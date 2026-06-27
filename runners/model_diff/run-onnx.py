#!/usr/bin/env python3
"""
model_diff ONNX runner — 只跑推理，不比较

读取 input.json → 加载模型 → 捕获中间层输出 → 保存到 runner_outputs/

调用方式:
  python3 run-onnx.py -C /tmp/task_xxx/

输入: <dir>/input.json
  {
    "modelPath": "/path/to/model.onnx",
    "params": { "batchSize": 1 }
  }

输出: <dir>/runner_outputs/
  meta.json     — 层信息 [{ layerName, layerType, inputShape, outputShape }]
  values.npz    — 每层的 tensor 值（key: layer_idx）
"""

import argparse
import json
import os
import sys
import time
import numpy as np
import onnx
import onnxruntime as ort


# ── 模型分析 ──

def get_node_shape_info(model, node):
    """尝试获取节点的输入/输出 shape"""
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


# ── 计算图提取 ──

def extract_graph(model, sampled_nodes, model_output_names):
    """
    从 ONNX 模型提取 DAG 结构：nodes（含 depth）+ edges。
    sampled_nodes: [(idx, node)] 已采样的节点列表
    model_output_names: session.get_outputs() 的原始输出名列表
    返回: {"nodes": [...], "edges": [...], "outputs": [...]}
    """
    # 构建 tensor → node 映射
    tensor_to_node = {}
    for node in model.graph.node:
        for out in node.output:
            if out:
                tensor_to_node[out] = node

    # 构建输入 tensor → 来源 node 的反向映射
    input_to_node = {}
    for node in model.graph.node:
        for inp in node.input:
            if inp and inp not in input_to_node:
                input_to_node[inp] = node

    # 只保留采样节点
    sampled_names = {node.name or f"{node.op_type}_{idx}" for idx, node in sampled_nodes}

    # 构建邻接表
    node_map = {}  # name → {name, opType, depth, idx}
    adj = {}  # name → [child names]
    rev_adj = {}  # name → [parent names]

    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        node_map[name] = {"name": name, "opType": node.op_type, "idx": idx}
        adj[name] = []
        rev_adj[name] = []

    # 边：如果采样节点 B 的某个输入 tensor 是采样节点 A 的输出，则有 A→B
    tensor_to_sampled = {}
    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for out in node.output:
            if out:
                tensor_to_sampled[out] = name

    # 再扫一遍采样节点，找入边
    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for inp in node.input:
            if inp in tensor_to_sampled:
                src = tensor_to_sampled[inp]
                if src != name:
                    adj[src].append(name)
                    rev_adj[name].append(src)

    # 拓扑深度：从没有入边的节点开始 BFS
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

    # 构建 edges list
    edges = []
    for src in adj:
        for dst in adj[src]:
            edges.append({"from": src, "to": dst})

    # 找哪些采样节点直接输出到模型输出（leaf nodes）
    leaf_names = set()
    for idx, node in sampled_nodes:
        name = node.name or f"{node.op_type}_{idx}"
        for out in node.output:
            if out and any(out == mo or out in model_output_names for mo in model_output_names):
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


# ── 主逻辑 ──

