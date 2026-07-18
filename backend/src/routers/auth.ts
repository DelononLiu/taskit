import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { config } from '../config.js'
import { authenticateLdap } from '../middleware/ldap.js'

const router = Router()

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' })
    }

    // When LDAP is enabled, LDAP users are managed externally — reject self-registration
    if (config.ldap.enabled) {
      return res.status(403).json({ error: 'registration disabled — LDAP users are managed externally' })
    }

    const existing = db.select().from(users).where(eq(users.email, email)).get()
    if (existing) return res.status(409).json({ error: 'email already registered' })

    const hashed = await bcrypt.hash(password, 10)
    const user = db.insert(users).values({ email, password: hashed, name: name || null }).returning().get()

    const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    })

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })

    // LDAP authentication — attempt BEFORE local auth when LDAP is enabled
    if (config.ldap.enabled) {
      const ldapUser = await authenticateLdap(email, password)
      if (ldapUser) {
        // Auto-create or find local user record
        let user = db.select().from(users).where(eq(users.email, ldapUser.email)).get()
        if (!user) {
          user = db.insert(users).values({
            email: ldapUser.email,
            password: '',
            name: ldapUser.displayName || ldapUser.uid,
          }).returning().get()
        }
        const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
          expiresIn: config.jwtExpiresIn as any,
        })
        return res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
      }
      // LDAP auth failed — fall through to local auth (could be a local user)
    }

    // Local bcrypt authentication
    const user = db.select().from(users).where(eq(users.email, email)).get()
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'invalid credentials' })

    const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    })

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/me', async (req: Request, res: Response) => {
  // @ts-ignore — passport 注入
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return res.status(404).json({ error: 'not found' })

  res.json({ id: user.id, email: user.email, name: user.name })
})

export default router
