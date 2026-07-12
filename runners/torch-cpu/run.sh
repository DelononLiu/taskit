#!/usr/bin/env bash
# runners/torch-cpu/run.sh — PyTorch (CPU) inference + comparison runner
#
# Usage:
#   run.sh --input model.pt --output result.json
#   run.sh --input baseline.pt,target.pt --output result.json --precision fp16

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/venv/bin/python" "$SCRIPT_DIR/run.py" "$@"
