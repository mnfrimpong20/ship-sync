/**
 * Ntemtem destination partner network — vetted clearing agents, devanning warehouses, last-mile delivery and
 * collection points in each destination, for shippers who don't have their own people there.
 *
 *   Ntemtem keeps the directory (Admin → Partners). A shipper assigns a partner to a container in one step:
 *   that creates the usual destination-agent link (manifest portal, pre-alert email when it sails) and an
 *   assignment the partner accepts. After the job the shipper rates the partner; ratings feed the directory.
 *   Demo partners are flagged and hidden with HIDE_DEMO_SHIPPERS like the demo shippers.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { hideDemoShippers, uid, type Db } from './db'
import type { ApiUser } from './api'
import { notifyShipperStaff } from './notify'
import { partnerUrl, sendPreAlerts } from './flow'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
export const PARTNER_SERVICES = ['clearing', 'devanning', 'warehouse', 'delivery', 'collection', 'vehicles'] as const
export const partnerOut = (p: Row) => ({
  id: p.id, name: p.name, country: p.country, cities: J<string[]>(p.cities, []), services: J<string[]>(p.services, []), contactName: p.contact_name, phone: p.phone, whatsapp: p.whatsapp, email: p.email,
  about: p.about, ratesNote: p.rates_note, verified: !!p.verified, active: !!p.active, demo: !!p.is_demo, rating: p.rating_count ? Math.round((Number(p.rating_sum) / Number(p.rating_count)) * 10) / 10 : null, ratingCount: Number(p.rating_count ?? 0), jobs: Number(p.jobs ?? 0),
})
const assignmentOut = (a: Row) => ({ id: a.id, partnerId: a.partner_id, partnerName: a.partner_name, containerId: a.container_id, containerRef: a.container_ref ?? '', shipper: a.shipper_name ?? '', services: J<string[]>(a.services, []), note: a.note, status: a.status as 'requested' | 'accepted' | 'declined' | 'done', stars: a.stars == null ? null : Number(a.stars), review: a.review ?? '', createdAt: ISO(a.created_at), respondedAt: ISO(a.responded_at) })

export async function seedPartners(db: Db) {
  const { rows } = await db.query<Row>('select count(*)::int as n from destination_partners'); if (Number(rows[0].n) > 0) return
  const list: [string, string, string[], string[], string, string, string][] = [
    ['Harbourline Clearing (sample)', 'GH', ['Tema', 'Accra'], ['clearing', 'devanning', 'warehouse', 'vehicles'], 'Ama Owusu', '+233 20 000 0101', 'Licensed customs broker at Tema port. Unstuffs containers in our bonded shed and holds goods for collection up to 14 days.'],
    ['Kejetia Last Mile (sample)', 'GH', ['Kumasi', 'Obuasi', 'Sunyani'], ['delivery', 'collection'], 'Kwabena Asare', '+233 20 000 0102', 'Door delivery across Ashanti and Bono with GhanaPost GPS addresses and proof-of-delivery photos.'],
    ['Apapa Gateway Agents (sample)', 'NG', ['Lagos'], ['clearing', 'devanning', 'vehicles'], 'Tunde Bello', '+234 800 000 0103', 'Clearing at Apapa and Tin Can, vehicle releases and terminal handling.'],
    ['Lomé Port Services (sample)', 'TG', ['Lomé'], ['clearing', 'warehouse', 'collection'], 'Kossi Agbeko', '+228 90 00 01 04', 'Dédouanement au port de Lomé, entrepôt et retrait des colis. Équipe francophone et anglophone.'],
    ['Abidjan Relais (sample)', 'CI', ['Abidjan'], ['clearing', 'delivery'], 'Awa Koné', '+225 07 00 00 01 05', 'Transit et livraison à Abidjan, paiement mobile money accepté à la livraison.'],
  ]
  for (const [name, country, cities, services, contact, phone, about] of list) await db.query(`insert into destination_partners (id,name,country,cities,services,contact_name,phone,whatsapp,email,about,verified,active,is_demo) values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,true,true,true)`, ['dp_' + uid(), name, country, JSON.stringify(cities), JSON.stringify(services), contact, phone, `${name.split(' ')[0].toLowerCase()}@example.com`, about])
}

const zPartner = z.object({
  name: z.string().trim().min(2).max(80), country: z.string().trim().length(2).toUpperCase(), cities: z.array(z.string().trim().min(2).max(40)).max(12).default([]), services: z.array(z.enum(PARTNER_SERVICES)).min(1, 'Pick at least one service.'),
  contactName: z.string().trim().max(80).default(''), phone: z.string().trim().max(30).default(''), whatsapp: z.string().trim().max(30).default(''), email: z.string().trim().email().or(z.literal('')).default(''),
  about: z.string().trim().max(500).default(''), ratesNote: z.string().trim().max(300).default(''), verified: z.boolean().default(false), active: z.boolean().default(true),
})

export function mountPartners(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.'); return u }
  const demoSql = () => (hideDemoShippers() ? 'and not p.is_demo' : '')

  /** Directory for shippers (and admins): active partners, optionally for one country. */
  r.get('/destination-partners', wrap(async (req, res) => {
    const db = await getDb(); await office(db, req).catch(async (e) => { const u = await requireUser(db, req); if (!u.admin) throw e })
    const country = String(req.query.country ?? '').toUpperCase()
    const { rows } = await db.query<Row>(`select p.*, (select count(*) from partner_assignments a where a.partner_id = p.id and a.status in ('accepted','done'))::int as jobs from destination_partners p where p.active ${demoSql()} ${/^[A-Z]{2}$/.test(country) ? 'and p.country = $1' : ''} order by p.verified desc, (p.rating_sum / greatest(p.rating_count, 1)) desc, p.name`, /^[A-Z]{2}$/.test(country) ? [country] : [])
    res.set('Cache-Control', 'no-store'); res.json({ partners: rows.map(partnerOut), services: PARTNER_SERVICES })
  }))
  /** Assign a partner to one of my containers: creates the agent link + an assignment the partner accepts. */
  r.post('/containers/:id/ntemtem-partner', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const b = z.object({ partnerId: z.string(), services: z.array(z.enum(PARTNER_SERVICES)).min(1, 'What should they do?'), note: z.string().trim().max(400).default('') }).parse(req.body)
    const { rows: cs } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const c = cs[0]; if (!c) throw new HttpError(404, 'Container not found.')
    const { rows: ps } = await db.query<Row>('select * from destination_partners where id = $1 and active', [b.partnerId]); const p = ps[0]; if (!p) throw new HttpError(404, 'Partner not found.')
    if (p.country !== c.destination) throw new HttpError(400, `That partner works in ${p.country}; this container goes to ${c.destination}.`)
    const { rows: dup } = await db.query<Row>(`select 1 from partner_assignments where container_id = $1 and partner_id = $2 and status in ('requested','accepted')`, [c.id, p.id]); if (dup[0]) throw new HttpError(409, 'That partner is already on this container.')
    const linkId = 'pl_' + uid(); const token = randomBytes(15).toString('base64url')
    await db.query('insert into partner_links (id,token,shipper_id,container_id,name,email,phone,created_by,partner_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [linkId, token, c.shipper_id, c.id, p.name, p.email, p.phone, u.name, p.id])
    const aid = 'pa_' + uid()
    await db.query('insert into partner_assignments (id,partner_id,shipper_id,container_id,link_id,services,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', [aid, p.id, c.shipper_id, c.id, linkId, JSON.stringify(b.services), b.note, u.name])
    await db.query(`insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,'',$3,$4,'manual','')`, [c.id, c.status, `Ntemtem partner ${p.name} asked to handle ${b.services.join(', ')}.`, u.name])
    if (p.email && ['sailed', 'arrived', 'customs'].includes(c.status)) await sendPreAlerts(db, c).catch(() => {})
    // Ntemtem's partner desk follows up so the partner confirms quickly.
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    const { notify } = await import('./notify')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'system', title: `Partner job: ${p.name} for ${c.ref}`, body: `${b.services.join(', ')}${b.note ? ` — ${b.note}` : ''}. Confirm with the partner.`, link: '/admin?view=partners', dedupe: `pa:${aid}:${a.id}` })
    res.status(201).json({ assignment: { id: aid, status: 'requested' }, link: { id: linkId, url: partnerUrl(token), path: `/p/${token}` } })
  }))
  r.get('/containers/:id/ntemtem-partner', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`select a.*, p.name as partner_name from partner_assignments a join destination_partners p on p.id = a.partner_id where a.container_id = $1 and a.shipper_id = $2 order by a.created_at desc`, [String(req.params.id), u.shipperId])
    res.json({ assignments: rows.map(assignmentOut) })
  }))
  r.post('/partner-assignments/:id/rate', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const b = z.object({ stars: z.number().int().min(1).max(5), review: z.string().trim().max(400).default('') }).parse(req.body)
    const { rows } = await db.query<Row>('select * from partner_assignments where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const a = rows[0]; if (!a) throw new HttpError(404, 'Not found.')
    if (!['accepted', 'done'].includes(a.status)) throw new HttpError(409, 'You can rate a partner once they’ve taken the job.')
    if (a.stars != null) throw new HttpError(409, 'Already rated — thank you.')
    await db.query(`update partner_assignments set stars = $2, review = $3, status = 'done' where id = $1`, [a.id, b.stars, b.review])
    await db.query('update destination_partners set rating_sum = rating_sum + $2, rating_count = rating_count + 1 where id = $1', [a.partner_id, b.stars])
    res.json({ ok: true })
  }))

  /* ---- admin: the directory and the jobs ---- */
  r.get('/admin/partners', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select p.*, (select count(*) from partner_assignments a where a.partner_id = p.id and a.status in ('accepted','done'))::int as jobs from destination_partners p order by p.country, p.name`)
    const { rows: as } = await db.query<Row>(`select a.*, p.name as partner_name, c.ref as container_ref, s.name as shipper_name from partner_assignments a join destination_partners p on p.id = a.partner_id left join containers c on c.id = a.container_id join shippers s on s.id = a.shipper_id order by (a.status = 'requested') desc, a.created_at desc limit 200`)
    res.set('Cache-Control', 'no-store'); res.json({ partners: rows.map(partnerOut), assignments: as.map(assignmentOut), services: PARTNER_SERVICES })
  }))
  r.post('/admin/partners', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zPartner.parse(req.body); const id = 'dp_' + uid()
    await db.query(`insert into destination_partners (id,name,country,cities,services,contact_name,phone,whatsapp,email,about,rates_note,verified,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, b.name, b.country, JSON.stringify(b.cities), JSON.stringify(b.services), b.contactName, b.phone, b.whatsapp, b.email, b.about, b.ratesNote, b.verified, b.active])
    res.status(201).json({ id })
  }))
  r.put('/admin/partners/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zPartner.parse(req.body)
    const { rows: upd } = await db.query(`update destination_partners set name=$2, country=$3, cities=$4, services=$5, contact_name=$6, phone=$7, whatsapp=$8, email=$9, about=$10, rates_note=$11, verified=$12, active=$13 where id = $1 returning id`, [String(req.params.id), b.name, b.country, JSON.stringify(b.cities), JSON.stringify(b.services), b.contactName, b.phone, b.whatsapp, b.email, b.about, b.ratesNote, b.verified, b.active])
    if (!upd[0]) throw new HttpError(404, 'Partner not found.'); res.json({ ok: true })
  }))
  /** The partner desk records the partner's answer (they confirm by phone/WhatsApp/email). */
  r.patch('/admin/partner-assignments/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = z.object({ status: z.enum(['accepted', 'declined', 'done']) }).parse(req.body)
    const { rows } = await db.query<Row>(`update partner_assignments set status = $2, responded_at = coalesce(responded_at, now()) where id = $1 returning *`, [String(req.params.id), b.status]); const a = rows[0]; if (!a) throw new HttpError(404, 'Not found.')
    const { rows: p } = await db.query<Row>('select name from destination_partners where id = $1', [a.partner_id]); const { rows: c } = await db.query<Row>('select ref from containers where id = $1', [a.container_id])
    if (b.status === 'declined' && a.link_id) await db.query('update partner_links set revoked_at = now() where id = $1', [a.link_id])
    if (b.status !== 'done') await notifyShipperStaff(db, a.shipper_id, { kind: 'container_update', title: `${p[0]?.name} ${b.status === 'accepted' ? 'accepted' : 'can’t take'} ${c[0]?.ref ?? 'your container'}`, body: b.status === 'accepted' ? 'They have the manifest link and will be in touch before arrival.' : 'Pick another Ntemtem partner on the container page.', link: `/dashboard/containers/${a.container_id}`, dedupe: `pa:${a.id}:${b.status}` }, ['owner', 'dispatcher'])
    res.json({ ok: true })
  }))
}
