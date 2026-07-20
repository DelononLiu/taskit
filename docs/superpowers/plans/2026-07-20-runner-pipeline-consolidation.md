# Runner Pipeline 统一 & 平台交互重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一模型输入格式（zip→npz），消除 runner 间重复代码（compare.py），新增自包含 HTML 精度报告，支持外部 runner 加载，按用户隔离上传目录，并精简 UI（去 Drawer + Modal 新建任务 + 表格精度列）。

**Architecture:** 7 个独立任务，按依赖顺序执行：先 Python 公共模块（zip2npz → compare），再后端基础设施（目录隔离 → 外部 runner → report 路由），最后前端 UI 重构（Modal + 表格列 + 去 Drawer）。每个任务产出可独立测试的增量。

**Tech Stack:** Python 3 (numpy, zipfile), TypeScript (Express, React 18, zustand, shadcn/ui Dialog)

## Global Constraints

- 所有 git commit 消息使用中文，格式 `feat/fix/docs/refactor/chore/test/style: 简短描述`
- Python 测试通过 `cd runners && ./run_tests.sh` 运行（或直接 `python -m pytest`）
- 后端测试通过 `cd backend && npm test` 运行
- 前端测试通过 `npm test` 运行
- 修改代码后必须运行相关测试确认通过
- 报告 HTML 零外部依赖（不引 CDN、图表库）
- 不要自动 push

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `runners/zip2npz.py` | **新增** | Zip→NPZ 解析，三种格式自适应 |
| `runners/compare.py` | **新增** | 精度指标函数 + compare_npz 高层比对 |
| `runners/onnx/run.py` | 修改 | 删除重复指标/比对代码，import compare |
| `runners/openvino/run.py` | 修改 | 同上 |
| `runners/torch-cpu/run.py` | 修改 | 同上 |
| `runners/__tests__/test_zip2npz.py` | **新增** | zip2npz 三种格式测试 |
| `runners/__tests__/test_compare.py` | **新增** | compare_npz 单元测试 |
| `backend/src/routers/files.ts` | 修改 | multer destination 加 userId 子目录 |
| `backend/src/index.ts` | 修改 | 启动时扫描并注册 `~/.taskit/runner/` |
| `backend/src/lib/task-engine.ts` | 修改 | 解析 runner 路径时回落 `~/.taskit/runner/` |
| `backend/src/lib/report.ts` | **新增** | HTML 报告生成器（纯字符串拼接） |
| `backend/src/routers/tasks.ts` | 修改 | 新增 `GET /:id/report` 路由，列表接口返回 overall |
| `backend/src/__tests__/tasks.test.ts` | 修改 | 新增 report 路由测试 |
| `src/tasks/model_compare/TaskFormModal.tsx` | **新增** | Modal 新建任务（从 DrawerTaskForm 重构） |
| `src/tasks/model_compare/DrawerTaskDetail.tsx` | **删除** | 去 Drawer，详情由 Report + 表格列替代 |
| `src/tasks/model_compare/DrawerTaskForm.tsx` | **删除** | 被 TaskFormModal 替代 |
| `src/core/components/DetailDrawer.tsx` | **删除** | 不再需要 |
| `src/core/components/TaskTable.tsx` | 修改 | 新增精度列 + 下载按钮，去掉 Eye 详情按钮 |
| `src/App.tsx` | 修改 | 去掉 Drawer 相关逻辑，引入 TaskFormModal |
| `src/pages/TaskitPage.tsx` | 修改 | 去掉 drawer 调用，改用 Modal 状态 |
| `src/stores/appStore.ts` | 修改 | 移除 drawer 相关状态，保留 activeModule |
| `src/types/task.ts` | 修改 | ComparisonTask 增加 overall 字段 |
| `src/api/task.ts` | 修改 | getTaskHistory 映射 overall 数据 |

---

### Task 1: zip2npz.py — Zip→NPZ 公共模块

**Files:**
- Create: `runners/zip2npz.py`
- Create: `runners/__tests__/test_zip2npz.py`

**Interfaces:**
- Produces: `extract_to_npz(zip_path: str, output_dir: str) -> str` — 返回生成的 .npz 文件绝对路径

- [ ] **Step 1: 编写 zip2npz 模块**

