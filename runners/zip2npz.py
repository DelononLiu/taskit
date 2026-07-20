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
    if target.lower().endswith('.onnx'):
        return _onnx_to_npz(extracted, extract_dir)
    return _raw_bin_to_npz(extracted, extract_dir)


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
