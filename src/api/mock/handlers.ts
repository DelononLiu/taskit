import type { ApiResponse, CreateTaskParams, ComparisonTask, LayerDiff, ModelFile } from '@/types'
import { MOCK_TASK, MOCK_LAYER_DIFFS, MOCK_MODEL } from './fixtures'

function delay(ms = 800): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let taskCounter = 1

export const mockApi = {
  async uploadModel(_file: File, onProgress?: (pct: number) => void): Promise<ModelFile> {
    onProgress?.(10)
    await delay(300)
    onProgress?.(50)
    await delay(400)
    onProgress?.(100)
    await delay(200)
    return { ...MOCK_MODEL, id: `model-${Date.now()}`, name: _file.name, size: _file.size }
  },

  async createTask(params: CreateTaskParams): Promise<ComparisonTask> {
    await delay(500)
    const id = taskCounter++
    return {
      ...MOCK_TASK,
      id,
      model: { ...MOCK_MODEL, id: params.modelId },
      frameworks: params.frameworks,
      status: 'running',
      progress: 0,
      createdAt: new Date().toISOString(),
    }
  },

  async getTask(taskId: number): Promise<ComparisonTask> {
    await delay(300)
    // Failed mock task
    if (taskId === 3) {
      return {
        ...MOCK_TASK,
        id: taskId,
        status: 'failed',
        progress: 62,
        error: '推理失败: 模型不兼容 (BertBase 未实现 fused attention)',
      }
    }
    // Simulate progress for new tasks
    if (taskId > 1) {
      const elapsed = Date.now() - new Date(MOCK_TASK.createdAt).getTime()
      const progress = Math.min(100, Math.round((elapsed / 5000) * 100))
      return {
        ...MOCK_TASK,
        id: taskId,
        status: progress >= 100 ? 'completed' : 'running',
        progress,
      }
    }
    return { ...MOCK_TASK, id: taskId }
  },

  async getTaskLayers(_taskId: number, _framework?: string): Promise<LayerDiff[]> {
    await delay(400)
    return MOCK_LAYER_DIFFS
  },
}
