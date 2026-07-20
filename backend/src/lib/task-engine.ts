import { spawn } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks, files } from '../db/schema.js'
import { getModule } from '../tasks/registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!task || task.status === 'cancelled') return

  db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, taskId)).run()

  let taskDir = ''
  try {
    const params = JSON.parse(task.params)
    const fileIds: string[] = JSON.parse(task.fileIds)

    // 解析文件路径
    let inputPath = ''
    if (fileIds.length > 0) {
      const fileRecord = db.select().from(files).where(eq(files.id, fileIds[0])).get()
      if (fileRecord) inputPath = fileRecord.storedPath
    }

    const mod = getModule(task.module)
    if (!mod) throw new Error(`Unknown module: ${task.module}`)

    // Runner 根目录（项目根下的 runners/）
    const RUNNERS_ROOT = path.resolve(__dirname, '../../../runners')

    // 解析 runner 路径：内置优先，回落用户目录
    function resolveRunnerScript(runnerName: string): string {
      const builtin = path.join(RUNNERS_ROOT, runnerName, 'run.sh')
      if (fsSync.existsSync(builtin)) return builtin

      const userRunner = path.join(
        require('os').homedir(), '.taskit', 'runner', runnerName, 'run.sh'
      )
      if (fsSync.existsSync(userRunner)) return userRunner

      throw new Error(`Runner not found: ${runnerName} (checked built-in and ~/.taskit/runner/)`)
    }

    // 创建临时目录
    taskDir = path.join(TASK_TEMP_DIR, `task_${taskId}`)
    await fs.mkdir(taskDir, { recursive: true })

    let cmd: string
    const outputPath = path.join(taskDir, 'output.json')

    if (mod.runner) {
      // ── Runner-based execution: --input --output CLI ──
      const runnerScript = resolveRunnerScript(mod.runner)

      const cliArgs: string[] = [
        `--input`, `'${inputPath}'`,
        `--output`, `'${outputPath}'`,
      ]

      // Map camelCase params to --kebab-case CLI args
      if (params.precision) cliArgs.push('--precision', `'${params.precision}'`)
      if (params.batchSize) cliArgs.push('--batch-size', `'${params.batchSize}'`)

      // Detect target framework (non-onnxruntime framework)
      const targetFw = (params.frameworks ?? []).find((fw: string) => fw !== 'onnxruntime')
      if (targetFw) cliArgs.push('--target-framework', `'${targetFw}'`)

      cmd = `bash ${runnerScript} ${cliArgs.join(' ')}`
    } else if (mod.shell) {
      // ── Legacy shell template execution ──
      const inputJson = {
        modelPath: inputPath,
        frameworks: params.frameworks ?? [],
        params: params,
      }
      await fs.writeFile(path.join(taskDir, 'input.json'), JSON.stringify(inputJson, null, 2))

      cmd = mod.shell
        .replace('{task_dir}', taskDir)
        .replace('{task_id}', String(taskId))
    } else {
      throw new Error(`Module ${task.module} has neither runner nor shell configured`)
    }

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
    const current = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (current?.status === 'cancelled') return

    if (exitCode !== 0) {
      db.update(tasks).set({
        status: 'failed',
        error: stderr.slice(0, 2000) || `Exit code: ${exitCode}`,
      }).where(eq(tasks.id, taskId)).run()
      return
    }

    // 读取 output.json
    const outputRaw = await fs.readFile(outputPath, 'utf-8').catch(() => {
      throw new Error('runner did not produce output.json')
    })
    const output = JSON.parse(outputRaw)
    const parsed = mod.parser?.(output, params) ?? output

    db.update(tasks).set({
      status: 'completed',
      progress: 100,
      result: JSON.stringify(parsed),
      completedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()
  } catch (e: any) {
    runningProcesses.delete(taskId)
    db.update(tasks).set({
      status: 'failed',
      error: e.message?.slice(0, 2000),
    }).where(eq(tasks.id, taskId)).run()
  } finally {
    // 清理临时目录
    if (taskDir) {
      fs.rm(taskDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
