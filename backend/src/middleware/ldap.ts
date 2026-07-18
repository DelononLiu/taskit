import ldap from 'ldapjs'
import { config } from '../config.js'

interface LdapUser {
  uid: string
  email: string
  displayName?: string
}

export async function authenticateLdap(username: string, password: string): Promise<LdapUser | null> {
  if (!config.ldap.enabled) return null

  const client = ldap.createClient({ url: config.ldap.url })

  return new Promise((resolve) => {
    client.bind(config.ldap.bindDN, config.ldap.bindPassword, (err) => {
      if (err) {
        client.destroy()
        return resolve(null)
      }

      const filter = config.ldap.searchFilter.replace('{{username}}', username)
      const opts = { scope: 'sub' as const, filter }
      client.search(config.ldap.searchBase, opts, (searchErr, res) => {
        if (searchErr) {
          client.destroy()
          return resolve(null)
        }

        let found: any = null
        res.on('searchEntry', (entry) => {
          if (!found) {
            // Build a plain object from SearchEntry attributes
            const obj: Record<string, string | string[]> = { dn: entry.objectName ?? '' }
            for (const attr of entry.attributes) {
              obj[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values
            }
            found = obj
          }
        })
        res.on('error', () => {
          client.destroy()
          resolve(null)
        })
        res.on('end', () => {
          if (!found) {
            client.destroy()
            return resolve(null)
          }
          // Re-bind with user's DN to verify password
          client.bind(found.dn, password, (bindErr) => {
            client.destroy()
            if (bindErr) return resolve(null)

            const uid = found[config.ldap.usernameField] ?? username
            const email = config.ldap.emailDomain
              ? `${uid}@${config.ldap.emailDomain}`
              : found.mail ?? `${uid}@ldap.local`

            resolve({
              uid: String(uid),
              email: String(email),
              displayName: found.displayName || found.cn || uid,
            })
          })
        })
      })
    })
  })
}
