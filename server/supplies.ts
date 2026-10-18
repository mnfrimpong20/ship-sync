/**
 * Supplies — two separate things under one roof:
 *
 *   1. Equipment store (Ntemtem holds the stock). Label printers, barcode scanners, label rolls and kits.
 *      A shipping company can BUY an item, RENT it monthly, or get a kit INCLUDED with its plan (a free
 *      loan for as long as it stays on that plan). Stock is reserved when the order is placed and put back
 *      if the order is cancelled or a rental comes back. Kits draw their stock from the parts inside them.
 *        shipper   /dashboard/supplies → cart → Stripe Checkout (payment, or subscription when renting)
 *        admin     products, stock in, orders (paid → packed → shipped → delivered), rentals and returns
 *
 *   2. Packing supplies sold by each shipper (barrels, boxes, locks, tape). The shipper sets the list and
 *      prices; the sender adds them to a booked shipment and pays for them in the same protected payment
 *      as the freight (see payments.amountDue). The shipper brings them before pickup.
 *
 * Without a Stripe key, equipment orders wait as "awaiting payment" and Ntemtem marks them paid by hand.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'
import { effectivePlan, type Plan } from './features'
import { notify, notifyShipperStaff } from './notify'
import { stripe, stripeMode } from './payments'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const r2 = (n: number) => Math.round(n * 100) / 100
export const SHIP_FLAT_USD = 12
export const SHIP_FREE_OVER_USD = 150
const LIVE = ['paid', 'packed', 'shipped', 'delivered']

export type Category = 'printer' | 'scanner' | 'labels' | 'kit' | 'accessory'
export type Mode = 'buy' | 'rent' | 'included'

/* ------------------------------------------------------------------ stock */
type Parts = Map<string, number>
async function allProducts(db: Db) { const { rows } = await db.query<Row>('select * from supply_products'); return new Map(rows.map((p) => [p.id, p])) }
/** A product (or kit) → the stocked parts it uses. */
function partsOf(products: Map<string, Row>, id: string, qty: number, into: Parts = new Map()): Parts {
  const p = products.get(id); if (!p) return into
  const kit = J<{ productId: string; qty: number }[]>(p.kit, [])
  if (kit.length) for (const k of kit) partsOf(products, k.productId, k.qty * qty, into)
  else into.set(id, (into.get(id) ?? 0) + qty)
  return into
}
function available(products: Map<string, Row>, id: string): number {
  const p = products.get(id); if (!p) return 0
  const kit = J<{ productId: string; qty: number }[]>(p.kit, [])
  if (!kit.length) return Math.max(0, Number(p.stock))
  return Math.max(0, Math.min(...kit.map((k) => Math.floor(available(products, k.productId) / Math.max(1, k.qty)))))
}
async function move(db: Db, parts: Parts, sign: 1 | -1, reason: string, ref: string, by: string) {
  for (const [pid, n] of parts) {
    await db.query('update supply_products set stock = stock + $2, updated_at = now() where id = $1', [pid, sign * n])
    await db.query('insert into supply_stock_moves (id,product_id,delta,reason,ref,by_name) values ($1,$2,$3,$4,$5,$6)', ['mv_' + uid(), pid, sign * n, reason, ref, by])
  }
}

/* ------------------------------------------------------------------ shapes */
const productOut = (p: Row, products: Map<string, Row>) => {
  const avail = available(products, p.id)
  return {
    id: p.id, sku: p.sku, name: p.name, category: p.category as Category, blurb: p.blurb, specs: J<string[]>(p.specs, []),
    priceUsd: Number(p.price_usd), rentUsd: p.rent_usd == null ? null : Number(p.rent_usd), stock: Number(p.stock), available: avail,
    reorderLevel: Number(p.reorder_level), low: avail <= Number(p.reorder_level), labelsPerUnit: Number(p.labels_per_unit),
    kit: J<{ productId: string; qty: number }[]>(p.kit, []).map((k) => ({ ...k, name: products.get(k.productId)?.name ?? k.productId })),
    includedWith: J<Plan[]>(p.included_with, []), active: !!p.active, sort: Number(p.sort),
  }
}
const orderOut = (o: Row, items: Row[]) => ({
  id: o.id, ref: o.ref, shipperId: o.shipper_id, shipperName: o.shipper_name ?? undefined, placedBy: o.placed_by, status: o.status as 'awaiting_payment' | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled',
  provider: o.provider as 'stripe' | 'manual' | 'included', subtotalUsd: Number(o.subtotal_usd), shippingUsd: Number(o.shipping_usd), totalUsd: Number(o.total_usd), monthlyUsd: Number(o.monthly_usd),
  shipTo: J<Record<string, string>>(o.ship_to, {}), carrier: o.carrier, tracking: o.tracking, note: o.note,
  createdAt: ISO(o.created_at), paidAt: ISO(o.paid_at), shippedAt: ISO(o.shipped_at), deliveredAt: ISO(o.delivered_at), cancelledAt: ISO(o.cancelled_at),
  items: items.filter((i) => i.order_id === o.id).map((i) => ({ productId: i.product_id, name: i.name, qty: Number(i.qty), mode: i.mode as Mode, unitUsd: Number(i.unit_usd) })),
})
const rentalOut = (r: Row) => ({
  id: r.id, shipperId: r.shipper_id, shipperName: r.shipper_name ?? undefined, productId: r.product_id, productName: r.product_name ?? r.product_id, orderId: r.order_id, orderRef: r.order_ref ?? null,
  qty: Number(r.qty), mode: r.mode as 'rent' | 'included', monthlyUsd: Number(r.monthly_usd), status: r.status as 'pending' | 'active' | 'return_requested' | 'returned' | 'cancelled', note: r.note,
  startedAt: ISO(r.started_at), returnRequestedAt: ISO(r.return_requested_at), returnedAt: ISO(r.returned_at),
})
const RENTAL_SELECT = `select r.*, p.name as product_name, o.ref as order_ref, sh.name as shipper_name from supply_rentals r left join supply_products p on p.id = r.product_id left join supply_orders o on o.id = r.order_id join shippers sh on sh.id = r.shipper_id`
async function ordersWithItems(db: Db, where: string, params: unknown[]) {
  const { rows } = await db.query<Row>(`select o.*, sh.name as shipper_name from supply_orders o join shippers sh on sh.id = o.shipper_id ${where} order by o.created_at desc limit 300`, params)
  const ids = rows.map((o) => o.id)
  const { rows: items } = ids.length ? await db.query<Row>('select * from supply_order_items where order_id = any($1)', [ids]) : { rows: [] as Row[] }
  return rows.map((o) => orderOut(o, items))
}

