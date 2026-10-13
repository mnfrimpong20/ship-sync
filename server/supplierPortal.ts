/**
 * Supplier portal — a token link an agent sends to the factory (WeChat usually). No account needed.
 * The supplier sees the PO for one job, confirms it, posts production progress and photos, sets or moves
 * the ready date, and flags delays. Every update lands on the job timeline and pings the agent.
 *   POST /sourcing/:id/supplier-link            agent: create (or reuse) the link for the accepted quote's supplier
 *   DELETE /sourcing/:id/supplier-link          agent: revoke
 *   GET  /s/:token                               supplier: PO, updates, photos
 *   POST /s/:token/update                        supplier: confirm | progress | ready | delay | note
 *   POST /s/:token/photos                        supplier: production photo (≤3 MB)
 *   GET  /s/:token/files/:fid                    supplier: their own photos back
 */
import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { notify, notifyShipperStaff } from './notify'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const SOURCING_SHIPPER = 'ship-sync-sourcing'
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)

const zUpdate = z.object({
  kind: z.enum(['confirm', 'progress', 'ready', 'delay', 'note']),
  body: z.string().trim().max(1500).default(''),
  by: z.string().trim().min(1).max(80),
  readyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pct: z.number().int().min(0).max(100).optional(),
})
const zPhoto = z.object({ title: z.string().trim().min(1).max(120), mime: z.string().regex(/^image\/(png|jpeg|webp)$/), data: z.string().min(10).max(4_200_000), by: z.string().trim().min(1).max(80) })

const updateOut = (r: Row) => ({ id: r.id, kind: r.kind, body: r.body, by: r.author, readyBy: r.ready_by ? String(ISO(r.ready_by)).slice(0, 10) : null, pct: r.pct, at: ISO(r.created_at) })

async function tellAgents(db: Db, job: Row, title: string, body: string, dedupe: string) {
  if (job.agent_user_id) await notify(db, { userId: job.agent_user_id, kind: 'sourcing', title, body, link: `/dashboard/sourcing/${job.id}`, dedupe, emailSubject: title })
  else await notifyShipperStaff(db, SOURCING_SHIPPER, { kind: 'sourcing', title, body, link: `/dashboard/sourcing/${job.id}`, dedupe }, ['owner', 'dispatcher', 'agent'])
}

