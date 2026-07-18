import { Router, Request, Response } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { tasks } from '../../db/schema.js'

const router = Router()

router.get('/modules/model_compare/tasks/:id/layers', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' })
    const framework = req.query.framework as string | undefined

    const task = db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task || !task.result) return res.json({ layers: [] })

    const data = JSON.parse(task.result)
    let layers = data.layers ?? []

    if (framework) {
      layers = layers.map((layer: any) => ({
        ...layer,
        metrics: (layer.metrics ?? []).filter((m: any) => m.frameworkId === framework),
      })).filter((layer: any) => layer.metrics.length > 0)
    }

    const graph = data.graph ?? null

    res.json({ layers, graph })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
