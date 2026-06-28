import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from './prisma.js'
import { getModule } from '../tasks/registry.js'

// 临时目录根
const TASK_TEMP_DIR = path.resolve('temp')

// 管理运行中的子进程，用于取消
const runningProcesses = new Map<number, ReturnType<typeof spawn>>()

export function cancelTask(taskId: number): boolean {
  const proc = runningProcesses.get(taskId)
  if (!proc) return false
  proc.kill('SIGTERM')
  setTimeout(() => {
    try { proc.kill('SIGKILL') } catch {}
  }, 5000)
  return true
}

export async function executeTask(taskId: number): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task || task.status === 'cancelled') return

  await prisma.task.update({ where: { id: taskId }, data: { status: 'running' } })

  let taskDir = ''
  try {
    const params = JSON.parse(task.params)
    const fileIds: string[] = JSON.parse(task.fileIds)

    // 解析文件路径
    let inputPath = ''
    if (fileIds.length > 0) {
      const file = await prisma.file.findUnique({ where: { id: fileIds[0] } })
      if (file) inputPath = file.storedPath
    }

    const mod = getModule(task.module)
    if (!mod) throw new Error(`Unknown module: ${task.module}`)

    // 创建临时目录
    taskDir = path.join(TASK_TEMP_DIR, `task_${taskId}`)
    await fs.mkdir(taskDir, { recursive: true })

    // 写入 input.json
    const inputJson = {
      modelPath: inputPath,
      frameworks: params.frameworks ?? [],
      params: params,
    }
    await fs.writeFile(path.join(taskDir, 'input.json'), JSON.stringify(inputJson, null, 2))

    // 构建命令: shell 模板拿到 taskDir，由 runner 读 input.json 写 output.json
    const cmd = mod.shell
      .replace('{task_dir}', taskDir)
      .replace('{task_id}', String(taskId))

    const child = spawn('bash', ['-c', cmd], {
      timeout: 3600_000,
    })
    runningProcesses.set(taskId, child)

    let stderr = ''

    child.stdout?.on('data', (data) => { process.stdout.write(data) })
    child.stderr?.on('data', (data) => { stderr += data.toString() })

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', resolve)
      child.on('error', () => resolve(1))
    })

    runningProcesses.delete(taskId)

    // 检查是否被取消
    const current = await prisma.task.findUnique({ where: { id: taskId } })
    if (current?.status === 'cancelled') return

    if (exitCode !== 0) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'failed', error: stderr.slice(0, 2000) || `Exit code: ${exitCode}` },
      })
      return
    }

    // 读取 output.json
    const outputPath = path.join(taskDir, 'output.json')
    const outputRaw = await fs.readFile(outputPath, 'utf-8').catch(() => {
      throw new Error('runner did not produce output.json')
    })
    const output = JSON.parse(outputRaw)
    const parsed = mod.parser?.(output, params) ?? output

    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'completed', progress: 100, result: JSON.stringify(parsed), completedAt: new Date() },
    })
  } catch (e: any) {
    runningProcesses.delete(taskId)
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: e.message?.slice(0, 2000) },
    })
  } finally {
    // 清理临时目录
    if (taskDir) {
      fs.rm(taskDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
