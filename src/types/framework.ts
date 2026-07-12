export interface Framework {
  id: string
  name: string
  value: 'onnxruntime' | 'openvino' | 'vllm-cpu' | 'transformers' | 'torch-cpu'
  version?: string
  isBaseline?: boolean
}

export const FRAMEWORKS: Framework[] = [
  { id: 'onnxruntime', name: 'ONNX Runtime', value: 'onnxruntime', isBaseline: true },
  { id: 'openvino', name: 'OpenVINO', value: 'openvino' },
  { id: 'vllm-cpu', name: 'vLLM (CPU)', value: 'vllm-cpu' },
  { id: 'transformers', name: 'Transformers', value: 'transformers' },
  { id: 'torch-cpu', name: 'PyTorch (CPU)', value: 'torch-cpu' },
]

export const BASELINE_FRAMEWORK = FRAMEWORKS[0]

export interface FrameworkResult {
  framework: Framework
  overallMetrics: OverallMetrics
}

export interface OverallMetrics {
  totalLayers: number
  passedLayers: number
  failedLayers: number
  avgCosineSimilarity: number
  maxAbsError: number
  worstLayer: string | null
}
