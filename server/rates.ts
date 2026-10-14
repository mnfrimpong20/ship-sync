/**
 * Rate cards — a shipper's published prices per lane and cargo type.
 *
 * A card prices one combination of origin (or "any origin"), destination country, mode and cargo:
 *   total = max(minCharge, price × quantity [or × kg when unit = 'kg']) + pickup/delivery/insurance fees when asked for
 * Cards marked `auto_send` turn into a quote the moment a matching request is posted (instant quote);
 * the rest show up as a suggested price in the shipper's quote form.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'
import { cargoLabel, countryByCode, type CargoType } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
export const rateOut = (r: Row) => ({
  id: r.id, shipperId: r.shipper_id, origin: r.origin ?? '', destination: r.destination, mode: r.mode as 'air' | 'ocean', cargo: r.cargo as CargoType,
  price: Number(r.price), unit: (r.unit ?? 'unit') as 'unit' | 'kg', minCharge: Number(r.min_charge ?? 0), pickupFee: Number(r.pickup_fee ?? 0), deliveryFee: Number(r.delivery_fee ?? 0), insuranceFee: Number(r.insurance_fee ?? 0),
  transitDays: Number(r.transit_days), validDays: Number(r.valid_days ?? 10), notes: r.notes ?? '', autoSend: Boolean(r.auto_send), active: Boolean(r.active), updatedAt: ISO(r.updated_at),
})
export type RateCard = ReturnType<typeof rateOut>

/** The shape of a request we can price — a `requests` row or the public quote form. */
export interface PriceInput { origin: string; destination: string; mode: 'air' | 'ocean' | 'either'; cargo: string; quantity?: number; weightKg?: number | null; pickup?: boolean; delivery?: boolean; insurance?: boolean }

export interface InstantQuote { cardId: string; price: number; transitDays: number; mode: 'air' | 'ocean'; includes: string[]; notes: string; validUntil: string; breakdown: { base: number; pickup: number; delivery: number; insurance: number; minApplied: boolean }; autoSend: boolean }

/** Price one card for one request. Null when the card can't price it (per-kg card without a weight). */
export function priceCard(card: RateCard, r: PriceInput): InstantQuote | null {
  const qty = Math.max(1, Number(r.quantity ?? 1))
  const units = card.unit === 'kg' ? Number(r.weightKg ?? 0) : qty
  if (card.unit === 'kg' && !(units > 0)) return null
  const raw = Math.round(card.price * units)
  const base = Math.max(card.minCharge, raw)
  const pickup = r.pickup ? card.pickupFee : 0
  const delivery = r.delivery ? card.deliveryFee : 0
  const insurance = r.insurance ? card.insuranceFee : 0
  const includes = [r.pickup ? 'Pickup' : 'Drop-off at warehouse', card.mode === 'air' ? 'Air freight' : 'Ocean freight', r.delivery ? 'Door delivery' : 'Port handling', ...(r.insurance ? ['All-risk insurance'] : [])]
  return { cardId: card.id, price: base + pickup + delivery + insurance, transitDays: card.transitDays, mode: card.mode, includes, notes: card.notes, validUntil: new Date(Date.now() + card.validDays * 86400000).toISOString().slice(0, 10), breakdown: { base, pickup, delivery, insurance, minApplied: base > raw }, autoSend: card.autoSend }
}

/** Best active card a shipper has for this request: exact origin beats any-origin; when the customer said "either", the cheaper mode wins. */
export function bestCard(cards: RateCard[], r: PriceInput): { card: RateCard; quote: InstantQuote } | null {
  const fits = cards.filter((c) => c.active && c.destination === r.destination && c.cargo === r.cargo && (r.mode === 'either' || c.mode === r.mode) && (c.origin === '' || c.origin.toLowerCase() === r.origin.toLowerCase()))
  const priced = fits.map((card) => ({ card, quote: priceCard(card, r) })).filter((x): x is { card: RateCard; quote: InstantQuote } => x.quote !== null)
  priced.sort((a, b) => (b.card.origin ? 1 : 0) - (a.card.origin ? 1 : 0) || a.quote.price - b.quote.price)
  return priced[0] ?? null
}

export async function cardsFor(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>('select * from rate_cards where shipper_id = $1 order by destination, mode, cargo, origin', [shipperId])
  return rows.map(rateOut)
}

