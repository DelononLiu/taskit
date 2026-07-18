import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'
import passport from 'passport'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { config } from '../config.js'

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwtSecret,
}

passport.use(
  new JwtStrategy(opts, async (payload, done) => {
    try {
      const user = db.select().from(users).where(eq(users.id, payload.sub)).get()
      if (user) return done(null, user)
      return done(null, false)
    } catch (err) {
      return done(err, false)
    }
  })
)

export default passport