```python
# runners/zip2npz.py
"""Zip → NPZ 统一解析模块。

支持三种 zip 内部结构（"三级"适配），按优先级依次尝试：
  1. 直接模型文件（.onnx / .pth / .bin）
  2. 命名目录结构（<name>/model.bin + config.json）
  3. 扁平多文件（多个 .bin 无目录层级）
"""

import os
import zipfile
import tempfile
import numpy as np
from typing import Optional


def _try_direct_models(zf: zipfile.ZipFile, extract_dir: str) -> Optional[str]:
    """级别1: zip 内为 model.onnx / model.pth 等，直接提取并加载 tensor。"""
    model_exts = ('.onnx', '.pth', '.pt', '.bin', '.pb')
    model_files = [n for n in zf.namelist()
                   if n.lower().endswith(model_exts) and not n.startswith('__MACOSX')]
    if not model_files:
        return None

    # 优先 .onnx
    model_files.sort(key=lambda n: (0 if n.endswith('.onnx') else 1, n))
    target = model_files[0]
    zf.extract(target, extract_dir)
    extracted = os.path.join(extract_dir, target)

    # 对 onnx 做一次 inference 提取 tensor 存为 npz
    return _onnx_to_npz(extracted, extract_dir)


def _try_named_dirs(zf: zipfile.ZipFile, extract_dir: str) -> Optional[str]:
    """级别2: <model_name>/model.bin + config.json 目录结构。"""
    dirs = set()
    for n in zf.namelist():
        if n.startswith('__MACOSX'):
            continue
        parts = n.split('/')
        if len(parts) >= 2 and parts[0]:
            dirs.add(parts[0])

    for d in sorted(dirs):
        contents = [n for n in zf.namelist() if n.startswith(d + '/')]
        bin_files = [n for n in contents
                     if n.lower().endswith(('.bin', '.onnx', '.pth', '.safetensors'))]
        if bin_files:
            # 提取整个目录
            for n in contents:
                zf.extract(n, extract_dir)
            # 找第一个 bin 文件
            extracted = os.path.join(extract_dir, bin_files[0])
            if extracted.endswith('.onnx'):
                return _onnx_to_npz(extracted, extract_dir)
            return _raw_bin_to_npz(extracted, extract_dir)

    return None


def _try_flat_files(zf: zipfile.ZipFile, extract_dir: str) -> Optional[str]:
    """级别3: 扁平多文件，按文件名模式匹配。"""
    bin_files = [n for n in zf.namelist()
                 if n.lower().endswith(('.bin', '.safetensors', '.npy'))
                 and not n.startswith('__MACOSX')
                 and '/' not in n]
    if not bin_files:
        return None

    # 优先最大的 .bin 文件（通常是权重）
    bin_files.sort(key=lambda n: zf.getinfo(n).file_size, reverse=True)
    target = bin_files[0]
    zf.extract(target, extract_dir)
    extracted = os.path.join(extract_dir, target)
    return _raw_bin_to_npz(extracted, extract_dir)


def _onnx_to_npz(onnx_path: str, output_dir: str) -> str:
    """对 ONNX 模型跑一次推理，提取逐层 tensor 输出存为 npz。"""
    try:
        import onnxruntime as ort
        import numpy as np

        session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
        input_info = session.get_inputs()[0]
        shape = [d if isinstance(d, int) and d > 0 else 1
                 for d in input_info.shape]
        dummy = np.random.randn(*shape).astype(np.float32)

        # 获取所有输出
        outputs = session.run(None, {input_info.name: dummy})

        npz_path = os.path.join(output_dir,
                                os.path.splitext(os.path.basename(onnx_path))[0] + '.npz')
        np.savez_compressed(npz_path,
                            **{f'layer_{i}': o for i, o in enumerate(outputs)})
        return npz_path
    except Exception:
        raise RuntimeError(f"无法从 {onnx_path} 提取 tensor 数据")


def _raw_bin_to_npz(bin_path: str, output_dir: str) -> str:
    """将原始 bin 文件按 float32 加载并包装为 npz。"""
    try:
        data = np.fromfile(bin_path, dtype=np.float32)
        if data.size == 0:
            raise RuntimeError(f"{bin_path} 为空")
        npz_path = os.path.join(output_dir,
                                os.path.splitext(os.path.basename(bin_path))[0] + '.npz')
        np.savez_compressed(npz_path, layer_0=data)
        return npz_path
    except Exception as e:
        raise RuntimeError(f"无法解析 {bin_path}: {e}")


def extract_to_npz(zip_path: str, output_dir: str) -> str:
    """解包 zip，自适应内部结构，返回 npz 文件路径。

    按优先级依次尝试三种格式匹配规则，命中即返回。
    所有规则失败则抛 RuntimeError。
    """
    os.makedirs(output_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        # 级别1: 直接模型文件
        result = _try_direct_models(zf, output_dir)
        if result:
            return result

        # 级别2: 命名目录结构
        result = _try_named_dirs(zf, output_dir)
        if result:
            return result

        # 级别3: 扁平多文件
        result = _try_flat_files(zf, output_dir)
        if result:
            return result

    raise RuntimeError(f"无法识别 zip 包内部结构: {zip_path}")
```

- [ ] **Step 2: 编写 zip2npz 测试**

```python
# runners/__tests__/test_zip2npz.py
import os
import sys
import zipfile
import tempfile
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from zip2npz import extract_to_npz


def make_zip(structure_type: str, tmpdir: str) -> str:
    """创建三种结构的 zip 文件用于测试。"""
    zip_path = os.path.join(tmpdir, 'test.zip')
    with zipfile.ZipFile(zip_path, 'w') as zf:
        if structure_type == 'direct':
            # 级别1: 直接 .bin 文件（onnx 需要 onnxruntime，这里用 bin 测试回退路径）
            data = np.random.randn(10, 10).astype(np.float32)
            bin_path = os.path.join(tmpdir, 'model.bin')
            data.tofile(bin_path)
            zf.write(bin_path, 'model.bin')
        elif structure_type == 'named_dir':
            # 级别2: named_dir/model.bin
            data = np.random.randn(5, 5).astype(np.float32)
            bin_path = os.path.join(tmpdir, 'my_model.bin')
            data.tofile(bin_path)
            zf.write(bin_path, 'my_model/model.bin')
            # 加个 config
            config = os.path.join(tmpdir, 'config.json')
            with open(config, 'w') as f:
                f.write('{}')
            zf.write(config, 'my_model/config.json')
        elif structure_type == 'flat':
            # 级别3: 扁平多 .bin
            data = np.random.randn(3, 3).astype(np.float32)
            bin_path = os.path.join(tmpdir, 'weights.bin')
            data.tofile(bin_path)
            zf.write(bin_path, 'weights.bin')
    return zip_path


class TestZip2Npz:
    def test_extract_direct_bin(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = make_zip('direct', tmpdir)
            out_dir = os.path.join(tmpdir, 'out')
            npz_path = extract_to_npz(zip_path, out_dir)
            assert npz_path.endswith('.npz')
            assert os.path.exists(npz_path)
            loaded = np.load(npz_path)
            assert len(loaded.files) > 0
            assert loaded[loaded.files[0]].shape == (10, 10)

    def test_extract_named_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = make_zip('named_dir', tmpdir)
            out_dir = os.path.join(tmpdir, 'out')
            npz_path = extract_to_npz(zip_path, out_dir)
            assert npz_path.endswith('.npz')
            assert os.path.exists(npz_path)
            loaded = np.load(npz_path)
            assert len(loaded.files) > 0

    def test_extract_flat_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = make_zip('flat', tmpdir)
            out_dir = os.path.join(tmpdir, 'out')
            npz_path = extract_to_npz(zip_path, out_dir)
            assert npz_path.endswith('.npz')
            assert os.path.exists(npz_path)
            loaded = np.load(npz_path)
            assert len(loaded.files) > 0

    def test_invalid_zip_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建一个只有文本文件的 zip
            zip_path = os.path.join(tmpdir, 'bad.zip')
            with zipfile.ZipFile(zip_path, 'w') as zf:
                readme = os.path.join(tmpdir, 'readme.txt')
                with open(readme, 'w') as f:
                    f.write('hello')
                zf.write(readme, 'readme.txt')
            out_dir = os.path.join(tmpdir, 'out')
            with pytest.raises(RuntimeError, match='无法识别'):
                extract_to_npz(zip_path, out_dir)
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd runners && source onnx/venv/bin/activate && python -m pytest __tests__/test_zip2npz.py -v
```

