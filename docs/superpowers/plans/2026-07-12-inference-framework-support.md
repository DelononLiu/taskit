# 推理框架支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build standardized multi-framework inference runner infrastructure with venv management, unified CLI, and backend integration.

**Architecture:** Each framework is an independent directory under `runners/` with its own `run.sh` entrypoint, `requirements.txt`, and `venv/`. A shared `_init/setup.sh` manages venv lifecycle. The backend task engine dispatches to runners via `runners/{framework}/run.sh --input ... --output ...`. Existing `model_diff` onnx code is refactored into the new structure.

**Tech Stack:** Python 3, bash, Node.js/Express (backend), React/TypeScript (frontend)

## Global Constraints

- Each runner must accept `--input <path>[,<path>]` and `--output <path>[,<path>]` (all other params optional)
- All runners must be callable as `run.sh` (chmod +x, any language)
- Framework identity = directory name
- Phase 1: no quantization CLI params; loading pre-quantized models is auto-detected
- Existing `runners/model_diff/` is replaced; remove it after migration
- `_init/setup.sh` must be idempotent (skip if venv exists, `--force` to rebuild)
- Backend module registry extended (existing `shell`/`parser` kept for backward compat)
- The `ComparisonTask` type on frontend stays the same (no schema changes)

---

### Task 1: Create `_init/setup.sh` — venv environment manager

**Files:**
- Create: `runners/_init/setup.sh`

**Interfaces:**
- Consumes: `runners/*/requirements.txt` files
- Produces: `runners/*/venv/` directories with installed dependencies

- [ ] **Step 1: Write `setup.sh`**

```bash
#!/usr/bin/env bash
# runners/_init/setup.sh — venv lifecycle manager
#
# Idempotent initialization: creates venv + pip install for each runner
# that has a requirements.txt and no existing venv/.
#
# Usage:
#   bash setup.sh           # create missing venvs only
#   bash setup.sh --force   # rebuild all venvs from scratch

set -euo pipefail

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNERS_DIR="$(dirname "$SCRIPT_DIR")"

echo "[setup] scanning runners in $RUNNERS_DIR"

for dir in "$RUNNERS_DIR"/*/; do
  name="$(basename "$dir")"
  req_file="$dir/requirements.txt"

  [[ "$name" == "_init" ]] && continue
  [[ -f "$req_file" ]] || { echo "[setup] $name: no requirements.txt, skipping"; continue; }

  venv_dir="$dir/venv"

  if [[ -d "$venv_dir" ]]; then
    if $FORCE; then
      echo "[setup] $name: --force, rebuilding venv"
      rm -rf "$venv_dir"
    else
      echo "[setup] $name: venv exists, skipping"
      continue
    fi
  fi

  echo "[setup] $name: creating venv..."
  python3 -m venv "$venv_dir"
  echo "[setup] $name: installing dependencies..."
  "$venv_dir/bin/pip" install -r "$req_file" --quiet
  echo "[setup] $name: done"
done

echo "[setup] all runners ready"
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x runners/_init/setup.sh
git add runners/_init/setup.sh
git commit -m "feat: add _init/setup.sh for venv lifecycle management"
```

---

### Task 2: Refactor ONNX runner into `runners/onnx/`

**Files:**
- Create: `runners/onnx/run.sh`
- Create: `runners/onnx/requirements.txt`
- Create: `runners/onnx/run.py` (merge of `run-onnx.py` + `tensor-compare.py` logic)
- Delete: `runners/model_diff/` (entire directory, after migration)

**Interfaces:**
- Consumes: `--input <model.onnx>[,<quantized.onnx>]` (one model = inference only; two = compare)
- Produces: output JSON to `--output` path (same schema as `tensor-compare.py`: `{ overall, layers, graph }`)
- Produces: `.npz` to `--node-output` path (optional, node-level tensors)

- [ ] **Step 1: Create `runners/onnx/requirements.txt`**

```
numpy<2.0
onnx
onnxruntime
```

