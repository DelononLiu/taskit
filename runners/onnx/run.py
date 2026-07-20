#!/usr/bin/env python3
"""
ONNX Runtime 推理 + 逐层精度比对

Usage:
  python run.py --input model.onnx --output result.json
  python run.py --input baseline.onnx,quantized.onnx --output result.json --node-output nodes.npz
  python run.py --input model.onnx --output result.json --precision fp16 --batch-size 4
"""

import argparse
import json
import os
import copy
import importlib.util
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort


import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, relative_error, compute_snr


# ── ONNX model helpers ──

def get_node_shape_info(model, node):
    name_to_info = {}
    for vi in model.graph.value_info:
        name_to_info[vi.name] = vi
    for vi in model.graph.input:
        name_to_info[vi.name] = vi
    for vi in model.graph.output:
        name_to_info[vi.name] = vi
    input_shapes = []
    for inp in node.input:
        if inp in name_to_info:
            dims = [d.dim_value for d in name_to_info[inp].type.tensor_type.shape.dim]
            input_shapes.append(dims)
    output_shapes = []
    for out in node.output:
        if out in name_to_info:
            dims = [d.dim_value for d in name_to_info[out].type.tensor_type.shape.dim]
            output_shapes.append(dims)
    return input_shapes, output_shapes


def extract_graph(model, sampled_nodes, model_output_names):
    tensor_to_node = {}
    for node in model.graph.node:
        for out in node.output:
            if out:
                tensor_to_node[out] = node

    sampled_names = {node.name or f"{node.op_type}_{idx}" for idx, node in sampled_nodes}
    node_map = {}
    adj = {}
    rev_adj = {}

    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        node_map[name] = {"name": name, "opType": node.op_type, "idx": idx}
        adj[name] = []
        rev_adj[name] = []

    tensor_to_sampled = {}
    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for out in node.output:
            if out:
                tensor_to_sampled[out] = name

    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for inp in node.input:
            if inp in tensor_to_sampled:
                src = tensor_to_sampled[inp]
                if src != name:
                    adj[src].append(name)
                    rev_adj[name].append(src)

    in_deg = {n: len(rev_adj[n]) for n in node_map}
    queue = [n for n, d in in_deg.items() if d == 0]
    depth = {n: 0 for n in queue}
    while queue:
        cur = queue.pop(0)
        for child in adj[cur]:
            in_deg[child] -= 1
            depth[child] = max(depth.get(child, 0), depth[cur] + 1)
            if in_deg[child] == 0:
                queue.append(child)

    edges = []
    for src in adj:
        for dst in adj[src]:
            edges.append({"from": src, "to": dst})

    leaf_names = set()
    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for out in node.output:
            if out and any(out == mo for mo in model_output_names):
                leaf_names.add(name)
                break

    nodes_out = []
    for n in node_map.values():
        nodes_out.append({
            "name": n["name"],
            "opType": n["opType"],
            "depth": depth.get(n["name"], 0),
            "isLeaf": n["name"] in leaf_names,
        })
    nodes_out.sort(key=lambda x: (x["depth"], x["name"]))

    return {"nodes": nodes_out, "edges": edges, "outputs": model_output_names}


# ── Inference ──

