#!/usr/bin/env bash
# runners/onnx/run.sh — ONNX Runtime inference + comparison runner
#
# Usage:
#   run.sh --input resnet50.onnx --output result.json
#   run.sh --input baseline.onnx,optimized.onnx --output result.json
#   run.sh --input model.onnx --output result.json --node-output nodes.npz --precision fp16

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