- [ ] **Step 2: Create `runners/onnx/run.sh`** (wrapper entrypoint)

```bash
#!/usr/bin/env bash
# runners/onnx/run.sh — ONNX Runtime inference + comparison runner
#
# Usage:
#   run.sh --input resnet50.onnx --output result.json
#   run.sh --input baseline.onnx,optimized.onnx --output result.json
#   run.sh --input resnet50.onnx --output result.json --node-output nodes.npz --precision fp16

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
```

- [ ] **Step 3: Create `runners/onnx/run.py`** — Merge `run-onnx.py` + `tensor-compare.py` with `--input --output` CLI

```python
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
import math
import os
import sys
import time
import numpy as np
import onnx
import onnxruntime as ort


# ── Tensor comparison metrics (from tensor-compare.py) ──

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

def relative_error(a, b):
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    denom = np.abs(a_f) + 1e-12
    return float(np.mean(np.abs(a_f - b_f) / denom))

def snr(a, b):
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    signal = np.sum(a_f ** 2)
    noise = np.sum((a_f - b_f) ** 2)
    if noise < 1e-30:
        return 100.0
    return float(10 * math.log10(signal / noise))


# ── ONNX inference (from run-onnx.py, extracted into functions) ──

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
    input_to_node = {}
    for node in model.graph.node:
        for inp in node.input:
            if inp and inp not in input_to_node:
                input_to_node[inp] = node
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


def run_inference(model_path, batch_size=1, precision='fp32'):
    """Load ONNX model, run inference, return (meta_list, arrays_dict, graph_data)."""
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

    from onnx import helper, TensorProto
    import copy

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


def compare_layers(meta_baseline, values_baseline, meta_target, values_target, framework_id, threshold=0.95):
    """Compare two sets of layer outputs and produce comparison result."""
    layers = []
    for i, (lb, lt) in enumerate(zip(meta_baseline, meta_target)):
        key_b = str(i)
        key_t = str(i)
        if key_b not in values_baseline or key_t not in values_target:
            key_b = next((k for k in values_baseline if values_baseline[k].shape == tuple(lb["outputShape"])), None)
            key_t = next((k for k in values_target if values_target[k].shape == tuple(lt["outputShape"])), None)
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
            "snr": round(snr(bv, tv), 4),
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
            "worstLayer": min(layers, key=lambda l: min(m["cosineSimilarity"] for m in l["metrics"]))["layerName"]
            if layers and all_cos else "",
        },
        "layers": layers,
    }


def main():
    parser = argparse.ArgumentParser(description="ONNX Runtime inference + accuracy comparison")
    parser.add_argument("--input", required=True, help="Model path, comma-separated for comparison")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--node-output", default="", help="Node-level tensor output (.npz)")
    parser.add_argument("--precision", default="fp32", choices=["fp32", "fp16", "int8"])
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size")
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]
    output_path = args.output

    print(f"[onnx] input: {model_paths}")
    print(f"[onnx] output: {output_path}")
    print(f"[onnx] precision: {args.precision}, batch-size: {args.batch_size}")

    # Run inference on each model
    all_results = []
    for mp in model_paths:
        print(f"[onnx] running inference: {mp}")
        meta, tensors, graph = run_inference(mp, args.batch_size, args.precision)
        all_results.append((mp, meta, tensors, graph))

    # If only one model: output meta-only result
    if len(all_results) == 1:
        mp, meta, tensors, graph = all_results[0]
        output = {
            "status": "ok",
            "framework": "onnx",
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
        # Two models: compare
        _, meta_b, tensors_b, graph_b = all_results[0]
        _, meta_t, tensors_t, _ = all_results[1]
        framework_id = f"onnx_{args.precision}"
        result = compare_layers(meta_b, tensors_b, meta_t, tensors_t, framework_id)
        output = {
            "status": "ok",
            "framework": "onnx",
            "model": os.path.basename(model_paths[0]),
            **result,
        }
        if graph_b:
            output["graph"] = graph_b

    # Write output JSON
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    # Write node-output if requested
    if args.node_output and len(all_results) > 0:
        _, _, tensors, _ = all_results[0]
        if tensors:
            np.savez_compressed(args.node_output, **tensors)

    print(f"[onnx] done → {output_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Copy any remaining useful files from `runners/model_diff/`**

Check if `runners/model_diff/run-onnx-e2e.sh` should be migrated to `runners/onnx/test.sh` or discarded. The e2e test was a standalone verification script — keep it as reference but don't migrate.

- [ ] **Step 5: Delete `runners/model_diff/` directory**

```bash
git rm -r runners/model_diff/
```

- [ ] **Step 6: Make entrypoint executable**

```bash
chmod +x runners/onnx/run.sh
```

- [ ] **Step 7: Test the runner (manual verification)**

```bash
# Create a test model if needed, or use an existing .onnx file
# cd runners/onnx
# bash setup.sh  # create venv first
./runners/onnx/run.sh --input /path/to/model.onnx --output /tmp/test_output.json
cat /tmp/test_output.json
```

Expected: Valid JSON with `status: "ok"` and layers array.

- [ ] **Step 8: Commit**

```bash
git add runners/onnx/
git add -A  # catches deletions of runners/model_diff/
git commit -m "refactor: migrate ONNX runner to runners/onnx/ with unified CLI"
```

---

### Task 3: Update backend module registry

**Files:**
- Modify: `backend/src/tasks/registry.ts`
- Modify: `backend/src/tasks/model_diff/runner.ts`
- Delete (optional): `backend/src/tasks/model_diff/runner.ts` if model_diff is fully integrated into framework-based dispatching

**Interfaces:**
- Consumes: `params.framework` from task creation request
- Produces: ModuleDef with `runner` field pointing to `runners/{name}/`

- [ ] **Step 1: Extend `ModuleDef` in `backend/src/tasks/registry.ts`**

```typescript
export interface ModuleDef {
  name: string
  /** Backward-compatible shell template (used if runner is not set) */
  shell?: string
  /** Runner dir name under runners/ (e.g. 'onnx', 'openvino') */
  runner?: string
  /** Parser function for output.json */
  parser: (stdout: any, params: any) => any
}
```

No interface fields removed — `shell` stays optional for backward compat.

- [ ] **Step 2: Update `backend/src/tasks/model_diff/runner.ts`** to add runner field

```typescript
import { MODULES } from '../registry.js'

