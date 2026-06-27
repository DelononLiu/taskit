#!/usr/bin/env bash
# 端到端测试：后端 API → task-engine → runner → output.json
#
# 用法:
#   bash runners/model_diff/run-onnx-e2e.sh
#
# 测试流程:
#   1. 创建临时 task 目录, 写入 input.json
#   2. 调用 run-onnx.sh -C <dir>
#   3. 检查 output.json 是否生成并合法
#   4. 模拟后端数据库写入和读取流程
#   5. 清理

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DIR=$(mktemp -d /tmp/model_diff_e2e_XXXXXX)
PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

echo ""
echo "═══ model_diff 端到端测试 ═══"
echo "  临时目录: $TASK_DIR"
echo ""

# ── 1. 写入 input.json ──
echo "──────────────────────────────"
echo "  Step 1: 写入 input.json"
echo "──────────────────────────────"

cat > "$TASK_DIR/input.json" << JSON
{
  "modelPath": "/home/beck2015/all-MiniLM-L6-v2/onnx/model.onnx",
  "params": { "batchSize": 1 }
}
JSON

if [[ -f "$TASK_DIR/input.json" ]]; then
  pass "input.json 已创建"
  echo "      $(head -3 "$TASK_DIR/input.json")"
else
  fail "input.json 创建失败"
fi

# ── 2. 执行 runner ──
echo ""
echo "──────────────────────────────"
echo "  Step 2: 运行 run-onnx.sh"
echo "──────────────────────────────"

if bash "$DIR/run-onnx.sh" -C "$TASK_DIR"; then
  pass "run-onnx.sh 执行成功 (exit 0)"
else
  fail "run-onnx.sh 执行失败"
fi

# ── 3. 验证 output.json ──
echo ""
echo "──────────────────────────────"
echo "  Step 3: 验证 output.json"
echo "──────────────────────────────"

if [[ ! -f "$TASK_DIR/output.json" ]]; then
  fail "output.json 不存在"
  exit 1
fi
pass "output.json 已生成"

# 验证 JSON 合法
if python3 -c "import json; data=json.load(open('$TASK_DIR/output.json')); assert 'overall' in data; assert 'layers' in data" 2>/dev/null; then
  pass "output.json 格式合法 (含 overall + layers)"
else
  fail "output.json 格式非法"
fi

# 校验整体字段
PY_VALIDATE=$(cat << 'PYEOF'
import json
data = json.load(open('/tmp/_e2e_out.json'))

# 检查 overall
o = data['overall']
assert 'totalLayers' in o, 'missing totalLayers'
assert 'passedLayers' in o, 'missing passedLayers'
assert 'failedLayers' in o, 'missing failedLayers'
assert 'avgCosineSimilarity' in o, 'missing avgCosineSimilarity'
assert o['passedLayers'] + o['failedLayers'] <= o['totalLayers'], 'passed+failed > total'

# 检查 layers
assert len(data['layers']) > 0, 'empty layers'
for l in data['layers']:
    assert 'layerName' in l, 'layer missing name'
    assert 'metrics' in l, f'{l["layerName"]} missing metrics'
    assert len(l['metrics']) > 0, f'{l["layerName"]} empty metrics'
    for m in l['metrics']:
        assert 'frameworkId' in m, 'metric missing frameworkId'
        assert 'cosineSimilarity' in m, 'metric missing cosineSimilarity'
        assert 'passed' in m, 'metric missing passed'
        assert 0 <= m['cosineSimilarity'] <= 1, f'cosineSimilarity out of range: {m["cosineSimilarity"]}'

print('  all validations passed')
PYEOF
)

cp "$TASK_DIR/output.json" /tmp/_e2e_out.json
if python3 -c "$PY_VALIDATE" 2>&1; then
  pass "output.json 字段完整性校验通过"
else
  fail "output.json 字段校验失败"
fi
rm -f /tmp/_e2e_out.json

# ── 4. 模拟后端流程 ──
echo ""
echo "──────────────────────────────"
echo "  Step 4: 模拟后端读取 pipeline"
echo "──────────────────────────────"

# 读取 output.json，模拟 parser 处理
PY_PIPELINE=$(cat << 'PYEOF'
import json

# 同 backend/src/tasks/model_diff/runner.ts 中的 parser
def parseModelDiffOutput(stdout, _params):
    return {
        "overall": stdout.get("overall", {}),
        "layers": stdout.get("layers", []),
    }

with open("/tmp/_e2e_out.json") as f:
    raw = json.load(f)

parsed = parseModelDiffOutput(raw, {})
# 模拟写入数据库 Task.result
result_str = json.dumps(parsed)
assert len(result_str) > 0, 'empty result'

# 验证 layers 数据格式
layers = parsed["layers"]
assert len(layers) > 0, 'no layers'
for l in layers:
    assert l["layerName"], 'layer missing name'
    assert l["layerType"], 'layer missing type'
    assert len(l["metrics"]) > 0, f'{l["layerName"]} empty metrics'
    for m in l["metrics"]:
        assert m["frameworkId"] in ("onnx_int8",), f'bad framework: {m[\"frameworkId\"]}'
        assert 0 <= m["cosineSimilarity"] <= 1, f'bad cosine: {m[\"cosineSimilarity\"]}'

print(f"  parser output -> {len(layers)} layers")
print(f"  first layer: {layers[0]['layerName']} ({layers[0]['layerType']})")
print(f"  result JSON size: {len(result_str)} bytes")
print("  pipeline simulation: OK")
PYEOF
)

cp "$TASK_DIR/output.json" /tmp/_e2e_out.json
if python3 -c "$PY_PIPELINE" 2>&1; then
  pass "后端 pipeline 模拟通过"
else
  fail "后端 pipeline 模拟失败"
fi
rm -f /tmp/_e2e_out.json

# ── 5. 清理 ──
rm -rf "$TASK_DIR"

echo ""
echo "═══════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "═══════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
