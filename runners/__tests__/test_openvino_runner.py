"""Tests for OpenVINO runner helper functions."""
import sys, os, json, importlib.util, numpy as np

BASE = os.path.join(os.path.dirname(__file__), '..')
_spec = importlib.util.spec_from_file_location(
    "openvino_runner", os.path.join(BASE, "openvino", "run.py"))
_ov = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ov)

cosine_similarity = _ov.cosine_similarity
max_abs_error = _ov.max_abs_error
mean_abs_error = _ov.mean_abs_error
compute_snr = _ov.compute_snr
compare_layers = _ov.compare_layers
run_inference = _ov.run_inference


def test_cosine_similarity_identical():
    a = np.array([[1.0, 2.0], [3.0, 4.0]])
    assert cosine_similarity(a, a) == 1.0


def test_cosine_similarity_orthogonal():
    a = np.array([1.0, 0.0])
    assert cosine_similarity(a, np.array([0.0, 1.0])) == 0.0


def test_max_abs_error():
    a = np.array([1.0, 2.0])
    assert max_abs_error(a, np.array([1.0, 5.0])) == 3.0


def test_max_abs_error_zero():
    assert max_abs_error(np.array([1.0]), np.array([1.0])) == 0.0


def test_mean_abs_error():
    a = np.array([1.0, 2.0, 3.0])
    assert mean_abs_error(a, np.array([1.0, 3.0, 3.0])) == 1.0 / 3.0


def test_compute_snr_perfect():
    assert compute_snr(np.array([1.0, 2.0]), np.array([1.0, 2.0])) == 100.0


def test_run_inference_on_lenet():
    """OpenVINO runner loads and runs LeNet ONNX."""
    onnx_path = os.path.join(BASE, 'models', 'lenet5.onnx')
    meta, arrays, graph = run_inference(onnx_path)
    assert len(meta) > 0
    assert len(arrays) > 0
    # Should capture Convolution, Relu, MaxPool, Gemm etc.
    types = set(m["layerType"] for m in meta)
    assert "Convolution" in types, f"Missing Convolution, got {types}"
    assert "Gemm" in types or "MatMul" in types, f"Missing Gemm/MatMul, got {types}"


def test_run_inference_batch_size():
    """OpenVINO runner handles batch_size > 1."""
    onnx_path = os.path.join(BASE, 'models', 'lenet5.onnx')
    meta, arrays, _ = run_inference(onnx_path, batch_size=2)
    assert len(arrays) > 0
    first_key = next(iter(arrays))
    assert arrays[first_key].shape[0] == 2


def test_compare_layers_identical():
    meta = [{"layerName": "conv", "layerType": "Conv", "inputShape": [], "outputShape": [1, 6, 24, 24]}]
    arr = {"0": np.random.rand(1, 6, 24, 24).astype(np.float32)}
    result = compare_layers(meta, arr, meta, arr, "test")
    assert result["overall"]["avgCosineSimilarity"] == 1.0
    assert result["overall"]["totalLayers"] == 1


def test_compare_layers_missing():
    result = compare_layers([], {}, [], {}, "test")
    assert result["overall"]["totalLayers"] == 0


def test_main_single_model(tmp_path):
    """CLI entry point works for single model."""
    onnx_path = os.path.join(BASE, 'models', 'lenet5.onnx')
    out = tmp_path / "result.json"
    sys.argv = ["run.py", "--input", onnx_path, "--output", str(out)]
    _ov.main()
    with open(out) as f:
        data = json.load(f)
    assert data["status"] == "ok"
    assert data["framework"] == "openvino"
