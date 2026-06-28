#!/usr/bin/env bash
# model_diff 全流程编排: 推理 + 比较
#
# 1. 读 input.json → 跑 FP32 模型推理
# 2. 自动发现量化模型 → 跑 INT8 推理
# 3. tensor-compare 逐层比对 → 写 output.json

set -euo pipefail

TASK_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -C) TASK_DIR="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

if [[ -z "$TASK_DIR" ]]; then
  echo "Usage: $0 -C <task-dir>"
  exit 1
fi

INPUT_JSON="$TASK_DIR/input.json"
[[ -f "$INPUT_JSON" ]] || { echo "Error: $INPUT_JSON not found" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 读取 input.json 中的 frameworks ──
FRAMEWORKS=$(python3 -c "
import json
data = json.load(open('$INPUT_JSON'))
print(json.dumps(data.get('frameworks', [])))
")

# 校验：仅 onnxruntime 是当前支持的推理后端
SUPPORTED_FW=("onnxruntime")
for fw in $(echo "$FRAMEWORKS" | python3 -c "import sys,json; [print(f) for f in json.load(sys.stdin)]"); do
  match=0
  for s in "${SUPPORTED_FW[@]}"; do [[ "$fw" == "$s" ]] && match=1; done
  if [[ $match -eq 0 ]]; then
    echo "[orchestrator] unsupported framework: $fw (only onnxruntime is implemented)" >&2
    cat > "$TASK_DIR/output.json" <<-EOF
{
  "overall": null,
  "layers": [],
  "error": "Framework $fw is not supported (only onnxruntime is implemented)"
}
EOF
    exit 1
  fi
done

# ── 1. 跑 FP32 推理（baseline） ──
echo "[orchestrator] running FP32 baseline..."
python3 "$SCRIPT_DIR/run-onnx.py" -C "$TASK_DIR"

# ── 2. 检查是否存在量化模型 ──
BASELINE_DIR="$TASK_DIR/runner_outputs"
MODEL_PATH=$(python3 -c "import json; print(json.load(open('$INPUT_JSON'))['modelPath'])")
MODEL_DIR=$(dirname "$MODEL_PATH")

Q_MODEL=""
for f in "$MODEL_DIR"/*qint8*.onnx "$MODEL_DIR"/*quint8*.onnx; do
  [[ -f "$f" ]] && [[ "$f" != "$MODEL_PATH" ]] && { Q_MODEL="$f"; break; }
done

# ── 3. 如果有量化模型，跑 INT8 推理 → 比较 ──
if [[ -n "$Q_MODEL" ]]; then
  echo "[orchestrator] quantized model found: $(basename "$Q_MODEL")"

  # 用量化模型跑推理（临时改 input.json）
  TMP_INPUT="$TASK_DIR/input_int8.json"
  python3 -c "
import json
d = json.load(open('$INPUT_JSON'))
d['modelPath'] = '$Q_MODEL'
with open('$TMP_INPUT', 'w') as f: json.dump(d, f)
"
  # 备份原 runner_outputs，然后跑量化模型
  mv "$BASELINE_DIR" "${BASELINE_DIR}_fp32"
  python3 "$SCRIPT_DIR/run-onnx.py" -C "$TASK_DIR"
  mv "$BASELINE_DIR" "${BASELINE_DIR}_int8"
  mv "${BASELINE_DIR}_fp32" "$BASELINE_DIR"
  rm -f "$TMP_INPUT"

  # ── 4. 比较 ──
  echo "[orchestrator] comparing FP32 vs INT8..."
  # 从 input.json 读取目标框架名（frameworks 最后一项）
  TARGET_FW=$(python3 -c "
import json
data = json.load(open('$INPUT_JSON'))
fw = data.get('frameworks', ['onnxruntime'])
# 使用用户选择的第一个非基线框架；如果只有一项就用它
fw = [f for f in fw if f != 'onnxruntime'] or fw
print(fw[-1])
")
  echo "[orchestrator] framework-id: $TARGET_FW"
  python3 "$SCRIPT_DIR/tensor-compare.py" \
    --baseline "${BASELINE_DIR}" \
    --target "${BASELINE_DIR}_int8" \
    -o "$TASK_DIR/output.json" \
    --framework-id "$TARGET_FW"
else
  echo "[orchestrator] no quantized model, baseline only"
  # 没有量化模型时，至少输出 meta 信息（无 metrics）
  LAYERS=$(python3 -c "
import json, os
meta = json.load(open('$BASELINE_DIR/meta.json'))
os.makedirs(os.path.dirname('$TASK_DIR/output.json'), exist_ok=True)
with open('$TASK_DIR/output.json', 'w') as f:
    json.dump({
        'overall': {'totalLayers': len(meta), 'passedLayers': 0, 'failedLayers': 0,
                     'avgCosineSimilarity': 0, 'maxAbsError': 0, 'worstLayer': ''},
        'layers': [{'layerName': l['layerName'], 'layerType': l['layerType'],
                     'inputShape': l['inputShape'], 'outputShape': l['outputShape'],
                     'metrics': []} for l in meta]
    }, f, indent=2)
")
  python3 -c "$LAYERS"
fi

echo "[orchestrator] done → $TASK_DIR/output.json"
