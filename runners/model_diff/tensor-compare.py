#!/usr/bin/env python3
"""
tensor-compare — 模型无关的逐层精度比对工具

比较两套 runner 的输出（baseline vs target），计算逐层精度指标。

用法:
  python3 tensor-compare.py --baseline <dir1/runner_outputs/> --target <dir2/runner_outputs/> -o <output.json>

输出 JSON:
  {
    "overall": { "totalLayers", "passedLayers", "failedLayers", "avgCosineSimilarity", "maxAbsError", "worstLayer" },
    "layers": [{ "layerName", "layerType", "inputShape", "outputShape",
                 "metrics": [{ "frameworkId", "cosineSimilarity", "maxAbsError", "meanAbsError", "snr", "passed" }] }]
  }
"""

import argparse
import json
import math
import os
import sys
import numpy as np


# ── 指标函数 ──

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


# ── 逐维余弦 ──

def per_dim_cosine_stats(a, b, max_buckets=10):
    """
    沿最后一个维度（通常是 hidden / channel 维）逐条算余弦，
    返回统计摘要，包含 min / max / mean 和直方图 buckets。
    只对 2D+ tensor 且非退化维度有意义。
    """
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    ndim = a_f.ndim

    if ndim < 2:
        return None  # 1D tensor 没必要逐维

    # 沿最后一个轴切分
    axis = -1
    n_slices = a_f.shape[axis]
    if n_slices < 2 or n_slices > 10000:
        return None  # 太少的切片没统计意义，太多数据量过大

    # 将切分轴移到前面，然后 flatten 剩余维
    a_moved = np.moveaxis(a_f, axis, 0).reshape(n_slices, -1)
    b_moved = np.moveaxis(b_f, axis, 0).reshape(n_slices, -1)

    # 向量化算余弦
    dots = np.sum(a_moved * b_moved, axis=1)
    na = np.linalg.norm(a_moved, axis=1)
    nb = np.linalg.norm(b_moved, axis=1)
    mask = (na > 1e-12) & (nb > 1e-12)
    cosines = np.where(mask, dots / (na * nb), 1.0)

    if len(cosines) == 0:
        return None

    # 直方图 buckets
    lo, hi = float(cosines.min()), float(cosines.max())
    if hi - lo < 1e-8:
        # 所有值几乎一样
        hist = [{"lo": lo, "hi": hi, "count": len(cosines)}]
    else:
        edges = np.linspace(lo, hi, max_buckets + 1)
        counts, _ = np.histogram(cosines, bins=edges)
        hist = [
            {"lo": round(float(edges[i]), 6), "hi": round(float(edges[i + 1]), 6), "count": int(counts[i])}
            for i in range(max_buckets) if counts[i] > 0
        ]

    return {
        "min": round(float(cosines.min()), 8),
        "max": round(float(cosines.max()), 8),
        "mean": round(float(cosines.mean()), 8),
        "histogram": hist,
    }


# ── 加载 runner 输出 ──

def load_runner_outputs(runner_dir: str):
    """加载 run-onnx.py 输出的 runner_outputs 目录"""
    meta_path = os.path.join(runner_dir, "meta.json")
    values_path = os.path.join(runner_dir, "values.npz")

    if not os.path.exists(meta_path):
        raise FileNotFoundError(f"runner_outputs/meta.json not found in {runner_dir}")

    with open(meta_path) as f:
        meta = json.load(f)

    values = {}
    if os.path.exists(values_path):
        loaded = np.load(values_path)
        values = {k: loaded[k] for k in loaded.files}

    return meta, values


# ── 比对逻辑 ──

def compute_metrics(baseline_val, target_val, framework_id: str, threshold=0.95):
    """计算两个 tensor 的所有精度指标"""
    if baseline_val.shape != target_val.shape or baseline_val.size == 0:
        return None

    cos = cosine_similarity(baseline_val, target_val)
    metric = {
        "frameworkId": framework_id,
        "cosineSimilarity": round(cos, 8),
        "maxAbsError": round(max_abs_error(baseline_val, target_val), 8),
        "meanAbsError": round(mean_abs_error(baseline_val, target_val), 8),
        "relativeError": round(relative_error(baseline_val, target_val), 8),
        "snr": round(snr(baseline_val, target_val), 4),
        "passed": cos >= threshold,
    }
    # 全局余弦不为 1.0 时，补充逐维余弦统计
    if cos < 0.999999:
        dim_stats = per_dim_cosine_stats(baseline_val, target_val)
        if dim_stats is not None:
            metric["dimCosineStats"] = dim_stats
    return metric


