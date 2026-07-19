#!/usr/bin/env bash
# Run each runner's tests using its own venv.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
FAILED=0

run_test() {
    local name="$1"    # runner name (onnx, torch-cpu, openvino)
    local venv_python="$2"  # path to venv python
    local test_file="$3"
    shift 3

    echo "━━━ $name ━━━"
    if [ -x "$venv_python" ]; then
        # Ensure pytest is installed in the venv
        "$venv_python" -m pip install pytest -q 2>/dev/null || true
        if "$venv_python" -m pytest "$DIR/__tests__/$test_file" -v --tb=short "$@"; then
            echo "  ✓ $name"
        else
            echo "  ✗ $name"
            FAILED=1
        fi
    else
        echo "  ⚠  venv not found at $venv_python, skipping $name"
    fi
    echo ""
}

run_test "onnx"       "$DIR/onnx/venv/bin/python"       "test_onnx_runner.py"
run_test "openvino"   "$DIR/openvino/venv/bin/python"    "test_openvino_runner.py"

# torch-cpu: prefer venv, fall back to system (where torch is installed)
if [ -x "$DIR/torch-cpu/venv/bin/python" ]; then
    run_test "torch-cpu" "$DIR/torch-cpu/venv/bin/python" "test_torch_cpu_runner.py"
else
    echo "━━━ torch-cpu ━━━"
    python3 -m pytest "$DIR/__tests__/test_torch_cpu_runner.py" -v --tb=short && echo "  ✓ torch-cpu (system)" || { echo "  ✗ torch-cpu"; FAILED=1; }
fi

# Integration tests that span runners — run under onnx venv (has most deps)
echo "━━━ torch_vs_onnx ━━━"
if python3 -c "import torch" 2>/dev/null; then
    python3 -m pytest "$DIR/__tests__/test_torch_vs_onnx.py" -v --tb=short && echo "  ✓ torch_vs_onnx" || { echo "  ✗ torch_vs_onnx"; FAILED=1; }
else
    echo "  ⚠  torch not available, skipping"
fi

echo "━━━ compare_lenet ━━━"
if python3 -c "import torch" 2>/dev/null; then
    python3 -m pytest "$DIR/__tests__/test_compare_lenet.py" -v --tb=short && echo "  ✓ compare_lenet" || { echo "  ✗ compare_lenet"; FAILED=1; }
else
    echo "  ⚠  torch not available, skipping"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
    echo "✅ All tests passed"
else
    echo "❌ Some tests failed"
    exit 1
fi