/* ------------------------------------------------------------------ lifecycle */
export async function markOrderPaid(db: Db, o: Row, opts: { subscriptionId?: string | null; by?: string } = {}) {
  if (o.status !== 'awaiting_payment') return
  await db.query(`update supply_orders set status = 'paid', paid_at = now(), subscription_id = coalesce($2, subscription_id) where id = $1`, [o.id, opts.subscriptionId ?? null])
  await db.query(`update supply_rentals set status = 'active', started_at = now() where order_id = $1 and status = 'pending'`, [o.id])
  await notifyShipperStaff(db, o.shipper_id, { kind: 'payment', title: `Equipment order ${o.ref} confirmed`, body: `${Number(o.total_usd) > 0 ? `$${Number(o.total_usd).toLocaleString()} paid` : 'No charge today'}${Number(o.monthly_usd) > 0 ? ` · $${Number(o.monthly_usd).toLocaleString()}/month rental` : ''}. We’ll pack it and send tracking.`, link: '/dashboard/supplies', dedupe: `eq:${o.id}:paid` }, ['owner', 'finance', 'dispatcher'])
}
async function cancelOrder(db: Db, o: Row, by: string) {
  if (!['awaiting_payment', 'paid', 'packed'].includes(o.status)) throw new Error('This order has already been shipped.')
  const products = await allProducts(db)
  const { rows: items } = await db.query<Row>('select * from supply_order_items where order_id = $1', [o.id])
  const parts: Parts = new Map(); for (const i of items) partsOf(products, i.product_id, Number(i.qty), parts)
  await move(db, parts, 1, 'cancelled', o.ref, by)
  await db.query(`update supply_orders set status = 'cancelled', cancelled_at = now() where id = $1`, [o.id])
  await db.query(`update supply_rentals set status = 'cancelled' where order_id = $1 and status in ('pending','active')`, [o.id])
  if (o.subscription_id) await stripe(`/subscriptions/${encodeURIComponent(o.subscription_id)}`, undefined, 'DELETE').catch(() => {})
}
/** Kits included with a plan go back when the company leaves that plan. */
async function sweepIncluded(db: Db, shipperId?: string) {
  const { rows } = await db.query<Row>(`select r.id, r.shipper_id, p.included_with, sh.plan, sh.trial_ends_at, p.name from supply_rentals r join supply_products p on p.id = r.product_id join shippers sh on sh.id = r.shipper_id
    where r.mode = 'included' and r.status in ('pending','active') ${shipperId ? 'and r.shipper_id = $1' : ''}`, shipperId ? [shipperId] : [])
  for (const r of rows) {
    const billed = effectivePlan(r).billed
    if (!J<Plan[]>(r.included_with, []).includes(billed)) {
      await db.query(`update supply_rentals set status = 'return_requested', return_requested_at = now(), note = 'Your plan changed — please send this back, or keep it by renting it.' where id = $1`, [r.id])
      await notifyShipperStaff(db, r.shipper_id, { kind: 'system', title: `Please return the ${r.name}`, body: 'It came free with your plan. Send it back, or switch it to a monthly rental.', link: '/dashboard/supplies', dedupe: `eq:return:${r.id}` }, ['owner'])
    }
  }
}
async function labelOutlook(db: Db, shipperId: string) {
  const { rows: pr } = await db.query<Row>(`select count(*) filter (where pc.printed_at > now() - interval '30 days')::int as n30 from pieces pc join shipments s on s.id = pc.shipment_id where s.shipper_id = $1`, [shipperId])
  const { rows: bought } = await db.query<Row>(`select coalesce(sum(i.qty * p.labels_per_unit),0)::int as labels, min(o.paid_at) as first from supply_order_items i join supply_orders o on o.id = i.order_id join supply_products p on p.id = i.product_id
    where o.shipper_id = $1 and o.status = any($2) and p.labels_per_unit > 0`, [shipperId, LIVE])
  const n30 = Number(pr[0]?.n30 ?? 0), labels = Number(bought[0]?.labels ?? 0), perWeek = Math.round((n30 / 30) * 7)
  let remaining: number | null = null
  if (labels > 0 && bought[0]?.first) {
    const { rows } = await db.query<Row>(`select count(*)::int as n from pieces pc join shipments s on s.id = pc.shipment_id where s.shipper_id = $1 and pc.printed_at >= $2`, [shipperId, bought[0].first])
    remaining = Math.max(0, labels - Number(rows[0]?.n ?? 0))
  }
  const weeksLeft = remaining != null && perWeek > 0 ? Math.round((remaining / perWeek) * 10) / 10 : null
  return { printed30: n30, perWeek, remaining, weeksLeft, reorder: (weeksLeft != null && weeksLeft < 3) || (remaining == null && n30 > 0) }
}

/* ------------------------------------------------------------------ webhook */
/** Called from the Stripe webhook before billing; true when the event belonged to an equipment order. */
export async function handleSuppliesEvent(db: Db, evt: Row): Promise<boolean> {
  const obj: Row = evt.data?.object ?? {}
  const ref = String(obj.client_reference_id ?? '')
  const mine = ref.startsWith('eq:') || obj.metadata?.kind === 'supply_order'
  if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && mine) {
    const id = ref.startsWith('eq:') ? ref.slice(3) : String(obj.metadata?.order_id ?? '')
    const { rows } = await db.query<Row>('select * from supply_orders where id = $1 or session_id = $2', [id, obj.id ?? ''])
    if (rows[0] && (obj.payment_status === 'paid' || (obj.mode === 'subscription' && obj.status === 'complete'))) await markOrderPaid(db, rows[0], { subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null })
    return true
  }
  if (evt.type === 'checkout.session.expired' && mine) {
    const { rows } = await db.query<Row>(`select * from supply_orders where session_id = $1 and status = 'awaiting_payment'`, [obj.id ?? ''])
    if (rows[0]) await cancelOrder(db, rows[0], 'Checkout expired')
    return true
  }
  if (evt.type === 'customer.subscription.deleted') {
    const { rows } = await db.query<Row>('select * from supply_orders where subscription_id = $1', [obj.id ?? ''])
    if (!rows[0]) return false
    await db.query(`update supply_rentals set status = 'return_requested', return_requested_at = now(), note = 'The rental subscription ended — please send the equipment back.' where order_id = $1 and status = 'active'`, [rows[0].id])
    await notifyShipperStaff(db, rows[0].shipper_id, { kind: 'system', title: `Rental ended on ${rows[0].ref}`, body: 'Please send the rented equipment back to Ntemtem.', link: '/dashboard/supplies', dedupe: `eq:${rows[0].id}:subend` }, ['owner'])
    return true
  }
  return false
}

