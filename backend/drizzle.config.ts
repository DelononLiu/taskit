import { defineConfig } from 'drizzle-kit'
import os from 'os'
import path from 'path'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || `file:${path.join(os.homedir(), '.taskit', 'dev.db')}`,
  },
})