def run_inference(model_path, batch_size=1):
    """Load ONNX model, run inference, return (meta_list, arrays_dict, graph_data)."""
    np.random.seed(42)
    model = onnx.load(model_path)

    input_meta = {i.name: i for i in model.graph.input}
    input_names = list(input_meta.keys())

    feed = {}
    if any(name in str(input_names).lower() for name in ["input_ids", "token_type_ids"]):
        seq_len = 32
        np.random.seed(42)
        num_real = min(seq_len - 2, 16)
        token_ids = [101] + np.random.randint(2000, 25000, num_real).tolist() + [102]
        token_ids += [0] * (seq_len - len(token_ids))
        attention = [1] * (num_real + 2) + [0] * (seq_len - num_real - 2)
        feed["input_ids"] = np.array([token_ids] * batch_size, dtype=np.int64)
        feed["attention_mask"] = np.array([attention] * batch_size, dtype=np.int64)
        feed["token_type_ids"] = np.zeros((batch_size, seq_len), dtype=np.int64)
    elif any(name in str(input_names).lower() for name in ["input", "data", "image", "pixel_values"]):
        input_name = input_names[0]
        shape_dims = [d.dim_value for d in input_meta[input_name].type.tensor_type.shape.dim]
        if len(shape_dims) == 4:
            shape = [batch_size if i == 0 else (d or 224) for i, d in enumerate(shape_dims)]
            feed[input_name] = np.random.rand(*shape).astype(np.float32)
        else:
            feed[input_name] = np.random.rand(batch_size, 3, 224, 224).astype(np.float32)
    else:
        for name, meta in input_meta.items():
            shape = [(d if d > 0 else 1) for d in meta.type.tensor_type.shape.dim]
            shape[0] = batch_size
            feed[name] = np.random.rand(*shape).astype(np.float32)

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    providers = ['CPUExecutionProvider']
    if 'CUDAExecutionProvider' in ort.get_available_providers():
        providers.insert(0, 'CUDAExecutionProvider')

    session = ort.InferenceSession(model_path, sess_options, providers=providers)
    orig_outputs = [o.name for o in session.get_outputs()]

    key_ops = {"MatMul", "Gemm", "Conv", "Relu", "Softmax"}
    layer_nodes = [(i, node) for i, node in enumerate(model.graph.node)
                   if node.op_type in key_ops and len(node.output) > 0]

    MAX_LAYERS = 50
    if len(layer_nodes) > MAX_LAYERS:
        step = len(layer_nodes) / MAX_LAYERS
        indices = [int(i * step) for i in range(MAX_LAYERS - 1)] + [len(layer_nodes) - 1]
        layer_nodes = [layer_nodes[i] for i in set(indices)]
        layer_nodes.sort(key=lambda x: x[0])

    graph_data = None
    try:
        graph_data = extract_graph(model, layer_nodes, orig_outputs)
    except Exception as e:
        print(f"[run] graph extraction skipped: {e}")

    aug_model = copy.deepcopy(model)
    vi_map = {vi.name: vi for vi in aug_model.graph.value_info}
    for _, node in layer_nodes:
        for out_name in node.output:
            if not out_name:
                continue
            if out_name in vi_map:
                aug_model.graph.output.append(vi_map[out_name])
            else:
                try:
                    vi = helper.make_tensor_value_info(out_name, TensorProto.FLOAT, None)
                    aug_model.graph.output.append(vi)
                except Exception:
                    continue

    aug_path = model_path + ".augmented.onnx"
    onnx.save(aug_model, aug_path)
    aug_session = ort.InferenceSession(aug_path, sess_options, providers=providers)
    aug_output_names = [o.name for o in aug_session.get_outputs()]

    results = aug_session.run(aug_output_names, feed)
    results_map = dict(zip(aug_output_names, results))

    if os.path.exists(aug_path):
        os.remove(aug_path)

    meta_list = []
    arrays = {}
    for idx, (node_idx, node) in enumerate(layer_nodes):
        layer_name = node.name or f"{node.op_type}_{node_idx}"
        input_shapes, output_shapes = get_node_shape_info(model, node)
        layer_out = node.output[0] if node.output else ""
        if layer_out and layer_out in results_map:
            val = results_map[layer_out]
            arrays[str(idx)] = val
            meta_list.append({
                "layerName": layer_name,
                "layerType": node.op_type,
                "inputShape": input_shapes[0] if input_shapes else [],
                "outputShape": list(val.shape),
            })

    return meta_list, arrays, graph_data


# ── Layer comparison ──

