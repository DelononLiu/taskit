import { MODULES } from '../registry.js'

// 解析 shell 脚本 stdout
function parseModelDiffOutput(stdout: any, _params: any) {
  return {
    overall: stdout.overall ?? {},
    layers: stdout.layers ?? [],
  }
}

import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runnerScript = path.resolve(__dirname, '../../../../runners/model_diff/run-onnx.sh')

MODULES.model_diff = {
  name: '模型精度比对',
  shell: `bash ${runnerScript} -C {task_dir}`,
  parser: parseModelDiffOutput,
}