Expected: 4 tests PASS

- [ ] **Step 4: 提交**

```bash
git add runners/zip2npz.py runners/__tests__/test_zip2npz.py
git commit -m "feat: 新增 zip2npz.py zip→npz 统一解析模块（三级格式适配）"
```

---

### Task 2: compare.py — 公共精度比对模块

**Files:**
- Create: `runners/compare.py`
- Modify: `runners/onnx/run.py`
- Modify: `runners/openvino/run.py`
- Modify: `runners/torch-cpu/run.py`
- Create: `runners/__tests__/test_compare.py`

**Interfaces:**
- Produces: `cosine_similarity(a, b)`, `max_abs_error(a, b)`, `mean_abs_error(a, b)`, `relative_error(a, b)`, `compute_snr(a, b)`, `compare_npz(baseline_npz, target_npz, framework_id, threshold=0.95) -> dict`
- Consumes: numpy (npz files loaded via `np.load()`)

- [ ] **Step 1: 编写 compare.py**

```python
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
```

- [ ] **Step 2: 编写 compare.py 单元测试**

```python
# runners/__tests__/test_compare.py
import os
import sys
import tempfile
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import (
    cosine_similarity, max_abs_error, mean_abs_error,
    relative_error, compute_snr, compare_npz,
)


class TestMetrics:
    def test_cosine_identical(self):
        a = np.array([1.0, 2.0, 3.0], dtype=np.float32)
        assert cosine_similarity(a, a) == pytest.approx(1.0, abs=1e-6)

    def test_cosine_orthogonal(self):
        a = np.array([1.0, 0.0], dtype=np.float32)
        b = np.array([0.0, 1.0], dtype=np.float32)
        assert cosine_similarity(a, b) == pytest.approx(0.0, abs=1e-6)

    def test_max_abs_error(self):
        a = np.array([0.0, 0.0], dtype=np.float32)
        b = np.array([3.0, 4.0], dtype=np.float32)
        assert max_abs_error(a, b) == pytest.approx(4.0, abs=1e-6)

    def test_mean_abs_error(self):
        a = np.array([0.0, 0.0], dtype=np.float32)
        b = np.array([2.0, 4.0], dtype=np.float32)
        assert mean_abs_error(a, b) == pytest.approx(3.0, abs=1e-6)

    def test_snr_identical(self):
        a = np.array([1.0, 2.0, 3.0], dtype=np.float32)
        assert compute_snr(a, a) == 100.0

    def test_relative_error(self):
        a = np.array([10.0, 10.0], dtype=np.float32)
        b = np.array([11.0, 11.0], dtype=np.float32)
        assert relative_error(a, b) == pytest.approx(0.1, abs=0.01)


class TestCompareNpz:
    def test_identical_npz(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = os.path.join(tmpdir, 'base.npz')
            tgt = os.path.join(tmpdir, 'tgt.npz')
            data = np.random.randn(10, 10).astype(np.float32)
            np.savez_compressed(base, layer_0=data, layer_1=data * 2)
            np.savez_compressed(tgt, layer_0=data, layer_1=data * 2)

            result = compare_npz(base, tgt, 'test', threshold=0.95)
            assert result['overall']['totalLayers'] == 2
            assert result['overall']['passedLayers'] == 2
            assert result['overall']['avgCosineSimilarity'] == pytest.approx(1.0, abs=0.01)

    def test_different_npz(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = os.path.join(tmpdir, 'base.npz')
            tgt = os.path.join(tmpdir, 'tgt.npz')
            np.savez_compressed(base, layer_0=np.ones((5, 5), dtype=np.float32))
            np.savez_compressed(tgt, layer_0=np.zeros((5, 5), dtype=np.float32))

            result = compare_npz(base, tgt, 'test')
            assert result['overall']['totalLayers'] == 1
            assert result['overall']['passedLayers'] == 0
```

Note: 需要在文件顶部加 `import pytest`。

- [ ] **Step 3: 运行 compare 测试确认通过**

```bash
cd runners && source onnx/venv/bin/activate && python -m pytest __tests__/test_compare.py -v
```

Expected: 8 tests PASS

- [ ] **Step 4: 修改 onnx/run.py — 删除重复代码，import compare**

删除 onnx/run.py 中以下函数（约 Lines 23-313 中的 metrics + compare_layers）：
- `cosine_similarity` (Line 25-33)
- `max_abs_error` (Line 35-36)
- `mean_abs_error` (Line 38-39)
- `relative_error` (Line 41-45)
- `compute_snr` (Line 47-54)
- `compare_layers` (Line 259-313)

在文件顶部 import 区域添加：

```python
# runners/onnx/run.py — 在现有 import 之后添加
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import (
    cosine_similarity, max_abs_error, mean_abs_error,
    relative_error, compute_snr, compare_layers,
)
```

注意：onnx/run.py 中的 `compare_layers` 函数签名是
```python
def compare_layers(meta_baseline, values_baseline, meta_target, values_target,
                   framework_id, threshold=0.95):
```
它不是接受 npz 文件路径，而是接受已经在内存中的 meta 列表和 arrays 字典。这与 `compare_npz` 不同。

所以 onnx runner 应该保留自己的 `compare_layers`（因为它的输入是内存中的 meta+arrays，不是 npz 文件路径），只删除底层的指标函数（cosine_similarity, max_abs_error, mean_abs_error, relative_error, compute_snr），改为从 compare import。

同理 openvino 和 torch-cpu 的 `compare_layers` 也是内存中的 meta+arrays，所以也只删除指标函数。

实际改动方案：

