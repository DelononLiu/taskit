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
            assert loaded[loaded.files[0]].size == 100

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