/** Instant quote from one shipper's rate cards, or null. */
export async function instantQuote(db: Db, shipperId: string, r: PriceInput) {
  return bestCard(await cardsFor(db, shipperId), r)?.quote ?? null
}

/** Every shipper with an auto-send card matching this request gets a quote at once. Returns the shippers quoted. */
export async function autoQuoteFromRates(db: Db, req: Row, shipperIds: string[]) {
  if (!shipperIds.length) return [] as { shipperId: string; price: number }[]
  const { rows } = await db.query<Row>('select * from rate_cards where shipper_id = any($1::text[]) and active and auto_send', [shipperIds])
  const byShipper = new Map<string, RateCard[]>()
  for (const r of rows) { const c = rateOut(r); byShipper.set(c.shipperId, [...(byShipper.get(c.shipperId) ?? []), c]) }
  const out: { shipperId: string; price: number }[] = []
  const input: PriceInput = { origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo, quantity: req.quantity, weightKg: req.weight_kg, pickup: req.pickup, delivery: req.delivery, insurance: req.insurance }
  for (const [shipperId, cards] of byShipper) {
    const best = bestCard(cards, input); if (!best) continue
    const q = best.quote
    const { rows: ins } = await db.query<Row>('insert into quotes (id,request_id,shipper_id,price,transit_days,valid_until,notes,includes) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning id',
      [uid(), req.id, shipperId, q.price, q.transitDays, q.validUntil, q.notes || 'Instant quote from our published rates.', JSON.stringify(q.includes)])
    if (ins[0]) out.push({ shipperId, price: q.price })
  }
  return out
}

const zCard = z.object({
  origin: z.string().trim().max(60).default(''),
  destination: z.string().trim().length(2).toUpperCase(),
  mode: z.enum(['air', 'ocean']),
  cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']),
  price: z.number().int().min(1).max(1_000_000),
  unit: z.enum(['unit', 'kg']).default('unit'),
  minCharge: z.number().int().min(0).max(1_000_000).default(0),
  pickupFee: z.number().int().min(0).max(100_000).default(0),
  deliveryFee: z.number().int().min(0).max(100_000).default(0),
  insuranceFee: z.number().int().min(0).max(100_000).default(0),
  transitDays: z.number().int().min(1).max(180),
  validDays: z.number().int().min(1).max(90).default(10),
  notes: z.string().trim().max(500).default(''),
  autoSend: z.boolean().default(false),
  active: z.boolean().default(true),
})
const zPreview = z.object({ origin: z.string().trim().min(1), destination: z.string().trim().length(2), mode: z.enum(['air', 'ocean', 'either']), cargo: z.string(), quantity: z.number().int().min(1).max(10_000).default(1), weightKg: z.number().min(0).max(1_000_000).optional(), pickup: z.boolean().default(false), delivery: z.boolean().default(false), insurance: z.boolean().default(false) })

const COLS = ['origin', 'destination', 'mode', 'cargo', 'price', 'unit', 'min_charge', 'pickup_fee', 'delivery_fee', 'insurance_fee', 'transit_days', 'valid_days', 'notes', 'auto_send', 'active'] as const
const vals = (b: z.infer<typeof zCard>) => [b.origin, b.destination, b.mode, b.cargo, b.price, b.unit, b.minCharge, b.pickupFee, b.deliveryFee, b.insuranceFee, b.transitDays, b.validDays, b.notes, b.autoSend, b.active]

