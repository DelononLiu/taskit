import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { files } from '../db/schema.js'
import { config } from '../config.js'

const storage = multer.diskStorage({
  destination: async (req: any, _file, cb) => {
    const userId = req.user?.id ?? 1
    const userDir = path.join(config.uploadDir, String(userId))
    await fs.mkdir(userDir, { recursive: true })
    cb(null, userDir)
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${unique}-${file.originalname}`)
  },
})

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }) // 2GB

const router = Router()

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no file' })

    // @ts-ignore
    const userId = req.user?.id ?? 1

    const record = db.insert(files).values({
      id: randomUUID(),
      userId,
      filename: file.originalname,
      storedPath: file.path,
      size: file.size,
      mimeType: file.mimetype,
    }).returning().get()

    res.json({
      id: record.id,
      name: record.filename,
      format: 'onnx',
      size: record.size,
      uploadTime: record.createdAt,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  const fileRecord = db.select().from(files).where(eq(files.id, req.params.id)).get()
  if (!fileRecord) return res.status(404).json({ error: 'not found' })
  res.json({
    id: fileRecord.id,
    name: fileRecord.filename,
    size: fileRecord.size,
    uploadTime: fileRecord.createdAt,
  })
})

export default router