def compare(baseline_dir: str, target_dir: str, framework_id: str = "onnx_int8", threshold=0.95):
    """比较 baseline 和 target 的 runner 输出"""
    meta_b, vals_b = load_runner_outputs(baseline_dir)
    meta_t, vals_t = load_runner_outputs(target_dir)

    if len(meta_b) != len(meta_t):
        print(f"[compare] warning: layer count mismatch ({len(meta_b)} vs {len(meta_t)})")

    layers = []
    for i, (lb, lt) in enumerate(zip(meta_b, meta_t)):
        key_b = str(i)
        key_t = str(i)

        if key_b not in vals_b or key_t not in vals_t:
            # fallback: 按 layerName 匹配
            key_b = next((k for k in vals_b if vals_b[k].shape == tuple(lb["outputShape"])), None)
            key_t = next((k for k in vals_t if vals_t[k].shape == tuple(lt["outputShape"])), None)
            if key_b is None or key_t is None:
                continue

        metric = compute_metrics(vals_b[key_b], vals_t[key_t], framework_id, threshold)
        if metric is None:
            continue

        layers.append({
            "layerName": lb["layerName"],
            "layerType": lb["layerType"],
            "inputShape": lb.get("inputShape", []),
            "outputShape": lb.get("outputShape", []),
            "metrics": [metric],
        })

    # 兜底：如果逐层没比成，比最终输出
    if not layers:
        final_b = os.path.join(baseline_dir, "final_output.npy")
        final_t = os.path.join(target_dir, "final_output.npy")
        if os.path.exists(final_b) and os.path.exists(final_t):
            bv = np.load(final_b)
            tv = np.load(final_t)
            metric = compute_metrics(bv, tv, framework_id, threshold)
            if metric:
                layers.append({
                    "layerName": "final_output",
                    "layerType": "Output",
                    "inputShape": list(bv.shape),
                    "outputShape": list(tv.shape),
                    "metrics": [metric],
                })

    # 生成 overall
    total = len(layers)
    passed = sum(1 for l in layers if all(m["passed"] for m in l["metrics"]))
    failed = sum(1 for l in layers if any(not m["passed"] for m in l["metrics"]))
    all_cos = [m["cosineSimilarity"] for l in layers for m in l["metrics"]]
    all_err = [m["maxAbsError"] for l in layers for m in l["metrics"]]

    # ── 合并计算图（从 baseline runner_outputs 读取 graph.json）──
    graph_data = None
    graph_path = os.path.join(baseline_dir, "graph.json")
    if os.path.exists(graph_path):
        try:
            with open(graph_path) as f:
                graph_data = json.load(f)
            # 构建 layer_name → cosine 的快速查找
            cos_lookup = {}
            for l in layers:
                if l["metrics"]:
                    cos_lookup[l["layerName"]] = l["metrics"][0]["cosineSimilarity"]
            for node in graph_data.get("nodes", []):
                node["cosineSimilarity"] = cos_lookup.get(node["name"], None)
        except Exception as e:
            print(f"[compare] graph annotation skipped: {e}")

    output = {
        "overall": {
            "totalLayers": total,
            "passedLayers": passed,
            "failedLayers": failed,
            "avgCosineSimilarity": round(sum(all_cos) / len(all_cos), 6) if all_cos else 0,
            "maxAbsError": max(all_err) if all_err else 0,
            "worstLayer": min(layers, key=lambda l: min(m["cosineSimilarity"] for m in l["metrics"]))["layerName"]
            if layers and all_cos else "",
        },
        "layers": layers,
    }
    if graph_data:
        output["graph"] = graph_data

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="逐层精度比对（模型无关）")
    parser.add_argument("--baseline", required=True, help="baseline runner_outputs/ 目录")
    parser.add_argument("--target", required=True, help="target runner_outputs/ 目录")
    parser.add_argument("-o", "--output", default="output.json", help="输出路径")
    parser.add_argument("--framework-id", default="onnx_int8", help="framework 标识")
    parser.add_argument("--threshold", type=float, default=0.95, help="cosine 阈值")
    args = parser.parse_args()

    result = compare(args.baseline, args.target, args.framework_id, args.threshold)

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"[compare] {result['overall']['totalLayers']} layers, "
          f"{result['overall']['passedLayers']} passed, "
          f"{result['overall']['failedLayers']} failed")
    print(f"[compare] avg cosine: {result['overall']['avgCosineSimilarity']:.6f}")
    print(f"[compare] written to {args.output}")
