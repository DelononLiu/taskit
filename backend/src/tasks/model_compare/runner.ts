import { MODULES } from '../registry.js'

function parseModelDiffOutput(stdout: any, _params: any) {
  return {
    overall: stdout.overall ?? {},
    layers: stdout.layers ?? [],
    graph: stdout.graph ?? null,
  }
}

MODULES.model_compare = {
  name: '模型精度比对',
  runner: 'onnx',
  parser: parseModelDiffOutput,
}
