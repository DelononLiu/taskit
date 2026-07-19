"""End-to-end test: torch-cpu runner → export ONNX → onnx runner → compare."""
import sys
import os
import json
import importlib.util
import numpy as np

# ── Import both runners as separate named modules ──
_test_dir = os.path.dirname(__file__)

_torch_spec = importlib.util.spec_from_file_location(
    "torch_cpu_runner_e2e", os.path.join(_test_dir, '..', 'torch-cpu', 'run.py'))
_torch_run = importlib.util.module_from_spec(_torch_spec)
_torch_spec.loader.exec_module(_torch_run)

_onnx_spec = importlib.util.spec_from_file_location(
    "onnx_runner_e2e", os.path.join(_test_dir, '..', 'onnx', 'run.py'))
_onnx_run = importlib.util.module_from_spec(_onnx_spec)
_onnx_spec.loader.exec_module(_onnx_run)

import torch
import torch.nn


class _LeNetLike(torch.nn.Module):
    """Mini LeNet-like model for end-to-end testing."""
    def __init__(self):
        super().__init__()
        self.conv1 = torch.nn.Conv2d(1, 4, 3)
        self.relu1 = torch.nn.ReLU()
        self.pool1 = torch.nn.MaxPool2d(2)
        self.conv2 = torch.nn.Conv2d(4, 8, 3)
        self.relu2 = torch.nn.ReLU()
        self.pool2 = torch.nn.MaxPool2d(2)
        self.fc = torch.nn.Linear(8 * 6 * 6, 10)

    def forward(self, x):
        x = self.pool1(self.relu1(self.conv1(x)))
        x = self.pool2(self.relu2(self.conv2(x)))
        x = x.view(x.size(0), -1)
        return self.fc(x)


def test_torch_export_to_onnx_creates_valid_file(tmp_path):
    """Torch runner exports model to valid ONNX file that onnx can load."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    # Run torch inference with ONNX export
    meta_t, arrays_t = _torch_run.run_inference(
        str(model_path), batch_size=1, export_onnx=str(onnx_path))

    # Verify ONNX was exported
    assert onnx_path.exists()
    assert onnx_path.stat().st_size > 0

    # Load with onnx to verify validity
    import onnx
    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)
    assert len(onnx_model.graph.node) > 0


def test_torch_and_onnx_both_produce_layer_outputs(tmp_path):
    """Both runners produce non-empty layer metadata from the same model."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    # Torch inference + export
    meta_t, arrays_t = _torch_run.run_inference(
        str(model_path), batch_size=1, export_onnx=str(onnx_path))

    # ONNX inference
    meta_o, arrays_o, graph_o = _onnx_run.run_inference(str(onnx_path), batch_size=1)

    # Both have layers
    assert len(meta_t) > 0, "Torch runner produced no layers"
    assert len(meta_o) > 0, "ONNX runner produced no layers"

    # Both produce tensor arrays
    assert len(arrays_t) > 0
    assert len(arrays_o) > 0

    # Layer metadata has required fields
    for m in meta_t:
        assert "layerName" in m
        assert "outputShape" in m
        assert len(m["outputShape"]) > 0

    for m in meta_o:
        assert "layerName" in m
        assert "outputShape" in m


def test_torch_and_onnx_layer_counts_consistent(tmp_path):
    """Layer count diff between torch and onnx should be small."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    meta_t, _ = _torch_run.run_inference(
        str(model_path), batch_size=1, export_onnx=str(onnx_path))
    meta_o, _, _ = _onnx_run.run_inference(str(onnx_path), batch_size=1)

    # Both runners should identify a similar number of layers
    diff = abs(len(meta_t) - len(meta_o))
    # Torch hooks capture leaf modules (conv, relu, pool, fc ≈ 7 layers).
    # ONNX captures Conv/Relu/MaxPool/Gemm nodes (≈ 7 too if decomposition is minimal).
    # Allow some variation due to onnx decomposition.
    assert diff <= 4, f"Layer count diff too large: torch={len(meta_t)}, onnx={len(meta_o)}"


def test_torch_onnx_compare_layers_accepts_both_outputs(tmp_path):
    """compare_layers() from torch runner can consume both torch and onnx outputs."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    meta_t, arrays_t = _torch_run.run_inference(
        str(model_path), batch_size=1, export_onnx=str(onnx_path))
    meta_o, arrays_o, _ = _onnx_run.run_inference(str(onnx_path), batch_size=1)

    # The compare function should accept both metadata structures
    result = _torch_run.compare_layers(meta_t, arrays_t, meta_o, arrays_o, "torch_vs_onnx")
    assert "overall" in result
    assert "layers" in result
    # It should produce some comparison
    assert result["overall"]["totalLayers"] >= 0


def test_torch_onnx_batch_size_consistency(tmp_path):
    """Both runners handle batch_size > 1."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    meta_t, arrays_t = _torch_run.run_inference(
        str(model_path), batch_size=2, export_onnx=str(onnx_path))
    meta_o, arrays_o, _ = _onnx_run.run_inference(str(onnx_path), batch_size=2)

    assert len(meta_t) > 0
    assert len(meta_o) > 0

    # First output should have batch size 2
    first_t = arrays_t["0"]
    first_o = arrays_o["0"]
    assert first_t.shape[0] == 2, f"Torch output batch dim: {first_t.shape}"
    assert first_o.shape[0] == 2, f"ONNX output batch dim: {first_o.shape}"


def test_compare_layers_functional_torch_like(tmp_path):
    """compare_layers from onnx runner also works with compatible metadata."""
    model = _LeNetLike()
    model_path = tmp_path / "test_model.pt"
    torch.save(model, model_path)
    onnx_path = tmp_path / "exported.onnx"

    meta_t, arrays_t = _torch_run.run_inference(
        str(model_path), batch_size=1, export_onnx=str(onnx_path))

    # Use compare_layers from onnx runner with torch data against itself
    result = _onnx_run.compare_layers(meta_t, arrays_t, meta_t, arrays_t, "self")
    assert result["overall"]["avgCosineSimilarity"] == 1.0
    assert result["overall"]["totalLayers"] == len(meta_t)
