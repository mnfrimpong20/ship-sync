/**
 * Operations plumbing for launch: an error log every 500 lands in (plus browser-side crashes),
 * a nightly JSON export of the whole database the admin can download, and a small system summary.
 */
import { SECRET_SETTINGS } from './secrets'
import { mkdirSync, readdirSync, statSync, unlinkSync, createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { hideDemoShippers, uid, type Db } from './db'
import { emailProvider } from './notify'
import { smsProvider, whatsappProvider } from './sms'
import { demoDataEnabled } from './db'

type Row = Record<string, any>
type ApiUser = { id: string; email: string; role: string; shipperId?: string | null; admin?: boolean }
interface Deps {
  getDb: () => Promise<Db>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const EXPORT_DIR = process.env.EXPORT_DIR || './data/exports'
const KEEP_EXPORTS = Number(process.env.EXPORT_KEEP || 14)
const EXPORT_HOUR_UTC = Number(process.env.EXPORT_HOUR_UTC || 3)

/* ---------------- error log ---------------- */

export async function logError(db: Db, e: { source: 'api' | 'client' | 'job'; route?: string; method?: string; status?: number; message: string; stack?: string; userId?: string | null; ua?: string; ip?: string }) {
  try {
    await db.query(`insert into app_errors (id,source,route,method,status,message,stack,user_id,user_agent,ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`err_${uid()}`, e.source, (e.route ?? '').slice(0, 300), e.method ?? null, e.status ?? 500, e.message.slice(0, 1000), (e.stack ?? '').slice(0, 6000) || null, e.userId ?? null, (e.ua ?? '').slice(0, 300) || null, e.ip ?? null])
  } catch (err) { console.error('[errors] could not record error', err) }
}

/** Express error middleware factory: records unexpected (non-HttpError, non-Zod) failures and answers generically. */
export function errorRecorder(getDb: () => Promise<Db>, currentUserId: (req: Request) => Promise<string | null>) {
  return async (err: unknown, req: Request) => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    let userId: string | null = null
    try { userId = await currentUserId(req) } catch { /* ignore */ }
    try { await logError(await getDb(), { source: 'api', route: req.originalUrl, method: req.method, status: 500, message, stack, userId, ua: req.get('user-agent'), ip: req.ip }) } catch { /* ignore */ }
  }
}

const errorOut = (r: Row) => ({ id: r.id, source: r.source, route: r.route, method: r.method, status: r.status, message: r.message, stack: r.stack, userId: r.user_id, userAgent: r.user_agent, resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() })

/* ---------------- database export ---------------- */

/** Every user table, in a stable order, as `{ table: rows[] }`. Streams to disk so a big shipments table doesn't need to fit in one string. */
export async function exportDatabase(db: Db, file: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const { rows: tables } = await db.query<Row>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)
  const out = createWriteStream(file)
  const write = (s: string) => new Promise<void>((res, rej) => out.write(s, (e) => (e ? rej(e) : res())))
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"app":"ship-sync","tables":{`)
  let first = true
  for (const t of tables) {
    const name = String(t.table_name)
    const { rows } = name === 'settings' ? await db.query<Row>(`select * from settings where id <> all($1::text[])`, [SECRET_SETTINGS]) : name === 'push_subscriptions' ? { rows: [] as Row[] } : await db.query<Row>(`select * from "${name.replace(/"/g, '')}"`)
    await write(`${first ? '' : ','}${JSON.stringify(name)}:${JSON.stringify(rows)}`)
    first = false
  }
  await write('}}')
  await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())))
  return { tables: tables.length, bytes: statSync(file).size }
}

