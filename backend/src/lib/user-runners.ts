import fs from 'fs'
import path from 'path'
import os from 'os'

export interface UserFramework {
  value: string
  label: string
  color: string
  runnerPath: string
}

export function getUserFrameworks(): UserFramework[] {
  const dir = path.join(os.homedir(), '.taskit', 'runner')
  if (!fs.existsSync(dir)) return []

  const results: UserFramework[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const runnerDir = path.join(dir, entry.name)
    const runSh = path.join(runnerDir, 'run.sh')
    if (!fs.existsSync(runSh)) continue

    const configPath = path.join(runnerDir, 'config.json')
    let cfg: any = {}
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch {}
    }

    results.push({
      value: entry.name,
      label: cfg.name || entry.name,
      color: cfg.color || '#6366f1',
      runnerPath: runSh,
    })
  }
  return results
}