export function mountRates(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staff = async (db: Db, req: Request, edit = false) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !can(u, 'rates')) throw new HttpError(403, 'Rate-card access is needed for this.')
    if (edit && !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner') && !u.perms?.allow?.includes('rates')) throw new HttpError(403, 'Only owners and dispatchers can change rate cards.')
    return u
  }
  const own = async (db: Db, shipperId: string, id: string) => {
    const { rows } = await db.query<Row>('select * from rate_cards where id = $1 and shipper_id = $2', [id, shipperId])
    if (!rows[0]) throw new HttpError(404, 'Rate card not found.')
    return rows[0]
  }
  const lane = (b: { origin: string; destination: string; mode: string; cargo: string }) => `${b.origin || 'Any origin'} → ${countryByCode(b.destination)?.name ?? b.destination} · ${b.mode} · ${cargoLabel(b.cargo as CargoType)}`

  r.get('/rates', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    res.json({ rates: await cardsFor(db, u.shipperId!), canEdit: u.staffRole !== 'agent' })
  }))
  r.post('/rates', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req, true)
    const b = zCard.parse(req.body)
    const { rows: dup } = await db.query<Row>('select id from rate_cards where shipper_id = $1 and origin = $2 and destination = $3 and mode = $4 and cargo = $5', [u.shipperId, b.origin, b.destination, b.mode, b.cargo])
    if (dup[0]) throw new HttpError(409, `You already have a card for ${lane(b)}. Edit that one instead.`)
    const id = 'rc_' + uid()
    await db.query(`insert into rate_cards (id,shipper_id,${COLS.join(',')}) values ($1,$2,${COLS.map((_, i) => `$${i + 3}`).join(',')})`, [id, u.shipperId, ...vals(b)])
    res.status(201).json({ rate: rateOut(await own(db, u.shipperId!, id)) })
  }))
  r.patch('/rates/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req, true)
    const cur = rateOut(await own(db, u.shipperId!, String(req.params.id)))
    const b = zCard.parse({ ...cur, ...req.body })
    const { rows: dup } = await db.query<Row>('select id from rate_cards where shipper_id = $1 and origin = $2 and destination = $3 and mode = $4 and cargo = $5 and id <> $6', [u.shipperId, b.origin, b.destination, b.mode, b.cargo, cur.id])
    if (dup[0]) throw new HttpError(409, `Another card already covers ${lane(b)}.`)
    await db.query(`update rate_cards set ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [cur.id, ...vals(b)])
    res.json({ rate: rateOut(await own(db, u.shipperId!, cur.id)) })
  }))
  r.delete('/rates/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req, true)
    const id = String(req.params.id)
    await own(db, u.shipperId!, id)
    await db.query('delete from rate_cards where id = $1', [id])
    res.json({ ok: true })
  }))
  /** "What would we quote for…" — the calculator on the rates page. */
  r.post('/rates/preview', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const b = zPreview.parse(req.body)
    const best = bestCard(await cardsFor(db, u.shipperId!), b)
    res.json({ quote: best?.quote ?? null, card: best?.card ?? null })
  }))
}

/** Gold Coast gets a few published lanes so the demo quotes instantly. */
export async function seedRatesDemo(db: Db) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from rate_cards where shipper_id = 'gold-coast-freight'`)
  if (rows[0].n > 0) return
  const cards: [string, string, string, string, number, number, number, number, number, number, boolean, string][] = [
    // origin, dest, mode, cargo, price, minCharge, pickup, delivery, insurance, transit, autoSend, notes
    ['Houston, TX', 'GH', 'ocean', 'barrels', 175, 175, 60, 90, 45, 32, true, 'Weekly consolidation from our Houston yard. Tema clearance included; duty payable by consignee.'],
    ['Houston, TX', 'GH', 'ocean', 'boxes', 95, 120, 60, 90, 30, 32, true, 'Boxes and suitcases ride in shared containers. Minimum charge applies to single small boxes.'],
    ['', 'GH', 'ocean', 'barrels', 195, 195, 80, 90, 45, 36, false, 'Pickups outside Houston go through partner trucking — allow a few extra days.'],
    ['', 'GH', 'ocean', 'vehicle', 1650, 1650, 0, 0, 120, 38, false, 'Containerised vehicle shipping with pre-shipment inspection. Duty estimate on request.'],
    ['Houston, TX', 'GH', 'ocean', 'container20', 3900, 3900, 0, 0, 0, 30, false, 'Full 20ft container, Houston → Tema. Port-to-port; door delivery quoted separately.'],
    ['Houston, TX', 'GH', 'ocean', 'container40', 5600, 5600, 0, 0, 0, 30, false, 'Full 40ft container, Houston → Tema. Port-to-port; door delivery quoted separately.'],
  ]
  for (const c of cards) await db.query(`insert into rate_cards (id,shipper_id,origin,destination,mode,cargo,price,unit,min_charge,pickup_fee,delivery_fee,insurance_fee,transit_days,valid_days,notes,auto_send,active) values ($1,'gold-coast-freight',$2,$3,$4,$5,$6,'unit',$7,$8,$9,$10,$11,10,$12,$13,true)`, ['rc_' + uid(), c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[11], c[10]])
}
