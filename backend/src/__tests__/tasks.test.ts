import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import '../tasks/model_compare/runner.js'

// Drizzle mock chain — use vi.hoisted so mockDb is defined before hoisted vi.mock calls
const { mockSelectChain, mockInsertChain, mockUpdateChain, mockDb } = vi.hoisted(() => {
  const selectChain: any = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    limit: vi.fn(() => selectChain),
    offset: vi.fn(() => selectChain),
    get: vi.fn(),
    all: vi.fn(),
  }

  const insertChain: any = {
    values: vi.fn(() => insertChain),
    returning: vi.fn(() => insertChain),
    get: vi.fn(),
  }

  const updateChain: any = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    run: vi.fn(),
  }

  return {
    mockSelectChain: selectChain,
    mockInsertChain: insertChain,
    mockUpdateChain: updateChain,
    mockDb: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  }
})

vi.mock('../db/index.js', () => ({ db: mockDb }))
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

beforeEach(() => {
  vi.clearAllMocks()
})

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
    mockInsertChain.get.mockReturnValue({
      id: 1,
      module: 'model_compare',
      status: 'pending',
      progress: 0,
      params: '{}',
      fileIds: '[]',
      createdAt: '2025-01-15 12:00:00',
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
    mockSelectChain.get.mockReturnValue(undefined)
    const app = createApp()
    const res = await request(app).get('/api/tasks/999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not found')
  })

  it('returns task details', async () => {
    mockSelectChain.get.mockReturnValue({
      id: 1,
      module: 'model_compare',
      status: 'completed',
      progress: 100,
      params: '{"frameworks":["tensorrt"]}',
      fileIds: '["file-1"]',
      result: '{"overall":{},"layers":[]}',
      error: null,
      createdAt: '2025-01-15 12:00:00',
      completedAt: '2025-01-15 12:00:00',
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
    mockSelectChain.all.mockReturnValue([
      { id: 1, module: 'model_compare', status: 'completed', progress: 100, createdAt: '2025-01-15 12:00:00', completedAt: '2025-01-15 12:00:00' },
      { id: 2, module: 'model_compare', status: 'running', progress: 50, createdAt: '2025-01-15 12:00:00', completedAt: null },
    ])
    mockSelectChain.get.mockReturnValue({ count: 2 })

    const app = createApp()
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.body.tasks).toHaveLength(2)
    expect(res.body.total).toBe(2)
  })
})
