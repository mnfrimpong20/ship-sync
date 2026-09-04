/**
 * Client management for shippers: the people they ship for, whether they came through the Ship Sync marketplace or are
 * long-standing offline customers. Everything here is scoped to the signed-in shipper's company.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { makeRef, uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadShipments: (db: Db, where: string, params: unknown[]) => Promise<any[]>
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

export const clientOut = (r: Row) => ({
  id: r.id, shipperId: r.shipper_id, userId: r.user_id ?? undefined, name: r.name, company: r.company, email: r.email, phone: r.phone, whatsapp: r.whatsapp, city: r.city,
  tags: J(r.tags) as string[], notes: r.notes, source: r.source as 'marketplace' | 'manual', status: r.status as 'active' | 'archived', createdAt: ISO(r.created_at), updatedAt: ISO(r.updated_at),
  // list-only aggregates (present when selected)
  shipmentCount: r.shipment_count != null ? Number(r.shipment_count) : undefined, activeShipments: r.active_count != null ? Number(r.active_count) : undefined,
  invoiced: r.invoiced != null ? Number(r.invoiced) : undefined, paid: r.paid != null ? Number(r.paid) : undefined, lastActivityAt: r.last_activity_at ? ISO(r.last_activity_at) : undefined,
  nextReminderAt: r.next_reminder_at ? ISO(r.next_reminder_at) : undefined,
})
const consigneeOut = (r: Row) => ({ id: r.id, clientId: r.client_id, name: r.name, phone: r.phone, address: r.address, city: r.city, country: r.country, relationship: r.relationship, isDefault: r.is_default })
const activityOut = (r: Row) => ({ id: r.id, clientId: r.client_id, type: r.type, body: r.body, at: ISO(r.at), dueAt: r.due_at ? ISO(r.due_at) : undefined, done: r.done, createdBy: r.created_by ?? undefined })
const invoiceOut = (r: Row, payments: Row[]) => {
  const paid = payments.reduce((n, p) => n + Number(p.amount), 0)
  return {
    id: r.id, clientId: r.client_id, shipmentId: r.shipment_id ?? undefined, number: r.number, status: r.status as 'draft' | 'sent' | 'paid' | 'void', currency: r.currency,
    items: J(r.items) as { description: string; qty: number; unit: number }[], subtotal: Number(r.subtotal), tax: Number(r.tax), total: Number(r.total), paid, balance: Math.max(0, Number(r.total) - paid),
    issuedAt: DATE(r.issued_at), dueAt: DATE(r.due_at), notes: r.notes, createdAt: ISO(r.created_at),
    payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount), method: p.method, at: DATE(p.at), note: p.note })),
  }
}

/* ---------------- schemas ---------------- */
const COUNTRY = z.enum(['GH', 'NG', 'LR', 'TG', 'CI', 'SL', 'SN'])
const zClient = z.object({
  name: z.string().trim().min(2, 'Enter the client’s name.').max(80),
  company: z.string().trim().max(80).default(''),
  email: z.string().trim().email('Enter a valid email.').or(z.literal('')).default(''),
  phone: z.string().trim().max(30).default(''),
  whatsapp: z.string().trim().max(30).default(''),
  city: z.string().trim().max(60).default(''),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  notes: z.string().trim().max(4000).default(''),
})
const zClientPatch = zClient.partial().extend({ status: z.enum(['active', 'archived']).optional() })
const zConsignee = z.object({
  name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).default(''), address: z.string().trim().max(200).default(''), city: z.string().trim().max(60).default(''),
  country: COUNTRY.default('GH'), relationship: z.string().trim().max(40).default(''), isDefault: z.boolean().default(false),
})
const zActivity = z.object({ type: z.enum(['note', 'call', 'email', 'whatsapp', 'meeting', 'reminder']), body: z.string().trim().min(1, 'Write something.').max(2000), dueAt: z.string().datetime().optional() })
const zActivityPatch = z.object({ body: z.string().trim().min(1).max(2000).optional(), done: z.boolean().optional(), dueAt: z.string().datetime().nullable().optional() })
const zBooking = z.object({
  mode: z.enum(['air', 'ocean']), origin: z.string().trim().min(2).max(60), destination: COUNTRY,
  cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']), description: z.string().trim().max(500).default(''),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an ETA.'), consigneeId: z.string().optional(), note: z.string().trim().max(500).default(''),
})
const zInvoice = z.object({
  shipmentId: z.string().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1).max(160), qty: z.number().min(0.01).max(10000), unit: z.number().int().min(0).max(10_000_000) })).min(1, 'Add at least one line.').max(30),
  tax: z.number().int().min(0).max(10_000_000).default(0),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(1000).default(''), status: z.enum(['draft', 'sent']).default('draft'),
})
const zInvoicePatch = z.object({ status: z.enum(['draft', 'sent', 'void']).optional(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), notes: z.string().trim().max(1000).optional() })
const zPayment = z.object({ amount: z.number().int().min(1).max(10_000_000), method: z.enum(['bank', 'cash', 'card', 'mobile_money', 'other']).default('bank'), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(200).default('') })