**onnx/run.py**: 删除 `cosine_similarity`, `max_abs_error`, `mean_abs_error`, `relative_error`, `compute_snr`（Lines 25-54），添加：
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, relative_error, compute_snr
```
保留 `compare_layers`（它操作内存中的 meta+arrays，与 compare_npz 输入不同）。

**openvino/run.py**: 删除 `cosine_similarity`, `max_abs_error`, `mean_abs_error`, `compute_snr`（Lines 20-46），添加同上 import。保留 `compare_layers`。

**torch-cpu/run.py**: 删除 `cosine_similarity`, `max_abs_error`, `mean_abs_error`, `compute_snr`（Lines 19-45），添加同上 import。保留 `compare_layers`。

- [ ] **Step 4 revised: 修改 onnx/run.py**

删除 Lines 23-54（`cosine_similarity` 到 `compute_snr`），在 import 区域添加：

```python
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, relative_error, compute_snr
```

- [ ] **Step 5: 修改 openvino/run.py**

删除 Lines 18-46（`cosine_similarity` 到 `compute_snr`），在 import 区域添加：

```python
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, compute_snr
```

- [ ] **Step 6: 修改 torch-cpu/run.py**

删除 Lines 19-45（`cosine_similarity` 到 `compute_snr`），在 import 区域添加：

```python
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from compare import cosine_similarity, max_abs_error, mean_abs_error, compute_snr
```

- [ ] **Step 7: 运行 runner 测试确认无回归**

```bash
cd runners && ./run_tests.sh
```

Expected: 所有已有测试 PASS

- [ ] **Step 8: 提交**

```bash
git add runners/compare.py runners/__tests__/test_compare.py runners/onnx/run.py runners/openvino/run.py runners/torch-cpu/run.py
git commit -m "feat: 新增 compare.py 公共精度比对模块，消除 runner 间指标函数重复"
```

---

### Task 3: 目录隔离 — 上传目录按 userId 分子目录

**Files:**
- Modify: `backend/src/routers/files.ts`

**Interfaces:**
- Modifies: multer `destination` callback — 在 `config.uploadDir` 下创建 `<userId>/` 子目录

- [ ] **Step 1: 修改 files.ts**

将 `backend/src/routers/files.ts` 第 12-15 行：

```typescript
// 之前
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(config.uploadDir, { recursive: true })
    cb(null, config.uploadDir)
  },
