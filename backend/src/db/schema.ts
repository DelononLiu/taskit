import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('User', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  name: text('name'),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
})

export const files = sqliteTable('File', {
  id: text('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  storedPath: text('storedPath').notNull(),
  size: integer('size').notNull(),
  mimeType: text('mimeType').notNull().default('application/octet-stream'),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
})

export const tasks = sqliteTable('Task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull().references(() => users.id),
  module: text('module').notNull(),
  status: text('status').notNull().default('pending'),
  progress: integer('progress').notNull().default(0),
  params: text('params').notNull().default('{}'),
  result: text('result'),
  error: text('error'),
  fileIds: text('fileIds').notNull().default('[]'),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
  completedAt: text('completedAt'),
})
