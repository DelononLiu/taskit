import { api } from './client'
import { mockApi } from './mock/handlers'
import type { CreateTaskParams, ComparisonTask, LayerDiff, LayersResponse } from '@/types'
import { USE_MOCK } from '@/lib/env'

function getToken() {
  return localStorage.getItem('token') || ''
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` }
}

export async function createTask(params: CreateTaskParams): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.createTask(params)
  }

  const body = {
    module: 'model_compare',
    fileIds: params.modelId ? [params.modelId] : [],
    params: {
      frameworks: [...new Set(params.frameworks)],
      ...(params.params || {}),
    },
  }

  const resp: any = await api.post('/tasks', body, { headers: authHeaders() })
  return {
    id: resp.id,
    model: { id: '', name: '', format: 'onnx', size: 0, uploadTime: '' },
    frameworks: params.frameworks,
    status: resp.status,
    progress: resp.progress,
    createdAt: resp.createdAt,
    baseline: null,
    comparisons: [],
  }
}

export async function getTask(taskId: number): Promise<ComparisonTask> {
  if (USE_MOCK) {
    return mockApi.getTask(taskId)
  }

  const resp: any = await api.get(`/tasks/${taskId}`, { headers: authHeaders() })
  const result = resp.result || {}

  return {
    id: resp.id,
    model: { id: '', name: '', format: 'onnx', size: 0, uploadTime: '' },
    frameworks: resp.params?.frameworks || [],
    status: resp.status,
    progress: resp.progress,
    createdAt: resp.createdAt === 'CURRENT_TIMESTAMP' ? new Date().toISOString() : resp.createdAt,
    completedAt: resp.completedAt,
    error: resp.error,
    baseline: null,
    comparisons: result.overall ? [
      { framework: { id: 'openvino', name: 'OpenVINO', value: 'openvino' }, overallMetrics: result.overall },
    ] : [],
  }
}

export async function getTaskLayers(taskId: number, framework?: string): Promise<LayersResponse> {
  if (USE_MOCK) {
    const layers = await mockApi.getTaskLayers(taskId, framework)
    return { layers, graph: null }
  }

  const qs = framework ? `?framework=${framework}` : ''
  const resp: any = await api.get(`/modules/model_compare/tasks/${taskId}/layers${qs}`, {
    headers: authHeaders(),
  })
  return { layers: resp.layers || [], graph: resp.graph ?? null }
}

export async function getTaskHistory(page = 1, limit = 20): Promise<any[]> {
  if (USE_MOCK) {
    return []
  }

  const resp: any = await api.get(`/tasks?page=${page}&limit=${limit}`, {
    headers: authHeaders(),
  })

  return (resp.tasks || []).map((t: any) => {
    const dateStr = typeof t.createdAt === 'number'
      ? new Date(t.createdAt).toISOString()
      : t.createdAt ?? ''
    let frameworks: string[] = [t.module]
    if (t.params) {
      try {
        const p = typeof t.params === 'string' ? JSON.parse(t.params) : t.params
        if (Array.isArray(p.frameworks)) frameworks = p.frameworks
      } catch {}
    }
    return {
      id: t.id,
      model: { name: (t.fileNames?.[0] || '').replace(/\.[^.]+$/, '') || `任务 #${t.id}`, size: 0 },
      frameworks,
      status: t.status,
      progress: t.progress,
      createdAt: dateStr,
      completedAt: t.completedAt,
      overall: t.overall || null,
    }
  })
}

export async function cancelTask(taskId: number): Promise<any> {
  if (USE_MOCK) return { id: taskId, status: 'cancelled' }
  return api.post(`/tasks/${taskId}/cancel`, undefined, { headers: authHeaders() })
}

export async function retryTask(taskId: number): Promise<any> {
  if (USE_MOCK) return { id: taskId, status: 'pending' }
  return api.post(`/tasks/${taskId}/retry`, undefined, { headers: authHeaders() })
}
