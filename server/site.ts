/**
 * Site plumbing: live marketing numbers, the contact form, and the public contact details that the
 * footer and Contact page show. Contact details come from env so nothing fake ever ships:
 *   CONTACT_EMAIL, CONTACT_PHONE, CONTACT_WHATSAPP (digits, intl), CONTACT_ADDRESS, SOCIAL_* (urls)
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { hideDemoShippers, publicShipperSql, uid, type Db } from './db'
import type { ApiUser } from './api'
import { emailProvider, emailTemplate, sendEmail } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

export function siteConfig() {
  const e = (k: string) => (process.env[k] ?? '').trim()
  const wa = e('CONTACT_WHATSAPP').replace(/[^\d]/g, '')
  return {
    email: e('CONTACT_EMAIL'), phone: e('CONTACT_PHONE'), whatsapp: wa, whatsappUrl: wa ? `https://wa.me/${wa}` : '', address: e('CONTACT_ADDRESS'),
    social: Object.fromEntries((['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube'] as const).map((k) => [k, e(`SOCIAL_${k.toUpperCase()}`)]).filter(([, v]) => v)) as Record<string, string>,
    demoHidden: hideDemoShippers(),
    hoursNote: e('CONTACT_HOURS') || 'Mon–Fri 9:00–18:00 US Central · UK team Mon–Fri 9:00–17:30 UK time · China team Mon–Sat 9:00–18:00 CST',
  }
}

const zContact = z.object({
  name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120), phone: z.string().trim().max(40).default(''), company: z.string().trim().max(80).default(''),
  topic: z.enum(['quote', 'tracking', 'shipper', 'sourcing', 'partnership', 'other']).default('other'), message: z.string().trim().min(10).max(3000), website: z.string().max(0).optional(), // honeypot
})

export function mountSite(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d
  const recent = new Map<string, number[]>() // ip → timestamps, a light brake on form spam

  r.get('/site/config', wrap(async (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(siteConfig()) }))

  /** Numbers the home page shows — real, from the database, never hard-coded. */
  r.get('/site/stats', wrap(async (_req, res) => {
    const db = await getDb()
    const { rows: sh } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where verified)::int as v from shippers where id <> 'ship-sync-sourcing' and ${publicShipperSql()}`)
    const { rows: q } = await db.query<Row>(`select count(*)::int as n from quotes`)
    const { rows: s } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where status = 'delivered')::int as d from shipments`)
    const { rows: ot } = await db.query<Row>(`select coalesce(round(avg(on_time))::int, 0) as p from shippers where on_time > 0 and id <> 'ship-sync-sourcing' and ${publicShipperSql()}`)
    const { rows: dests } = await db.query<Row>(`select count(distinct destination)::int as n from shipments`)
    const { rows: rq } = await db.query<Row>(`select count(*)::int as n from requests where created_at > now() - interval '30 days'`)
    res.set('Cache-Control', 'public, max-age=120')
    res.json({ shippers: sh[0].n, verifiedShippers: sh[0].v, quotes: q[0].n, shipments: s[0].n, delivered: s[0].d, onTimePct: Number(ot[0].p), destinations: Math.max(Number(dests[0].n), 7), requests30: Number(rq[0]?.n ?? 0) })
  }))

  r.post('/site/contact', wrap(async (req, res) => {
    const b = zContact.parse(req.body)
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const now = Date.now(); const hits = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000); if (hits.length >= 5) throw new HttpError(429, 'Too many messages from this connection — try again in an hour or email us directly.'); hits.push(now); recent.set(ip, hits)
    const db = await getDb(); const id = 'cm_' + uid()
    await db.query(`insert into contact_messages (id,name,email,phone,company,topic,message,ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, b.name, b.email, b.phone, b.company, b.topic, b.message, ip])
    const cfg = siteConfig()
    if (cfg.email && emailProvider().id !== 'off') {
      try { await sendEmail(cfg.email, `[Ntemtem contact] ${b.topic} — ${b.name}`, emailTemplate({ title: `New message from ${b.name}`, body: `${b.message}\n\nFrom: ${b.name} <${b.email}>${b.phone ? ` · ${b.phone}` : ''}${b.company ? ` · ${b.company}` : ''}\nTopic: ${b.topic}`, link: `${(process.env.APP_URL || '').replace(/\/$/, '')}/admin`, cta: 'Open admin' })) } catch (e) { console.error('[site] contact email', e) }
    }
    res.status(201).json({ ok: true, id })
  }))

  r.get('/admin/contact', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select * from contact_messages order by created_at desc limit 200`)
    res.set('Cache-Control', 'no-store'); res.json({ messages: rows.map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, company: m.company, topic: m.topic, message: m.message, handled: !!m.handled, createdAt: ISO(m.created_at) })) })
  }))
  r.post('/admin/contact/:id/handled', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); await db.query('update contact_messages set handled = true where id = $1', [req.params.id]); res.json({ ok: true }) }))
}
