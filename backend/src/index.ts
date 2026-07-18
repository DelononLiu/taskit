import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { config } from './config.js'
import { db, resolveDbPath } from './db/index.js'

// 导入 passport 策略（注册 JWT 策略）
import './middleware/passport.js'

// 导入路由
import authRouter from './routers/auth.js'
import filesRouter from './routers/files.js'
import tasksRouter from './routers/tasks.js'

// 导入模型触发注册
import './tasks/model_compare/runner.js'
import { MODULES } from './tasks/registry.js'
import { getUserFrameworks } from './lib/user-runners.js'
import modelCompareRouter from './tasks/model_compare/router.js'

const app = express()

app.use(cors())
app.use(express.json())

// 请求日志
app.use((req, _res, next) => {
  const start = Date.now()
  _res.on('finish', () => {
    console.log(`  ${req.method} ${req.originalUrl} → ${_res.statusCode} (${Date.now() - start}ms)`)
  })
  next()
})

// ── 公开路由（无需认证） ──
app.use('/auth', authRouter)

// ── 需要认证的路由 ──
import { optionalAuth } from './middleware/auth.js'
app.use('/api/files', optionalAuth, filesRouter)
app.use('/api/tasks', optionalAuth, tasksRouter)
app.use('/api', optionalAuth, modelCompareRouter)

// ── 模块列表 ──
app.get('/api/modules', optionalAuth, (_req, res) => {
  res.json(
    Object.entries(MODULES).map(([key, mod]) => ({
      key,
      name: mod.name,
      description: (mod as any).description,
      icon: (mod as any).icon,
      source: (mod as any).source || 'builtin',
    }))
  )
})

// ── 模型比对框架列表（内置 + 用户 runner） ──
app.get('/api/modules/model_compare/frameworks', optionalAuth, (_req, res) => {
  const builtinFrameworks = [
    { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
    { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
    { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
  ]
  const userFrameworks = getUserFrameworks()
  res.json([...builtinFrameworks, ...userFrameworks])
})

// ── 启动 ──
async function main() {
  // 确保上传目录存在
  const uploadDir = path.resolve(config.uploadDir)
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

  // ── 启动信息 ──
  const info = [
    `Taskit Backend`,
    `Port        : http://localhost:${config.port}`,
    `Database    : ${resolveDbPath()}`,
    `Uploads     : ${uploadDir}`,
    `Modules     : ${Object.keys(MODULES).join(', ')}`,
  ]
  const width = Math.max(...info.map(s => s.length)) + 4
  const sep = '─'.repeat(width - 2)
  console.log(`  ┌${sep}┐`)
  for (const line of info) {
    console.log(`  │ ${line.padEnd(width - 4)} │`)
  }
  console.log(`  └${sep}┘`)

  app.listen(config.port, () => {
    console.log(`  Taskit API → http://localhost:${config.port}`)
  })
}

main().catch(console.error)