/** Marketplace customers become clients automatically the moment they book with this shipper. Idempotent; runs on each list. */
export async function ensureMarketplaceClients(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>(
    `select s.user_id, max(s.customer) as customer, max(u.email) as email, max(u.name) as uname from shipments s left join users u on u.id = s.user_id
     where s.shipper_id = $1 and s.user_id is not null and s.client_id is null group by s.user_id`, [shipperId])
  for (const r of rows) {
    const id = 'cl_' + uid()
    await db.query(
      `insert into clients (id,shipper_id,user_id,name,email,source) values ($1,$2,$3,$4,$5,'marketplace') on conflict (shipper_id, user_id) do nothing`,
      [id, shipperId, r.user_id, r.uname || r.customer || 'Customer', r.email || ''])
    await db.query(`update shipments set client_id = (select id from clients where shipper_id = $1 and user_id = $2) where shipper_id = $1 and user_id = $2 and client_id is null`, [shipperId, r.user_id])
  }
}

/** Link a freshly booked marketplace shipment to its client (called from the quote-accept flow). */
export async function attachShipmentToClient(db: Db, shipperId: string, userId: string, shipmentId: string, customerName: string, email: string) {
  await db.query(`insert into clients (id,shipper_id,user_id,name,email,source) values ($1,$2,$3,$4,$5,'marketplace') on conflict (shipper_id, user_id) do nothing`, ['cl_' + uid(), shipperId, userId, customerName, email])
  const { rows } = await db.query<Row>('select id from clients where shipper_id = $1 and user_id = $2', [shipperId, userId])
  if (rows[0]) {
    await db.query('update shipments set client_id = $2 where id = $1', [shipmentId, rows[0].id])
    await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), rows[0].id, shipperId, 'Booked through Ship Sync.'])
  }
}

/** System note on a client's timeline (status changes etc.). Silent when the shipment has no client. */
export async function logShipmentActivity(db: Db, shipmentId: string, body: string) {
  const { rows } = await db.query<Row>('select client_id, shipper_id from shipments where id = $1', [shipmentId])
  if (rows[0]?.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), rows[0].client_id, rows[0].shipper_id, body])
}