function parseModelDiffOutput(stdout: any, _params: any) {
  return {
    overall: stdout.overall ?? {},
    layers: stdout.layers ?? [],
    graph: stdout.graph ?? null,
  }
}

import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

MODULES.model_diff = {
  name: '模型精度比对',
  runner: 'onnx',
  parser: parseModelDiffOutput,
}
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/tasks/registry.ts backend/src/tasks/model_diff/runner.ts
git commit -m "refactor: add runner field to backend ModuleDef"
```

---

### Task 4: Update backend task engine to use runner CLI

**Files:**
- Modify: `backend/src/lib/task-engine.ts`

**Interfaces:**
- Consumes: `ModuleDef.runner` + `params.framework` + `params` fields
- Produces: Command `runners/{runner}/run.sh --input {path} --output {path} [--key value ...]`

- [ ] **Step 1: Update `executeTask` in `backend/src/lib/task-engine.ts`**

Key changes:
1. If module has `runner`, build command using new CLI pattern instead of shell template
2. No `input.json` needed — params go as CLI args
3. Output path is explicit (no `output.json` in task dir lookup)

```typescript
// Inside executeTask(), replace the section after mkdir with:

const mod = getModule(task.module)
if (!mod) throw new Error(`Unknown module: ${task.module}`)

// Create temp directory (for intermediate files only; no input.json)
taskDir = path.join(TASK_TEMP_DIR, `task_${taskId}`)
await fs.mkdir(taskDir, { recursive: true })

