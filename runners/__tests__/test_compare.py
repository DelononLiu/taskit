import os
import sys
import tempfile
import numpy as np
import pytest

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