```

改为：

```typescript
const storage = multer.diskStorage({
  destination: async (req: any, _file, cb) => {
    const userId = req.user?.id ?? 1
    const userDir = path.join(config.uploadDir, String(userId))
    await fs.mkdir(userDir, { recursive: true })
    cb(null, userDir)
  },
```

`req` 参数类型从 `Request` 改为 `any` 以访问 `req.user`（与文件中其他地方一致，参考 Line 32 的 `// @ts-ignore` 用法）。

- [ ] **Step 2: 运行后端测试**

```bash
cd backend && npm test
```

Expected: 所有已有测试 PASS（files 路由不在测试覆盖范围内，但需确保无破坏性变更）

- [ ] **Step 3: 提交**

```bash
git add backend/src/routers/files.ts
git commit -m "feat: 上传目录按 userId 分子目录，支持多用户隔离"
```

---

### Task 4: 外部 Runner 加载 — 启动注册 + 执行回落

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/lib/task-engine.ts`

**Interfaces:**
- Modifies: index.ts 启动流程 — 扫描 `~/.taskit/runner/` 注册到 MODULES
- Modifies: task-engine.ts `executeTask()` — 解析 runner 路径时回落 `~/.taskit/runner/`

- [ ] **Step 1: 修改 index.ts — 启动时注册外部 runner**

在 `backend/src/index.ts` 中，`import { getUserFrameworks } from './lib/user-runners.js'` 之后，`main()` 函数之前，添加注册逻辑：

```typescript
// 注册用户 runner 到 MODULES（已有 import { getUserFrameworks } 和 import { MODULES }）
import fs from 'fs'
import path from 'path'
import os from 'os'

function registerUserRunners() {
  const userRunnerDir = path.join(os.homedir(), '.taskit', 'runner')
  if (!fs.existsSync(userRunnerDir)) return

  const entries = fs.readdirSync(userRunnerDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const runnerDir = path.join(userRunnerDir, entry.name)
    const runSh = path.join(runnerDir, 'run.sh')
    if (!fs.existsSync(runSh)) continue

    // 读取 config.json（可选）
    const configPath = path.join(runnerDir, 'config.json')
    let cfg: any = {}
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
    }

    const moduleKey = `user_${entry.name}`
    if (MODULES[moduleKey]) continue  // 不覆盖同名模块

    MODULES[moduleKey] = {
      name: cfg.name || entry.name,
      runner: entry.name,           // 目录名，task-engine 用于回落查找
      source: 'user' as any,
      description: cfg.description,
      icon: cfg.icon,
      parser: (output: any, _params: any) => output,
    }

    console.log(`  [runner] registered user runner: ${entry.name}`)
  }
}
```

然后在 `main()` 函数中，`const uploadDir = ...` 之前调用：

```typescript
  // 注册外部 runner
  registerUserRunners()
```

- [ ] **Step 2: 修改 task-engine.ts — 执行时回落外部 runner**

修改 `backend/src/lib/task-engine.ts` 中 `executeTask()` 函数的 runner 路径解析逻辑。当前代码（约 Line 51、62）：

```typescript
    const RUNNERS_ROOT = path.resolve(__dirname, '../../../runners')
    // ...
    const runnerScript = path.join(RUNNERS_ROOT, mod.runner, 'run.sh')
```

改为在 RUNNERS_ROOT 找不到时回落 `~/.taskit/runner/`：

```typescript
    const RUNNERS_ROOT = path.resolve(__dirname, '../../../runners')

    // 解析 runner 路径：内置优先，回落用户目录
    function resolveRunnerScript(runnerName: string): string {
      const builtin = path.join(RUNNERS_ROOT, runnerName, 'run.sh')
      if (fs.existsSync(builtin)) return builtin

      const userRunner = path.join(
        require('os').homedir(), '.taskit', 'runner', runnerName, 'run.sh'
      )
      if (fs.existsSync(userRunner)) return userRunner

      throw new Error(`Runner not found: ${runnerName} (checked built-in and ~/.taskit/runner/)`)
    }

    // ...
    const runnerScript = resolveRunnerScript(mod.runner)
```

注意需要在文件顶部 import 区域确保 `fs` 已导入（当前已有 `import fs from 'fs/promises'`，需要额外导入同步版本或使用 `fs.existsSync` → 改为在顶部添加 `import fsSync from 'fs'`）。

实际上当前第 2 行已有 `import fs from 'fs/promises'`，需要在顶部加一行：

```typescript
import fsSync from 'fs'
```

然后在 `resolveRunnerScript` 中用 `fsSync.existsSync()`。

- [ ] **Step 3: 运行后端测试**

```bash
cd backend && npm test
```

Expected: 所有已有测试 PASS

- [ ] **Step 4: 提交**

```bash
git add backend/src/index.ts backend/src/lib/task-engine.ts
git commit -m "feat: 启动时加载 ~/.taskit/runner/ 外部 runner，task-engine 执行时回落查找"
```

---

### Task 5: Report — 自包含 HTML 精度报告 + 路由

**Files:**
- Create: `backend/src/lib/report.ts`
- Modify: `backend/src/routers/tasks.ts`
- Modify: `backend/src/__tests__/tasks.test.ts`

**Interfaces:**
- Produces: `generateReportHtml(task: any) -> string` — 返回完整 HTML 字符串
- Produces: `GET /api/tasks/:id/report` — 返回 `Content-Type: text/html`

- [ ] **Step 1: 编写 report.ts HTML 生成器**

```typescript
// backend/src/lib/report.ts

interface ReportData {
  modelName: string
  framework: string
  createdAt: string
  overall: {
    totalLayers: number
    passedLayers: number
    failedLayers: number
    avgCosineSimilarity: number
    maxAbsError: number
    worstLayer: string
  }
  layers: Array<{
    layerName: string
    layerType: string
    inputShape: number[]
    outputShape: number[]
    metrics: Array<{
      frameworkId: string
      cosineSimilarity: number
      maxAbsError: number
      meanAbsError: number
      snr: number
      passed: boolean
    }>
  }>
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function generateReportHtml(task: any): string {
  const result = task.result ? JSON.parse(task.result) : {}
  const params = task.params ? JSON.parse(task.params) : {}
  const overall = result.overall || {}
  const layers = result.layers || []
  const modelName = (task.fileNames?.[0] || `任务 #${task.id}`).replace(/\.[^.]+$/, '')
  const framework = result.framework || task.module || 'unknown'
  const createdAt = task.createdAt || ''

  // 构建分布数据
  const bins = { '0.95-1.00': 0, '0.90-0.95': 0, '<0.90': 0 }
  let maxPct = 0
  for (const l of layers) {
    for (const m of (l.metrics || [])) {
      const cos = m.cosineSimilarity || 0
      if (cos >= 0.95) bins['0.95-1.00']++
      else if (cos >= 0.90) bins['0.90-0.95']++
      else bins['<0.90']++
    }
  }
  const total = layers.length || 1
  for (const k of Object.keys(bins)) {
    const pct = Math.round((bins[k as keyof typeof bins] / total) * 100)
    bins[k as keyof typeof bins] = pct
    if (pct > maxPct) maxPct = pct
  }

  // 构建层表格行
  const layerRows = layers.map((l: any) => {
    const m = (l.metrics || [])[0] || {}
    const passed = m.passed !== false
    const rowClass = passed ? '' : ' class="failed"'
    return `<tr${rowClass}>
      <td>${escapeHtml(l.layerName || '')}</td>
      <td>${escapeHtml(l.layerType || '')}</td>
      <td>${m.cosineSimilarity != null ? m.cosineSimilarity.toFixed(6) : '—'}</td>
      <td>${m.maxAbsError != null ? m.maxAbsError.toFixed(6) : '—'}</td>
      <td>${m.meanAbsError != null ? m.meanAbsError.toFixed(6) : '—'}</td>
      <td>${m.snr != null ? m.snr.toFixed(2) : '—'}</td>
      <td>${passed ? '✅' : '❌'}</td>
    </tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>精度比对报告 — ${escapeHtml(modelName)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa; color: #1a1a2e; padding: 32px; line-height: 1.6;
}
.container { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 4px; }
.subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
.cards { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.card {
  flex: 1; min-width: 150px; background: #fff; border-radius: 12px;
  padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06);
  text-align: center;
}
.card .value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
.card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-top: 4px; }
.card.good .value { color: #16a34a; }
.card.warn .value { color: #ea580c; }

.bar-section { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 24px; }
.bar-section h2 { font-size: 15px; margin-bottom: 16px; color: #444; }
.bar { display: flex; align-items: center; margin-bottom: 10px; font-size: 12px; }
.bar .bar-label { width: 80px; color: #666; text-align: right; margin-right: 12px; }
.bar .bar-track { flex: 1; height: 24px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
.bar .bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bar .bar-pct { width: 48px; margin-left: 8px; color: #444; font-weight: 600; }

.table-section { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-section h2 { font-size: 15px; margin-bottom: 16px; color: #444; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e5e7eb; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; cursor: pointer; user-select: none; }
th:hover { color: #333; }
td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
tr.failed { background: #fef2f2; }
tr.failed td:first-child { color: #dc2626; font-weight: 600; }
tr:hover { background: #f8fafc; }
tr.failed:hover { background: #fee2e2; }
.footer { text-align: center; color: #aaa; font-size: 11px; margin-top: 24px; }
</style>
</head>
<body>
<div class="container">
<h1>🔬 精度比对报告</h1>
<div class="subtitle">
  模型: ${escapeHtml(modelName)} &nbsp;|&nbsp; 框架: ${escapeHtml(framework)} &nbsp;|&nbsp; 时间: ${escapeHtml(createdAt)}
</div>

<div class="cards">
  <div class="card">
    <div class="value">${overall.totalLayers ?? layers.length}</div>
    <div class="label">总层数</div>
  </div>
  <div class="card good">
    <div class="value">${overall.passedLayers ?? 0} ✅</div>
    <div class="label">通过层数</div>
  </div>
  <div class="card">
    <div class="value">${overall.avgCosineSimilarity != null ? overall.avgCosineSimilarity.toFixed(6) : '—'}</div>
    <div class="label">平均余弦相似度</div>
  </div>
  <div class="card warn">
    <div class="value">${escapeHtml(overall.worstLayer || '—')}</div>
    <div class="label">最差层</div>
  </div>
</div>

<div class="bar-section">
  <h2>📈 余弦相似度分布</h2>
  <div class="bar">
    <span class="bar-label">0.95–1.00</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['0.95-1.00']}%;background:#16a34a"></div></div>
    <span class="bar-pct">${bins['0.95-1.00']}%</span>
  </div>
  <div class="bar">
    <span class="bar-label">0.90–0.95</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['0.90-0.95']}%;background:#f59e0b"></div></div>
    <span class="bar-pct">${bins['0.90-0.95']}%</span>
  </div>
  <div class="bar">
    <span class="bar-label">&lt;0.90</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['<0.90']}%;background:#dc2626"></div></div>
    <span class="bar-pct">${bins['<0.90']}%</span>
  </div>
</div>

<div class="table-section">
  <h2>📋 逐层精度表</h2>
  <table id="layerTable">
    <thead>
      <tr>
        <th onclick="sortTable(0)">层名</th>
        <th onclick="sortTable(1)">类型</th>
        <th onclick="sortTable(2)">余弦相似度</th>
        <th onclick="sortTable(3)">最大误差</th>
        <th onclick="sortTable(4)">平均误差</th>
        <th onclick="sortTable(5)">SNR</th>
        <th onclick="sortTable(6)">结果</th>
      </tr>
    </thead>
    <tbody>
${layerRows}
    </tbody>
  </table>
</div>

<div class="footer">Taskit 精度比对报告 · 离线可查看</div>
</div>

<script>
function sortTable(col) {
  var tbody = document.querySelector('#layerTable tbody');
  var rows = Array.from(tbody.querySelectorAll('tr'));
  var asc = tbody.dataset.sortCol == col ? tbody.dataset.sortDir != 'asc' : true;
  rows.sort(function(a, b) {
    var ca = a.cells[col].textContent.trim();
    var cb = b.cells[col].textContent.trim();
    var na = parseFloat(ca), nb = parseFloat(cb);
    if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
    return asc ? ca.localeCompare(cb) : cb.localeCompare(ca);
  });
  rows.forEach(function(r) { tbody.appendChild(r); });
  tbody.dataset.sortCol = col;
  tbody.dataset.sortDir = asc ? 'asc' : 'desc';
}
</script>
</body>
</html>`
}
```

- [ ] **Step 2: 修改 tasks.ts 添加 report 路由 + 列表 API 返回 overall**

在 `backend/src/routers/tasks.ts` 中：

**a) 添加 import：**

```typescript
import { generateReportHtml } from '../lib/report.js'
```

**b) 在列表 API（`router.get('/')`）的返回数据中增加 overall 字段**，在 `taskList.map()` 回调中（约 Line 78-89），给每个 task 增加从 result 中解析的 overall：

```typescript
    res.json({
      tasks: taskList.map((t: any) => {
        const ids: string[] = (() => { try { return JSON.parse(t.fileIds || '[]') } catch { return [] } })()
        let overall = null
        if (t.result) {
          try {
            const r = typeof t.result === 'string' ? JSON.parse(t.result) : t.result
            overall = r.overall || null
          } catch {}
        }
        return {
          id: t.id,
          module: t.module,
          status: t.status,
          progress: t.progress,
          createdAt: t.createdAt === 'CURRENT_TIMESTAMP' ? new Date().toISOString() : t.createdAt,
          completedAt: t.completedAt ?? null,
          params: t.params,
          fileNames: ids.map(id => fileMap[id]).filter(Boolean),
          overall,
        }
      }),
      total,
      page,
      limit,
    })
```

**c) 在文件末尾（`export default router` 之前）添加 report 路由：**

```typescript
// 下载精度报告
router.get('/:id/report', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' })
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task) return res.status(404).json({ error: 'not found' })
    if (task.status !== 'completed') {
      return res.status(400).json({ error: 'task not completed yet' })
    }

    const html = generateReportHtml(task)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})
```

- [ ] **Step 3: 新增后端测试**

在 `backend/src/__tests__/tasks.test.ts` 中添加 report 路由测试：

```typescript
describe('GET /api/tasks/:id/report', () => {
  it('returns 400 for invalid id', async () => {
    const app = createApp()
    const res = await request(app).get('/api/tasks/abc/report')
    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent task', async () => {
    mockSelectChain.get.mockReturnValue(undefined)
    const app = createApp()
    const res = await request(app).get('/api/tasks/999/report')
    expect(res.status).toBe(404)
  })

  it('returns html for completed task', async () => {
    mockSelectChain.get.mockReturnValue({
      id: 1,
      module: 'model_compare',
      status: 'completed',
      progress: 100,
      params: '{"frameworks":["tensorrt"]}',
      fileIds: '["file-1"]',
      result: JSON.stringify({
        framework: 'onnx_vs_openvino',
        overall: { totalLayers: 5, passedLayers: 4, failedLayers: 1, avgCosineSimilarity: 0.9876, maxAbsError: 0.05, worstLayer: 'Conv_3' },
        layers: [
          { layerName: 'Conv_0', layerType: 'Conv', inputShape: [1,3,224,224], outputShape: [1,64,112,112], metrics: [{ frameworkId: 'onnx_fp32', cosineSimilarity: 0.9998, maxAbsError: 0.001, meanAbsError: 0.0003, snr: 45, passed: true }] },
        ],
      }),
      error: null,
      createdAt: '2025-01-15',
      completedAt: '2025-01-15',
      userId: 1,
    })

    const app = createApp()
    const res = await request(app).get('/api/tasks/1/report')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('Conv_0')
    expect(res.text).toContain('0.9998')
  })

  it('returns 400 for non-completed task', async () => {
    mockSelectChain.get.mockReturnValue({
      id: 2,
      module: 'model_compare',
      status: 'running',
      progress: 50,
      params: '{}',
      fileIds: '[]',
      result: null,
      error: null,
      createdAt: '2025-01-15',
      completedAt: null,
      userId: 1,
    })

    const app = createApp()
    const res = await request(app).get('/api/tasks/2/report')
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('not completed')
  })
})
```

- [ ] **Step 4: 运行后端测试**

```bash
cd backend && npm test
```

Expected: 所有测试 PASS（包括新增的 4 个 report 测试 + 原有 7 个）

- [ ] **Step 5: 提交**

```bash
git add backend/src/lib/report.ts backend/src/routers/tasks.ts backend/src/__tests__/tasks.test.ts
git commit -m "feat: 新增 /api/tasks/:id/report 自包含 HTML 精度报告 + 列表接口返回 overall"
```

---

### Task 6: 前端 — types + API 层适配 overall

**Files:**
- Modify: `src/types/task.ts`
- Modify: `src/api/task.ts`

**Interfaces:**
- Modifies: `ComparisonTask` 增加 `overall` 字段
- Modifies: `getTaskHistory` 映射 `overall` 数据

- [ ] **Step 1: 修改 types/task.ts**

```typescript
// src/types/task.ts — 在 ComparisonTask interface 中添加 overall 字段

export interface ComparisonTask {
  id: number
  model: ModelFile
  frameworks: string[]
  status: TaskStatus
  progress: number
  createdAt: string
  completedAt?: string
  error?: string
  baseline: FrameworkResult | null
  comparisons: FrameworkResult[]
  /** 精度摘要（从列表 API 的 overall 字段映射） */
  overall?: {
    totalLayers: number
    passedLayers: number
    failedLayers: number
    avgCosineSimilarity: number
    maxAbsError: number
    worstLayer: string
  } | null
}
```

- [ ] **Step 2: 修改 api/task.ts**

在 `getTaskHistory` 函数的 map 回调中（Line 98-106），添加 `overall` 映射：

```typescript
    return {
      id: t.id,
      model: { name: (t.fileNames?.[0] || '').replace(/\.[^.]+$/, '') || `任务 #${t.id}`, size: 0 },
      frameworks,
      status: t.status,
      progress: t.progress,
      createdAt: dateStr,
      completedAt: t.completedAt,
      overall: t.overall || null,
    }
```

- [ ] **Step 3: 前端类型检查**

```bash
npx tsc --noEmit
```

Expected: 无新类型错误

- [ ] **Step 4: 提交**

```bash
git add src/types/task.ts src/api/task.ts
git commit -m "feat: ComparisonTask 增加 overall 精度摘要字段，API 层数据映射"
```

---

### Task 7: 前端 UI 重构 — Modal + 表格列 + 去 Drawer

**Files:**
- Create: `src/tasks/model_compare/TaskFormModal.tsx`
- Modify: `src/core/components/TaskTable.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/TaskitPage.tsx`
- Modify: `src/stores/appStore.ts`
- Delete: `src/tasks/model_compare/DrawerTaskDetail.tsx`
- Delete: `src/tasks/model_compare/DrawerTaskForm.tsx`
- Delete: `src/core/components/DetailDrawer.tsx`

**Interfaces:**
- Produces: `TaskFormModal` — 用 shadcn/ui `<Dialog>` 居中弹出的新建任务表单
- Produces: `TaskTable` — 新增精度列 + 下载按钮，移除 Eye 按钮
- Removes: `DetailDrawer`, `DrawerTaskDetail`, `DrawerTaskForm`
- Modifies: `appStore` — 移除 drawer 状态，保留 `activeModule`

- [ ] **Step 1: 安装 shadcn/ui Dialog 组件**

```bash
npx shadcn@latest add dialog
```

这会在 `src/components/ui/dialog.tsx` 创建 Dialog 组件。

- [ ] **Step 2: 创建 TaskFormModal.tsx**

基于 `DrawerTaskForm.tsx` 的内容，将外层容器改为 shadcn/ui 的 `<Dialog>`。

```typescript
// src/tasks/model_compare/TaskFormModal.tsx
// 核心改动：将 DrawerTaskForm 的组件逻辑装入 <Dialog> 而非 DetailDrawer

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileIcon, Loader2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { uploadModel } from '@/api/model'
import { createTask, getTask, cancelTask, retryTask } from '@/api/task'
import type { ModelFile, ComparisonTask } from '@/types'
import { formatSize } from './utils'
import { FW_OPTIONS } from './constants'
import { useToast } from '@/components/ui/toast'

interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function TaskFormModal({ open, onClose, onSuccess }: TaskFormModalProps) {
  // ... 内容与 DrawerTaskForm 完全一致，仅将 DrawerTaskFormProps 改为 TaskFormModalProps
  // 并在最外层包 <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
  //   <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
  //     <DialogHeader><DialogTitle>新建精度比对任务</DialogTitle></DialogHeader>
  //     ... 原 DrawerTaskForm 的 JSX 内容 ...
  //   </DialogContent>
  // </Dialog>
}
```

完整实现：将 `DrawerTaskForm.tsx` 复制到 `TaskFormModal.tsx`，做以下改动：
1. `interface DrawerTaskFormProps` → `interface TaskFormModalProps`，增加 `open: boolean` 和 `onClose: () => void`
2. `export function DrawerTaskForm` → `export function TaskFormModal`
3. 函数体最外层包 `<Dialog open={open} onOpenChange={(open) => !open && onClose()}>`
4. 内容包 `<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">`
5. 顶部加 `<DialogHeader><DialogTitle>新建精度比对任务</DialogTitle></DialogHeader>`
6. `onSuccess` 回调中调用 `onClose()`
7. 删除原 `DrawerTaskForm` 特有的运行中 UI（polling/progress bar 等内容保留，这是表单内嵌的运行状态）

- [ ] **Step 3: 修改 TaskTable.tsx — 精度列 + 下载按钮**

改动点：

**a) 修改 props**：删除 `onSelectTask`，增加 `onDownloadReport` 回调：

```typescript
interface TaskTableProps {
  tasks: ComparisonTask[]
  loading?: boolean
  onNewTask: () => void
  onDownloadReport: (taskId: number) => void
  filterStatus?: string
  onFilterStatusChange?: (v: string) => void
  searchQuery?: string
  onSearchChange?: (v: string) => void
}
```

**b) 修改表头（Line 125 附近）**：将 "精度" 列改为 "通过/总计"，"状态" 列之后加 "余弦" 列：

