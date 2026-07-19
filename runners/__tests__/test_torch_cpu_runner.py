"""Tests for torch-cpu runner helper functions."""
import sys
import os
import json
import importlib.util
import numpy as np
import torch
import torch.nn

# Import torch-cpu runner as its own module to avoid name conflict with onnx runner
_torch_dir = os.path.join(os.path.dirname(__file__), '..', 'torch-cpu')
_spec = importlib.util.spec_from_file_location("torch_cpu_runner",
                                                os.path.join(_torch_dir, "run.py"))
_torch_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_torch_run)

cosine_similarity = _torch_run.cosine_similarity
max_abs_error = _torch_run.max_abs_error
mean_abs_error = _torch_run.mean_abs_error
compute_snr = _torch_run.compute_snr
compare_layers = _torch_run.compare_layers
run_inference = _torch_run.run_inference


def test_cosine_similarity_identical():
    a = np.array([[1.0, 2.0], [3.0, 4.0]])
    assert cosine_similarity(a, a) == 1.0


def test_cosine_similarity_orthogonal():
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert cosine_similarity(a, b) == 0.0


def test_cosine_similarity_scale():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([2.0, 4.0, 6.0])
    assert abs(cosine_similarity(a, b) - 1.0) < 1e-10


def test_cosine_similarity_negative():
    a = np.array([1.0, 0.0])
    b = np.array([-1.0, 0.0])
    assert cosine_similarity(a, b) == -1.0


def test_max_abs_error():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([1.5, 2.0, 3.0])
    assert max_abs_error(a, b) == 0.5


def test_max_abs_error_zero():
    a = np.array([1.0, 2.0, 3.0])
    assert max_abs_error(a, a) == 0.0


def test_mean_abs_error():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([1.0, 3.0, 3.0])
    assert mean_abs_error(a, b) == 1.0 / 3.0


def test_mean_abs_error_zero():
    a = np.array([1.0, 2.0, 3.0])
    assert mean_abs_error(a, a) == 0.0


def test_compute_snr_perfect():
    a = np.array([1.0, 2.0, 3.0])
    assert compute_snr(a, a) == 100.0


def test_compute_snr_finite():
    a = np.array([10.0, 20.0, 30.0])
    b = np.array([10.5, 20.5, 30.5])
    snr = compute_snr(a, b)
    assert snr > 0
    assert snr < 100


def test_compare_layers_identical():
    meta = [
        {"layerName": "conv1", "layerType": "Module", "inputShape": [1, 1, 32, 32], "outputShape": [1, 6, 28, 28]},
    ]
    arr = {"0": np.random.rand(1, 6, 28, 28).astype(np.float32)}
    result = compare_layers(meta, arr, meta, arr, "torch_fp32")
    assert result["overall"]["avgCosineSimilarity"] == 1.0
    assert result["overall"]["maxAbsError"] == 0.0
    assert result["overall"]["passedLayers"] == 1


def test_compare_layers_with_diff():
    meta = [
        {"layerName": "fc1", "layerType": "Module", "inputShape": [1, 256], "outputShape": [1, 120]},
    ]
    arr_b = {"0": np.random.rand(1, 120).astype(np.float32)}
    arr_t = {"0": np.random.rand(1, 120).astype(np.float32)}
    result = compare_layers(meta, arr_b, meta, arr_t, "torch_fp32")
    assert result["overall"]["totalLayers"] == 1
    assert result["layers"][0]["metrics"][0]["frameworkId"] == "torch_fp32"


def test_compare_layers_missing_key():
    meta = [
        {"layerName": "conv1", "layerType": "Module", "inputShape": [1, 1, 32, 32], "outputShape": [1, 6, 28, 28]},
    ]
    result = compare_layers(meta, {}, meta, {}, "torch_fp32")
    assert result["overall"]["totalLayers"] == 0


class _SimpleNet(torch.nn.Module):
    """Simple test network defined at module level for pickling."""
    def __init__(self):
        super().__init__()
        self.conv = torch.nn.Conv2d(1, 4, 3)
        self.relu = torch.nn.ReLU()
        self.fc = torch.nn.Linear(4 * 30 * 30, 10)

    def forward(self, x):
        x = self.conv(x)
        x = self.relu(x)
        x = x.view(x.size(0), -1)
        x = self.fc(x)
        return x


def test_run_inference_with_module(tmp_path):
    """Test run_inference with a real torch.nn.Module."""
    model = _SimpleNet()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)

    meta, arrays = run_inference(str(model_path), batch_size=1)
    assert len(meta) > 0
    assert len(arrays) > 0
    layer_names = [m["layerName"] for m in meta]
    has_conv = any("conv" in n for n in layer_names)
    has_fc = any("fc" in n for n in layer_names)
    assert has_conv, f"Expected conv layer, got {layer_names}"
    assert has_fc, f"Expected fc layer, got {layer_names}"
