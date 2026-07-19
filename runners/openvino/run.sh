#!/usr/bin/env bash
# runners/openvino/run.sh — OpenVINO inference + comparison runner
#
# Usage:
#   run.sh --input model.onnx --output result.json
#   run.sh --input baseline.onnx,optimized.onnx --output result.json

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
