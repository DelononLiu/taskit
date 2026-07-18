import fs from 'fs'
import path from 'path'
import os from 'os'
import { MODULES } from '../tasks/registry.js'

interface RunnerConfig {
  name: string
  description?: string
  icon?: string
}

export function scanUserRunners() {
  const dir = path.join(os.homedir(), '.taskit', 'runner')
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const runnerDir = path.join(dir, entry.name)
    const runSh = path.join(runnerDir, 'run.sh')
    if (!fs.existsSync(runSh)) continue

    const configPath = path.join(runnerDir, 'config.json')
    let cfg: RunnerConfig = { name: entry.name }
    if (fs.existsSync(configPath)) {
      try {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
      } catch {
        // ignore malformed config.json
      }
    }

    const moduleKey = `user:${entry.name}`
    if (MODULES[moduleKey]) continue // don't override existing

    MODULES[moduleKey] = {
      name: cfg.name,
      shell: `bash ${runSh} --task-dir {task_dir} --task-id {task_id}`,
      parser: (output: any) => output, // pass through
      description: cfg.description,
      icon: cfg.icon,
      source: 'user',
    }
  }
}
