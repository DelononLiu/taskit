import { PrismaClient } from '@prisma/client'
import path from 'path'

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db'

export const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl },
  },
})

/** 解析 SQLite 数据库文件的绝对路径 */
export function resolveDbPath(): string {
  // Prisma SQLite URL 格式: "file:./path/to/db.db"
  const filePart = dbUrl.replace(/^file:/, '')
  return path.resolve(filePart)
}
