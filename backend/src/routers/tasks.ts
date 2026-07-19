import { Router, Request, Response } from 'express'
import { eq, and, desc, count, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks, files } from '../db/schema.js'
import { getModule } from '../tasks/registry.js'
import { executeTask, cancelTask } from '../lib/task-engine.js'

const router = Router()

// 创建任务
router.post('/', async (req: Request, res: Response) => {
  try {
    const { module, fileIds, params } = req.body
    if (!module) return res.status(400).json({ error: 'module required' })
    if (!getModule(module)) return res.status(400).json({ error: `unknown module: ${module}` })

    // @ts-ignore
    const userId = req.user?.id ?? 1

    const now = new Date().toISOString()
    const task = db.insert(tasks).values({
      userId,
      module,
      status: 'pending',
      params: JSON.stringify(params ?? {}),
      fileIds: JSON.stringify(fileIds ?? []),
      createdAt: now,
    }).returning().get()

    // 异步执行
    executeTask(task.id).catch(console.error)

    res.json({
      id: task.id,
      module: task.module,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 任务列表
router.get('/', async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.id ?? 1
    const module = req.query.module as string | undefined
    const status = req.query.status as string | undefined
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20

    const conditions = [eq(tasks.userId, userId)]
    if (module) conditions.push(eq(tasks.module, module))
    if (status) conditions.push(eq(tasks.status, status))

    const [taskList, totalResult] = await Promise.all([
      db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.createdAt)).limit(limit).offset((page - 1) * limit).all(),
      db.select({ count: count() }).from(tasks).where(and(...conditions)).get(),
    ])
    const total = totalResult?.count ?? 0

    // 查找任务关联的文件名
    const allFileIds = taskList.flatMap((t: any) => {
      try { return JSON.parse(t.fileIds || '[]') } catch { return [] }
    })
    const fileMap = allFileIds.length
      ? Object.fromEntries(
          db.select({ id: files.id, filename: files.filename }).from(files)
            .where(inArray(files.id, [...new Set(allFileIds)])).all()
            .map((f: any) => [f.id, f.filename])
        )
      : {}

    res.json({
      tasks: taskList.map((t: any) => {
        const ids: string[] = (() => { try { return JSON.parse(t.fileIds || '[]') } catch { return [] } })()
        return {
          id: t.id,
          module: t.module,
          status: t.status,
          progress: t.progress,
          createdAt: t.createdAt === 'CURRENT_TIMESTAMP' ? new Date().toISOString() : t.createdAt,
          completedAt: t.completedAt ?? null,
          params: t.params,
          fileNames: ids.map(id => fileMap[id]).filter(Boolean),
        }
      }),
      total,
      page,
      limit,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 任务详情
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' })
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task) return res.status(404).json({ error: 'not found' })

    const resp: any = {
      id: task.id,
      module: task.module,
      status: task.status,
      progress: task.progress,
      params: JSON.parse(task.params),
      createdAt: task.createdAt,
      completedAt: task.completedAt ?? null,
    }

    if (task.result) resp.result = JSON.parse(task.result)
    if (task.error) resp.error = task.error

    res.json(resp)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 取消任务
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' })
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task) return res.status(404).json({ error: 'not found' })
    if (task.status !== 'running' && task.status !== 'pending') {
      return res.status(400).json({ error: `cannot cancel task in status: ${task.status}` })
    }

    cancelTask(task.id)
    db.update(tasks).set({ status: 'cancelled', completedAt: new Date().toISOString() }).where(eq(tasks.id, task.id)).run()

    res.json({ id: task.id, status: 'cancelled' })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 重试任务
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' })
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task) return res.status(404).json({ error: 'not found' })
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return res.status(400).json({ error: `cannot retry task in status: ${task.status}` })
    }

    const newTask = db.insert(tasks).values({
      userId: task.userId,
      module: task.module,
      status: 'pending',
      params: task.params,
      fileIds: task.fileIds,
      createdAt: new Date().toISOString(),
    }).returning().get()

    executeTask(newTask.id).catch(console.error)

    res.json({
      id: newTask.id,
      module: newTask.module,
      status: newTask.status,
      createdAt: newTask.createdAt,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
