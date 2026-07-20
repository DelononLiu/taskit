"""End-to-end test: compare ONNX Runtime vs OpenVINO on LeNet5 using compare.py.

Note: the runners' run_inference() functions generate their own random input internally.
Since ONNX and OpenVINO consume different amounts of random calls before generating
the input tensor, the actual inputs differ. We therefore validate the pipeline
(structural correctness, metrics shape) rather than requiring a specific cosine value.
"""

import sys
import os
import tempfile
import importlib.util
import numpy as np

BASE = os.path.join(os.path.dirname(__file__), '..')
MODELS = os.path.join(BASE, 'models')
ONNX_PATH = os.path.join(MODELS, 'lenet5.onnx')

sys.path.insert(0, BASE)

# Import onnx runner
spec_o = importlib.util.spec_from_file_location(
    "onnx_runner", os.path.join(BASE, "onnx", "run.py"))
onnx_run = importlib.util.module_from_spec(spec_o)
spec_o.loader.exec_module(onnx_run)

# Import openvino runner
spec_ov = importlib.util.spec_from_file_location(
    "ov_runner", os.path.join(BASE, "openvino", "run.py"))
ov_run = importlib.util.module_from_spec(spec_ov)
spec_ov.loader.exec_module(ov_run)

from compare import compare_npz


def test_onnx_vs_openvino_pipeline():
    """ONNX vs OpenVINO on same .onnx — both runners produce valid outputs."""
    meta_o, arrays_o, _ = onnx_run.run_inference(ONNX_PATH)
    meta_v, arrays_v, _ = ov_run.run_inference(ONNX_PATH)

    assert len(meta_o) > 0, "ONNX should produce layer metadata"
    assert len(arrays_o) > 0, "ONNX should produce tensor outputs"
    assert len(meta_v) > 0, "OpenVINO should produce layer metadata"
    assert len(arrays_v) > 0, "OpenVINO should produce tensor outputs"

    # Both runners should capture at least some layers (different capture strategies)
    assert len(arrays_o) >= 5, f"ONNX should capture >=5 layers, got {len(arrays_o)}"
    assert len(arrays_v) >= 5, f"OpenVINO should capture >=5 layers, got {len(arrays_v)}"


def test_onnx_vs_openvino_compare_npz_structural():
    """compare_npz on ONNX vs OpenVINO outputs produces valid result structure."""
    _, arrays_o, _ = onnx_run.run_inference(ONNX_PATH)
    _, arrays_v, _ = ov_run.run_inference(ONNX_PATH)

    with tempfile.TemporaryDirectory() as tmpdir:
        base_npz = os.path.join(tmpdir, 'onnx.npz')
        tgt_npz = os.path.join(tmpdir, 'openvino.npz')

        np.savez_compressed(base_npz,
                            **{f'layer_{k}': v for k, v in arrays_o.items()})
        np.savez_compressed(tgt_npz,
                            **{f'layer_{k}': v for k, v in arrays_v.items()})

        result = compare_npz(base_npz, tgt_npz, 'onnx_vs_openvino')

        # compare_npz matches by sorted key position; shapes must match
        overall = result['overall']
        assert overall['totalLayers'] >= 1, \
            f"Should match at least 1 layer, got {overall['totalLayers']}"
        assert 'avgCosineSimilarity' in overall
        assert 'maxAbsError' in overall
        assert 'worstLayer' in overall
        assert overall['passedLayers'] + overall['failedLayers'] == overall['totalLayers']

        # Each matched layer has correct metric shape
        for layer in result['layers']:
            assert 'layerName' in layer
            assert len(layer['metrics']) == 1
            m = layer['metrics'][0]
            assert m['frameworkId'] == 'onnx_vs_openvino'
            assert 0.0 <= m['cosineSimilarity'] <= 1.0, \
                f"cosine out of range: {m['cosineSimilarity']}"
            assert 'snr' in m
            assert 'maxAbsError' in m
            assert 'meanAbsError' in m
            assert isinstance(m['passed'], bool)


def test_onnx_vs_openvino_same_input():
    """With the SAME input, ONNX vs OpenVINO produces near-identical results.

    We bypass the runners' random input generation and feed identical input
    to both ONNX Runtime and OpenVINO directly.
    """
    try:
        import onnxruntime as ort
        import openvino as ov
    except ImportError:
        import pytest
        pytest.skip("onnxruntime or openvino not available")

    # Generate a single deterministic input
    np.random.seed(42)
    input_data = np.random.randn(1, 1, 28, 28).astype(np.float32)

    # ── ONNX Runtime ──
    sess = ort.InferenceSession(ONNX_PATH, providers=['CPUExecutionProvider'])
    input_name = sess.get_inputs()[0].name
    onnx_outputs = sess.run(None, {input_name: input_data})

    # ── OpenVINO ──
    core = ov.Core()
    model = core.read_model(ONNX_PATH)
    compiled = core.compile_model(model, "CPU")
    ov_result = compiled([input_data])

    # Collect OpenVINO outputs as flat array list
    ov_arrays = {}
    for i, (_, val) in enumerate(ov_result.items()):
        ov_arrays[str(i)] = np.array(val, dtype=np.float32)

    # Collect ONNX outputs
    onnx_arrays = {}
    for i, val in enumerate(onnx_outputs):
        onnx_arrays[str(i)] = np.array(val, dtype=np.float32)

    with tempfile.TemporaryDirectory() as tmpdir:
        base_npz = os.path.join(tmpdir, 'onnx_same.npz')
        tgt_npz = os.path.join(tmpdir, 'ov_same.npz')
        np.savez_compressed(base_npz, **{f'layer_{k}': v for k, v in onnx_arrays.items()})
        np.savez_compressed(tgt_npz, **{f'layer_{k}': v for k, v in ov_arrays.items()})

        result = compare_npz(base_npz, tgt_npz, 'onnx_vs_openvino_same_input')

        overall = result['overall']
        # Same input, same model — should be near-identical (>0.999)
        assert overall['avgCosineSimilarity'] > 0.999, \
            f"With same input, expected cosine > 0.999, got {overall['avgCosineSimilarity']}"
        assert overall['passedLayers'] == overall['totalLayers'], \
            f"All layers should pass with same input: {overall['passedLayers']}/{overall['totalLayers']}"
