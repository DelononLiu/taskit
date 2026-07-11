import { describe, it, expect, vi } from 'vitest'
import { mockApi } from '@/api/mock/handlers'

describe('mockApi.createTask', () => {
  it('returns a running task with correct frameworks', async () => {
    const task = await mockApi.createTask({
      modelId: 'model-1',
      frameworks: ['onnxruntime', 'tensorrt'],
    })
    expect(task.id).toBeGreaterThan(0)
    expect(task.frameworks).toEqual(['onnxruntime', 'tensorrt'])
    expect(task.status).toBe('running')
    expect(task.progress).toBe(0)
  })
})

describe('mockApi.getTask', () => {
  it('returns a completed task for ID 1', async () => {
    const task = await mockApi.getTask(1)
    expect(task.status).toBe('completed')
  })

  it('returns failed task with error message for ID 3', async () => {
    const task = await mockApi.getTask(3)
    expect(task.status).toBe('failed')
    expect(task.error).toContain('推理失败')
    expect(task.progress).toBe(62)
  })

  it('returns running task for a new ID', async () => {
    const task = await mockApi.getTask(999)
    expect(['running', 'completed']).toContain(task.status)
    expect(task.id).toBe(999)
  })
})

describe('mockApi.uploadModel', () => {
  it('calls onProgress callback', async () => {
    const onProgress = vi.fn()
    const result = await mockApi.uploadModel(new File([], 'test.onnx'), onProgress)
    expect(onProgress).toHaveBeenCalled()
    expect(result.name).toBe('test.onnx')
    expect(result.format).toBe('onnx')
  })
})
