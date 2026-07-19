"""Tests for ONNX runner helper functions."""
import sys
import os
import json
import tempfile
import importlib.util
import numpy as np

# Import onnx runner as its own module to avoid name conflict with torch-cpu runner
_onnx_dir = os.path.join(os.path.dirname(__file__), '..', 'onnx')
_spec = importlib.util.spec_from_file_location("onnx_runner",
                                                os.path.join(_onnx_dir, "run.py"))
_onnx_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_onnx_run)

cosine_similarity = _onnx_run.cosine_similarity
max_abs_error = _onnx_run.max_abs_error
mean_abs_error = _onnx_run.mean_abs_error
compute_snr = _onnx_run.compute_snr
compare_layers = _onnx_run.compare_layers


def test_cosine_similarity_identical():
    a = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    assert cosine_similarity(a, a) == 1.0


def test_cosine_similarity_orthogonal():
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert cosine_similarity(a, b) == 0.0


def test_cosine_similarity_zero():
    a = np.zeros((3, 3))
    b = np.ones((3, 3))
    # both zero norm → 1.0 if equal, else 0.0
    assert cosine_similarity(a, a) == 1.0


def test_cosine_similarity_partial():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([2.0, 4.0, 6.0])
    result = cosine_similarity(a, b)
    assert abs(result - 1.0) < 1e-10


def test_cosine_similarity_negative():
    a = np.array([1.0, 0.0])
    b = np.array([-1.0, 0.0])
    assert cosine_similarity(a, b) == -1.0


def test_max_abs_error():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([1.0, 5.0, 3.0])
    assert max_abs_error(a, b) == 3.0


def test_max_abs_error_identical():
    a = np.array([1.0, 2.0, 3.0])
    assert max_abs_error(a, a) == 0.0


def test_mean_abs_error():
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([1.0, 4.0, 3.0])
    assert mean_abs_error(a, b) == 2.0 / 3.0


def test_mean_abs_error_identical():
    a = np.array([1.0, 2.0, 3.0])
    assert mean_abs_error(a, a) == 0.0


def test_compute_snr_perfect():
    a = np.array([1.0, 2.0, 3.0])
    assert compute_snr(a, a) == 100.0


def test_compute_snr_lower():
    a = np.array([10.0, 20.0, 30.0])
    b = np.array([10.1, 20.1, 30.1])
    snr = compute_snr(a, b)
    assert snr < 100.0
    assert snr > 0.0


def test_compare_layers_basic():
    meta = [
        {"layerName": "conv1", "layerType": "Conv", "inputShape": [1, 3, 32, 32], "outputShape": [1, 6, 28, 28]},
    ]
    arrays = {"0": np.random.rand(1, 6, 28, 28).astype(np.float32)}
    result = compare_layers(meta, arrays, meta, arrays, "test_fw")
    assert result["overall"]["totalLayers"] == 1
    assert result["overall"]["avgCosineSimilarity"] == 1.0
    assert result["overall"]["maxAbsError"] == 0.0


def test_compare_layers_mismatch_shapes():
    meta = [
        {"layerName": "conv1", "layerType": "Conv", "inputShape": [1, 3, 32, 32], "outputShape": [1, 6, 28, 28]},
        {"layerName": "conv2", "layerType": "Conv", "inputShape": [1, 6, 28, 28], "outputShape": [1, 16, 10, 10]},
    ]
    arrays_b = {
        "0": np.random.rand(1, 6, 28, 28).astype(np.float32),
        "1": np.random.rand(1, 16, 10, 10).astype(np.float32),
    }
    arrays_t = {
        "0": np.random.rand(1, 6, 28, 28).astype(np.float32),
        "1": np.random.rand(1, 16, 10, 10).astype(np.float32),
    }
    result = compare_layers(meta, arrays_b, meta, arrays_t, "test_fw")
    assert result["overall"]["totalLayers"] == 2


def test_compare_layers_below_threshold():
    meta = [
        {"layerName": "conv1", "layerType": "Conv", "inputShape": [1, 3, 32, 32], "outputShape": [1, 6, 28, 28]},
    ]
    arrays = {"0": np.random.rand(1, 6, 28, 28).astype(np.float32)}
    result = compare_layers(meta, arrays, meta, arrays, "test_fw")
    assert result["overall"]["passedLayers"] == 1
    assert result["layers"][0]["metrics"][0]["passed"] is True


def test_parse_model_diff_output():
    meta = [
        {"layerName": "fc1", "layerType": "Gemm", "inputShape": [1, 256], "outputShape": [1, 120]},
    ]
    arrays = {"0": np.random.rand(1, 120).astype(np.float32)}
    result = compare_layers(meta, arrays, meta, arrays, "test_fw")
    assert result["overall"]["avgCosineSimilarity"] == 1.0
    assert result["layers"][0]["metrics"][0]["frameworkId"] == "test_fw"


def test_main_single_model(tmp_path):
    """Test main() with a single model produces valid output."""
    import onnx

    # Create a minimal ONNX model
    input_tensor = onnx.helper.make_tensor_value_info("input", onnx.TensorProto.FLOAT, [1, 3, 32, 32])
    output_tensor = onnx.helper.make_tensor_value_info("output", onnx.TensorProto.FLOAT, [1, 10])
    node = onnx.helper.make_node("Relu", ["input"], ["output"])
    graph = onnx.helper.make_graph([node], "test", [input_tensor], [output_tensor])
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 14)])

    model_path = tmp_path / "test_model.onnx"
    onnx.save(model, model_path)
    output_path = tmp_path / "result.json"

    # Run main via CLI args
    sys.argv = ["run.py", "--input", str(model_path), "--output", str(output_path)]
    _onnx_run.main()

    with open(output_path) as f:
        data = json.load(f)
    assert data["status"] == "ok"
    assert data["framework"] == "onnx"
