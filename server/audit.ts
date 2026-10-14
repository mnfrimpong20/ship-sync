/**
 * Audit log + "View as".
 *   Every successful change (POST/PUT/PATCH/DELETE) by a signed-in person is written to audit_log by a
 *   middleware — who, as which role, on which company, what route, a readable action, the ids in the
 *   path and a redacted copy of the body. Explicit audit() calls add richer entries where it matters.
 *   GET /admin/audit        search + filters + CSV (admins)
 *   GET /team/audit         the same, limited to the caller's company (owners and dispatchers)
 *   GET /admin/users?q=     find someone to view as
 *   POST /admin/view-as     start a read-only session as that person (logged)
 *   POST /view-as/exit      back to the admin's own session
 */
import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction, Router, RequestHandler } from 'express'
import type { Db } from './db'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const SESSION_COOKIE = 'ss_session'
const RETURN_COOKIE = 'ss_admin_return'
const id = () => 'au_' + randomBytes(8).toString('hex')
const ipOf = (req: Request) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || ''

/** Routes too chatty or too private to log (reading, messaging, sign-in, telemetry, scanning). */
const SKIP = [/^\/auth\//, /^\/notifications/, /^\/errors/, /^\/track/, /^\/contact/, /^\/geocode/, /\/messages$/, /^\/scan/, /^\/live/, /^\/view-as\/exit$/, /^\/admin\/view-as$/, /^\/telemetry/, /^\/stripe/, /^\/announcements\//, /^\/widget/]
const SECRET = /pass|token|secret|card|cvc|cvv|iban|account_?n|routing|signature|photo|data$|file/i

function redact(v: unknown, depth = 0): unknown {
  if (depth > 3) return '…'
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Row).slice(0, 40).map(([k, x]) => [k, SECRET.test(k) ? '•••' : redact(x, depth + 1)]))
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v
  return v
}

const isId = (seg: string) => /\d/.test(seg) && (seg.length >= 6 || /^[a-z]{1,5}[_-]/i.test(seg)) || /^[a-z]+_[a-z0-9_-]+$/i.test(seg) && seg.length > 8 || seg.length >= 20
const NAMED: [RegExp, string][] = [
  [/^POST \/admin\/shippers\/[^/]+\/verify$/, 'Changed verification'],
  [/^POST \/admin\/shippers\/[^/]+\/standing$/, 'Changed marketplace standing'],
  [/^POST \/admin\/payouts\/[^/]+\/paid$/, 'Marked payout paid'],
  [/^POST \/admin\/payouts\/[^/]+\/reject$/, 'Rejected payout'],
  [/refund/, 'Refund'],
  [/^PUT \/admin\/payments\/settings$/, 'Changed payment settings'],
  [/^PUT \/admin\/features/, 'Changed a feature switch'],
  [/^PUT \/admin\/billing/, 'Changed billing'],
  [/^POST \/admin\/billing/, 'Changed a plan'],
  [/^PATCH \/team\/[^/]+$/, 'Changed a team member (role, access or status)'],
  [/^POST \/team\/invite$/, 'Invited a team member'],
  [/^POST \/shipments\/[^/]+\/status$/, 'Changed shipment status'],
  [/^POST \/shipments\/[^/]+\/override/, 'Overrode a release check'],
  [/^POST \/shipments\/[^/]+\/cancel$/, 'Cancelled a shipment'],
  [/^POST \/quotes\/[^/]+\/accept$/, 'Accepted a quote'],
  [/^POST \/quotes\/[^/]+\/withdraw$/, 'Withdrew a quote'],
  [/^POST \/campaigns/, 'Sent a campaign'],
  [/^(POST|PATCH|DELETE) \/webhooks/, 'Changed a webhook'],
  [/^(POST|DELETE) \/costs/, 'Changed a cost'],
  [/^POST \/admin\/announcements/, 'Posted an announcement'],
]
export function describe(method: string, path: string): { action: string; entity: string; entityId: string | null } {
  const segs = path.split('/').filter(Boolean)
  const ids = segs.filter(isId); const words = segs.filter((s) => !isId(s))
  const entity = (words[0] === 'admin' ? words[1] : words[0]) ?? ''
  const named = NAMED.find(([re]) => re.test(`${method} ${path}`))
  if (named) return { action: named[1], entity, entityId: ids[0] ?? null }
  const verb = method === 'DELETE' ? 'Deleted' : method === 'POST' && !ids.length ? 'Created' : 'Updated'
  const rest = words.filter((w) => w !== 'admin').map((w) => w.replace(/-/g, ' '))
  return { action: `${verb} ${rest.join(' · ') || path}`, entity, entityId: ids[0] ?? null }
}