```tsx
<th className="py-2 px-1 w-[44px]">通过/总计</th>
<th className="py-2 px-1 w-[44px]">余弦</th>
<th className="py-2 px-1 w-[44px]">状态</th>
```

**c) 修改 colSpan**：从 9 列改为 10 列（新增一列余弦）。

**d) 修改表格行**（Line 148-213）：替换精度列和操作列：

```tsx
{/* 精度列（原 Line 180-189）改为通过/总计 */}
<td className="py-2 px-1 font-mono">
  {task.status === 'completed' && task.overall ? (
    <span className="text-brand-success font-semibold text-[11px]">
      {task.overall.passedLayers}/{task.overall.totalLayers}
    </span>
  ) : (
    <span className="text-muted-foreground/60">—</span>
  )}
</td>
{/* 余弦列（新增） */}
<td className="py-2 px-1 font-mono">
  {task.status === 'completed' && task.overall ? (
    <span className="text-foreground font-semibold text-[11px]">
      {task.overall.avgCosineSimilarity.toFixed(4)}
    </span>
  ) : (
    <span className="text-muted-foreground/60">—</span>
  )}
</td>
```

**e) 修改操作列**（原 Line 200-211），去掉 Eye 按钮，改为下载按钮：

```tsx
<td className="py-2 px-1">
  <div className="flex items-center gap-1">
    {task.status === 'completed' && (
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDownloadReport(task.id)
        }}
        className="text-muted-foreground hover:text-brand-accent p-1 rounded-lg hover:bg-brand-light-bg/50 transition"
        title="下载报告"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
</td>
```