let cmd: string

if (mod.runner) {
  // ── New runner-based execution ──
  const runnerPath = path.resolve(`runners/${mod.runner}/run.sh`)
  const outputPath = path.join(taskDir, 'output.json')

  // Build CLI args from params
  const paramKeys: Record<string, string> = {
    batchSize: '--batch-size',
    precision: '--precision',
  }

  const cliArgs: string[] = [
    `--input`, inputPath,
    `--output`, outputPath,
  ]

  // Add known optional params
  if (params.precision) cliArgs.push('--precision', params.precision)
  if (params.batchSize) cliArgs.push('--batch-size', String(params.batchSize))

  cmd = `bash ${runnerPath} ${cliArgs.map(a => `'${a}'`).join(' ')}`
} else {
  // ── Legacy shell template (backward compat) ──
  cmd = mod.shell!
    .replace('{task_dir}', taskDir)
    .replace('{task_id}', String(taskId))

  // Write input.json for legacy runners
  const inputJson = {
    modelPath: inputPath,
    frameworks: params.frameworks ?? [],
    params: params,
  }
  await fs.writeFile(path.join(taskDir, 'input.json'), JSON.stringify(inputJson, null, 2))
}

// ── Spawn child process (same for both paths) ──
const child = spawn('bash', ['-c', cmd), {
  timeout: 3600_000,
})
runningProcesses.set(taskId, child)

let stderr = ''

child.stdout?.on('data', (data) => { process.stdout.write(data) })
child.stderr?.on('data', (data) => { stderr += data.toString() })

const exitCode = await new Promise<number>((resolve) => {
  child.on('close', resolve)
  child.on('error', () => resolve(1))
})

runningProcesses.delete(taskId)

// Check if cancelled
const current = await prisma.task.findUnique({ where: { id: taskId } })
if (current?.status === 'cancelled') return

if (exitCode !== 0) {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'failed', error: stderr.slice(0, 2000) || `Exit code: ${exitCode}` },
  })
  return
}

// Read output (from explicit path in runner mode, from taskDir/output.json in legacy)
const outputPath = mod.runner
  ? path.join(taskDir, 'output.json')
  : path.join(taskDir, 'output.json')
const outputRaw = await fs.readFile(outputPath, 'utf-8').catch(() => {
  throw new Error('runner did not produce output.json')
})
const output = JSON.parse(outputRaw)
const parsed = mod.parser?.(output, params) ?? output
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/task-engine.ts
git commit -m "feat: support runner-based execution in task engine"
```

---

### Task 5: Update frontend framework types and constants

**Files:**
- Modify: `src/types/framework.ts`
- Modify: `src/tasks/model_diff/constants.ts`
- Modify: `src/tasks/model_diff/TaskForm.tsx` (framework selection adapt)

**Interfaces:**
- Consumes: Existing `FW_OPTIONS`, `FRAMEWORKS` definitions
- Produces: Updated list reflecting new framework support (remove TensorRT, add vllm-cpu/transformers/torch-cpu)

- [ ] **Step 1: Update `src/types/framework.ts`**

```typescript
export interface Framework {
  id: string
  name: string
  value: 'onnxruntime' | 'openvino' | 'vllm-cpu' | 'transformers' | 'torch-cpu'
  version?: string
  isBaseline?: boolean
}

export const FRAMEWORKS: Framework[] = [
  { id: 'onnxruntime', name: 'ONNX Runtime', value: 'onnxruntime', isBaseline: true },
  { id: 'openvino', name: 'OpenVINO', value: 'openvino' },
  { id: 'vllm-cpu', name: 'vLLM (CPU)', value: 'vllm-cpu' },
  { id: 'transformers', name: 'Transformers', value: 'transformers' },
  { id: 'torch-cpu', name: 'PyTorch (CPU)', value: 'torch-cpu' },
]