export function mountSupplierPortal(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  const isAgent = (u: ApiUser) => !!u.admin || (u.role === 'shipper' && u.shipperId === SOURCING_SHIPPER && u.staffRole !== 'driver')
  const jobFor = async (db: Db, id: string) => { const { rows } = await db.query<Row>('select * from sourcing_requests where id = $1 or ref = $1', [id]); if (!rows[0]) throw new HttpError(404, 'Sourcing request not found.'); return rows[0] }
  const byToken = async (db: Db, token: string) => {
    const { rows } = await db.query<Row>(`select l.*, j.ref, j.title, j.description, j.quantity, j.unit, j.status as job_status, j.po, j.agent_user_id, j.destination, j.id as job_id, sp.name as sup_name, sp.contact as sup_contact, q.unit_price_cny, q.lead_days, q.qty as q_qty, q.title as q_title, q.notes as q_notes, q.tiers, q.moq
      from supplier_links l join sourcing_requests j on j.id = l.sourcing_id left join suppliers sp on sp.id = l.supplier_id left join sourcing_quotes q on q.id = j.accepted_quote_id where l.token = $1`, [token])
    const l = rows[0]
    if (!l || l.revoked_at) throw new HttpError(404, 'This link is no longer valid. Ask your Ship Sync agent for a new one.')
    await db.query('update supplier_links set last_seen_at = now() where token = $1', [token])
    return l
  }
  const linkOut = (l: Row, req: Request) => ({ token: l.token, url: `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/#/s/${l.token}`, supplierId: l.supplier_id, createdAt: ISO(l.created_at), lastSeenAt: ISO(l.last_seen_at), revokedAt: ISO(l.revoked_at) })

  /* ---- agent side ---- */
  r.get('/sourcing/:id/supplier-link', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (!isAgent(u)) throw new HttpError(403, 'Sourcing team only.')
    const job = await jobFor(db, String(req.params.id))
    const { rows } = await db.query<Row>('select * from supplier_links where sourcing_id = $1 and revoked_at is null order by created_at desc limit 1', [job.id])
    const { rows: ups } = await db.query<Row>('select * from supplier_updates where sourcing_id = $1 order by created_at desc limit 50', [job.id])
    res.json({ link: rows[0] ? linkOut(rows[0], req) : null, updates: ups.map(updateOut) })
  }))
  r.post('/sourcing/:id/supplier-link', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (!isAgent(u)) throw new HttpError(403, 'Sourcing team only.')
    const job = await jobFor(db, String(req.params.id))
    const { rows: q } = await db.query<Row>('select supplier_id from sourcing_quotes where id = $1', [job.accepted_quote_id])
    const supplierId = (req.body?.supplierId as string | undefined) || q[0]?.supplier_id || null
    if (!supplierId) throw new HttpError(409, 'Accept a quote (so we know which factory) before creating a supplier link.')
    const { rows: ex } = await db.query<Row>('select * from supplier_links where sourcing_id = $1 and supplier_id = $2 and revoked_at is null limit 1', [job.id, supplierId])
    if (ex[0]) return res.json({ link: linkOut(ex[0], req), reused: true })
    const token = randomBytes(18).toString('base64url')
    await db.query('insert into supplier_links (token,sourcing_id,supplier_id,created_by) values ($1,$2,$3,$4)', [token, job.id, supplierId, u.name])
    const { rows } = await db.query<Row>('select * from supplier_links where token = $1', [token])
    res.status(201).json({ link: linkOut(rows[0], req), reused: false })
  }))
  r.delete('/sourcing/:id/supplier-link', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (!isAgent(u)) throw new HttpError(403, 'Sourcing team only.')
    const job = await jobFor(db, String(req.params.id))
    await db.query('update supplier_links set revoked_at = now() where sourcing_id = $1 and revoked_at is null', [job.id]); res.json({ ok: true })
  }))

  /* ---- supplier side (no login) ---- */
  r.get('/s/:token', wrap(async (req, res) => {
    const db = await getDb(); const l = await byToken(db, String(req.params.token))
    const { rows: ups } = await db.query<Row>('select * from supplier_updates where sourcing_id = $1 order by created_at desc limit 50', [l.job_id])
    const { rows: photos } = await db.query<Row>(`select id, title, mime, uploaded_by, created_at from sourcing_files where sourcing_id = $1 and uploaded_by_role = 'supplier' order by created_at desc`, [l.job_id])
    const { rows: agent } = l.agent_user_id ? await db.query<Row>('select name from users where id = $1', [l.agent_user_id]) : { rows: [] as Row[] }
    const po = J(l.po) as Row | null
    res.set('Cache-Control', 'no-store')
    res.json({
      supplier: { name: l.sup_name, contact: l.sup_contact },
      job: { ref: l.ref, title: l.title, description: l.description, quantity: Number(l.q_qty || l.quantity), unit: l.unit, status: l.job_status, destination: l.destination },
      po: po ? { number: po.number, incoterm: po.incoterm, readyBy: po.readyBy, leadDays: po.leadDays, placedAt: po.placedAt, confirmedAt: po.confirmedAt ?? null, confirmedBy: po.confirmedBy ?? null, readyAt: po.readyAt ?? null, pct: po.pct ?? null } : null,
      quote: l.unit_price_cny != null ? { title: l.q_title, unitPriceCny: Number(l.unit_price_cny), leadDays: Number(l.lead_days), notes: l.q_notes, moq: l.moq != null ? Number(l.moq) : null } : null,
      agent: agent[0]?.name ?? 'Ship Sync Sourcing',
      updates: ups.map(updateOut),
      photos: photos.map((p) => ({ id: p.id, title: p.title, by: p.uploaded_by, at: ISO(p.created_at), url: `/api/s/${l.token}/files/${p.id}` })),
    })
  }))
  r.post('/s/:token/update', wrap(async (req, res) => {
    const db = await getDb(); const l = await byToken(db, String(req.params.token)); const b = zUpdate.parse(req.body)
    if (['closed', 'cancelled', 'delivered'].includes(l.job_status)) throw new HttpError(409, 'This order is closed.')
    if ((b.kind === 'ready' || b.kind === 'delay') && !b.readyBy) throw new HttpError(400, 'Give the date the goods will be ready.')
    const id = 'su_' + uid()
    await db.query('insert into supplier_updates (id,sourcing_id,token,kind,body,author,ready_by,pct) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, l.job_id, l.token, b.kind, b.body, b.by, b.readyBy ?? null, b.pct ?? null])
    // reflect on the job: PO fields + timeline + status
    const po = (J(l.po) as Row | null) ?? {}
    const labels: Record<string, string> = { confirm: 'confirmed the order', progress: 'reported production progress', ready: 'says the goods are ready', delay: 'reports a delay', note: 'left a note' }
    const notePieces = [`Factory (${b.by}) ${labels[b.kind]}`]
    if (b.pct != null) { po.pct = b.pct; notePieces.push(`${b.pct}% done`) }
    if (b.readyBy) { po.readyBy = b.readyBy; notePieces.push(`ready by ${b.readyBy}`) }
    if (b.kind === 'confirm') { po.confirmedAt = new Date().toISOString(); po.confirmedBy = b.by }
    if (b.kind === 'ready') { po.readyAt = new Date().toISOString(); po.pct = 100 }
    const note = notePieces.join(' · ') + (b.body ? ` — "${b.body.slice(0, 200)}"` : '')
    const timeline = (J((await db.query<Row>('select timeline from sourcing_requests where id = $1', [l.job_id])).rows[0]?.timeline) ?? []) as Row[]
    const newStatus = b.kind === 'confirm' && l.job_status === 'ordered' ? 'in_production' : null
    timeline.push({ at: new Date().toISOString(), status: newStatus ?? l.job_status, note, by: `${l.sup_name ?? 'Factory'} (supplier portal)` })
    await db.query(`update sourcing_requests set po = $2, timeline = $3, updated_at = now()${newStatus ? ', status = $4' : ''} where id = $1`, newStatus ? [l.job_id, JSON.stringify(po), JSON.stringify(timeline.slice(-60)), newStatus] : [l.job_id, JSON.stringify(po), JSON.stringify(timeline.slice(-60))])
    await tellAgents(db, { id: l.job_id, agent_user_id: l.agent_user_id, ref: l.ref }, `${l.ref}: factory ${labels[b.kind]}${b.kind === 'delay' ? ' ⚠' : ''}`, note.slice(0, 200), `src:${l.job_id}:sup:${id}`)
    res.status(201).json({ update: { id, kind: b.kind, body: b.body, by: b.by, readyBy: b.readyBy ?? null, pct: b.pct ?? null, at: new Date().toISOString() }, status: newStatus ?? l.job_status })
  }))
  r.post('/s/:token/photos', wrap(async (req, res) => {
    const db = await getDb(); const l = await byToken(db, String(req.params.token)); const b = zPhoto.parse(req.body)
    const data = b.data.replace(/^data:[^;]+;base64,/, ''); const size = Math.floor((data.length * 3) / 4)
    if (size > 3_000_000) throw new HttpError(413, 'Keep photos under 3 MB.')
    const { rows: c } = await db.query<Row>(`select count(*)::int as n from sourcing_files where sourcing_id = $1 and uploaded_by_role = 'supplier'`, [l.job_id])
    if (Number(c[0].n) >= 40) throw new HttpError(429, 'Photo limit reached for this order.')
    const id = 'sf_' + uid()
    await db.query(`insert into sourcing_files (id,sourcing_id,kind,title,mime,size,data,uploaded_by,uploaded_by_role) values ($1,$2,'photo',$3,$4,$5,$6,$7,'supplier')`, [id, l.job_id, b.title, b.mime, size, data, b.by])
    await db.query('update sourcing_requests set updated_at = now() where id = $1', [l.job_id])
    await tellAgents(db, { id: l.job_id, agent_user_id: l.agent_user_id, ref: l.ref }, `${l.ref}: production photo from the factory`, `${b.by} added "${b.title}".`, `src:${l.job_id}:supphoto:${id}`)
    res.status(201).json({ photo: { id, title: b.title, by: b.by, at: new Date().toISOString(), url: `/api/s/${l.token}/files/${id}` } })
  }))
  r.get('/s/:token/files/:fid', wrap(async (req, res) => {
    const db = await getDb(); const l = await byToken(db, String(req.params.token))
    const { rows } = await db.query<Row>(`select * from sourcing_files where id = $1 and sourcing_id = $2 and uploaded_by_role = 'supplier'`, [req.params.fid, l.job_id]); const f = rows[0]; if (!f) throw new HttpError(404, 'File not found.')
    res.set('Content-Type', f.mime); res.set('Cache-Control', 'private, max-age=3600'); res.send(Buffer.from(f.data, 'base64'))
  }))
}
