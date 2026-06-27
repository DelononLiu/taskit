export interface LayerDiff {
  layerName: string
  layerType: string
  inputShape: number[]
  outputShape: number[]
  metrics: LayerMetric[]
}

export interface LayerMetric {
  frameworkId: string
  cosineSimilarity: number
  maxAbsError: number
  meanAbsError: number
  relativeError: number
  snr: number
  passed: boolean
  dimCosineStats?: DimCosineStats
}

export interface DimCosineStats {
  min: number
  max: number
  mean: number
  histogram: Array<{ lo: number; hi: number; count: number }>
}

export interface GraphNode {
  name: string
  opType: string
  depth: number
  isLeaf: boolean
  cosineSimilarity?: number | null
}

export interface GraphEdge {
  from: string
  to: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  outputs: string[]
}

export interface LayersResponse {
  layers: LayerDiff[]
  graph: GraphData | null
}