/* ------------------------------------------------------------------ packing supplies on a shipment (used by payments) */
export async function dueSupplies(db: Db, shipmentId: string) {
  const { rows } = await db.query<Row>(`select * from shipment_supplies where shipment_id = $1 and status = 'due' order by created_at`, [shipmentId])
  return rows.map((l) => ({ description: `${l.qty} × ${l.name} — brought before pickup`, amountUsd: r2(Number(l.qty) * Number(l.unit_usd)), kind: 'supplies' as const, ref: l.id as string }))
}
export async function markSuppliesPaid(db: Db, items: { kind?: string; ref?: string }[]) {
  const ids = items.filter((i) => i.kind === 'supplies' && i.ref).map((i) => i.ref!)
  if (ids.length) await db.query(`update shipment_supplies set status = 'paid' where id = any($1) and status = 'due'`, [ids])
}

/* ------------------------------------------------------------------ seed */
const CATALOG: Row[] = [
  { id: 'eq-printer', sku: 'NT-PRN-46', name: '4×6 thermal label printer', category: 'printer', blurb: 'Prints Ntemtem piece stickers and shipping labels. No ink — ever.', specs: ['Direct thermal, 203 dpi', 'USB and Wi-Fi', 'Up to 150 mm/s', 'Prints from the browser'], price: 249, rent: 15, stock: 24, reorder: 5, sort: 1 },
  { id: 'eq-scanner', sku: 'NT-SCN-BT', name: 'Wireless barcode scanner', category: 'scanner', blurb: 'Scan stickers at the warehouse, the container door and the doorstep.', specs: ['Bluetooth and USB', 'Reads QR and barcodes', '30 m range', 'Works like a keyboard — no setup'], price: 89, rent: 6, stock: 40, reorder: 8, sort: 2 },
  { id: 'eq-scanner-rugged', sku: 'NT-SCN-RG', name: 'Rugged scanner with stand', category: 'scanner', blurb: 'For busy loading days — survives drops onto concrete.', specs: ['IP65, 1.8 m drop rated', 'Hands-free stand', 'Reads damaged or creased labels', 'Charging cradle'], price: 179, rent: 10, stock: 14, reorder: 4, sort: 3 },
  { id: 'eq-labels-roll', sku: 'NT-LBL-500', name: '4×6 thermal labels — roll of 500', category: 'labels', blurb: 'Weather-resistant stickers that stay on barrels in a wet container.', specs: ['500 labels per roll', 'Strong freezer-grade adhesive', 'Fits every printer we sell'], price: 18, rent: null, stock: 180, reorder: 40, labels: 500, sort: 4 },
  { id: 'eq-labels-case', sku: 'NT-LBL-3K', name: '4×6 thermal labels — case of 6 rolls', category: 'labels', blurb: 'Six rolls for busy months — the best price per label.', specs: ['3,000 labels', 'Same adhesive as the single roll'], price: 96, rent: null, stock: 36, reorder: 8, labels: 3000, sort: 5 },
  { id: 'eq-kit-starter', sku: 'NT-KIT-ST', name: 'Starter kit', category: 'kit', blurb: 'Everything a small team needs to sticker and scan from day one.', specs: ['1 label printer', '1 wireless scanner', '2 rolls of labels (1,000)'], price: 339, rent: 19, kit: [{ productId: 'eq-printer', qty: 1 }, { productId: 'eq-scanner', qty: 1 }, { productId: 'eq-labels-roll', qty: 2 }], included: ['pro', 'enterprise'], labels: 1000, sort: 0 },
  { id: 'eq-kit-warehouse', sku: 'NT-KIT-WH', name: 'Warehouse kit', category: 'kit', blurb: 'For warehouses loading several containers a month.', specs: ['1 label printer', '3 rugged scanners with stands', '1 case of labels (3,000)'], price: 749, rent: 45, kit: [{ productId: 'eq-printer', qty: 1 }, { productId: 'eq-scanner-rugged', qty: 3 }, { productId: 'eq-labels-case', qty: 1 }], included: ['enterprise'], labels: 3000, sort: 0.5 },
]
const PACKING: [string, string, string, number][] = [
  ['Blue drum barrel (55 gal)', 'barrel', 'Food-safe plastic drum with a lid', 45],
  ['Barrel lock ring & seal', 'lock', 'Steel ring with a numbered seal', 9],
  ['Large moving box', 'box', '24 × 18 × 18 in, double wall', 7],
  ['Heavy-duty packing tape', 'tape', '3 rolls', 6],
]
export async function seedSupplies(db: Db) {
  const { rows: have } = await db.query<Row>('select count(*)::int as n from supply_products')
  if (!Number(have[0]?.n)) for (const p of CATALOG) await db.query(`insert into supply_products (id,sku,name,category,blurb,specs,price_usd,rent_usd,stock,reorder_level,labels_per_unit,kit,included_with,sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [p.id, p.sku, p.name, p.category, p.blurb, JSON.stringify(p.specs), p.price, p.rent, p.stock ?? 0, p.reorder ?? 0, p.labels ?? 0, JSON.stringify(p.kit ?? []), JSON.stringify(p.included ?? []), Math.round((p.sort ?? 0) * 10)])
  const { rows: flag } = await db.query<Row>(`select 1 from settings where id = 'seed:supplies'`)
  if (flag.length) return
  const { rows: demo } = await db.query<Row>(`select id from shippers where demo order by id`)
  for (const [n, sh] of demo.entries()) {
    const { rows: has } = await db.query<Row>('select 1 from shipper_supplies where shipper_id = $1 limit 1', [sh.id]); if (has.length) continue
    for (const [k, [name, kind, note, price]] of PACKING.entries()) await db.query('insert into shipper_supplies (id,shipper_id,name,kind,note,price_usd,sort) values ($1,$2,$3,$4,$5,$6,$7)', ['ps_' + uid(), sh.id, name, kind, note, price + ((n * 3 + k) % 4) * (kind === 'barrel' ? 2.5 : 0.5), k])
  }
  // A demo history for Gold Coast Freight: the Pro starter kit on loan, and a delivered labels order.
  const { rows: gc } = await db.query<Row>(`select id from shippers where id = 'gold-coast-freight'`)
  if (gc[0]) {
    const products = await allProducts(db)
    const mk = async (ref: string, status: string, provider: string, items: [string, number, Mode, number][], daysAgo: number, tracking = '') => {
      if ((await db.query<Row>('select 1 from supply_orders where ref = $1', [ref])).rows.length) return
      const id = 'eqo_' + uid(); const sub = items.filter((i) => i[2] === 'buy').reduce((a, i) => a + i[1] * i[3], 0); const ship = sub > 0 && sub < SHIP_FREE_OVER_USD ? SHIP_FLAT_USD : 0
      const at = new Date(Date.now() - daysAgo * 86400000)
      await db.query(`insert into supply_orders (id,ref,shipper_id,placed_by,status,provider,subtotal_usd,shipping_usd,total_usd,monthly_usd,ship_to,carrier,tracking,created_at,paid_at,shipped_at,delivered_at) values ($1,$2,'gold-coast-freight','Nana Boateng',$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$11,$12,$13)`,
        [id, ref, status, provider, sub, ship, sub + ship, JSON.stringify({ name: 'Nana Boateng', company: 'Gold Coast Freight', line1: '1200 Industrial Blvd', city: 'Houston', state: 'TX', zip: '77032', country: 'US', phone: '' }), tracking ? 'UPS' : '', tracking, at, ['shipped', 'delivered'].includes(status) ? new Date(at.getTime() + 86400000) : null, status === 'delivered' ? new Date(at.getTime() + 3 * 86400000) : null])
      const parts: Parts = new Map()
      for (const [pid, qty, mode, unit] of items) {
        await db.query('insert into supply_order_items (id,order_id,product_id,name,qty,mode,unit_usd) values ($1,$2,$3,$4,$5,$6,$7)', ['eqi_' + uid(), id, pid, products.get(pid)?.name ?? pid, qty, mode, unit])
        if (mode !== 'buy') await db.query(`insert into supply_rentals (id,shipper_id,product_id,order_id,qty,mode,monthly_usd,status,started_at) values ($1,'gold-coast-freight',$2,$3,$4,$5,$6,'active',$7)`, ['eqr_' + uid(), pid, id, qty, mode, mode === 'rent' ? unit : 0, at])
        partsOf(products, pid, qty, parts)
      }
      await move(db, parts, -1, 'order', ref, 'Demo')
    }
    await mk('EQ-10421', 'delivered', 'included', [['eq-kit-starter', 1, 'included', 0]], 48, '1Z84A2W90311204417')
    await mk('EQ-10587', 'shipped', 'stripe', [['eq-labels-roll', 4, 'buy', 18], ['eq-scanner', 1, 'buy', 89]], 3, '1Z84A2W90311288152')
  }
  await db.query(`insert into settings (id,value) values ('seed:supplies','true') on conflict (id) do nothing`)
}

/* ------------------------------------------------------------------ routes */
const zAddress = z.object({ name: z.string().trim().min(2).max(80), company: z.string().trim().max(120).default(''), line1: z.string().trim().min(3).max(160), line2: z.string().trim().max(160).default(''), city: z.string().trim().min(2).max(80), state: z.string().trim().max(40).default(''), zip: z.string().trim().max(20).default(''), country: z.string().trim().min(2).max(40), phone: z.string().trim().max(40).default('') })
const zCheckout = z.object({ items: z.array(z.object({ productId: z.string().max(60), qty: z.number().int().min(1).max(50), mode: z.enum(['buy', 'rent', 'included']) })).min(1).max(20), shipTo: zAddress, note: z.string().trim().max(400).default('') })
const zProduct = z.object({ name: z.string().trim().min(2).max(120), sku: z.string().trim().max(40).default(''), category: z.enum(['printer', 'scanner', 'labels', 'kit', 'accessory']), blurb: z.string().trim().max(300).default(''), specs: z.array(z.string().trim().max(120)).max(10).default([]), priceUsd: z.number().min(0).max(100000), rentUsd: z.number().min(0).max(10000).nullable().default(null), reorderLevel: z.number().int().min(0).max(100000).default(5), labelsPerUnit: z.number().int().min(0).max(100000).default(0), kit: z.array(z.object({ productId: z.string().max(60), qty: z.number().int().min(1).max(100) })).max(10).default([]), includedWith: z.array(z.enum(['starter', 'pro', 'enterprise'])).default([]), active: z.boolean().default(true), sort: z.number().int().min(0).max(1000).default(50) })
const zPacking = z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(['barrel', 'box', 'lock', 'tape', 'other']).default('other'), note: z.string().trim().max(160).default(''), priceUsd: z.number().min(0.5).max(5000), active: z.boolean().default(true) })

export function mountSupplies(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const staff = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'For shipping companies only.'); if (u.staffRole === 'driver') throw new HttpError(403, 'Ask your office to order equipment.'); return u }
  const canOrder = (u: ApiUser) => can(u, 'payments')
  const fail = (e: unknown, code = 409) => new HttpError(code, e instanceof Error ? e.message : 'Something went wrong.')

  /* ---- equipment: public catalogue (marketing page) ---- */
  r.get('/supplies/catalog', wrap(async (_req, res) => {
    const db = await getDb(); const products = await allProducts(db)
    const list = [...products.values()].filter((p) => p.active).sort((a, b) => Number(a.sort) - Number(b.sort)).map((p) => { const o = productOut(p, products); return { id: o.id, name: o.name, category: o.category, blurb: o.blurb, specs: o.specs, priceUsd: o.priceUsd, rentUsd: o.rentUsd, includedWith: o.includedWith } })
    res.set('Cache-Control', 'public, max-age=300'); res.json({ products: list })
  }))

  /* ---- equipment: shipping company ---- */
  r.get('/supplies', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    await sweepIncluded(db, u.shipperId)
    const products = await allProducts(db)
    const { rows: sh } = await db.query<Row>('select plan, trial_ends_at from shippers where id = $1', [u.shipperId]); const plan = effectivePlan(sh[0] ?? {})
    const { rows: rent } = await db.query<Row>(`${RENTAL_SELECT} where r.shipper_id = $1 and r.status <> 'cancelled' order by r.created_at desc`, [u.shipperId])
    const claimed = new Set(rent.filter((x) => x.mode === 'included' && ['pending', 'active', 'return_requested'].includes(x.status)).map((x) => x.product_id))
    const list = [...products.values()].filter((p) => p.active).sort((a, b) => Number(a.sort) - Number(b.sort)).map((p) => {
      const o = productOut(p, products)
      return { ...o, includedNow: o.includedWith.includes(plan.billed) && !claimed.has(p.id), includedClaimed: claimed.has(p.id) }
    })
    res.set('Cache-Control', 'no-store')
    res.json({
      products: list, plan: { plan: plan.billed, trial: plan.trial }, online: stripeMode() !== 'off', mode: stripeMode(), canOrder: canOrder(u),
      shipping: { flatUsd: SHIP_FLAT_USD, freeOverUsd: SHIP_FREE_OVER_USD },
      orders: await ordersWithItems(db, 'where o.shipper_id = $1', [u.shipperId]), rentals: rent.map(rentalOut), labels: await labelOutlook(db, u.shipperId!),
    })
  }))

  r.post('/supplies/checkout', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); if (!canOrder(u)) throw new HttpError(403, 'Ask the account owner or finance to place equipment orders.')
    const b = zCheckout.parse(req.body)
    const products = await allProducts(db)
    const { rows: sh } = await db.query<Row>('select id, name, plan, trial_ends_at from shippers where id = $1', [u.shipperId]); const plan = effectivePlan(sh[0] ?? {}).billed
    const { rows: claimedRows } = await db.query<Row>(`select product_id from supply_rentals where shipper_id = $1 and mode = 'included' and status in ('pending','active','return_requested')`, [u.shipperId])
    const claimed = new Set(claimedRows.map((x) => x.product_id))
    const lines: { p: Row; qty: number; mode: Mode; unit: number }[] = []
    for (const it of b.items) {
      const p = products.get(it.productId); if (!p || !p.active) throw new HttpError(404, 'One of the items is no longer sold.')
      if (it.mode === 'rent' && p.rent_usd == null) throw new HttpError(400, `${p.name} can only be bought.`)
      if (it.mode === 'included') {
        if (!J<Plan[]>(p.included_with, []).includes(plan)) throw new HttpError(403, `${p.name} isn’t included with your plan.`)
        if (claimed.has(p.id) || it.qty !== 1 || b.items.filter((x) => x.productId === p.id && x.mode === 'included').length > 1) throw new HttpError(409, `Your plan includes one ${p.name}, and you already have it.`)
      }
      lines.push({ p, qty: it.qty, mode: it.mode, unit: it.mode === 'buy' ? Number(p.price_usd) : it.mode === 'rent' ? Number(p.rent_usd) : 0 })
    }
    const parts: Parts = new Map(); for (const l of lines) partsOf(products, l.p.id, l.qty, parts)
    for (const [pid, n] of parts) if (Number(products.get(pid)?.stock ?? 0) < n) throw new HttpError(409, `Not enough ${products.get(pid)?.name ?? 'stock'} left — ${Math.max(0, Number(products.get(pid)?.stock ?? 0))} available.`)
    const subtotal = r2(lines.filter((l) => l.mode === 'buy').reduce((a, l) => a + l.unit * l.qty, 0))
    const shipping = subtotal > 0 && subtotal < SHIP_FREE_OVER_USD ? SHIP_FLAT_USD : 0
    const total = r2(subtotal + shipping), monthly = r2(lines.filter((l) => l.mode === 'rent').reduce((a, l) => a + l.unit * l.qty, 0))
    const free = total === 0 && monthly === 0
    const online = stripeMode() !== 'off'
    const id = 'eqo_' + uid(), ref = 'EQ-' + String(10000 + Math.floor(Math.random() * 89999))
    await move(db, parts, -1, 'order', ref, u.name)
    await db.query(`insert into supply_orders (id,ref,shipper_id,user_id,placed_by,status,provider,subtotal_usd,shipping_usd,total_usd,monthly_usd,ship_to,note) values ($1,$2,$3,$4,$5,'awaiting_payment',$6,$7,$8,$9,$10,$11,$12)`,
      [id, ref, u.shipperId, u.id, u.name, free ? 'included' : online ? 'stripe' : 'manual', subtotal, shipping, total, monthly, JSON.stringify(b.shipTo), b.note])
    for (const l of lines) {
      await db.query('insert into supply_order_items (id,order_id,product_id,name,qty,mode,unit_usd) values ($1,$2,$3,$4,$5,$6,$7)', ['eqi_' + uid(), id, l.p.id, l.p.name, l.qty, l.mode, l.unit])
      if (l.mode !== 'buy') await db.query('insert into supply_rentals (id,shipper_id,product_id,order_id,qty,mode,monthly_usd) values ($1,$2,$3,$4,$5,$6,$7)', ['eqr_' + uid(), u.shipperId, l.p.id, id, l.qty, l.mode, l.mode === 'rent' ? l.unit * l.qty : 0])
    }
    const { rows: o } = await db.query<Row>('select * from supply_orders where id = $1', [id])
    if (free) { await markOrderPaid(db, o[0], { by: u.name }); return res.status(201).json({ orderId: id, ref, url: null, status: 'paid' }) }
    if (!online) return res.status(201).json({ orderId: id, ref, url: null, status: 'awaiting_payment' })
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const items: Row[] = lines.filter((l) => l.mode !== 'included').map((l) => ({ quantity: l.qty, price_data: { currency: 'usd', unit_amount: Math.round(l.unit * 100), product_data: { name: l.mode === 'rent' ? `${l.p.name} — monthly rental` : l.p.name }, ...(l.mode === 'rent' ? { recurring: { interval: 'month' } } : {}) } }))
    if (shipping) items.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: shipping * 100, product_data: { name: 'Shipping' } } })
    try {
      const session = await stripe<Row>('/checkout/sessions', {
        mode: monthly > 0 ? 'subscription' : 'payment', client_reference_id: `eq:${id}`, customer_email: u.email || undefined,
        success_url: `${base}/#/dashboard/supplies?order=${id}&paid=1`, cancel_url: `${base}/#/dashboard/supplies?order=${id}&paid=cancel`,
        metadata: { kind: 'supply_order', order_id: id, order_ref: ref, shipper_id: u.shipperId }, line_items: items,
        ...(monthly > 0 ? { subscription_data: { metadata: { kind: 'supply_order', order_id: id } } } : { payment_intent_data: { description: `Ntemtem equipment ${ref}`, metadata: { order_id: id } } }),
      })
      await db.query('update supply_orders set session_id = $2 where id = $1', [id, session.id])
      res.status(201).json({ orderId: id, ref, url: session.url, status: 'awaiting_payment' })
    } catch (e) { await cancelOrder(db, o[0], 'Checkout failed').catch(() => {}); throw fail(e, 502) }
  }))

  r.post('/supplies/orders/:id/verify', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const { rows } = await db.query<Row>('select * from supply_orders where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const o = rows[0]; if (!o) throw new HttpError(404, 'Order not found.')
    if (o.status === 'awaiting_payment' && o.session_id && stripeMode() !== 'off') {
      const s = await stripe<Row>(`/checkout/sessions/${encodeURIComponent(o.session_id)}`)
      if (s.payment_status === 'paid' || (s.mode === 'subscription' && s.status === 'complete')) await markOrderPaid(db, o, { subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null })
    }
    res.json({ order: (await ordersWithItems(db, 'where o.id = $1', [o.id]))[0] })
  }))
  r.post('/supplies/orders/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); if (!canOrder(u)) throw new HttpError(403, 'Ask the account owner or finance.')
    const { rows } = await db.query<Row>('select * from supply_orders where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const o = rows[0]; if (!o) throw new HttpError(404, 'Order not found.')
    if (o.status !== 'awaiting_payment') throw new HttpError(409, 'This order is paid — contact Ntemtem to change it.')
    await cancelOrder(db, o, u.name).catch((e) => { throw fail(e) }); res.json({ ok: true })
  }))
  r.post('/supplies/rentals/:id/return', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); if (!canOrder(u)) throw new HttpError(403, 'Ask the account owner or finance.')
    const { rows } = await db.query<Row>(`update supply_rentals set status = 'return_requested', return_requested_at = now(), note = 'Return requested — Ntemtem will email a prepaid return label.' where id = $1 and shipper_id = $2 and status = 'active' returning id`, [String(req.params.id), u.shipperId])
    if (!rows[0]) throw new HttpError(409, 'This equipment isn’t out on rental.')
    res.json({ ok: true })
  }))

  /* ---- equipment: Ntemtem admin ---- */
  r.get('/admin/supplies', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    await sweepIncluded(db)
    const products = await allProducts(db)
    const { rows: rent } = await db.query<Row>(`${RENTAL_SELECT} where r.status <> 'cancelled' and (r.status <> 'returned' or r.returned_at > now() - interval '60 days') order by (r.status = 'return_requested') desc, r.created_at desc limit 300`)
    const { rows: m } = await db.query<Row>(`select coalesce(sum(total_usd) filter (where status = any($1) and paid_at >= date_trunc('month', now())),0)::float as sales from supply_orders`, [LIVE])
    const orders = await ordersWithItems(db, '', [])
    const list = [...products.values()].sort((a, b) => Number(a.sort) - Number(b.sort)).map((p) => productOut(p, products))
    const { rows: moves } = await db.query<Row>(`select m.*, p.name from supply_stock_moves m left join supply_products p on p.id = m.product_id order by m.at desc limit 60`)
    res.set('Cache-Control', 'no-store')
    res.json({
      products: list, orders, rentals: rent.map(rentalOut),
      moves: moves.map((x) => ({ productName: x.name ?? x.product_id, delta: Number(x.delta), reason: x.reason, ref: x.ref, by: x.by_name, at: ISO(x.at) })),
      stats: { salesMonthUsd: r2(Number(m[0]?.sales ?? 0)), rentalMrrUsd: r2(rent.filter((x) => x.status === 'active' && x.mode === 'rent').reduce((a, x) => a + Number(x.monthly_usd), 0)), openOrders: orders.filter((o) => ['awaiting_payment', 'paid', 'packed'].includes(o.status)).length, lowStock: list.filter((p) => p.active && !p.kit.length && p.low).length, returnsDue: rent.filter((x) => x.status === 'return_requested').length },
    })
  }))
  const saveProduct = async (db: Db, id: string, b: z.infer<typeof zProduct>, create: boolean) => {
    const vals = [id, b.sku, b.name, b.category, b.blurb, JSON.stringify(b.specs), b.priceUsd, b.rentUsd, b.reorderLevel, b.labelsPerUnit, JSON.stringify(b.kit), JSON.stringify(b.includedWith), b.active, b.sort]
    if (create) await db.query(`insert into supply_products (id,sku,name,category,blurb,specs,price_usd,rent_usd,reorder_level,labels_per_unit,kit,included_with,active,sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, vals)
    else await db.query(`update supply_products set sku=$2,name=$3,category=$4,blurb=$5,specs=$6,price_usd=$7,rent_usd=$8,reorder_level=$9,labels_per_unit=$10,kit=$11,included_with=$12,active=$13,sort=$14,updated_at=now() where id=$1`, vals)
  }
  r.post('/admin/supplies/products', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zProduct.parse(req.body); const id = 'eq-' + uid()
    await saveProduct(db, id, b, true); res.status(201).json({ id })
  }))
  r.patch('/admin/supplies/products/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const id = String(req.params.id)
    const { rows } = await db.query<Row>('select id from supply_products where id = $1', [id]); if (!rows[0]) throw new HttpError(404, 'Product not found.')
    const b = zProduct.parse(req.body); if (b.kit.some((k) => k.productId === id)) throw new HttpError(400, 'A kit can’t contain itself.')
    await saveProduct(db, id, b, false); res.json({ ok: true })
  }))
  r.post('/admin/supplies/products/:id/stock', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireAdmin(db, req)
    const b = z.object({ delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, 'Enter how many.'), note: z.string().trim().max(120).default('') }).parse(req.body)
    const { rows } = await db.query<Row>('select * from supply_products where id = $1', [String(req.params.id)]); const p = rows[0]; if (!p) throw new HttpError(404, 'Product not found.')
    if (J<unknown[]>(p.kit, []).length) throw new HttpError(400, 'Kits use the stock of their parts — add stock to the parts instead.')
    if (Number(p.stock) + b.delta < 0) throw new HttpError(409, `Only ${p.stock} in stock.`)
    await move(db, new Map([[p.id, Math.abs(b.delta)]]), b.delta > 0 ? 1 : -1, b.delta > 0 ? 'received' : 'adjusted', b.note, u.name)
    res.json({ ok: true })
  }))
  r.patch('/admin/supplies/orders/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireAdmin(db, req)
    const b = z.object({ action: z.enum(['paid', 'packed', 'shipped', 'delivered', 'cancel']), carrier: z.string().trim().max(40).default(''), tracking: z.string().trim().max(80).default('') }).parse(req.body)
    const { rows } = await db.query<Row>('select * from supply_orders where id = $1', [String(req.params.id)]); const o = rows[0]; if (!o) throw new HttpError(404, 'Order not found.')
    const next: Record<string, string[]> = { paid: ['awaiting_payment'], packed: ['paid'], shipped: ['paid', 'packed'], delivered: ['shipped'], cancel: ['awaiting_payment', 'paid', 'packed'] }
    if (!next[b.action].includes(o.status)) throw new HttpError(409, `Can’t mark a ${o.status.replace('_', ' ')} order as ${b.action}.`)
    if (b.action === 'paid') await markOrderPaid(db, o, { by: u.name })
    else if (b.action === 'cancel') await cancelOrder(db, o, u.name).catch((e) => { throw fail(e) })
    else if (b.action === 'packed') await db.query(`update supply_orders set status = 'packed' where id = $1`, [o.id])
    else if (b.action === 'shipped') {
      if (!b.tracking) throw new HttpError(400, 'Add the tracking number.')
      await db.query(`update supply_orders set status = 'shipped', shipped_at = now(), carrier = $2, tracking = $3 where id = $1`, [o.id, b.carrier, b.tracking])
      await notifyShipperStaff(db, o.shipper_id, { kind: 'system', title: `Your equipment order ${o.ref} is on its way`, body: `${b.carrier || 'Carrier'} tracking ${b.tracking}.`, link: '/dashboard/supplies', dedupe: `eq:${o.id}:shipped` }, ['owner', 'finance', 'dispatcher', 'warehouse'])
    } else if (b.action === 'delivered') await db.query(`update supply_orders set status = 'delivered', delivered_at = now() where id = $1`, [o.id])
    res.json({ ok: true })
  }))
  r.patch('/admin/supplies/rentals/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireAdmin(db, req)
    const b = z.object({ action: z.enum(['returned', 'keep']) }).parse(req.body)
    const { rows } = await db.query<Row>('select r.*, o.subscription_id, o.ref from supply_rentals r left join supply_orders o on o.id = r.order_id where r.id = $1', [String(req.params.id)]); const x = rows[0]; if (!x) throw new HttpError(404, 'Rental not found.')
    if (b.action === 'keep') { if (x.status !== 'return_requested') throw new HttpError(409, 'Nothing to undo.'); await db.query(`update supply_rentals set status = 'active', return_requested_at = null, note = '' where id = $1`, [x.id]); return res.json({ ok: true }) }
    if (!['active', 'return_requested'].includes(x.status)) throw new HttpError(409, 'This equipment isn’t out.')
    await move(db, partsOf(await allProducts(db), x.product_id, Number(x.qty)), 1, 'returned', x.ref ?? '', u.name)
    await db.query(`update supply_rentals set status = 'returned', returned_at = now() where id = $1`, [x.id])
    if (x.subscription_id) {
      const { rows: left } = await db.query<Row>(`select 1 from supply_rentals where order_id = $1 and mode = 'rent' and status in ('active','return_requested')`, [x.order_id])
      if (!left.length) await stripe(`/subscriptions/${encodeURIComponent(x.subscription_id)}`, undefined, 'DELETE').catch(() => {})
    }
    await notifyShipperStaff(db, x.shipper_id, { kind: 'system', title: 'Returned equipment received', body: 'Thanks — we’ve checked it back in.', link: '/dashboard/supplies', dedupe: `eq:ret:${x.id}` }, ['owner'])
    res.json({ ok: true })
  }))

  /* ---- packing supplies sold by a shipper ---- */
  const packingOut = (p: Row) => ({ id: p.id, name: p.name, kind: p.kind as 'barrel' | 'box' | 'lock' | 'tape' | 'other', note: p.note, priceUsd: Number(p.price_usd), active: !!p.active })
  r.get('/shippers/:id/supplies', wrap(async (req, res) => {
    const db = await getDb(); const { rows } = await db.query<Row>('select * from shipper_supplies where shipper_id = $1 and active order by sort, created_at', [String(req.params.id)])
    res.set('Cache-Control', 'public, max-age=120'); res.json({ supplies: rows.map(packingOut) })
  }))
  const office = async (db: Db, req: Request) => { const u = await staff(db, req); if (!can(u, 'rates')) throw new HttpError(403, 'Ask someone who manages your prices.'); return u }
  r.get('/shipper/packing-supplies', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const { rows } = await db.query<Row>('select * from shipper_supplies where shipper_id = $1 order by sort, created_at', [u.shipperId])
    const { rows: sold } = await db.query<Row>(`select coalesce(sum(l.qty * l.unit_usd),0)::float as v, coalesce(sum(l.qty),0)::int as n from shipment_supplies l join shipments s on s.id = l.shipment_id where s.shipper_id = $1 and l.status = 'paid' and l.created_at > now() - interval '90 days'`, [u.shipperId])
    const { rows: due } = await db.query<Row>(`select l.*, s.ref, s.customer from shipment_supplies l join shipments s on s.id = l.shipment_id where s.shipper_id = $1 and l.status <> 'cancelled' and s.status = 'booked' order by l.created_at desc limit 50`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ supplies: rows.map(packingOut), canEdit: can(u, 'rates'), sold90: { valueUsd: r2(Number(sold[0]?.v ?? 0)), units: Number(sold[0]?.n ?? 0) }, toDeliver: due.map((l) => ({ id: l.id, shipmentId: l.shipment_id, ref: l.ref, customer: l.customer, name: l.name, qty: Number(l.qty), status: l.status as 'due' | 'paid' })) })
  }))
  r.post('/shipper/packing-supplies', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zPacking.parse(req.body)
    const { rows } = await db.query<Row>('select count(*)::int as n from shipper_supplies where shipper_id = $1', [u.shipperId]); if (Number(rows[0]?.n) >= 30) throw new HttpError(409, 'You can list up to 30 items.')
    const id = 'ps_' + uid(); await db.query('insert into shipper_supplies (id,shipper_id,name,kind,note,price_usd,active,sort) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, u.shipperId, b.name, b.kind, b.note, b.priceUsd, b.active, Number(rows[0]?.n ?? 0)])
    res.status(201).json({ id })
  }))
  r.patch('/shipper/packing-supplies/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zPacking.parse(req.body)
    const { rows } = await db.query<Row>('update shipper_supplies set name=$3, kind=$4, note=$5, price_usd=$6, active=$7 where id = $1 and shipper_id = $2 returning id', [String(req.params.id), u.shipperId, b.name, b.kind, b.note, b.priceUsd, b.active])
    if (!rows[0]) throw new HttpError(404, 'Item not found.'); res.json({ ok: true })
  }))
  r.delete('/shipper/packing-supplies/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    await db.query('delete from shipper_supplies where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); res.json({ ok: true })
  }))

  /* ---- packing supplies on a booked shipment ---- */
  const access = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const isOffice = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!isOffice && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    const { rows: pay } = await db.query<Row>(`select 1 from escrow_payments where shipment_id = $1 and status in ('held','released','paid_out','direct') limit 1`, [s.id])
    const editable = (isOffice || owner) && !pay.length && s.status === 'booked'
    return { u, s, isOffice, owner, editable }
  }
  const lineOut = (l: Row) => ({ id: l.id, supplyId: l.supply_id, name: l.name, qty: Number(l.qty), unitUsd: Number(l.unit_usd), status: l.status as 'due' | 'paid', addedBy: l.added_by })
  const view = async (db: Db, s: Row, editable: boolean, isOffice: boolean) => {
    const { rows: cat } = await db.query<Row>('select * from shipper_supplies where shipper_id = $1 and active order by sort, created_at', [s.shipper_id])
    const { rows: lines } = await db.query<Row>(`select * from shipment_supplies where shipment_id = $1 and status <> 'cancelled' order by created_at`, [s.id])
    return { catalog: cat.map(packingOut), lines: lines.map(lineOut), editable, isOffice }
  }
  r.get('/shipments/:id/supplies', wrap(async (req, res) => {
    const db = await getDb(); const { s, editable, isOffice } = await access(db, req)
    res.set('Cache-Control', 'no-store'); res.json(await view(db, s, editable, isOffice))
  }))
  r.post('/shipments/:id/supplies', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, editable, isOffice, owner } = await access(db, req)
    if (!editable) throw new HttpError(409, 'Supplies can only be added before pickup, while the shipment is unpaid.')
    const b = z.object({ supplyId: z.string().max(60), qty: z.number().int().min(1).max(50) }).parse(req.body)
    const { rows } = await db.query<Row>('select * from shipper_supplies where id = $1 and shipper_id = $2 and active', [b.supplyId, s.shipper_id]); const it = rows[0]; if (!it) throw new HttpError(404, 'That item isn’t available.')
    const { rows: ex } = await db.query<Row>(`select id, qty from shipment_supplies where shipment_id = $1 and supply_id = $2 and status = 'due'`, [s.id, it.id])
    if (ex[0]) await db.query('update shipment_supplies set qty = least(qty + $2, 50) where id = $1', [ex[0].id, b.qty])
    else await db.query(`insert into shipment_supplies (id,shipment_id,supply_id,name,qty,unit_usd,added_by) values ($1,$2,$3,$4,$5,$6,$7)`, ['ssl_' + uid(), s.id, it.id, it.name, b.qty, Number(it.price_usd), owner ? 'customer' : u.name])
    if (owner) await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.customer} added ${b.qty} × ${it.name} to ${s.ref}`, body: 'Bring them before the pickup. They’re paid with the shipment.', link: '/dashboard/supplies?tab=packing' }, ['owner', 'dispatcher', 'agent', 'warehouse'])
    else if (isOffice && s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${b.qty} × ${it.name} added to ${s.ref}`, body: 'Your shipper will bring them before pickup. They’re added to what you pay for this shipment.', link: `/dashboard?tab=shipments&s=${s.id}` })
    res.status(201).json(await view(db, s, editable, isOffice))
  }))
  r.patch('/shipments/:id/supplies/:line', wrap(async (req, res) => {
    const db = await getDb(); const { s, editable, isOffice } = await access(db, req)
    if (!editable) throw new HttpError(409, 'This shipment is already paid.')
    const b = z.object({ qty: z.number().int().min(0).max(50) }).parse(req.body)
    if (b.qty === 0) await db.query(`update shipment_supplies set status = 'cancelled' where id = $1 and shipment_id = $2 and status = 'due'`, [String(req.params.line), s.id])
    else await db.query(`update shipment_supplies set qty = $3 where id = $1 and shipment_id = $2 and status = 'due'`, [String(req.params.line), s.id, b.qty])
    res.json(await view(db, s, editable, isOffice))
  }))
}