需要在 import 中加 `Download`：
```typescript
import { Search, Download, Plus } from 'lucide-react'
```

**f) 删除整行点击 `onSelectTask`**：移除 `<tr>` 上的 `onClick={() => onSelectTask(task)}` 和 `cursor-pointer`：

```tsx
<tr key={task.id} className="hover:bg-brand-light-bg/40 transition group">
```

**g) 空态处理**：`EmptyState` 的 `onAction` 仍然绑定 `onNewTask`。

- [ ] **Step 4: 修改 appStore.ts — 移除 drawer 状态**

```typescript
// src/stores/appStore.ts
import { create } from 'zustand'
import type { ModuleId } from '@/core/types'

interface AppState {
  activeModule: ModuleId
  setActiveModule: (m: ModuleId) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'model-compare',
  setActiveModule: (m) => set({ activeModule: m }),
}))
```

删除 `drawerMode`, `drawerTaskId`, `drawerTitle`, `openDrawer`, `closeDrawer`。

- [ ] **Step 5: 修改 TaskitPage.tsx — 用 Modal 替代 Drawer**

```typescript
// src/pages/TaskitPage.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskTable } from '@/core/components/TaskTable'
import { EmptyState } from '@/core/components/EmptyState'
import { TaskFormModal } from '@/tasks/model_compare/TaskFormModal'
import { useAppStore } from '@/stores/appStore'
import { useTaskStore } from '@/stores/taskStore'

export default function TaskitPage() {
  const navigate = useNavigate()
  const activeModule = useAppStore((s) => s.activeModule)
  const { tasks, tasksLoading, fetchTasks } = useTaskStore()
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (activeModule === 'model-compare') {
      fetchTasks()
    }
  }, [activeModule])

  if (activeModule === 'deploy-agent') {
    return (
      <EmptyState
        icon="🏗️"
        title="模型部署 · 即将上线"
        description="LLM 驱动的模型端侧全自动转化、SDK 库与可执行 Demo 构建流水线，敬请期待"
      />
    )
  }

  const handleDownloadReport = (taskId: number) => {
    const token = localStorage.getItem('token') || ''
    // 打开新标签页下载报告
    window.open(`/api/tasks/${taskId}/report?token=${encodeURIComponent(token)}`, '_blank')
  }

  return (
    <>
      <TaskTable
        tasks={tasks}
        loading={tasksLoading}
        onNewTask={() => setModalOpen(true)}
        onDownloadReport={handleDownloadReport}
      />
      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false)
          fetchTasks()
        }}
      />
    </>
  )
}
```

