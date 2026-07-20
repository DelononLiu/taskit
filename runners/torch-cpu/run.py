#!/usr/bin/env python3
"""
PyTorch (CPU) inference + comparison runner.

Usage:
  python run.py --input model.pt --output result.json
  python run.py --input baseline.pt,target.pt --output result.json --precision fp16
"""

import argparse
import json
import os
import importlib.util
import numpy as np
import torch


import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, compute_snr


def _load_model(model_path, model_script=None):
    """Load a PyTorch model from file.

    Supports:
    - Full model saved with ``torch.save(model, path)``
    - State dict, when ``model_script`` points to a Python file with a Model class
    """

    raw = torch.load(model_path, map_location='cpu', weights_only=False)

    if isinstance(raw, dict):
        # State dict — need model architecture
        if model_script and os.path.isfile(model_script):
            import ast

            # Try importing the module normally
            ModelClass = None
            try:
                spec = importlib.util.spec_from_file_location("model_mod", model_script)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                for name in dir(mod):
                    obj = getattr(mod, name)
                    if isinstance(obj, type) and issubclass(obj, torch.nn.Module) and obj is not torch.nn.Module:
                        ModelClass = obj
                        break
            except ModuleNotFoundError:
                pass

            # Fallback: parse AST to extract model class without running imports
            if ModelClass is None:
                with open(model_script) as f:
                    tree = ast.parse(f.read())
                class_node = None
                for node in ast.walk(tree):
                    if isinstance(node, ast.ClassDef):
                        for base in node.bases:
                            base_name = ast.unparse(base)
                            if 'Module' in base_name:
                                class_node = node
                                break
                if class_node is None:
                    raise RuntimeError(f"No torch.nn.Module subclass found in {model_script}")
                # Reconstruct class code and exec with torch in namespace
                body_lines = []
                for node in class_node.body:
                    body_lines.append(ast.unparse(node))
                class_code = f"class {class_node.name}(torch.nn.Module):\n"
                for line in body_lines:
                    class_code += f"  {line}\n"
                namespace = {'torch': torch, 'nn': torch.nn, 'F': torch.nn.functional}
                exec(compile(ast.parse(class_code), model_script, 'exec'), namespace)
                ModelClass = namespace[class_node.name]

            model = ModelClass()
            model.load_state_dict(raw)
            print(f"[torch] loaded state_dict into {ModelClass.__name__} from {model_script}")
        else:
            raise RuntimeError(
                "Model file is a state_dict. Provide --model-script with the model definition file."
            )
    else:
        model = raw

    model.eval()
    return model


def _guess_input_shape(model, default_size=32):
    """Detect input channels from first conv layer; fall back to 3."""
    in_channels = 3
    for m in model.modules():
        if isinstance(m, (torch.nn.Conv1d, torch.nn.Conv2d, torch.nn.Conv3d)):
            in_channels = m.in_channels
            break
    return in_channels, default_size, default_size


def run_inference(model_path, batch_size=1, precision='fp32', model_script=None, input_shape=None, export_onnx=None):
    """Load and run a PyTorch model, return layer info and tensor values.

    If ``export_onnx`` is a file path, exports the model to ONNX after inference.
    """
    np.random.seed(42)
    torch.manual_seed(42)
    model = _load_model(model_path, model_script)

    if precision == 'fp16':
        model = model.half()

    if input_shape:
        c, h, w = input_shape
    else:
        c, h, w = _guess_input_shape(model)
    dummy_input = torch.randn(batch_size, c, h, w)
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

    # Export to ONNX if requested
    if export_onnx:
        torch.onnx.export(
            model,
            dummy_input,
            export_onnx,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
            opset_version=18,
            do_constant_folding=True,
            external_data=False,
        )
        print(f"[torch] exported ONNX → {export_onnx}")

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
    parser.add_argument("--model-script", default="",
                        help="Path to .py file with model class (required for state_dict)")
    parser.add_argument("--input-shape", default="",
                        help="Input shape as CxHxW, e.g. 1x28x28 (auto-detected if omitted)")
    parser.add_argument("--export-onnx", default="",
                        help="Export model to ONNX at this path after inference")
    args = parser.parse_args()

    input_shape = None
    if args.input_shape:
        parts = [int(x) for x in args.input_shape.split("x")]
        if len(parts) == 3:
            input_shape = tuple(parts)

    model_paths = [p.strip() for p in args.input.split(",")]

    all_results = []
    for mp in model_paths:
        meta, arrays = run_inference(mp, args.batch_size, args.precision,
                                     args.model_script or None, input_shape,
                                     args.export_onnx or None)
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