def run_task(task_dir: str):
    input_path = os.path.join(task_dir, "input.json")
    with open(input_path) as f:
        inp = json.load(f)

    model_path = inp["modelPath"]
    params = inp.get("params", {})

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"model not found: {model_path}")

    print(f"[run] model: {model_path}")

    # 加载模型
    model = onnx.load(model_path)

    # 准备输入
    input_meta = {i.name: i for i in model.graph.input}
    input_names = list(input_meta.keys())
    print(f"[run] inputs: {input_names}")

    batch_size = params.get("batchSize", 1)
    feed = {}

    if any(name in str(input_names).lower() for name in ["input_ids", "token_type_ids"]):
        seq_len = params.get("seqLen", 32)
        print(f"[run] NLP model, seq_len={seq_len}")
        if "input_ids" in params:
            token_ids = params["input_ids"][:seq_len]
            attention = params.get("attention_mask", [1]*len(token_ids))[:seq_len]
        else:
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
        print(f"[run] CV model, shape: {shape_dims}")
        if len(shape_dims) == 4:
            shape = [batch_size if i == 0 else (d or 224) for i, d in enumerate(shape_dims)]
            feed[input_name] = np.random.rand(*shape).astype(np.float32)
        else:
            feed[input_name] = np.random.rand(batch_size, 3, 224, 224).astype(np.float32)

    else:
        print(f"[run] unknown model type, random inputs")
        for name, meta in input_meta.items():
            shape = [(d if d > 0 else 1) for d in meta.type.tensor_type.shape.dim]
            shape[0] = batch_size
            feed[name] = np.random.rand(*shape).astype(np.float32)

    # 创建 session
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    providers = ['CPUExecutionProvider']
    if 'CUDAExecutionProvider' in ort.get_available_providers():
        providers.insert(0, 'CUDAExecutionProvider')

    session = ort.InferenceSession(model_path, sess_options, providers=providers)
    orig_outputs = [o.name for o in session.get_outputs()]
    print(f"[run] original outputs: {orig_outputs}")

    # 构建中间层节点列表
    layer_nodes = []
    key_ops = {"MatMul", "Gemm", "Conv", "Relu", "Softmax"}
    for i, node in enumerate(model.graph.node):
        if node.op_type in key_ops and len(node.output) > 0:
            layer_nodes.append((i, node))
    print(f"[run] key layers: {len(layer_nodes)}")

    MAX_LAYERS = 50
    if len(layer_nodes) > MAX_LAYERS:
        step = len(layer_nodes) / MAX_LAYERS
        indices = [int(i * step) for i in range(MAX_LAYERS - 1)] + [len(layer_nodes) - 1]
        layer_nodes = [layer_nodes[i] for i in set(indices)]
        layer_nodes.sort(key=lambda x: x[0])
        print(f"[run] sampled to {len(layer_nodes)} layers")

    # ── 提取计算图 ──
    try:
        graph_data = extract_graph(model, layer_nodes, orig_outputs)
        meta_out = os.path.join(task_dir, "runner_outputs")
        os.makedirs(meta_out, exist_ok=True)
        with open(os.path.join(meta_out, "graph.json"), "w") as f:
            json.dump(graph_data, f, indent=2)
        print(f"[run] graph extracted: {len(graph_data['nodes'])} nodes, {len(graph_data['edges'])} edges")
    except Exception as e:
        print(f"[run] graph extraction skipped: {e}")

    # 添加中间层为 graph output
    import copy
    from onnx import helper, TensorProto
    aug_model = copy.deepcopy(model)
    vi_map = {vi.name: vi for vi in aug_model.graph.value_info}
    added = 0
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
            added += 1
    print(f"[run] added {added} intermediate outputs")

    # 保存增强模型并推理
    aug_path = os.path.join(task_dir, "_augmented.onnx")
    onnx.save(aug_model, aug_path)
    aug_session = ort.InferenceSession(aug_path, sess_options, providers=providers)
    aug_output_names = [o.name for o in aug_session.get_outputs()]

    print(f"[run] running inference ({len(aug_output_names)} outputs)...")
    t0 = time.time()
    results = aug_session.run(aug_output_names, feed)
    t1 = time.time()
    print(f"[run] done in {t1-t0:.1f}s")

    results_map = dict(zip(aug_output_names, results))
    orig_set = set(orig_outputs)

    # ── 保存输出 ──
    out_dir = os.path.join(task_dir, "runner_outputs")
    os.makedirs(out_dir, exist_ok=True)

    # 1) 所有原始输出（含 baseline 的最终结果）
    orig_outputs_path = os.path.join(out_dir, "orig_outputs")
    os.makedirs(orig_outputs_path, exist_ok=True)
    for name in orig_outputs:
        if name in results_map:
            np.save(os.path.join(orig_outputs_path, f"{name}.npy"), results_map[name])

    # 2) 中间层的 meta 和 values
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

    # 保存 meta
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta_list, f, indent=2)

    # 保存 values (npz 格式，自动压缩)
    if arrays:
        np.savez_compressed(os.path.join(out_dir, "values.npz"), **arrays)

    # 3) 最终输出也保存（上层可直接使用）
    if orig_outputs:
        final = orig_outputs[-1]
        if final in results_map:
            np.save(os.path.join(out_dir, "final_output.npy"), results_map[final])

    print(f"[run] saved {len(meta_list)} layers to {out_dir}")
    print(f"[run] total values: {sum(v.nbytes for v in arrays.values()) / 1024:.0f} KB")

    # 清理
    if os.path.exists(aug_path):
        os.remove(aug_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-C", "--task-dir", required=True)
    args = parser.parse_args()
    run_task(args.task_dir)