注：report 下载需要处理认证。`window.open` 方式简单但无法传 Authorization header。更稳健的做法是通过 fetch + blob 下载，或者让 report 路由支持 `?token=` query 参数。

考虑认证：report 路由当前在 `optionalAuth` 下，需要添加 token query 参数支持。或者前端用 fetch 下载：

```typescript
const handleDownloadReport = async (taskId: number) => {
  const token = localStorage.getItem('token') || ''
  const resp = await fetch(`/api/tasks/${taskId}/report`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) return
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
```

这种方式更可靠，用 fetch 带 auth header 获取 HTML，然后通过 blob URL 在新标签页打开。

- [ ] **Step 6: 修改 App.tsx — 去掉 DetailDrawer 相关**

```tsx
// src/App.tsx — 精简版

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Header } from '@/core/components/Header'
import { Sidebar } from '@/core/components/Sidebar'
import { useAppStore } from '@/stores/appStore'
import { AuthPage } from '@/core/components/AuthPage'
import { AuthGuard } from '@/core/components/AuthGuard'
import TaskitPage from '@/pages/TaskitPage'

function AppLayout() {
  const { activeModule, setActiveModule } = useAppStore()

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
        <main className="flex-1 p-8 overflow-y-auto">
          <TaskitPage />
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="/tasks/:id" element={<AuthGuard><AppLayout /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

删除 import：`DetailDrawer`, `DrawerTaskForm`, `DrawerTaskDetail`, `useNavigate`, `useParams`
删除：`handleCloseDrawer`, `JSX 中的 <DetailDrawer>...</DetailDrawer>`

- [ ] **Step 7: 运行前端测试**

```bash
npm test
```

Expected: 所有已有测试 PASS（需检查是否有依赖 drawer 状态的测试需要更新）

- [ ] **Step 8: 手动检查类型**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 9: 提交**

```bash
git add src/tasks/model_compare/TaskFormModal.tsx \
        src/core/components/TaskTable.tsx \
        src/App.tsx src/pages/TaskitPage.tsx src/stores/appStore.ts
git rm src/tasks/model_compare/DrawerTaskDetail.tsx \
        src/tasks/model_compare/DrawerTaskForm.tsx \
        src/core/components/DetailDrawer.tsx
git commit -m "feat: 去 Drawer → Modal 新建任务 + 表格精度列 + 下载报告按钮"
```

---
