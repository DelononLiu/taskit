#!/usr/bin/env bash
# model_diff runner (PyTorch) — placeholder
#
# 调用方式:
#   bash run-torch.sh -C /tmp/task_xxx/
#
# 输入: $TASK_DIR/input.json  （后端写入）
# 输出: $TASK_DIR/output.json （runner 写入，固定文件名）

set -euo pipefail

TASK_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -C) TASK_DIR="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

if [[ -z "$TASK_DIR" ]]; then
  echo "Usage: $0 -C <dir>"
  exit 1
fi

echo "run-torch.sh: not yet implemented" >&2
exit 1