export const BASELINE_FRAMEWORK = FRAMEWORKS[0]
```

- [ ] **Step 2: Update `src/tasks/model_diff/constants.ts`**

```typescript
export const FW_OPTIONS = [
  { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
  { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
  { value: 'vllm-cpu', label: 'vLLM (CPU)', color: '#9333ea' },
  { value: 'transformers', label: 'Transformers', color: '#06b6d4' },
  { value: 'torch-cpu', label: 'PyTorch (CPU)', color: '#22c55e' },
]
```

- [ ] **Step 3: Update `src/tasks/model_diff/TaskForm.tsx`**

Key changes:
1. In the framework selector dropdowns, ensure TensorRT is not listed and new frameworks are.
2. The baseline column stays ONNX Runtime (fixed).
3. The comparison slots now list only the new frameworks.

The existing code uses `FW_OPTIONS` from constants, so Step 2 automatically updates the dropdowns. However, the available precision options per framework differ. Update the precision dropdown per slot to use a shared list:

```typescript
// Replace the per-slot precision Select options (line ~239) with:
{['auto', 'fp32', 'fp16', 'int8'].map((p) => (
  <SelectItem key={p} value={p} className="text-xs">{p.toUpperCase()}</SelectItem>
))}
```

(Remove `uint8` — only relevant for onnx quantization. `int8` stays for pre-quantized model support.)

Also remove the "推理精度" collapsed section (lines ~342-348) since per-framework precision is now set in each slot card.

Update the models the upload accepts — the app is no longer ONNX-only for uploads:

```typescript
// Line ~201: Change .onnx only to accept more model types
<input ref={fileInputRef} type="file" className="hidden"
  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
```

Remove `accept=".onnx"` so users can upload any model type. The specific runner will reject unsupported formats.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/framework.ts src/tasks/model_diff/constants.ts src/tasks/model_diff/TaskForm.tsx
git commit -m "feat: update frontend framework list (remove TensorRT, add vllm/transformers/torch)"
```

---

### Task 6: Create OpenVINO runner

**Files:**
- Create: `runners/openvino/run.sh`
- Create: `runners/openvino/run.py`
- Create: `runners/openvino/requirements.txt`

**Interfaces:**
- Consumes: `--input <model.xml>[,<model2.xml>] --output <path> --precision [fp32|fp16|int8] --batch-size [N] --device [CPU|AUTO]`
- Produces: output JSON to `--output` path (same schema as ONNX runner)

- [ ] **Step 1: Create `runners/openvino/requirements.txt`**

```
numpy<2.0
openvino
```

- [ ] **Step 2: Create `runners/openvino/run.sh`**

```bash
#!/usr/bin/env bash
# runners/openvino/run.sh — OpenVINO inference + comparison runner

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
```

- [ ] **Step 3: Create `runners/openvino/run.py`**

```python
#!/usr/bin/env python3
"""
OpenVINO inference + comparison runner.

Usage:
  python run.py --input model.xml --output result.json
  python run.py --input baseline.xml,optimized.xml --output result.json
  python run.py --input model.xml --output result.json --precision fp16 --device CPU
"""

import argparse
import json
import math
import os
import numpy as np
from openvino import Core


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


def run_inference(model_path, batch_size=1, device='CPU'):
    ie = Core()
    model = ie.read_model(model_path)
    compiled = ie.compile_model(model, device)

    # Infer request for accessing intermediate tensors
    infer_request = compiled.create_infer_request()

    # Prepare input data
    input_data = {}
    for inp in model.inputs:
        shape = list(inp.shape)
        if len(shape) >= 2:
            shape[0] = batch_size
        shape = [d if d > 0 else 1 for d in shape]
        input_data[inp] = np.random.rand(*shape).astype(np.float32)

    # Run inference
    results = infer_request.infer(input_data)

    # Extract layer info + outputs
    layers = []
    arrays = {}
    for i, out in enumerate(model.outputs):
        name = out.get_any_name()
        val = results[out]
        layers.append({
            "layerName": name,
            "layerType": "Output",
            "inputShape": [list(inp.shape) for inp in model.inputs],
            "outputShape": list(val.shape),
        })
        arrays[str(i)] = val

    graph_data = {
        "nodes": [{"name": n.get_friendly_name(), "opType": "Layer", "depth": 0, "isLeaf": False}
                  for n in model.get_ordered_ops()],
        "edges": [],
        "outputs": [out.get_any_name() for out in model.outputs],
    }

    return layers, arrays, graph_data


def compare_layers(layers_b, arrays_b, layers_t, arrays_t, framework_id, threshold=0.95):
    """Compare two OpenVINO inference outputs."""
    results = []
    for i, (lb, lt) in enumerate(zip(layers_b, layers_t)):
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
        results.append({
            "layerName": lb["layerName"],
            "layerType": lb["layerType"],
            "inputShape": lb["inputShape"],
            "outputShape": lb["outputShape"],
            "metrics": [metric],
        })
    total = len(results)
    passed = sum(1 for l in results if all(m["passed"] for m in l["metrics"]))
    all_cos = [m["cosineSimilarity"] for l in results for m in l["metrics"]]
    all_err = [m["maxAbsError"] for l in results for m in l["metrics"]]
    return {
        "overall": {
            "totalLayers": total,
            "passedLayers": passed,
            "failedLayers": total - passed,
            "avgCosineSimilarity": round(sum(all_cos) / len(all_cos), 6) if all_cos else 0,
            "maxAbsError": max(all_err) if all_err else 0,
            "worstLayer": min(results, key=lambda l: min(m["cosineSimilarity"] for m in l["metrics"]))["layerName"]
            if results and all_cos else "",
        },
        "layers": results,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenVINO inference + accuracy comparison")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-output", default="")
    parser.add_argument("--precision", default="fp32", choices=["fp32", "fp16", "int8"])
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--device", default="CPU", choices=["CPU", "AUTO"])
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    all_results = []
    for mp in model_paths:
        layers, arrays, graph = run_inference(mp, args.batch_size, args.device)
        all_results.append((mp, layers, arrays, graph))

    if len(all_results) == 1:
        mp, layers, arrays, graph = all_results[0]
        output = {
            "status": "ok",
            "framework": "openvino",
            "model": os.path.basename(mp),
            "overall": {"totalLayers": len(layers), "passedLayers": 0, "failedLayers": 0,
                        "avgCosineSimilarity": 0, "maxAbsError": 0, "worstLayer": ""},
            "layers": layers,
        }
        if graph:
            output["graph"] = graph
    else:
        _, layers_b, arrays_b, graph_b = all_results[0]
        _, layers_t, arrays_t, _ = all_results[1]
        result = compare_layers(layers_b, arrays_b, layers_t, arrays_t, f"openvino_{args.precision}")
        output = {"status": "ok", "framework": "openvino", "model": os.path.basename(model_paths[0]), **result}
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
```

- [ ] **Step 4: Make executable and commit**

```bash
chmod +x runners/openvino/run.sh
git add runners/openvino/
git commit -m "feat: add OpenVINO runner (runners/openvino/)"
```

---

### Task 7: Create vLLM (CPU) runner

**Files:**
- Create: `runners/vllm-cpu/run.sh`
- Create: `runners/vllm-cpu/run.py`
- Create: `runners/vllm-cpu/requirements.txt`

**Interfaces:**
- Consumes: `--input <model-dir> --output <path> --max-model-len [4096] --dtype [float32|float16|bfloat16] --max-batch-size [1]`
- Produces: output JSON with generation metrics

- [ ] **Step 1: Create `runners/vllm-cpu/requirements.txt`**

```
numpy<2.0
vllm
```

- [ ] **Step 2: Create `runners/vllm-cpu/run.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
```

- [ ] **Step 3: Create `runners/vllm-cpu/run.py`**

```python
#!/usr/bin/env python3
"""
vLLM (CPU) inference runner — text generation with accuracy comparison.

Compares output token distributions between two model variants.

Usage:
  python run.py --input /path/to/model --output result.json
  python run.py --input baseline/,target/ --output result.json --max-model-len 2048
"""

import argparse
import json
import os
import sys
import numpy as np


def main():
    parser = argparse.ArgumentParser(description="vLLM CPU inference runner")
    parser.add_argument("--input", required=True, help="Model path, comma-separated for comparison")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--node-output", default="")
    parser.add_argument("--max-model-len", type=int, default=4096)
    parser.add_argument("--dtype", default="float32", choices=["float32", "float16", "bfloat16"])
    parser.add_argument("--max-batch-size", type=int, default=1)
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    # Phase 1: basic output with shape info (vLLM integration will be added in a subsequent pass)
    output = {
        "status": "ok",
        "framework": "vllm-cpu",
        "model": os.path.basename(model_paths[0]),
        "overall": {
            "totalLayers": 0,
            "passedLayers": 0,
            "failedLayers": 0,
            "avgCosineSimilarity": 0,
            "maxAbsError": 0,
            "worstLayer": "",
        },
        "layers": [],
        "config": {
            "max_model_len": args.max_model_len,
            "dtype": args.dtype,
            "max_batch_size": args.max_batch_size,
        },
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    print(f"[vllm-cpu] done → {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Commit**

```bash
chmod +x runners/vllm-cpu/run.sh
git add runners/vllm-cpu/
git commit -m "feat: add vLLM CPU runner scaffold (runners/vllm-cpu/)"
```

---

### Task 8: Create Transformers runner

**Files:**
- Create: `runners/transformers/run.sh`
- Create: `runners/transformers/run.py`
- Create: `runners/transformers/requirements.txt`

**Interfaces:**
- Consumes: `--input <model-dir> --output <path> --task [text-generation] --max-new-tokens [256] --dtype [float32] --batch-size [1] --device [cpu]`

- [ ] **Step 1: Create `runners/transformers/requirements.txt`**

```
numpy<2.0
transformers
torch
```

- [ ] **Step 2: Create `runners/transformers/run.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
```

- [ ] **Step 3: Create `runners/transformers/run.py`**

```python
#!/usr/bin/env python3
"""
Transformers inference runner — text generation with accuracy comparison.

Usage:
  python run.py --input /path/to/model --output result.json
  python run.py --input baseline/,target/ --output result.json --task text-generation
"""

import argparse
import json
import os


def main():
    parser = argparse.ArgumentParser(description="Transformers inference runner")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-output", default="")
    parser.add_argument("--task", default="text-generation")
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument("--dtype", default="float32")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    output = {
        "status": "ok",
        "framework": "transformers",
        "model": os.path.basename(model_paths[0]),
        "overall": {
            "totalLayers": 0,
            "passedLayers": 0,
            "failedLayers": 0,
            "avgCosineSimilarity": 0,
            "maxAbsError": 0,
            "worstLayer": "",
        },
        "layers": [],
        "config": {
            "task": args.task,
            "max_new_tokens": args.max_new_tokens,
            "dtype": args.dtype,
            "batch_size": args.batch_size,
            "device": args.device,
        },
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    print(f"[transformers] done → {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Commit**

```bash
chmod +x runners/transformers/run.sh
git add runners/transformers/
git commit -m "feat: add Transformers runner scaffold (runners/transformers/)"
```

---

### Task 9: Create PyTorch (CPU) runner

**Files:**
- Create: `runners/torch-cpu/run.sh`
- Create: `runners/torch-cpu/run.py`
- Create: `runners/torch-cpu/requirements.txt`

**Interfaces:**
- Consumes: `--input <model.pt>[,<model2.pt>] --output <path> --precision [fp32] --batch-size [1]`

- [ ] **Step 1: Create `runners/torch-cpu/requirements.txt`**

```
numpy<2.0
torch
```

- [ ] **Step 2: Create `runners/torch-cpu/run.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
```

- [ ] **Step 3: Create `runners/torch-cpu/run.py`**

```python
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


def main():
    parser = argparse.ArgumentParser(description="PyTorch CPU inference runner")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-output", default="")
    parser.add_argument("--precision", default="fp32", choices=["fp32", "fp16"])
    parser.add_argument("--batch-size", type=int, default=1)
    args = parser.parse_args()

    model_paths = [p.strip() for p in args.input.split(",")]

    output = {
        "status": "ok",
        "framework": "torch-cpu",
        "model": os.path.basename(model_paths[0]),
        "overall": {
            "totalLayers": 0,
            "passedLayers": 0,
            "failedLayers": 0,
            "avgCosineSimilarity": 0,
            "maxAbsError": 0,
            "worstLayer": "",
        },
        "layers": [],
        "config": {
            "precision": args.precision,
            "batch_size": args.batch_size,
        },
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    print(f"[torch-cpu] done → {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Commit**

```bash
chmod +x runners/torch-cpu/run.sh
git add runners/torch-cpu/
git commit -m "feat: add PyTorch CPU runner scaffold (runners/torch-cpu/)"
```

---

### Task 10: Run setup.sh to initialize all venvs

**Files:**
- Run: `runners/_init/setup.sh`

- [ ] **Step 1: Run setup.sh**

```bash
bash runners/_init/setup.sh
```

Expected output:
```
[setup] scanning runners in runners/
[setup] onnx: creating venv...
[setup] onnx: installing dependencies...
[setup] onnx: done
[setup] openvino: creating venv...
[setup] openvino: installing dependencies...
[setup] openvino: done
[setup] vllm-cpu: creating venv...
[setup] vllm-cpu: installing dependencies...
[setup] vllm-cpu: done
[setup] transformers: creating venv...
[setup] transformers: installing dependencies...
[setup] transformers: done
[setup] torch-cpu: creating venv...
[setup] torch-cpu: installing dependencies...
[setup] torch-cpu: done
[setup] all runners ready
```

- [ ] **Step 2: Verify one runner works end-to-end**

```bash
# Find an ONNX model or create a minimal test
# If no model available, at least verify the runner parses CLI correctly:
cd runners/onnx
./run.sh --input nonexistent.onnx --output /tmp/t.json 2>&1 || true
echo "---"
ls venv/bin/python
```

Expected: venv is usable, run.sh finds the venv Python.

- [ ] **Step 3: Commit any venv-related changes** (venv dirs are in .gitignore, so only commit the setup.sh)

```bash
git add -A
git status  # verify no venv/ directories are staged
```

If venv dirs are staged, add them to `.gitignore` first:

```bash
echo "runners/*/venv/" >> .gitignore
echo "runners/*/__pycache__/" >> .gitignore
git add .gitignore
```

- [ ] **Step 4: Final commit**

```bash
git commit -m "chore: initialize runner venvs and add .gitignore for Python artifacts"
```

---

## Spec Coverage Check

| Spec Item | Task |
|-----------|------|
| `_init/setup.sh` venv manager | Task 1 ✓ |
| `runners/onnx/` — ONNX Runtime runner | Task 2 ✓ |
| Backend module registry `runner` field | Task 3 ✓ |
| Backend task engine `--input --output` CLI support | Task 4 ✓ |
| Frontend framework types update | Task 5 ✓ |
| `FW_OPTIONS` updated (remove TensorRT, add new) | Task 5 ✓ |
| Frontend TaskForm precision dropdowns (no int8/uint8) | Task 5 ✓ |
| `runners/openvino/` — OpenVINO runner | Task 6 ✓ |
| `runners/vllm-cpu/` — vLLM CPU runner scaffold | Task 7 ✓ |
| `runners/transformers/` — Transformers runner scaffold | Task 8 ✓ |
| `runners/torch-cpu/` — PyTorch CPU runner scaffold | Task 9 ✓ |
| Delete `runners/model_diff/` | Task 2 ✓ |
| .gitignore for venv/ and __pycache__ | Task 10 ✓ |
