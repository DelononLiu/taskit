import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import '../tasks/model_compare/runner.js'

const mockPrisma = vi.hoisted(() => ({
  task: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  file: {
    findUnique: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/task-engine.js', () => ({
  executeTask: vi.fn().mockResolvedValue(undefined),
  cancelTask: vi.fn(),
}))

import tasksRouter from '../routers/tasks.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tasks', tasksRouter)
  return app
}

describe('POST /api/tasks', () => {
  it('returns 400 when module is missing', async () => {
    const app = createApp()
    const res = await request(app).post('/api/tasks').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('module required')
  })

  it('returns 400 for unknown module', async () => {
    const app = createApp()
    const res = await request(app).post('/api/tasks').send({ module: 'nonexistent' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('unknown module')
  })

  it('returns 200 and creates task for model_compare', async () => {
    const now = new Date()
    mockPrisma.task.create.mockResolvedValue({
      id: 1,
      module: 'model_compare',
      status: 'pending',
      progress: 0,
      params: '{}',
      fileIds: '[]',
      createdAt: now,
    })

    const app = createApp()
    const res = await request(app).post('/api/tasks').send({
      module: 'model_compare',
      fileIds: [],
      params: {},
    })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(1)
    expect(res.body.module).toBe('model_compare')
    expect(res.body.status).toBe('pending')
  })
})

describe('GET /api/tasks/:id', () => {
  it('returns 400 for invalid id', async () => {
    const app = createApp()
    const res = await request(app).get('/api/tasks/abc')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid id')
  })

  it('returns 404 for nonexistent task', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null)
    const app = createApp()
    const res = await request(app).get('/api/tasks/999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not found')
  })

  it('returns task details', async () => {
    const now = new Date()
    mockPrisma.task.findUnique.mockResolvedValue({
      id: 1,
      module: 'model_compare',
      status: 'completed',
      progress: 100,
      params: '{"frameworks":["tensorrt"]}',
      fileIds: '["file-1"]',
      result: '{"overall":{},"layers":[]}',
      error: null,
      createdAt: now,
      completedAt: now,
    })

    const app = createApp()
    const res = await request(app).get('/api/tasks/1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(1)
    expect(res.body.status).toBe('completed')
    expect(res.body.result).toBeDefined()
  })
})

describe('GET /api/tasks', () => {
  it('returns task list with pagination', async () => {
    const now = new Date()
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 1, module: 'model_compare', status: 'completed', progress: 100, createdAt: now, completedAt: now },
      { id: 2, module: 'model_compare', status: 'running', progress: 50, createdAt: now, completedAt: null },
    ])
    mockPrisma.task.count.mockResolvedValue(2)

    const app = createApp()
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.body.tasks).toHaveLength(2)
    expect(res.body.total).toBe(2)
  })
})