const exportName = (d = new Date()) => `ntemtem-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
const SAFE_NAME = /^(shipsync|ntemtem)-[\d-]+\.json$/

export function listExports() {
  if (!existsSync(EXPORT_DIR)) return []
  return readdirSync(EXPORT_DIR).filter((f) => SAFE_NAME.test(f)).map((f) => { const st = statSync(path.join(EXPORT_DIR, f)); return { name: f, bytes: st.size, at: st.mtime.toISOString() } }).sort((a, b) => b.at.localeCompare(a.at))
}

function pruneExports() {
  for (const f of listExports().slice(KEEP_EXPORTS)) { try { unlinkSync(path.join(EXPORT_DIR, f.name)) } catch { /* ignore */ } }
}

export async function runExport(db: Db) {
  const name = exportName()
  const r = await exportDatabase(db, path.join(EXPORT_DIR, name))
  pruneExports()
  console.log(`[export] wrote ${name} (${r.tables} tables, ${(r.bytes / 1024).toFixed(0)} KB)`)
  return { name, ...r }
}

/** Nightly export at EXPORT_HOUR_UTC (default 03:00 UTC). Checked every 10 minutes; never runs twice in one day. */
export function startExportSchedule(getDb: () => Promise<Db>) {
  if (process.env.EXPORT_NIGHTLY === 'false') return
  let lastDay = ''
  const tick = async () => {
    const now = new Date(); const day = now.toISOString().slice(0, 10)
    if (now.getUTCHours() !== EXPORT_HOUR_UTC || lastDay === day) return
    lastDay = day
    try { await runExport(await getDb()) } catch (e) { console.error('[export] nightly failed', e); try { await logError(await getDb(), { source: 'job', route: 'nightly-export', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }) } catch { /* ignore */ } }
  }
  setInterval(() => { tick().catch(() => {}) }, 10 * 60_000).unref()
}

/* ---------------- routes ---------------- */

export function mountSystem(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d
  const clientErrs = new Map<string, number[]>()

  /** Browser crashes (window.onerror / unhandledrejection / React error boundary). Anonymous, throttled 20/IP/hour. */
  r.post('/site/client-error', wrap(async (req, res) => {
    const b = z.object({ message: z.string().trim().min(1).max(1000), stack: z.string().max(6000).optional(), route: z.string().max(300).optional() }).parse(req.body)
    const ip = req.ip || 'unknown'; const now = Date.now(); const hits = (clientErrs.get(ip) ?? []).filter((t) => now - t < 3_600_000)
    if (hits.length >= 20) return res.status(204).end()
    clientErrs.set(ip, [...hits, now])
    await logError(await getDb(), { source: 'client', route: b.route, message: b.message, stack: b.stack, ua: req.get('user-agent'), ip })
    res.status(204).end()
  }))

  r.get('/admin/errors', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const showResolved = req.query.resolved === '1'
    const { rows } = await db.query<Row>(`select * from app_errors ${showResolved ? '' : 'where resolved_at is null'} order by created_at desc limit 200`)
    const { rows: c } = await db.query<Row>(`select count(*) filter (where resolved_at is null)::int as open, count(*) filter (where created_at > now() - interval '24 hours')::int as day from app_errors`)
    res.json({ errors: rows.map(errorOut), open: c[0].open, last24h: c[0].day })
  }))
  r.post('/admin/errors/:id/resolve', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    await db.query('update app_errors set resolved_at = now() where id = $1', [req.params.id]); res.json({ ok: true })
  }))
  r.post('/admin/errors/resolve-all', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    await db.query('update app_errors set resolved_at = now() where resolved_at is null'); res.json({ ok: true })
  }))

  r.get('/admin/exports', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    res.json({ exports: listExports(), nightly: process.env.EXPORT_NIGHTLY !== 'false', hourUtc: EXPORT_HOUR_UTC, keep: KEEP_EXPORTS })
  }))
  r.post('/admin/exports/run', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    res.json(await runExport(db))
  }))
  r.get('/admin/exports/:name', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const name = String(req.params.name)
    if (!SAFE_NAME.test(name) || !existsSync(path.join(EXPORT_DIR, name))) throw new HttpError(404, 'Export not found.')
    res.download(path.resolve(EXPORT_DIR, name), name)
  }))

  /** Public: whether the demo companies and sample data are on (sample tracking numbers etc. only show then). */
  r.get('/site', wrap(async (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json({ demo: !hideDemoShippers() }) }))
  /** One screen of "is everything wired up?" facts for the admin. No secrets — only whether each is set. */
  r.get('/admin/system', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const has = (k: string) => Boolean(process.env[k])
    const { rows: u } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where email not like '%.demo')::int as real from users`)
    const { rows: s } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where demo = false)::int as real from shippers`)
    res.json({
      version: process.env.npm_package_version ?? null, node: process.version, uptimeSec: Math.round(process.uptime()), env: process.env.NODE_ENV ?? 'development',
      database: process.env.DATABASE_URL ? 'postgres' : 'pglite (embedded — not for production)',
      // For checking rate limits after publishing: this should be YOUR internet address, not a proxy's.
      you: { ip: req.ip ?? '', hops: String(req.headers['x-forwarded-for'] ?? '').split(',').filter(Boolean).length, trusted: Number(process.env.TRUST_PROXY_HOPS ?? 1) || 0 },
      demoData: demoDataEnabled(),
      demoShippersHidden: hideDemoShippers(), demoAutoQuotes: process.env.DEMO_AUTO_QUOTES ? process.env.DEMO_AUTO_QUOTES !== 'false' : demoDataEnabled(),
      email: emailProvider().id, sms: smsProvider().id, whatsapp: whatsappProvider().id,
      stripe: has('STRIPE_SECRET_KEY') && has('STRIPE_WEBHOOK_SECRET'), ais: has('AISSTREAM_API_KEY'), terminal49: has('TERMINAL49_API_KEY'), appUrl: process.env.APP_URL ?? null,
      contact: { email: has('CONTACT_EMAIL'), phone: has('CONTACT_PHONE'), whatsapp: has('CONTACT_WHATSAPP') },
      users: { total: u[0].n, real: u[0].real }, shippers: { total: s[0].n, real: s[0].real },
      // Everything the published app needs before real customers arrive (shown as a checklist on this page).
      launch: [
        { key: 'db', ok: !!process.env.DATABASE_URL, label: 'Production database attached', how: 'Replit → Database → create the production database; turn on backups.' },
        { key: 'demo', ok: !demoDataEnabled(), label: 'Demo data and demo logins off', how: 'Automatic on the published app; leave DEMO_DATA unset.' },
        { key: 'admins', ok: !!(process.env.ADMIN_EMAILS ?? '').trim(), label: 'Your own admin account', how: 'Sign up with your email, then add it to the ADMIN_EMAILS secret.' },
        { key: 'email', ok: emailProvider().id !== 'off', label: 'Email sending (password resets, invoices)', how: 'Add RESEND_API_KEY and EMAIL_FROM (e.g. Ntemtem <hello@ntemtem.com>) — verify the domain in Resend.' },
        { key: 'payments', ok: has('STRIPE_SECRET_KEY') && has('STRIPE_WEBHOOK_SECRET') || has('PAYSTACK_SECRET_KEY'), label: 'Online payments (escrow)', how: 'Add STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (and/or PAYSTACK_SECRET_KEY).' },
        { key: 'texts', ok: smsProvider().id !== 'off' && smsProvider().id !== 'log' || whatsappProvider().id !== 'off', label: 'Text / WhatsApp messages to receivers', how: 'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM — and/or WHATSAPP_TOKEN + WHATSAPP_PHONE_ID.' },
        { key: 'contact', ok: has('CONTACT_EMAIL') && (has('CONTACT_PHONE') || has('CONTACT_WHATSAPP')), label: 'Contact details on the website', how: 'Add CONTACT_EMAIL and CONTACT_PHONE or CONTACT_WHATSAPP (and CONTACT_HOURS).' },
        { key: 'legal', ok: has('COMPANY_LEGAL_NAME') && has('CONTACT_ADDRESS'), label: 'Company legal name and address', how: 'Add COMPANY_LEGAL_NAME and CONTACT_ADDRESS (shown on legal pages and invoices).' },
        { key: 'url', ok: !!process.env.APP_URL, label: 'Site address for links in emails/texts', how: 'Add APP_URL, e.g. https://ntemtem.com' },
      ],
    })
  }))
}
