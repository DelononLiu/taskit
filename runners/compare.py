# runners/compare.py
"""公共精度比对模块 — 所有 runner 统一引用。

提供底层的 tensor 比较指标和高层的 npz 比对函数。
"""

import math
import numpy as np


# ── 底层指标 ──

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a_f = a.flatten().astype(np.float64)
    b_f = b.flatten().astype(np.float64)
    dot = np.dot(a_f, b_f)
    na = np.linalg.norm(a_f)
    nb = np.linalg.norm(b_f)
    if na < 1e-12 or nb < 1e-12:
        return 1.0 if na == nb else 0.0
    return float(dot / (na * nb))


def max_abs_error(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def mean_abs_error(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def relative_error(a: np.ndarray, b: np.ndarray) -> float:
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    denom = np.abs(a_f) + 1e-12
    return float(np.mean(np.abs(a_f - b_f) / denom))


def compute_snr(a: np.ndarray, b: np.ndarray) -> float:
    a_f = a.astype(np.float64)
    b_f = b.astype(np.float64)
    signal = np.sum(a_f ** 2)
    noise = np.sum((a_f - b_f) ** 2)
    if noise < 1e-30:
        return 100.0
    return float(10 * math.log10(signal / noise))


# ── 高层比对 ──

def compare_npz(
    baseline_npz: str,
    target_npz: str,
    framework_id: str,
    threshold: float = 0.95,
) -> dict:
    """加载两个 npz，逐层比对，返回 {overall, layers}。

    npz 内部 key 命名约定: layer_0, layer_1, ... 对应每一层。
    按 key 排序后逐对比较。
    """
    base = np.load(baseline_npz)
    tgt = np.load(target_npz)

    base_keys = sorted(base.files)
    tgt_keys = sorted(tgt.files)

    layers = []
    for bk, tk in zip(base_keys, tgt_keys):
        bv = base[bk]
        tv = tgt[tk]
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
            "layerName": bk,
            "layerType": "tensor",
            "inputShape": list(bv.shape),
            "outputShape": list(tv.shape),
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
            "worstLayer": min(layers, key=lambda l: min(
                m["cosineSimilarity"] for m in l["metrics"]
            ))["layerName"] if layers and all_cos else "",
        },
        "layers": layers,
    }
