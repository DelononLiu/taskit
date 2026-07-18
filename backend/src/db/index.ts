import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import path from 'path'
import fs from 'fs'

import os from 'os'

const dbUrl = process.env.DATABASE_URL || `file:${path.join(os.homedir(), '.taskit', 'dev.db')}`
const filePath = path.resolve(dbUrl.replace(/^file:/, ''))

// Ensure directory exists
const dir = path.dirname(filePath)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const sqlite = new Database(filePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite)

/** Resolve the absolute path to the SQLite database file. */
export function resolveDbPath(): string {
  return filePath
}