def compare_layers(meta_baseline, values_baseline, meta_target, values_target,
                   framework_id, threshold=0.95):
    layers = []
    for i, (lb, lt) in enumerate(zip(meta_baseline, meta_target)):
        key_b = str(i)
        key_t = str(i)
        if key_b not in values_baseline or key_t not in values_target:
            key_b = next((k for k in values_baseline
                          if values_baseline[k].shape == tuple(lb["outputShape"])), None)
            key_t = next((k for k in values_target
                          if values_target[k].shape == tuple(lt["outputShape"])), None)
            if key_b is None or key_t is None:
                continue

        bv = values_baseline[key_b]
        tv = values_target[key_t]
        if bv.shape != tv.shape or bv.size == 0:
            continue

        cos = cosine_similarity(bv, tv)
        metric = {
            "frameworkId": framework_id,
            "cosineSimilarity": round(cos, 8),
            "maxAbsError": round(max_abs_error(bv, tv), 8),
            "meanAbsError": round(mean_abs_error(bv, tv), 8),
            "relativeError": round(relative_error(bv, tv), 8),
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


# ── Main ──

def main():
    parser = argparse.ArgumentParser(
        description="ONNX Runtime inference + accuracy comparison")
    parser.add_argument("--input", required=True,
                        help="Model path, comma-separated for comparison")
    parser.add_argument("--output", required=True,
                        help="Output JSON path")
    parser.add_argument("--node-output", default="",
                        help="Node-level tensor output (.npz)")
    parser.add_argument("--precision", default="fp32",
                        choices=["fp32", "fp16", "int8"])
    parser.add_argument("--batch-size", type=int, default=1,
                        help="Batch size")
    parser.add_argument("--target-framework", default="",
                        help="Compare ONNX Runtime (baseline) vs target framework (e.g. openvino)")
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]
    output_path = args.output

    print(f"[onnx] input: {model_paths}")
    print(f"[onnx] output: {output_path}")
    print(f"[onnx] precision: {args.precision}, batch-size: {args.batch_size}")

    # Run inference on each model
    baseline_results = []  # (meta, tensors, graph)
    for mp in model_paths:
        print(f"[onnx] running inference: {mp}")
        meta, tensors, graph = run_inference(mp, args.batch_size)
        baseline_results.append((meta, tensors, graph))

    # Run target framework if specified (single model + target framework = compare)
    target_result = None  # (meta_list, tensors_dict) from target framework
    if args.target_framework and len(model_paths) == 1:
        target_fw = args.target_framework.lower()
        print(f"[onnx] comparing with target framework: {target_fw}")
        runner_map = {
            'openvino': os.path.join(os.path.dirname(__file__), '..', 'openvino', 'run.sh'),
        }
        runner_sh = runner_map.get(target_fw)
        if runner_sh and os.path.exists(runner_sh):
            import subprocess, tempfile
            with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as tmp_json, \
                 tempfile.NamedTemporaryFile(suffix='.npz', delete=False) as tmp_npz:
                tmp_out = tmp_json.name
                tmp_npz_path = tmp_npz.name
            try:
                cmd = f'bash {runner_sh} --input {model_paths[0]} --output {tmp_out} --node-output {tmp_npz_path} --batch-size {args.batch_size}'
                ret = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
                if ret.returncode == 0 and os.path.exists(tmp_out):
                    with open(tmp_out) as f:
                        fw_data = json.load(f)
                    fw_meta = fw_data.get('layers', [])
                    # Load target framework tensors from npz
                    fw_tensors = {}
                    if os.path.exists(tmp_npz_path) and os.path.getsize(tmp_npz_path) > 0:
                        fw_tensors = dict(np.load(tmp_npz_path, allow_pickle=True))
                        # np.savez prefixes integer-like keys with 'arr_'; normalize
                        fw_tensors = {k.replace('arr_', ''): v for k, v in fw_tensors.items()}
                    target_result = (fw_meta, fw_tensors)
                else:
                    print(f"[onnx] {target_fw} runner failed: {ret.stderr[:200]}")
            finally:
                for p in (tmp_out, tmp_npz_path):
                    if os.path.exists(p):
                        os.unlink(p)
        # Add more target frameworks here (tensorrt, etc.)

    has_baseline = len(baseline_results) > 0
    meta_b, tensors_b, graph_b = baseline_results[0]

    if target_result is not None:
        # Actually compare ONNX Runtime tensors vs target framework tensors
        target_meta_extra, target_tensors_by_idx = target_result
        ft = args.target_framework

        if target_tensors_by_idx:
            # Build name→tensor map for target framework (OV may decompose ops differently)
            # target_meta_extra[i] matches target_tensors_by_idx[str(i)]
            ov_name_to_tensor = {}
            for i, m in enumerate(target_meta_extra):
                k = str(i)
                if k in target_tensors_by_idx:
                    ov_name_to_tensor[m['layerName']] = target_tensors_by_idx[k]

            # Match ONNX layers to OV layers by ONNX node name, rebuilding
            # both sides with contiguous indices so compare_layers aligns correctly.
            # OV may split a fused ONNX op (e.g. Conv) into sub-ops like
            # "node/WithoutBiases" + "node" (bias-add). We prefer the final
            # bias-add output (exact name match) over decomposed sub-ops.
            matched_meta_b = []
            matched_meta_t = []
            matched_arrs_b = {}
            matched_arrs_t = {}
            skipped = 0
            for i, lb in enumerate(meta_b):
                onnx_name = lb['layerName']
                matched_name = None

                # 1) Exact name match (OV keeps the same name for bias-add final output)
                if onnx_name in ov_name_to_tensor:
                    matched_name = onnx_name
                else:
                    # 2) Prefix match — OV adds suffixes like /WithoutBiases.
                    #    Only accept if a non-/WithoutBiases variant exists
                    #    (the bias-add output).  Don't fall back to /WithoutBiases
                    #    because comparing Gemm+bias vs MatMul alone is misleading.
                    candidates = [n for n in ov_name_to_tensor
                                  if n == onnx_name or n.startswith(onnx_name + '/')]
                    no_bias = [n for n in candidates if '/WithoutBiases' not in n]
                    if no_bias:
                        matched_name = no_bias[0]

                if matched_name and matched_name in ov_name_to_tensor:
                    idx = len(matched_meta_b)
                    tv = ov_name_to_tensor[matched_name]
                    matched_meta_b.append(lb)
                    matched_meta_t.append({
                        "layerName": lb["layerName"],
                        "layerType": lb["layerType"],
                        "inputShape": lb.get("inputShape", []),
                        "outputShape": list(tv.shape),
                    })
                    matched_arrs_b[str(idx)] = tensors_b[str(i)]
                    matched_arrs_t[str(idx)] = tv
                else:
                    skipped += 1

            if skipped:
                print(f"[onnx] warning: {skipped}/{len(meta_b)} layers could not be matched to {ft} outputs")

            if matched_meta_b:
                result = compare_layers(matched_meta_b, matched_arrs_b,
                                        matched_meta_t, matched_arrs_t, ft)
                output = {"status": "ok", "framework": f"onnx_vs_{ft}",
                          "model": os.path.basename(model_paths[0]), **result}
            else:
                output = {
                    "status": "ok",
                    "framework": f"onnx_vs_{ft}",
                    "model": os.path.basename(model_paths[0]),
                    "overall": {"totalLayers": len(meta_b), "passedLayers": 0, "failedLayers": 0,
                                "avgCosineSimilarity": 0, "maxAbsError": 0, "worstLayer": ""},
                    "layers": [],
                }
        else:
            # Fallback: structural-only (no tensors from target)
            merged_layers = []
            for lb in meta_b:
                merged_layers.append({
                    "layerName": lb["layerName"],
                    "layerType": lb["layerType"],
                    "inputShape": lb.get("inputShape", []),
                    "outputShape": lb.get("outputShape", []),
                    "metrics": [
                        {"frameworkId": ft, "cosineSimilarity": 0, "maxAbsError": 0,
                         "meanAbsError": 0, "snr": 0, "passed": False},
                    ],
                })
            output = {
                "status": "ok",
                "framework": f"onnx_vs_{ft}",
                "model": os.path.basename(model_paths[0]),
                "overall": {"totalLayers": len(merged_layers), "passedLayers": 0, "failedLayers": 0,
                            "avgCosineSimilarity": 0, "maxAbsError": 0, "worstLayer": ""},
                "layers": merged_layers,
            }
        if graph_b:
            output["graph"] = graph_b
    elif len(baseline_results) >= 2:
        # Two models: compare
        _, _, graph_b = baseline_results[0]
        meta_t, tensors_t, _ = baseline_results[1]
        framework_id = f"onnx_{args.precision}"
        result = compare_layers(meta_b, tensors_b, meta_t, tensors_t, framework_id)
        output = {"status": "ok", "framework": "onnx",
                  "model": os.path.basename(model_paths[0]), **result}
        if graph_b:
            output["graph"] = graph_b
    else:
        # Single model, no comparison: metadata only
        output = {
            "status": "ok",
            "framework": "onnx",
            "model": os.path.basename(model_paths[0]),
            "overall": {
                "totalLayers": len(meta_b),
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
            } for l in meta_b],
        }
        if graph_b:
            output["graph"] = graph_b

    # Write output JSON
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    # Write node-output if requested
    if args.node_output and len(baseline_results) > 0:
        _, tensors, _ = baseline_results[0]
        if tensors:
            np.savez_compressed(args.node_output, **tensors)

    print(f"[onnx] done → {output_path}")


if __name__ == "__main__":
    main()
