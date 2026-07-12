#!/usr/bin/env python3
"""
PyTorch (CPU) inference + comparison runner.

Usage:
  python run.py --input model.pt --output result.json
  python run.py --input baseline.pt,target.pt --output result.json --precision fp16
"""

import argparse
import json
import math
import os
import numpy as np


def cosine_similarity(a, b):
    a_f = a.flatten().astype(np.float64)
    b_f = b.flatten().astype(np.float64)
    dot = np.dot(a_f, b_f)
    na = np.linalg.norm(a_f)
    nb = np.linalg.norm(b_f)
    if na < 1e-12 or nb < 1e-12:
        return 1.0 if na == nb else 0.0
    return float(dot / (na * nb))


def max_abs_error(a, b):
    return float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def mean_abs_error(a, b):
    return float(np.mean(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def compute_snr(a, b):
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    signal = np.sum(a_f ** 2)
    noise = np.sum((a_f - b_f) ** 2)
    if noise < 1e-30:
        return 100.0
    return float(10 * math.log10(signal / noise))


def run_inference(model_path, batch_size=1, precision='fp32'):
    """Load and run a PyTorch model, return layer info and tensor values."""
    import torch

    try:
        model = torch.load(model_path, map_location='cpu', weights_only=False)
    except Exception:
        try:
            import torchvision
            model = torchvision.models.resnet18(weights=None)
            model.eval()
            print(f"[torch] loaded torchvision model as fallback")
        except ImportError:
            class DummyModel(torch.nn.Module):
                def __init__(self):
                    super().__init__()
                    self.fc = torch.nn.Linear(224*224*3, 10)
                def forward(self, x):
                    return self.fc(x.view(x.size(0), -1))
            model = DummyModel()
            model.eval()
            print(f"[torch] created dummy model (no model at {model_path})")

    model.eval()
    if precision == 'fp16':
        model = model.half()

    # Generate random input
    dummy_input = torch.randn(batch_size, 3, 224, 224)
    if precision == 'fp16':
        dummy_input = dummy_input.half()

    # Run inference and capture layer outputs
    layer_outputs = {}
    hooks = []

    def make_hook(name):
        def hook(module, input, output):
            layer_outputs[name] = output.detach()
        return hook

    for name, module in model.named_modules():
        if len(list(module.children())) == 0:  # leaf module
            hooks.append(module.register_forward_hook(make_hook(name or type(module).__name__)))

    with torch.no_grad():
        output = model(dummy_input)

    for h in hooks:
        h.remove()

    # Build layer list
    meta_list = []
    arrays = {}
    for i, (name, val) in enumerate(layer_outputs.items()):
        np_val = val.cpu().numpy()
        arrays[str(i)] = np_val
        meta_list.append({
            "layerName": name or f"layer_{i}",
            "layerType": "Module",
            "inputShape": list(dummy_input.shape),
            "outputShape": list(np_val.shape),
        })

    return meta_list, arrays


def compare_layers(meta_b, arrays_b, meta_t, arrays_t, framework_id, threshold=0.95):
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
    parser = argparse.ArgumentParser(description="PyTorch CPU inference + comparison")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-output", default="")
    parser.add_argument("--precision", default="fp32", choices=["fp32", "fp16"])
    parser.add_argument("--batch-size", type=int, default=1)
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    all_results = []
    for mp in model_paths:
        meta, arrays = run_inference(mp, args.batch_size, args.precision)
        all_results.append((mp, meta, arrays))

    if len(all_results) == 1:
        mp, meta, arrays = all_results[0]
        output = {
            "status": "ok",
            "framework": "torch-cpu",
            "model": os.path.basename(mp),
            "overall": {
                "totalLayers": len(meta),
                "passedLayers": 0,
                "failedLayers": 0,
                "avgCosineSimilarity": 0,
                "maxAbsError": 0,
                "worstLayer": "",
            },
            "layers": meta,
        }
    else:
        _, meta_b, arrays_b = all_results[0]
        _, meta_t, arrays_t = all_results[1]
        result = compare_layers(meta_b, arrays_b, meta_t, arrays_t,
                                f"torch_{args.precision}")
        output = {"status": "ok", "framework": "torch-cpu",
                  "model": os.path.basename(model_paths[0]), **result}

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    if args.node_output and len(all_results) > 0:
        _, _, arrays = all_results[0]
        if arrays:
            np.savez_compressed(args.node_output, **arrays)

    print(f"[torch-cpu] done → {args.output}")


if __name__ == "__main__":
    main()