export function mountClients(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap, loadShipments } = d
  const shipperOf = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Client management is for shipper accounts.')
    return { user: u, shipperId: u.shipperId }
  }
  const ownClient = async (db: Db, shipperId: string, id: string) => {
    const { rows } = await db.query<Row>('select * from clients where id = $1 and shipper_id = $2', [id, shipperId])
    if (!rows[0]) throw new HttpError(404, 'Client not found.')
    return rows[0]
  }
  const loadInvoices = async (db: Db, where: string, params: unknown[]) => {
    const { rows } = await db.query<Row>(`select * from invoices where ${where} order by created_at desc`, params)
    if (!rows.length) return []
    const { rows: pays } = await db.query<Row>('select * from payments where invoice_id = any($1::text[]) order by at asc', [rows.map((x) => x.id)])
    return rows.map((x) => invoiceOut(x, pays.filter((p) => p.invoice_id === x.id)))
  }
  const act = (db: Db, clientId: string, shipperId: string, type: string, body: string, by?: string) =>
    db.query(`insert into client_activities (id,client_id,shipper_id,type,body,created_by) values ($1,$2,$3,$4,$5,$6)`, [uid(), clientId, shipperId, type, body, by ?? null])

  // ---- clients
  r.get('/clients', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    await ensureMarketplaceClients(db, shipperId)
    const { rows } = await db.query<Row>(`
      select c.*,
        (select count(*) from shipments s where s.client_id = c.id)::int as shipment_count,
        (select count(*) from shipments s where s.client_id = c.id and s.status <> 'delivered')::int as active_count,
        (select coalesce(sum(i.total),0) from invoices i where i.client_id = c.id and i.status <> 'void')::int as invoiced,
        (select coalesce(sum(p.amount),0) from payments p join invoices i on i.id = p.invoice_id where i.client_id = c.id and i.status <> 'void')::int as paid,
        (select max(a.at) from client_activities a where a.client_id = c.id) as last_activity_at,
        (select min(a.due_at) from client_activities a where a.client_id = c.id and a.type = 'reminder' and a.done = false) as next_reminder_at
      from clients c where c.shipper_id = $1 order by c.status asc, coalesce((select max(a.at) from client_activities a where a.client_id = c.id), c.created_at) desc`, [shipperId])
    res.json({ clients: rows.map(clientOut) })
  }))
  r.post('/clients', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, user } = await shipperOf(db, req)
    const b = zClient.parse(req.body)
    const id = 'cl_' + uid()
    await db.query(`insert into clients (id,shipper_id,name,company,email,phone,whatsapp,city,tags,notes,source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual')`,
      [id, shipperId, b.name, b.company, b.email, b.phone, b.whatsapp, b.city, JSON.stringify(b.tags), b.notes])
    await act(db, id, shipperId, 'system', `Added as a client by ${user.name}.`, user.id)
    const c = await ownClient(db, shipperId, id)
    res.status(201).json({ client: clientOut(c) })
  }))
  r.get('/clients/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const [{ rows: cons }, { rows: acts }, shipments, invoices] = await Promise.all([
      db.query<Row>('select * from client_consignees where client_id = $1 order by is_default desc, name asc', [c.id]),
      db.query<Row>('select * from client_activities where client_id = $1 order by at desc limit 200', [c.id]),
      loadShipments(db, 'client_id = $1', [c.id]),
      loadInvoices(db, 'client_id = $1', [c.id]),
    ])
    res.json({ client: clientOut(c), consignees: cons.map(consigneeOut), activities: acts.map(activityOut), shipments, invoices })
  }))
  r.patch('/clients/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const b = zClientPatch.parse(req.body)
    const next = { ...c, ...b, tags: b.tags ?? J(c.tags) }
    await db.query(`update clients set name=$2, company=$3, email=$4, phone=$5, whatsapp=$6, city=$7, tags=$8, notes=$9, status=$10, updated_at=now() where id = $1`,
      [c.id, next.name, next.company, next.email, next.phone, next.whatsapp, next.city, JSON.stringify(next.tags), next.notes, next.status])
    res.json({ client: clientOut(await ownClient(db, shipperId, c.id)) })
  }))

  // ---- consignees
  r.post('/clients/:id/consignees', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const b = zConsignee.parse(req.body)
    const id = 'cs_' + uid()
    if (b.isDefault) await db.query('update client_consignees set is_default = false where client_id = $1', [c.id])
    await db.query('insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, c.id, b.name, b.phone, b.address, b.city, b.country, b.relationship, b.isDefault])
    const { rows } = await db.query<Row>('select * from client_consignees where client_id = $1 order by is_default desc, name asc', [c.id])
    res.status(201).json({ consignees: rows.map(consigneeOut) })
  }))
  r.patch('/consignees/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select cs.*, c.shipper_id from client_consignees cs join clients c on c.id = cs.client_id where cs.id = $1', [req.params.id])
    const cs = rows[0]; if (!cs || cs.shipper_id !== shipperId) throw new HttpError(404, 'Consignee not found.')
    const b = zConsignee.partial().parse(req.body); const n = { ...cs, ...b, isDefault: b.isDefault ?? cs.is_default }
    if (n.isDefault) await db.query('update client_consignees set is_default = false where client_id = $1', [cs.client_id])
    await db.query('update client_consignees set name=$2, phone=$3, address=$4, city=$5, country=$6, relationship=$7, is_default=$8 where id = $1', [cs.id, n.name, n.phone, n.address, n.city, n.country, n.relationship, n.isDefault])
    const { rows: all } = await db.query<Row>('select * from client_consignees where client_id = $1 order by is_default desc, name asc', [cs.client_id])
    res.json({ consignees: all.map(consigneeOut) })
  }))
  r.delete('/consignees/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select cs.*, c.shipper_id from client_consignees cs join clients c on c.id = cs.client_id where cs.id = $1', [req.params.id])
    const cs = rows[0]; if (!cs || cs.shipper_id !== shipperId) throw new HttpError(404, 'Consignee not found.')
    await db.query('delete from client_consignees where id = $1', [cs.id])
    const { rows: all } = await db.query<Row>('select * from client_consignees where client_id = $1 order by is_default desc, name asc', [cs.client_id])
    res.json({ consignees: all.map(consigneeOut) })
  }))

  // ---- activity & reminders
  r.post('/clients/:id/activities', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, user } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const b = zActivity.parse(req.body)
    if (b.type === 'reminder' && !b.dueAt) throw new HttpError(400, 'Reminders need a due date.')
    const id = uid()
    await db.query('insert into client_activities (id,client_id,shipper_id,type,body,due_at,created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, c.id, shipperId, b.type, b.body, b.dueAt ? new Date(b.dueAt) : null, user.id])
    await db.query('update clients set updated_at = now() where id = $1', [c.id])
    const { rows } = await db.query<Row>('select * from client_activities where client_id = $1 order by at desc limit 200', [c.id])
    res.status(201).json({ activities: rows.map(activityOut) })
  }))
  r.patch('/activities/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select * from client_activities where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    const a = rows[0]; if (!a) throw new HttpError(404, 'Activity not found.')
    const b = zActivityPatch.parse(req.body)
    await db.query('update client_activities set body = $2, done = $3, due_at = $4 where id = $1', [a.id, b.body ?? a.body, b.done ?? a.done, b.dueAt === undefined ? a.due_at : b.dueAt ? new Date(b.dueAt) : null])
    const { rows: all } = await db.query<Row>('select * from client_activities where client_id = $1 order by at desc limit 200', [a.client_id])
    res.json({ activities: all.map(activityOut) })
  }))
  r.delete('/activities/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select * from client_activities where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    const a = rows[0]; if (!a) throw new HttpError(404, 'Activity not found.')
    if (a.type === 'system') throw new HttpError(409, 'System entries can’t be deleted.')
    await db.query('delete from client_activities where id = $1', [a.id])
    const { rows: all } = await db.query<Row>('select * from client_activities where client_id = $1 order by at desc limit 200', [a.client_id])
    res.json({ activities: all.map(activityOut) })
  }))
  /** Everything due across all clients — for the dashboard's reminder strip. */
  r.get('/clients/reminders/due', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>(`select a.*, c.name as client_name from client_activities a join clients c on c.id = a.client_id where a.shipper_id = $1 and a.type = 'reminder' and a.done = false order by a.due_at asc limit 50`, [shipperId])
    res.json({ reminders: rows.map((x) => ({ ...activityOut(x), clientName: x.client_name })) })
  }))

  // ---- manual bookings
  r.post('/clients/:id/shipments', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, user } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const b = zBooking.parse(req.body)
    let consignee: Row | null = null
    if (b.consigneeId) { const { rows } = await db.query<Row>('select * from client_consignees where id = $1 and client_id = $2', [b.consigneeId, c.id]); consignee = rows[0] ?? null; if (!consignee) throw new HttpError(400, 'That consignee doesn’t belong to this client.') }
    const id = uid(); const ref = makeRef()
    await db.query(`insert into shipments (id,ref,shipper_id,user_id,client_id,consignee_id,mode,origin,destination,cargo,description,status,eta,customer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'booked',$12,$13)`,
      [id, ref, shipperId, c.user_id ?? null, c.id, consignee?.id ?? null, b.mode, b.origin, b.destination, b.cargo, b.description || `${b.cargo} for ${c.name}`, b.eta, c.name])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [id, 'booked', b.origin, b.note || `Booked directly with ${user.company ?? 'your shipper'}.${consignee ? ` Consignee: ${consignee.name}, ${consignee.city}.` : ''}`])
    await act(db, c.id, shipperId, 'system', `Shipment ${ref} booked (${b.mode}, ${b.origin} → ${countryByCode(b.destination)?.name ?? b.destination}).`, user.id)
    const [shipment] = await loadShipments(db, 'id = $1', [id])
    res.status(201).json({ shipment })
  }))

  // ---- invoices & payments
  r.post('/clients/:id/invoices', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, user } = await shipperOf(db, req)
    const c = await ownClient(db, shipperId, String(req.params.id))
    const b = zInvoice.parse(req.body)
    if (b.shipmentId) { const { rows } = await db.query<Row>('select id from shipments where id = $1 and shipper_id = $2', [b.shipmentId, shipperId]); if (!rows[0]) throw new HttpError(400, 'Unknown shipment.') }
    const subtotal = Math.round(b.items.reduce((n, i) => n + i.qty * i.unit, 0))
    const total = subtotal + b.tax
    const year = new Date().getFullYear()
    const { rows: seq } = await db.query<{ n: string }>(`select count(*)::text as n from invoices where shipper_id = $1 and number like $2`, [shipperId, `INV-${year}-%`])
    let number = `INV-${year}-${String(Number(seq[0].n) + 1).padStart(4, '0')}`
    for (let i = 0; i < 5; i++) { const { rows: dup } = await db.query('select 1 from invoices where shipper_id = $1 and number = $2', [shipperId, number]); if (!dup.length) break; number = `INV-${year}-${String(Number(seq[0].n) + 2 + i).padStart(4, '0')}` }
    const id = 'inv_' + uid()
    await db.query(`insert into invoices (id,shipper_id,client_id,shipment_id,number,status,items,subtotal,tax,total,issued_at,due_at,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, shipperId, c.id, b.shipmentId ?? null, number, b.status, JSON.stringify(b.items), subtotal, b.tax, total, b.issuedAt ?? new Date().toISOString().slice(0, 10), b.dueAt ?? null, b.notes])
    await act(db, c.id, shipperId, 'system', `Invoice ${number} ${b.status === 'sent' ? 'sent' : 'drafted'} for $${total.toLocaleString()}.`, user.id)
    const [invoice] = await loadInvoices(db, 'id = $1', [id])
    res.status(201).json({ invoice })
  }))
  r.patch('/invoices/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select * from invoices where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    const inv = rows[0]; if (!inv) throw new HttpError(404, 'Invoice not found.')
    const b = zInvoicePatch.parse(req.body)
    if (inv.status === 'paid' && b.status && b.status !== 'void') throw new HttpError(409, 'A paid invoice can only be voided.')
    await db.query('update invoices set status = $2, due_at = $3, notes = $4 where id = $1', [inv.id, b.status ?? inv.status, b.dueAt === undefined ? inv.due_at : b.dueAt, b.notes ?? inv.notes])
    if (b.status && b.status !== inv.status) await act(db, inv.client_id, shipperId, 'system', `Invoice ${inv.number} marked ${b.status}.`)
    const [invoice] = await loadInvoices(db, 'id = $1', [inv.id])
    res.json({ invoice })
  }))
  r.post('/invoices/:id/payments', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const { rows } = await db.query<Row>('select * from invoices where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    const inv = rows[0]; if (!inv) throw new HttpError(404, 'Invoice not found.')
    if (inv.status === 'void') throw new HttpError(409, 'This invoice is void.')
    const b = zPayment.parse(req.body)
    await db.query('insert into payments (id,invoice_id,amount,method,at,note) values ($1,$2,$3,$4,$5,$6)', ['pay_' + uid(), inv.id, b.amount, b.method, b.at ?? new Date().toISOString().slice(0, 10), b.note])
    const { rows: sum } = await db.query<{ s: string }>('select coalesce(sum(amount),0)::text as s from payments where invoice_id = $1', [inv.id])
    const paid = Number(sum[0].s)
    if (paid >= Number(inv.total)) await db.query(`update invoices set status = 'paid' where id = $1`, [inv.id])
    else if (inv.status === 'draft') await db.query(`update invoices set status = 'sent' where id = $1`, [inv.id])
    await act(db, inv.client_id, shipperId, 'system', `Payment of $${b.amount.toLocaleString()} recorded on ${inv.number}${paid >= Number(inv.total) ? ' — paid in full.' : '.'}`)
    const [invoice] = await loadInvoices(db, 'id = $1', [inv.id])
    res.status(201).json({ invoice })
  }))
  /** One invoice with everything needed to render/print it. */
  r.get('/invoices/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await shipperOf(db, req)
    const [invoice] = await loadInvoices(db, 'id = $1 and shipper_id = $2', [req.params.id, shipperId])
    if (!invoice) throw new HttpError(404, 'Invoice not found.')
    const c = await ownClient(db, shipperId, invoice.clientId)
    const { rows: sh } = await db.query<Row>('select * from shippers where id = $1', [shipperId])
    const shipment = invoice.shipmentId ? (await loadShipments(db, 'id = $1', [invoice.shipmentId]))[0] : null
    res.json({ invoice, client: clientOut(c), shipper: { id: sh[0].id, name: sh[0].name, hq: sh[0].hq, initials: sh[0].initials, hue: sh[0].hue }, shipment })
  }))
}
