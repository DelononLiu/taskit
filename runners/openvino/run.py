#!/usr/bin/env python3
"""
OpenVINO inference + layer-wise accuracy comparison runner.

Usage:
  python run.py --input model.onnx --output result.json
  python run.py --input baseline.onnx,target.onnx --output result.json
  python run.py --input model.onnx --output result.json --precision fp16 --batch-size 4
"""

import argparse
import json
import os
import numpy as np


import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, compute_snr


# ── Inference ──

def get_intermediate_layers(model):
    """Discover intermediate ops to capture as layers."""
    import openvino as ov
    key_ops = {"Convolution", "Relu", "Add", "Gemm", "MatMul", "Softmax", "MaxPool"}
    layers = []
    for op in model.get_ordered_ops():
        if op.get_type_name() in key_ops:
            friendly = op.get_friendly_name()
            # Prefer shorter names; skip auto-generated suffix-only names
            if len(friendly) > 40:
                continue
            layers.append((friendly, op))
    return layers


def run_inference(model_path, batch_size=1, precision='fp32'):
    """Load ONNX model with OpenVINO, run inference, return (meta, arrays, graph)."""
    np.random.seed(42)
    import openvino as ov

    core = ov.Core()
    model = core.read_model(model_path)

    if precision == 'fp16':
        model = ov.runtime.Model(model)
        for op in model.get_ordered_ops():
            if op.get_type_name() in ('Parameter', 'Constant'):
                continue
            try:
                ov.runtime.set_precision(op, ov.Type.f16)
            except Exception:
                pass

    # Generate random input
    input_map = {}
    for param in model.inputs:
        name = param.any_name
        shape = param.get_partial_shape().get_min_shape() if hasattr(param.get_partial_shape(), 'get_min_shape') else param.shape
        shape = [batch_size if i == 0 else (int(s) if s > 0 else 32) for i, s in enumerate(shape)]
        input_map[name] = np.random.rand(*shape).astype(np.float32)

    # Add intermediate outputs for layer capture
    layers = get_intermediate_layers(model)
    MAX_LAYERS = 50
    if len(layers) > MAX_LAYERS:
        step = len(layers) / MAX_LAYERS
        indices = [int(i * step) for i in range(MAX_LAYERS - 1)] + [len(layers) - 1]
        layers = [layers[i] for i in set(indices)]
        layers.sort(key=lambda x: {n: i for i, (n, _) in enumerate(layers)}.get(x[0], 0))

    for name, op in layers:
        try:
            model.add_outputs(op.output(0))
        except Exception:
            pass

    # Compile and run
    compiled = core.compile_model(model, "CPU")
    results = compiled(input_map)

    # Build layer metadata — match results by iterating (OV uses ConstOutput keys)
    result_list = list(results.items())
    meta_list = []
    arrays = {}
    # First result is always the original model output; subsequent ones are our added outputs
    for i, (name, op) in enumerate(layers):
        # Added outputs come after original outputs in result_list
        result_idx = i + 1  # +1 because results[0] is the original model output
        if result_idx >= len(result_list):
            break
        _, val = result_list[result_idx]
        arr = np.array(val, dtype=np.float32)
        arrays[str(i)] = arr
        meta_list.append({
            "layerName": name,
            "layerType": op.get_type_name(),
            "inputShape": [],
            "outputShape": list(arr.shape),
        })

    return meta_list, arrays, None


def compare_layers(meta_b, arrays_b, meta_t, arrays_t, framework_id, threshold=0.95):
    """Compare two sets of layer outputs and return overall + per-layer results."""
    layers = []
    for i, (lb, lt) in enumerate(zip(meta_b, meta_t)):
        kb, kt = str(i), str(i)
        if kb not in arrays_b or kt not in arrays_t:
            continue
        bv, tv = arrays_b[kb], arrays_t[kt]
        if bv.shape != tv.shape or bv.size == 0:
            continue

        cos = cosine_similarity(bv, tv)
        metric = {
            "frameworkId": framework_id,
            "cosineSimilarity": round(cos, 8),
            "maxAbsError": round(max_abs_error(bv, tv), 8),
            "meanAbsError": round(mean_abs_error(bv, tv), 8),
            "snr": round(compute_snr(bv, tv), 4),
            "passed": cos >= threshold,
        }
        layers.append({
            "layerName": lb["layerName"],
            "layerType": lb["layerType"],
            "inputShape": lb.get("inputShape", []),
            "outputShape": lb.get("outputShape", []),
            "metrics": [metric],
        })

    total = len(layers)
    passed = sum(1 for l in layers if all(m["passed"] for m in l["metrics"]))
    all_cos = [m["cosineSimilarity"] for l in layers for m in l["metrics"]]
    all_err = [m["maxAbsError"] for l in layers for m in l["metrics"]]

    return {
        "overall": {
            "totalLayers": total,
            "passedLayers": passed,
            "failedLayers": total - passed,
            "avgCosineSimilarity": round(sum(all_cos) / len(all_cos), 6) if all_cos else 0,
            "maxAbsError": max(all_err) if all_err else 0,
            "worstLayer": min(layers, key=lambda l: min(m["cosineSimilarity"]
                              for m in l["metrics"]))["layerName"]
            if layers and all_cos else "",
        },
        "layers": layers,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenVINO inference + comparison")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-output", default="")
    parser.add_argument("--precision", default="fp32", choices=["fp32", "fp16"])
    parser.add_argument("--batch-size", type=int, default=1)
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    all_results = []
    for mp in model_paths:
        print(f"[openvino] running inference: {mp}")
        meta, arrays, graph = run_inference(mp, args.batch_size, args.precision)
        all_results.append((mp, meta, arrays, graph))

    if len(all_results) == 1:
        mp, meta, arrays, graph = all_results[0]
        output = {
            "status": "ok",
            "framework": "openvino",
            "model": os.path.basename(mp),
            "overall": {
                "totalLayers": len(meta),
                "passedLayers": 0,
                "failedLayers": 0,
                "avgCosineSimilarity": 0,
                "maxAbsError": 0,
                "worstLayer": "",
            },
            "layers": [{
                "layerName": l["layerName"],
                "layerType": l["layerType"],
                "inputShape": l["inputShape"],
                "outputShape": l["outputShape"],
                "metrics": [],
            } for l in meta],
        }
        if graph:
            output["graph"] = graph
    else:
        _, meta_b, arrays_b, graph_b = all_results[0]
        _, meta_t, arrays_t, _ = all_results[1]
        result = compare_layers(meta_b, arrays_b, meta_t, arrays_t,
                                f"openvino_{args.precision}")
        output = {"status": "ok", "framework": "openvino",
                  "model": os.path.basename(model_paths[0]), **result}
        if graph_b:
            output["graph"] = graph_b

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    if args.node_output and len(all_results) > 0:
        _, _, arrays, _ = all_results[0]
        if arrays:
            np.savez_compressed(args.node_output, **arrays)

    print(f"[openvino] done → {args.output}")


if __name__ == "__main__":
    main()
