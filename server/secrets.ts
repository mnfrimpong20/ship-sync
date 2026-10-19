/**
 * Encryption for credentials we must keep (a shipper's carrier API key, QuickBooks tokens).
 * AES-256-GCM. The key comes from DATA_ENCRYPTION_KEY (any long random string — set it in production);
 * without it a random key is generated once and kept in `settings` (redacted from database exports).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Db } from './db'

let key: Buffer | null = null
async function dataKey(db: Db) {
  if (key) return key
  const env = process.env.DATA_ENCRYPTION_KEY?.trim()
  if (env) return (key = createHash('sha256').update(env).digest())
  const { rows } = await db.query<Record<string, any>>(`select value from settings where id = 'data_key'`)
  let v = rows[0] ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : null
  if (!v?.k) { await db.query(`insert into settings (id,value,updated_at) values ('data_key',$1,now()) on conflict (id) do nothing`, [JSON.stringify({ k: randomBytes(32).toString('base64') })]); const { rows: again } = await db.query<Record<string, any>>(`select value from settings where id = 'data_key'`); v = typeof again[0].value === 'string' ? JSON.parse(again[0].value) : again[0].value }
  return (key = Buffer.from(v.k, 'base64'))
}
export async function seal(db: Db, plain: string) {
  if (!plain) return ''
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', await dataKey(db), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
export async function unseal(db: Db, sealed: string | null | undefined) {
  if (!sealed) return ''
  const [v, iv, tag, data] = sealed.split(':'); if (v !== 'v1') return ''
  try { const d = createDecipheriv('aes-256-gcm', await dataKey(db), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8') } catch { return '' }
}
export const mask = (s: string) => (s ? `••••${s.slice(-4)}` : '')
/** Settings rows that must never leave the server in an export. */
export const SECRET_SETTINGS = ['data_key', 'vapid']
