/**
 * Costs & profit.
 *   A cost belongs to a shipment, to a container (split across the shipments loaded in it by weight,
 *   or evenly when weights are missing) or to the company (overhead — rent, salaries, software).
 *   GET /costs?days=   POST /costs   DELETE /costs/:id   GET /costs/categories
 *   allocate(db, shipperId) → per-shipment cost, used by analytics for profit by lane, client, container.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
export const COST_CATEGORIES = [
  { key: 'freight', label: 'Shipping line / airline' }, { key: 'trucking', label: 'Trucking & drayage' }, { key: 'port', label: 'Port & terminal fees' },
  { key: 'customs', label: 'Customs, duty & clearing' }, { key: 'agent', label: 'Agents & brokers' }, { key: 'warehouse', label: 'Warehouse & storage' },
  { key: 'packaging', label: 'Packaging & materials' }, { key: 'fuel', label: 'Fuel & vehicles' }, { key: 'staff', label: 'Staff & wages' }, { key: 'other', label: 'Other' },
] as const
const KEYS = COST_CATEGORIES.map((c) => c.key) as [string, ...string[]]
const num = (v: unknown) => Number(v ?? 0) || 0
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10))

/** Per-shipment allocated cost (direct + share of container costs) and the overhead rows. */
export async function allocate(db: Db, shipperId: string) {
  const { rows: costs } = await db.query<Row>('select * from costs where shipper_id = $1', [shipperId])
  const byShip = new Map<string, { total: number; byCat: Record<string, number> }>()
  const add = (sid: string, cat: string, v: number) => { const x = byShip.get(sid) ?? { total: 0, byCat: {} }; x.total += v; x.byCat[cat] = (x.byCat[cat] ?? 0) + v; byShip.set(sid, x) }
  const contIds = [...new Set(costs.filter((c) => c.container_id && !c.shipment_id).map((c) => c.container_id))]
  const loaded = new Map<string, { id: string; kg: number }[]>()
  if (contIds.length) {
    const { rows } = await db.query<Row>('select id, container_id, booking from shipments where container_id = any($1) and cancelled_at is null', [contIds])
    for (const s of rows) { const a = loaded.get(s.container_id) ?? []; a.push({ id: s.id, kg: num(J(s.booking)?.weightKg) }); loaded.set(s.container_id, a) }
  }
  const overhead: Row[] = []; const unallocated: Row[] = []
  for (const c of costs) {
    const v = num(c.amount_usd)
    if (c.shipment_id) add(c.shipment_id, c.category, v)
    else if (c.container_id) {
      const list = loaded.get(c.container_id) ?? []
      if (!list.length) { unallocated.push(c); continue }
      const kg = list.reduce((a, s) => a + s.kg, 0)
      for (const s of list) add(s.id, c.category, kg > 0 ? (v * s.kg) / kg : v / list.length)
    } else overhead.push(c)
  }
  return { byShip, overhead, unallocated, costs }
}

const zCost = z.object({
  category: z.enum(KEYS), amountUsd: z.number().positive().max(10_000_000), description: z.string().trim().max(200).default(''), vendor: z.string().trim().max(120).default(''),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), containerId: z.string().max(60).nullable().optional(), shipmentId: z.string().max(60).nullable().optional(),
})

export function mountCosts(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !(can(u, 'payments') || ['owner', 'dispatcher'].includes(u.staffRole ?? 'owner'))) throw new HttpError(403, 'Owners, dispatchers and finance only.')
    return u
  }
  r.get('/costs/categories', wrap(async (_req, res) => { res.json({ categories: COST_CATEGORIES }) }))
  r.get('/costs', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const days = Math.max(7, Math.min(730, Number(req.query.days) || 90))
    const { rows } = await db.query<Row>(`select c.*, ct.ref as container_ref, ct.number as container_number, s.ref as shipment_ref, s.customer from costs c left join containers ct on ct.id = c.container_id left join shipments s on s.id = c.shipment_id where c.shipper_id = $1 and c.incurred_on >= $2 order by c.incurred_on desc, c.created_at desc limit 500`, [u.shipperId, new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)])
    const { rows: cont } = await db.query<Row>(`select id, ref, number, status from containers where shipper_id = $1 order by created_at desc limit 40`, [u.shipperId])
    const { rows: sh } = await db.query<Row>(`select id, ref, customer from shipments where shipper_id = $1 and cancelled_at is null order by created_at desc limit 60`, [u.shipperId])
    const total = rows.reduce((a, c) => a + num(c.amount_usd), 0)
    const byCat = COST_CATEGORIES.map((c) => ({ key: c.key, label: c.label, amount: Math.round(rows.filter((x) => x.category === c.key).reduce((a, x) => a + num(x.amount_usd), 0)) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount)
    res.json({
      costs: rows.map((c) => ({ id: c.id, category: c.category, amountUsd: num(c.amount_usd), description: c.description, vendor: c.vendor, incurredOn: ISO(c.incurred_on), containerId: c.container_id, containerRef: c.container_ref ?? null, shipmentId: c.shipment_id, shipmentRef: c.shipment_ref ?? null, customer: c.customer ?? null, scope: c.shipment_id ? 'shipment' : c.container_id ? 'container' : 'overhead', createdBy: c.created_by })),
      total: Math.round(total), byCategory: byCat, categories: COST_CATEGORIES,
      containers: cont.map((c) => ({ id: c.id, label: `${c.ref}${c.number ? ` · ${c.number}` : ''}`, status: c.status })), shipments: sh.map((s) => ({ id: s.id, label: `${s.ref} · ${s.customer}` })),
    })
  }))
  r.post('/costs', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zCost.parse(req.body)
    if (b.containerId) { const { rows } = await db.query('select 1 from containers where id = $1 and shipper_id = $2', [b.containerId, u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Container not found.') }
    if (b.shipmentId) { const { rows } = await db.query('select 1 from shipments where id = $1 and shipper_id = $2', [b.shipmentId, u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Shipment not found.') }
    const id = 'cost_' + uid()
    await db.query(`insert into costs (id,shipper_id,container_id,shipment_id,category,description,vendor,amount_usd,incurred_on,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, u.shipperId, b.shipmentId ? null : b.containerId ?? null, b.shipmentId ?? null, b.category, b.description, b.vendor, b.amountUsd, b.incurredOn ?? new Date().toISOString().slice(0, 10), u.name])
    res.status(201).json({ id })
  }))
  r.delete('/costs/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rowCount } = await db.query('delete from costs where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]) as unknown as { rowCount: number }
    void rowCount; res.json({ ok: true })
  }))
  /** One shipment's profit — shown on the shipment / container pages. */
  r.get('/shipments/:id/profit', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>('select id from shipments where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Shipment not found.')
    const { byShip } = await allocate(db, u.shipperId!)
    const { rows: inv } = await db.query<Row>(`select coalesce(sum(total),0)::float as t from invoices where shipment_id = $1 and status not in ('void','draft')`, [req.params.id])
    const cost = byShip.get(String(req.params.id)); const revenue = num(inv[0]?.t)
    res.json({ revenue: Math.round(revenue), cost: Math.round(cost?.total ?? 0), profit: Math.round(revenue - (cost?.total ?? 0)), marginPct: revenue ? Math.round(((revenue - (cost?.total ?? 0)) / revenue) * 100) : null, byCategory: cost?.byCat ?? {} })
  }))
}
