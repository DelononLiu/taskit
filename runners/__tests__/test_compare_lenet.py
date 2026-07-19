"""End-to-end test: compare torch-cpu and onnx runner outputs on real LeNet model."""
import sys, os, json, importlib.util
import numpy as np

BASE = os.path.join(os.path.dirname(__file__), '..')
MODELS = os.path.join(BASE, 'models')

# Import torch-cpu runner
spec_t = importlib.util.spec_from_file_location(
    "torch_runner", os.path.join(BASE, "torch-cpu", "run.py"))
torch_run = importlib.util.module_from_spec(spec_t)
spec_t.loader.exec_module(torch_run)

# Import onnx runner
spec_o = importlib.util.spec_from_file_location(
    "onnx_runner", os.path.join(BASE, "onnx", "run.py"))
onnx_run = importlib.util.module_from_spec(spec_o)
spec_o.loader.exec_module(onnx_run)

MODEL_SCRIPT = os.path.join(MODELS, "lenet5.py")
STATE_DICT   = os.path.join(MODELS, "lenet_mnist_model.pth")
ONNX_PATH    = os.path.join(MODELS, "lenet5.onnx")


def test_torch_runner_loads_lenet():
    """torch-cpu runner can load LeNet from state_dict + model script."""
    meta, arrays = torch_run.run_inference(
        STATE_DICT, model_script=MODEL_SCRIPT, input_shape=(1, 28, 28))
    assert len(meta) > 0
    assert len(arrays) > 0
    # LeNet has: conv1, relu1, pool1, conv2, relu2, pool2, fc1, relu3, fc2, relu4, fc3
    layer_names = [m["layerName"] for m in meta]
    assert "conv1" in layer_names, f"Missing conv1, got {layer_names}"
    assert "fc3" in layer_names, f"Missing fc3, got {layer_names}"


def test_torch_exports_lenet_to_onnx(tmp_path):
    """torch-cpu runner can export LeNet to valid ONNX."""
    onnx_out = tmp_path / "lenet.onnx"
    meta, _ = torch_run.run_inference(
        STATE_DICT, model_script=MODEL_SCRIPT, input_shape=(1, 28, 28),
        export_onnx=str(onnx_out))
    assert onnx_out.exists()
    assert onnx_out.stat().st_size > 0
    # Validate with onnx
    import onnx
    m = onnx.load(str(onnx_out))
    onnx.checker.check_model(m)
    assert len(m.graph.node) > 0


def test_onnx_runner_loads_lenet():
    """onnx runner can load the exported LeNet ONNX model."""
    meta, arrays, graph = onnx_run.run_inference(ONNX_PATH)
    assert len(meta) > 0
    assert len(arrays) > 0


def test_lenet_torch_vs_onnx_layer_counts():
    """Torch and ONNX runners produce similar layer counts for LeNet."""
    meta_t, _ = torch_run.run_inference(
        STATE_DICT, model_script=MODEL_SCRIPT, input_shape=(1, 28, 28))
    meta_o, _, _ = onnx_run.run_inference(ONNX_PATH)
    # Torch captures 11 layers (including MaxPool), ONNX captures ~9 (no MaxPool)
    diff = abs(len(meta_t) - len(meta_o))
    assert diff <= 3, f"Layer count diff too large: torch={len(meta_t)}, onnx={len(meta_o)}"


def test_lenet_torch_vs_onnx_comparison():
    """Comparing torch and ONNX LeNet outputs produces valid structure.

    Note: runner generates random input internally, so torch and ONNX
    receive different inputs. Numeric comparison is covered by unit tests
    (test_torch_cpu_runner, test_onnx_runner). This test validates the
    end-to-end pipeline: both runners produce data → compare_layers accepts both.
    """
    meta_t, arr_t = torch_run.run_inference(
        STATE_DICT, model_script=MODEL_SCRIPT, input_shape=(1, 28, 28))
    meta_o, arr_o, _ = onnx_run.run_inference(ONNX_PATH)

    result = torch_run.compare_layers(meta_t, arr_t, meta_o, arr_o, "torch_vs_onnx")
    o = result["overall"]

    # compare_layers matches by index+shape; some layers should align
    assert o["totalLayers"] >= 2, f"Too few comparable layers: {o['totalLayers']}"
    assert "avgCosineSimilarity" in o
    assert "maxAbsError" in o
    assert "worstLayer" in o
    assert len(result["layers"]) == o["totalLayers"]


def test_lenet_produces_expected_layer_shapes():
    """LeNet layer output shapes should match expected dimensions."""
    meta_t, _ = torch_run.run_inference(
        STATE_DICT, model_script=MODEL_SCRIPT, input_shape=(1, 28, 28))

    shape_map = {m["layerName"]: m["outputShape"] for m in meta_t}
    # conv1: (1, 6, 24, 24) — 28x28 input, conv5 → 24x24
    assert shape_map["conv1"] == [1, 6, 24, 24], f"conv1 shape: {shape_map['conv1']}"
    # pool1: (1, 6, 12, 12)
    assert shape_map["pool1"] == [1, 6, 12, 12], f"pool1 shape: {shape_map['pool1']}"
    # fc3: (1, 10)
    assert shape_map["fc3"] == [1, 10], f"fc3 shape: {shape_map['fc3']}"