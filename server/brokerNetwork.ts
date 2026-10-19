/**
 * Joining the broker network.
 *  - Public application form (/brokers/join) → broker_applications (status pending).
 *  - Ntemtem admin approves → a broker listing + an owner login invite (join link), or rejects with a reason.
 *  - Admin can also invite an owner for any existing listing ("Invite to dashboard").
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { emailProvider, emailTemplate, notify, sendEmail } from './notify'

type Row = Record<string, any>
interface Deps { getDb: () => Promise<Db>; requireAdmin: (db: Db, req: Request) => Promise<ApiUser>; HttpError: new (status: number, message: string) => Error; wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void }
const J = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : (v as T))
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const HUES = ['#F5B82E', '#6CC3DD', '#38BDF8', '#F472B6', '#A78BFA', '#FB923C']
const AUTHORITY: Record<string, string> = { GH: 'GRA Customs Division', NG: 'Nigeria Customs Service' }

const zApp = z.object({
  company: z.string().trim().min(2, 'Enter your firm’s name.').max(120),
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email.'),
  phone: z.string().trim().min(6, 'Enter a phone number.').max(30),
  whatsapp: z.string().trim().max(30).default(''),
  country: z.string().trim().length(2),
  ports: z.array(z.string().trim().min(2).max(40)).min(1, 'Pick at least one port.').max(6),
  licenceNo: z.string().trim().min(3, 'Enter your customs licence number.').max(60),
  licenceAuthority: z.string().trim().max(80).default(''),
  licenceExpires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  specialties: z.array(z.string().trim().min(2).max(40)).max(8).default([]),
  about: z.string().trim().max(600).default(''),
  fees: z.record(z.string(), z.number().min(0).max(100000)).default({}),
  dutyAdvance: z.boolean().default(false),
  licenceFile: z.string().max(8_000_000).regex(/^data:(application\/pdf|image\/(png|jpe?g|webp));base64,/, 'Upload a PDF or photo of your licence.').nullable().default(null),
  website: z.string().max(0).optional(), // honeypot
})

const appOut = (a: Row) => ({ id: a.id, company: a.company, name: a.name, email: a.email, phone: a.phone, whatsapp: a.whatsapp, country: a.country, ports: J<string[]>(a.ports, []), licenceNo: a.licence_no, licenceAuthority: a.licence_authority, licenceExpires: DATE(a.licence_expires), specialties: J<string[]>(a.specialties, []), about: a.about, fees: J<Record<string, number>>(a.fees, {}), dutyAdvance: !!a.duty_advance, hasLicenceFile: !!a.licence_file, status: a.status, reason: a.reason, brokerId: a.broker_id ?? null, decidedBy: a.decided_by ?? null, decidedAt: ISO(a.decided_at), createdAt: ISO(a.created_at) })

/** Make (or re-issue) an owner invite for a broker firm and email it. Returns the join path. */
export async function inviteOwner(db: Db, brokerId: string, who: { name: string; email: string; phone?: string }, HttpError: Deps['HttpError']) {
  const email = who.email.trim().toLowerCase()
  const { rows: b } = await db.query<Row>('select id, name, company from brokers where id = $1', [brokerId]); if (!b[0]) throw new HttpError(404, 'Broker not found.')
  const { rows: ex } = await db.query<Row>('select id, broker_id, status from broker_members where lower(email) = $1', [email])
  const token = randomBytes(18).toString('base64url')
  if (ex[0]) {
    if (ex[0].broker_id !== brokerId) throw new HttpError(409, 'That email already belongs to another broker firm.')
    if (ex[0].status === 'active') throw new HttpError(409, 'They already have a login — they can sign in at /broker-portal (or use “email me a link”).')
    await db.query(`update broker_members set invite_token = $2, name = $3, role = 'owner' where id = $1`, [ex[0].id, token, who.name])
  } else {
    await db.query(`insert into broker_members (id,broker_id,name,email,phone,role,status,invite_token) values ($1,$2,$3,$4,$5,'owner','invited',$6)`, ['bmem_' + uid(), brokerId, who.name, email, who.phone ?? '', token])
  }
  const link = `/broker-portal/join/${token}`
  const firm = b[0].company || b[0].name
  if (emailProvider().id !== 'off') await sendEmail(email, `Your Ntemtem broker dashboard for ${firm}`, emailTemplate({ name: who.name, title: 'Your broker dashboard is ready', body: `${firm} is on the Ntemtem broker network. Set your password to see clearance jobs, upload customs papers, message shipping companies and send invoices. Afterwards, sign in any time at ntemtem.com/broker-portal.`, link: `${appUrl()}${link}`, cta: 'Set your password' })).catch((e) => console.error('[broker invite email]', e))
  else console.log(`[broker invite] ${email} → ${link}`)
  return link
}