export async function audit(db: Db, a: { actor?: ApiUser | null; action: string; entity?: string; entityId?: string | null; shipperId?: string | null; data?: unknown; ip?: string; method?: string; path?: string; status?: number }) {
  const u = a.actor
  const role = !u ? 'system' : u.admin ? 'admin' : u.role === 'shipper' ? (u.staffRole ?? 'owner') : 'customer'
  await db.query(`insert into audit_log (id,actor_id,actor_name,actor_email,actor_role,view_as_by,shipper_id,method,path,action,entity,entity_id,status,data,ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id(), u?.id ?? null, u?.actingBy ? `${u.actingBy.name} for ${u.name}` : u?.name ?? 'System', u?.actingBy?.email ?? u?.email ?? '', role, u?.viewAsBy ?? null, a.shipperId ?? u?.shipperId ?? null, a.method ?? '', a.path ?? '', a.action.slice(0, 200), a.entity ?? '', a.entityId ?? null, a.status ?? null, a.data === undefined ? null : JSON.stringify(redact(a.data)), a.ip ?? null]).catch((e) => console.error('[audit]', e))
}

/** Logs every successful change after the response is sent. */
export function auditMiddleware(getDb: () => Promise<Db>): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    const path = req.path; if (SKIP.some((re) => re.test(path))) return next()
    const body = req.body
    res.on('finish', () => {
      const u = (req as Request & { ssUser?: ApiUser }).ssUser
      if (!u || res.statusCode >= 400) return
      const d = describe(req.method, path)
      const adminShipper = path.match(/^\/admin\/shippers\/([^/]+)/)?.[1]
      getDb().then((db) => audit(db, { actor: u, ...d, shipperId: adminShipper ?? u.shipperId ?? null, data: body, ip: ipOf(req), method: req.method, path, status: res.statusCode })).catch(() => {})
    })
    next()
  }
}

const out = (r: Row) => ({ id: r.id, at: r.at instanceof Date ? r.at.toISOString() : r.at, actorId: r.actor_id, actor: r.actor_name, actorEmail: r.actor_email, role: r.actor_role, viewAsBy: r.view_as_by_name ?? r.view_as_by ?? null, shipperId: r.shipper_id, shipperName: r.shipper_name ?? null, method: r.method, path: r.path, action: r.action, entity: r.entity, entityId: r.entity_id, status: r.status, data: r.data, ip: r.ip })
const csv = (rows: ReturnType<typeof out>[]) => ['at,actor,email,role,company,action,path,entity_id,view_as_by,ip', ...rows.map((r) => [r.at, r.actor, r.actorEmail, r.role, r.shipperName ?? '', r.action, `${r.method} ${r.path}`, r.entityId ?? '', r.viewAsBy ?? '', r.ip ?? ''].map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))].join('\n')

export function mountAudit(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d

  async function search(db: Db, q: Row, shipperOnly?: string) {
    const where: string[] = []; const p: unknown[] = []
    const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)) }
    if (shipperOnly) add('a.shipper_id = ?', shipperOnly); else if (q.shipper) add('a.shipper_id = ?', String(q.shipper))
    if (q.q) add(`(a.action ilike ? or a.path ilike $${p.length + 1} or a.actor_name ilike $${p.length + 1} or a.actor_email ilike $${p.length + 1} or coalesce(a.entity_id,'') ilike $${p.length + 1})`, `%${String(q.q).slice(0, 80)}%`)
    if (q.actor) add('a.actor_id = ?', String(q.actor))
    if (q.role) add('a.actor_role = ?', String(q.role))
    if (q.from) add('a.at >= ?', new Date(String(q.from)))
    if (q.to) add('a.at < ?', new Date(new Date(String(q.to)).getTime() + 86400000))
    if (q.viewAs === '1') where.push('a.view_as_by is not null')
    const limit = Math.min(q.format === 'csv' ? 5000 : 200, Math.max(1, Number(q.limit) || 50)); const offset = Math.max(0, Number(q.offset) || 0)
    const { rows } = await db.query<Row>(`select a.*, s.name as shipper_name, v.name as view_as_by_name from audit_log a left join shippers s on s.id = a.shipper_id left join users v on v.id = a.view_as_by ${where.length ? 'where ' + where.join(' and ') : ''} order by a.at desc limit ${limit + 1} offset ${offset}`, p)
    return { entries: rows.slice(0, limit).map(out), more: rows.length > limit }
  }
  r.get('/admin/audit', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const x = await search(db, req.query as Row)
    if (req.query.format === 'csv') { res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', 'attachment; filename="audit-log.csv"'); return res.send(csv(x.entries)) }
    res.json(x)
  }))
  r.get('/team/audit', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.')
    const x = await search(db, req.query as Row, u.shipperId)
    if (req.query.format === 'csv') { res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', 'attachment; filename="activity-log.csv"'); return res.send(csv(x.entries)) }
    res.json(x)
  }))

  /* ---------------- view as ---------------- */
  r.get('/admin/users', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const q = String(req.query.q ?? '').trim(); if (q.length < 2) return res.json({ users: [] })
    const { rows } = await db.query<Row>(`select u.id, u.name, u.email, u.role, u.is_admin, u.shipper_id, s.name as company, st.role as staff_role from users u left join shippers s on s.id = u.shipper_id left join staff st on st.user_id = u.id and st.shipper_id = u.shipper_id where u.email ilike $1 or u.name ilike $1 or s.name ilike $1 order by u.created_at desc limit 20`, [`%${q}%`])
    res.json({ users: rows.map((x) => ({ id: x.id, name: x.name, email: x.email, role: x.role, admin: !!x.is_admin, company: x.company ?? null, staffRole: x.shipper_id ? x.staff_role ?? 'owner' : null })) })
  }))
  r.post('/admin/view-as', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const target = String(req.body?.userId ?? '')
    const { rows } = await db.query<Row>('select id, name, email, shipper_id from users where id = $1', [target]); const t = rows[0]
    if (!t) throw new HttpError(404, 'User not found.')
    if (t.id === admin.id) throw new HttpError(400, 'That’s you.')
    const sid = randomBytes(32).toString('hex')
    await db.query(`insert into sessions (id,user_id,expires_at,read_only,impersonator_id) values ($1,$2,now() + interval '2 hours',true,$3)`, [sid, t.id, admin.id])
    const opts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 2 * 3600_000, path: '/' }
    res.cookie(RETURN_COOKIE, req.cookies?.[SESSION_COOKIE] ?? '', opts)
    res.cookie(SESSION_COOKIE, sid, opts)
    await audit(db, { actor: admin, action: `Started “View as” ${t.name} (${t.email})`, entity: 'users', entityId: t.id, shipperId: t.shipper_id, ip: ipOf(req), method: 'POST', path: '/admin/view-as', status: 200 })
    res.json({ ok: true, user: { id: t.id, name: t.name } })
  }))
  r.post('/view-as/exit', wrap(async (req, res) => {
    const db = await getDb(); const back = req.cookies?.[RETURN_COOKIE]; const cur = req.cookies?.[SESSION_COOKIE]
    const { rows } = await db.query<Row>(`select se.id, se.user_id, se.impersonator_id from sessions se where se.id = $1`, [cur ?? '']); const s = rows[0]
    if (!s?.impersonator_id) throw new HttpError(400, 'You are not viewing as anyone.')
    await db.query('delete from sessions where id = $1', [s.id])
    const { rows: ok } = await db.query<Row>(`select se.id from sessions se join users u on u.id = se.user_id where se.id = $1 and u.id = $2 and u.is_admin and se.expires_at > now()`, [back ?? '', s.impersonator_id])
    res.clearCookie(RETURN_COOKIE, { path: '/' })
    if (ok[0]) res.cookie(SESSION_COOKIE, ok[0].id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000, path: '/' })
    else res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.json({ ok: true, restored: !!ok[0] })
  }))
}
