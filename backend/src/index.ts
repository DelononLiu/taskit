import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import os from 'os'
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

// ── 注册用户 runner ──
function registerUserRunners() {
  const userRunnerDir = path.join(os.homedir(), '.taskit', 'runner')
  if (!fs.existsSync(userRunnerDir)) return

  const entries = fs.readdirSync(userRunnerDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const runnerDir = path.join(userRunnerDir, entry.name)
    const runSh = path.join(runnerDir, 'run.sh')
    if (!fs.existsSync(runSh)) continue

    // 读取 config.json（可选）
    const configPath = path.join(runnerDir, 'config.json')
    let cfg: any = {}
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
    }

    const moduleKey = `user_${entry.name}`
    if (MODULES[moduleKey]) continue  // 不覆盖同名模块

    MODULES[moduleKey] = {
      name: cfg.name || entry.name,
      runner: entry.name,           // 目录名，task-engine 用于回落查找
      source: 'user' as any,
      description: cfg.description,
      icon: cfg.icon,
      parser: (output: any, _params: any) => output,
    }

    console.log(`  [runner] registered user runner: ${entry.name}`)
  }
}

// ── 启动 ──
async function main() {
  // 注册外部 runner
  registerUserRunners()

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