export function mountBrokerNetwork(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d
  const tries = new Map<string, number[]>()
  const brake = (k: string) => { const now = Date.now(); const t = (tries.get(k) ?? []).filter((x) => now - x < 60 * 60000); if (t.length >= 5) throw new HttpError(429, 'Too many applications from here — try again in an hour.'); t.push(now); tries.set(k, t) }

  /* ---- public: apply ---- */
  r.post('/broker-applications', wrap(async (req, res) => {
    const db = await getDb(); const b = zApp.parse(req.body)
    if (b.website) return res.status(201).json({ ok: true }) // bot
    brake('ip:' + (req.ip ?? '')); brake('em:' + b.email)
    const { rows: m } = await db.query('select 1 from broker_members where lower(email) = $1', [b.email]); if (m[0]) throw new HttpError(409, 'That email already has a broker login — sign in at /broker-portal.')
    const { rows: p } = await db.query(`select 1 from broker_applications where lower(email) = $1 and status = 'pending'`, [b.email]); if (p[0]) throw new HttpError(409, 'We already have an application from this email — we’ll be in touch soon.')
    const id = 'bapp_' + uid()
    await db.query(`insert into broker_applications (id,company,name,email,phone,whatsapp,country,ports,licence_no,licence_authority,licence_expires,specialties,about,fees,duty_advance,licence_file) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, b.company, b.name, b.email, b.phone, b.whatsapp, b.country, JSON.stringify(b.ports), b.licenceNo, b.licenceAuthority || AUTHORITY[b.country] || '', b.licenceExpires, JSON.stringify(b.specialties), b.about, JSON.stringify(b.fees), b.dutyAdvance, b.licenceFile])
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'system', title: `Broker application: ${b.company}`, body: `${b.name} · ${b.ports.join(', ')} · licence ${b.licenceNo}`, link: '/admin?view=brokers', dedupe: 'bapp:' + id }).catch(() => {})
    if (emailProvider().id !== 'off') await sendEmail(b.email, 'We received your Ntemtem broker application', emailTemplate({ name: b.name, title: 'Application received', body: `Thanks for applying to list ${b.company} on the Ntemtem broker network. We check every customs licence before a firm goes live — usually within 2 working days. When you're approved we'll email you a link to set your password for the broker dashboard.` })).catch(() => {})
    res.status(201).json({ ok: true })
  }))

  /* ---- admin: review ---- */
  r.get('/admin/broker-applications', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select * from broker_applications order by (status = 'pending') desc, created_at desc limit 200`)
    res.set('Cache-Control', 'no-store'); res.json({ applications: rows.map(appOut) })
  }))
  r.get('/admin/broker-applications/:id/licence', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>('select licence_file from broker_applications where id = $1', [String(req.params.id)]); if (!rows[0]?.licence_file) throw new HttpError(404, 'No licence file.')
    res.json({ dataUrl: rows[0].licence_file })
  }))
  r.post('/admin/broker-applications/:id/approve', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const { verified } = z.object({ verified: z.boolean().default(true) }).parse(req.body ?? {})
    const { rows } = await db.query<Row>(`select * from broker_applications where id = $1`, [String(req.params.id)]); const a = rows[0]
    if (!a) throw new HttpError(404, 'Application not found.'); if (a.status !== 'pending') throw new HttpError(409, `This application was already ${a.status}.`)
    const id = 'brk_' + uid(); const initials = String(a.company).split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    await db.query(`insert into brokers (id,name,company,country,ports,licence_no,licence_authority,phone,whatsapp,email,about,specialties,fees,duty_advance,response_hours,verified,active,initials,hue,licence_expires) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,24,$15,true,$16,$17,$18)`,
      [id, a.name, a.company, a.country, JSON.stringify(J(a.ports, [])), a.licence_no, a.licence_authority, a.phone, a.whatsapp, a.email, a.about, JSON.stringify(J(a.specialties, [])), JSON.stringify(J(a.fees, {})), a.duty_advance, verified, initials, HUES[Math.floor(Math.random() * HUES.length)], a.licence_expires])
    const link = await inviteOwner(db, id, { name: a.name, email: a.email, phone: a.phone }, HttpError)
    await db.query(`update broker_applications set status = 'approved', broker_id = $2, decided_by = $3, decided_at = now() where id = $1`, [a.id, id, admin.name])
    res.json({ ok: true, brokerId: id, link })
  }))
  r.post('/admin/broker-applications/:id/reject', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const { reason } = z.object({ reason: z.string().trim().min(3, 'Give a short reason — the applicant sees it.').max(600) }).parse(req.body)
    const { rows } = await db.query<Row>(`update broker_applications set status = 'rejected', reason = $2, decided_by = $3, decided_at = now() where id = $1 and status = 'pending' returning *`, [String(req.params.id), reason, admin.name])
    const a = rows[0]; if (!a) throw new HttpError(409, 'Not found or already decided.')
    if (emailProvider().id !== 'off') await sendEmail(a.email, 'Your Ntemtem broker application', emailTemplate({ name: a.name, title: 'We couldn’t approve your application yet', body: `Thanks for applying to list ${a.company}. We couldn't approve it this time: ${reason}\n\nYou're welcome to apply again at ntemtem.com/brokers/join once that's sorted.` })).catch(() => {})
    res.json({ ok: true })
  }))

  /* ---- admin: dashboard access for existing listings ---- */
  r.get('/admin/broker-access', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select broker_id, name, email, role, status, last_seen_at from broker_members order by role = 'owner' desc, name`)
    const out: Record<string, { name: string; email: string; role: string; status: string; lastSeenAt: string | null }[]> = {}
    for (const m of rows) (out[m.broker_id] ??= []).push({ name: m.name, email: m.email, role: m.role, status: m.status, lastSeenAt: ISO(m.last_seen_at) })
    res.set('Cache-Control', 'no-store'); res.json({ access: out })
  }))
  r.post('/admin/brokers/:id/invite', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = z.object({ name: z.string().trim().min(2, 'Enter their name.').max(80), email: z.string().trim().toLowerCase().email('Enter a valid email.'), phone: z.string().trim().max(30).default('') }).parse(req.body)
    const link = await inviteOwner(db, String(req.params.id), b, HttpError)
    res.status(201).json({ ok: true, link })
  }))
}
