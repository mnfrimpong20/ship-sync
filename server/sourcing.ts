/**
 * Ntemtem Sourcing — an end-to-end "source & ship" concierge from China, the UK and the USA, run by
 * Ntemtem's own people. A customer picks where to buy from and describes what they want (or pastes a
 * 1688 / Alibaba / Amazon / Argos / Walmart link); an agent finds and vets suppliers, prices the landed
 * cost, places the order in Ntemtem's name, inspects the goods, receives them at our warehouse in
 * that country and hands them to the ocean/air leg — which is a normal shipment.
 *
 *   origin     CN (factories, prices in ¥) · GB (UK retailers/wholesalers, £) · US (US stores/wholesalers, $).
 *              Prices are stored in the origin's currency in `unit_price_cny` (historic name) with the
 *              currency on the quote, and converted with the rate in sourcing settings.
 *
 *   tiers      find   — supplier search only: 2–3 vetted options; a flat sourcing fee unlocks contacts
 *              order  — we buy, pay the factory, inspect and ship to the port
 *              door   — order + customs clearance + delivery to the door
 *   money      deposit (service fee + inspection + 30 % of factory price) when a quote is accepted →
 *              balance (rest of factory price + handling + freight + insurance + duty) after QC →
 *              all held in escrow, released to Ntemtem Sourcing's balance at 'ordered' / 'shipped'
 *   people     agents are staff of the platform-owned shipper `ship-sync-sourcing`; admins assign jobs
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, makeRef, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { attachShipmentToClient } from './clients'
import { getSettings as paymentSettings, markPaid, paymentOut, refundPayment, stripe, stripeMode } from './payments'
import { countryByCode, type ShipmentStatus } from '../src/lib/data'
import { ORIGINS, asOrigin, localPrice, type Origin } from '../src/lib/sourcingOrigins'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const r2 = (n: number) => Math.round(n * 100) / 100
/** Stable 3-letter code so a masked supplier stays recognisable across quotes without leaking its id. */
const maskCode = (id: string) => { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return A[h % 24] + A[(h >> 5) % 24] + String(h % 10) }

export const SOURCING_SHIPPER = 'ship-sync-sourcing'
export const TIERS = {
  find: { label: 'Find me a supplier', blurb: 'We shortlist 2–3 vetted factories, wholesalers or stores with prices, MOQ and lead times. A flat sourcing fee unlocks their contacts — you take it from there, or upgrade.' },
  order: { label: 'Order & inspect', blurb: 'We buy in Ntemtem’s name, pay the supplier, inspect the goods with photos, and ship them to your port.' },
  door: { label: 'Door to door', blurb: 'Everything in Order & inspect, plus customs clearance and delivery to your door.' },
} as const
export type Tier = keyof typeof TIERS
export const STEPS = ['requested', 'assigned', 'sourcing', 'quoted', 'deposit_paid', 'ordered', 'in_production', 'inspected', 'balance_paid', 'received_cn', 'shipped', 'delivered', 'closed'] as const
export type Step = (typeof STEPS)[number]
export const stepLabels: Record<Step | 'cancelled', string> = {
  requested: 'Request received', assigned: 'Agent assigned', sourcing: 'Finding suppliers', quoted: 'Quotes ready', deposit_paid: 'Deposit paid', ordered: 'Order placed with factory', in_production: 'In production', inspected: 'Quality inspected',
  balance_paid: 'Balance paid', received_cn: 'Received at our warehouse', shipped: 'Shipped', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
}
/** Who may move a job into each step. */
/** Standard inspection checklist; agents mark each item pass / fail / n/a. */
export const QC_ITEMS = [
  { id: 'quantity', label: 'Quantity matches the PO' }, { id: 'packaging', label: 'Export packaging & carton strength' }, { id: 'labeling', label: 'Labels, barcodes & shipping marks' }, { id: 'appearance', label: 'Appearance, finish & colour' },
  { id: 'function', label: 'Function / performance test' }, { id: 'dimensions', label: 'Dimensions & weight' }, { id: 'safety', label: 'Safety marks & certificates (CE, CCC, RoHS…)' }, { id: 'damage', label: 'No damage, moisture or mould' },
] as const
/** ISO 2859-1 general inspection level II, normal — sample size for a lot (the usual buyer's AQL table). */
export function aqlSample(lot: number) {
  const t: [number, number][] = [[8, 2], [15, 3], [25, 5], [50, 8], [90, 13], [150, 20], [280, 32], [500, 50], [1200, 80], [3200, 125], [10000, 200], [35000, 315], [150000, 500], [500000, 800]]
  const n = t.find(([max]) => lot <= max)?.[1] ?? 1250
  // Acceptance numbers at AQL 2.5 (major) / 4.0 (minor) for that sample size.
  const acc: Record<number, [number, number]> = { 2: [0, 0], 3: [0, 0], 5: [0, 0], 8: [0, 1], 13: [1, 1], 20: [1, 2], 32: [2, 3], 50: [3, 5], 80: [5, 7], 125: [7, 10], 200: [10, 14], 315: [14, 21], 500: [21, 21], 800: [21, 21], 1250: [21, 21] }
  return { sampleSize: Math.min(n, lot), acceptMajor: acc[n]?.[0] ?? 21, acceptMinor: acc[n]?.[1] ?? 21 }
}
const STEP_BY: Record<Step, ('agent' | 'customer' | 'system')[]> = {
  requested: ['system'], assigned: ['system'], sourcing: ['agent'], quoted: ['system'], deposit_paid: ['system'], ordered: ['agent'], in_production: ['agent'], inspected: ['agent'], balance_paid: ['system'], received_cn: ['agent'], shipped: ['agent'], delivered: ['agent', 'system'], closed: ['customer', 'agent', 'system'],
}

export interface SourcingSettings { enabled: boolean; servicePct: number; minFeeUsd: number; findFeeUsd: number; depositPct: number; inspectionUsd: number; handlingUsd: number; cnyPerUsd: number; gbpPerUsd: number; note: string; agentCommissionPct: number; sampleHandlingUsd: number }
export const DEFAULT_SOURCING: SourcingSettings = { enabled: true, servicePct: 0.07, minFeeUsd: 150, findFeeUsd: 95, depositPct: 0.3, inspectionUsd: 120, handlingUsd: 80, cnyPerUsd: Number(process.env.CNY_PER_USD) || 7.2, gbpPerUsd: Number(process.env.GBP_PER_USD) || 0.79, agentCommissionPct: 0.2, sampleHandlingUsd: 25, note: 'Ntemtem buys in its own name and holds your money in escrow — the factory is only paid once your order is confirmed, and the balance only after you approve the inspection photos.' }
export async function sourcingSettings(db: Db): Promise<SourcingSettings> {
  const { rows } = await db.query<Row>(`select value from settings where id = 'sourcing'`)
  const v = (J(rows[0]?.value) ?? {}) as Partial<SourcingSettings>
  return { ...DEFAULT_SOURCING, ...v, cnyPerUsd: Number(process.env.CNY_PER_USD) || v.cnyPerUsd || DEFAULT_SOURCING.cnyPerUsd, gbpPerUsd: Number(process.env.GBP_PER_USD) || v.gbpPerUsd || DEFAULT_SOURCING.gbpPerUsd }
}
/** Units of the origin's currency per US dollar. */
export const rateFor = (cfg: SourcingSettings, origin: unknown) => { const o = asOrigin(origin); return o === 'CN' ? cfg.cnyPerUsd : o === 'GB' ? cfg.gbpPerUsd : 1 }
const originOf = (job: Row): Origin => asOrigin(job?.origin_country)
const publicPricing = (cfg: SourcingSettings) => ({ servicePct: cfg.servicePct, minFeeUsd: cfg.minFeeUsd, findFeeUsd: cfg.findFeeUsd, depositPct: cfg.depositPct, inspectionUsd: cfg.inspectionUsd, handlingUsd: cfg.handlingUsd, cnyPerUsd: cfg.cnyPerUsd, gbpPerUsd: cfg.gbpPerUsd, note: cfg.note })

/* ------------------------------------------------------------------ output */
export const supplierOut = (s: Row, full = false) => ({
  id: s.id, name: full ? s.name : s.name_public ?? s.name, city: s.city, province: s.province, country: asOrigin(s.country), products: (J(s.products) ?? []) as string[], verified: !!s.verified, rating: Number(s.rating ?? 0), jobs: Number(s.n_jobs ?? 0), notes: full ? s.notes : '',
  contact: full ? s.contact : '', wechat: full ? s.wechat : '', phone: full ? s.phone : '', website: full ? s.website : '', storefront: full ? s.storefront : '', active: !!s.active, createdAt: ISO(s.created_at), lastAudit: s.last_audit ? { date: String((J(s.last_audit) as Row).audit_date).slice(0, 10), score: Number((J(s.last_audit) as Row).score), result: (J(s.last_audit) as Row).result, auditor: (J(s.last_audit) as Row).auditor } : null,
})
export const quoteOut = (q: Row, revealSupplier: boolean) => ({
  id: q.id, sourcingId: q.sourcing_id, supplierId: q.supplier_id, supplier: q.sup_name ? supplierOut({ id: q.supplier_id, name: q.sup_name, name_public: revealSupplier ? q.sup_name : `${asOrigin(q.sup_country) === 'CN' ? 'Factory' : 'Supplier'} ${maskCode(String(q.supplier_id))}`, city: q.sup_city, province: q.sup_province, country: q.sup_country, products: q.sup_products, verified: q.sup_verified, rating: q.sup_rating, contact: q.sup_contact, wechat: q.sup_wechat, phone: q.sup_phone, website: q.sup_website, storefront: q.sup_storefront, active: true, notes: '' }, revealSupplier) : null,
  title: q.title, unitPriceCny: Number(q.unit_price_cny), unitPrice: Number(q.unit_price_cny), currency: (q.currency ?? 'CNY') as string, qty: Number(q.qty), moq: Number(q.moq), leadDays: Number(q.lead_days), factoryUsd: Number(q.factory_usd), serviceFeeUsd: Number(q.service_fee_usd), inspectionUsd: Number(q.inspection_usd), handlingUsd: Number(q.handling_usd), freightUsd: Number(q.freight_usd), insuranceUsd: Number(q.insurance_usd), dutyEstUsd: Number(q.duty_est_usd),
  totalUsd: Number(q.total_usd), depositUsd: Number(q.deposit_usd), balanceUsd: r2(Number(q.total_usd) - Number(q.deposit_usd)), tiers: (J(q.tiers) ?? []) as { minQty: number; unitPriceCny: number }[], notes: q.notes ?? '', sampleAvailable: !!q.sample_available, status: q.status as 'proposed' | 'accepted' | 'rejected', createdAt: ISO(q.created_at),
})
export const jobOut = (j: Row, viewer: 'customer' | 'agent' | 'admin' | 'public') => {
  const paid = ['deposit_paid', 'ordered', 'in_production', 'inspected', 'balance_paid', 'received_cn', 'shipped', 'delivered', 'closed'].includes(j.status) || (j.tier === 'find' && j.status === 'closed')
  return {
    id: j.id, ref: j.ref, tier: j.tier as Tier, tierLabel: TIERS[j.tier as Tier]?.label ?? j.tier, title: j.title, description: j.description, links: (J(j.links) ?? []) as string[], quantity: Number(j.quantity), unit: j.unit, targetPriceUsd: j.target_price_usd == null ? null : Number(j.target_price_usd),
    origin: asOrigin(j.origin_country), originName: ORIGINS[asOrigin(j.origin_country)].name, currency: ORIGINS[asOrigin(j.origin_country)].currency,
    destination: j.destination, destinationName: countryByCode(j.destination)?.name ?? j.destination, destinationCity: j.destination_city, mode: j.mode, deadline: j.deadline ? String(j.deadline).slice(0, 10) : null,
    customer: viewer === 'public' ? undefined : { id: j.user_id, name: j.contact_name, email: viewer === 'customer' ? j.contact_email : j.contact_email, phone: j.contact_phone, company: j.company ?? '' },
    status: j.status as Step | 'cancelled', statusLabel: j.status === 'received_cn' ? `Received at our ${ORIGINS[asOrigin(j.origin_country)].hub} warehouse` : stepLabels[j.status as Step] ?? j.status, agent: j.agent_user_id ? { id: j.agent_user_id, name: j.agent_name ?? 'Sourcing agent', city: j.agent_city ?? '' } : null,
    acceptedQuoteId: j.accepted_quote_id ?? null, po: (J(j.po) ?? null) as Row | null, qc: (J(j.qc) ?? null) as Row | null, sample: (J(j.sample) ?? null) as Row | null, reference: (J(j.reference) ?? null) as Row | null, recurring: (J(j.recurring) ?? null) as Row | null, parentId: j.parent_id ?? null, parentRef: j.p_ref ?? null, receipt: (J(j.receipt) ?? null) as Row | null, containerId: j.s_container ?? null, containerRef: j.c_ref ?? null, shipmentId: j.shipment_id ?? null, shipmentRef: j.s_ref ?? null, shipmentStatus: j.s_status ?? null,
    supplierRevealed: viewer !== 'customer' || paid, timeline: (J(j.timeline) ?? []) as { at: string; status: string; note: string; by: string }[], createdAt: ISO(j.created_at), updatedAt: ISO(j.updated_at), closedAt: ISO(j.closed_at),
  }
}
const paymentStage = (p: Row) => ({ ...paymentOut(p), stage: p.stage as 'fee' | 'deposit' | 'balance' | 'sample', sourcingId: p.sourcing_id })

const JOB_SELECT = `select j.*, u.name as agent_name, st.city as agent_city, s.ref as s_ref, s.status as s_status, s.container_id as s_container, c.ref as c_ref, pj.ref as p_ref from sourcing_requests j left join sourcing_requests pj on pj.id = j.parent_id left join users u on u.id = j.agent_user_id left join staff st on st.user_id = j.agent_user_id and st.shipper_id = '${SOURCING_SHIPPER}' left join shipments s on s.id = j.shipment_id left join containers c on c.id = s.container_id`
const QUOTE_SELECT = `select q.*, sp.name as sup_name, sp.city as sup_city, sp.country as sup_country, sp.province as sup_province, sp.products as sup_products, sp.verified as sup_verified, sp.rating as sup_rating, sp.contact as sup_contact, sp.wechat as sup_wechat, sp.phone as sup_phone, sp.website as sup_website, sp.storefront as sup_storefront from sourcing_quotes q left join suppliers sp on sp.id = q.supplier_id`
const SUP_SELECT = `select sp.*, (select count(*) from sourcing_quotes q where q.supplier_id = sp.id and q.status = 'accepted')::int as n_jobs, (select row_to_json(a) from (select audit_date, score, result, auditor from supplier_audits a where a.supplier_id = sp.id order by audit_date desc limit 1) a) as last_audit from suppliers sp`
const PAY_SELECT = `select p.*, sh.name as shipper_name from escrow_payments p join shippers sh on sh.id = p.shipper_id`

/* ------------------------------------------------------------------ validation */
const zRequest = z.object({
  tier: z.enum(['find', 'order', 'door']), origin: z.enum(['CN', 'GB', 'US']).default('CN'), title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(3000), links: z.array(z.string().trim().url().max(400)).max(6).default([]),
  quantity: z.number().int().min(1).max(10_000_000), unit: z.string().trim().min(1).max(30).default('pcs'), targetPriceUsd: z.number().min(0).max(10_000_000).nullable().optional(),
  destination: z.string().trim().length(2).transform((s) => s.toUpperCase()), destinationCity: z.string().trim().max(60).default(''), mode: z.enum(['ocean', 'air', 'either']).default('either'), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contactName: z.string().trim().min(2).max(80), contactEmail: z.string().trim().email(), contactPhone: z.string().trim().max(30).default(''), company: z.string().trim().max(80).default(''),
  reference: z.object({ url: z.string().url().max(400), platform: z.string().max(20), productId: z.string().max(40).default(''), title: z.string().max(200).default(''), image: z.string().max(600).default(''), priceCny: z.number().min(0).nullable().default(null), priceUsd: z.number().min(0).nullable().default(null), price: z.number().min(0).nullable().optional(), currency: z.string().max(3).optional(), origin: z.string().max(2).optional(), moq: z.number().int().min(0).nullable().default(null) }).nullable().optional(),
})
const zTier = z.object({ minQty: z.number().int().min(1).max(10_000_000), unitPriceCny: z.number().min(0.01).max(10_000_000) })
const zRecurring = z.object({ active: z.boolean(), everyWeeks: z.number().int().min(2).max(26).default(4), nextAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
const zSupplier = z.object({
  name: z.string().trim().min(2).max(100), country: z.enum(['CN', 'GB', 'US']).optional(), city: z.string().trim().max(60).default(''), province: z.string().trim().max(60).default(''), products: z.array(z.string().trim().min(2).max(40)).max(12).default([]), contact: z.string().trim().max(80).default(''), wechat: z.string().trim().max(60).default(''), phone: z.string().trim().max(30).default(''),
  website: z.string().trim().max(200).default(''), storefront: z.string().trim().max(300).default(''), notes: z.string().trim().max(1000).default(''), verified: z.boolean().default(false), rating: z.number().min(0).max(5).default(0), active: z.boolean().default(true),
})
const zQuote = z.preprocess((v) => (v && typeof v === 'object' && (v as Row).unitPriceCny == null && (v as Row).unitPrice != null ? { ...(v as Row), unitPriceCny: (v as Row).unitPrice } : v), z.object({
  supplierId: z.string().min(1), title: z.string().trim().min(2).max(120), unitPriceCny: z.number().min(0.01).max(10_000_000), qty: z.number().int().min(1).max(10_000_000), moq: z.number().int().min(0).max(10_000_000).default(0), leadDays: z.number().int().min(0).max(365),
  freightUsd: z.number().min(0).max(1_000_000).default(0), insuranceUsd: z.number().min(0).max(100_000).default(0), dutyEstUsd: z.number().min(0).max(1_000_000).default(0), inspectionUsd: z.number().min(0).max(10_000).optional(), handlingUsd: z.number().min(0).max(10_000).optional(), serviceFeeUsd: z.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(1000).default(''), sampleAvailable: z.boolean().default(false), tiers: z.array(z.object({ minQty: z.number().int().min(1).max(10_000_000), unitPriceCny: z.number().min(0.01).max(10_000_000) })).max(6).default([]),
}))
const zStep = z.object({
  status: z.enum([...STEPS, 'cancelled']), note: z.string().trim().max(600).default(''),
  po: z.object({ number: z.string().trim().max(40).default(''), leadDays: z.number().int().min(0).max(365).optional(), readyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), incoterm: z.enum(['EXW', 'FOB', 'CIF', 'DDP']).default('FOB'), factoryPaidCny: z.number().min(0).optional() }).optional(),
  qc: z.object({ result: z.enum(['pass', 'rework', 'fail']), checked: z.number().int().min(0).max(1_000_000).default(0), defects: z.number().int().min(0).max(1_000_000).default(0), notes: z.string().trim().max(1500).default(''), items: z.array(z.object({ id: z.string().min(1).max(30), result: z.enum(['pass', 'fail', 'na']), note: z.string().trim().max(300).default('') })).max(20).optional() }).optional(),
  ship: z.object({ mode: z.enum(['ocean', 'air']), originCity: z.string().trim().max(60).default(''), cargo: z.enum(['boxes', 'pallets', 'container20', 'container40', 'commercial']).default('commercial'), eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), vesselName: z.string().trim().max(60).optional(), flight: z.string().trim().max(20).optional(), description: z.string().trim().max(300).optional() }).optional(),
  refund: z.boolean().optional(),
  receipt: z.object({ cartons: z.number().int().min(0).max(100_000).default(0), grossKg: z.number().min(0).max(1_000_000).default(0), cbm: z.number().min(0).max(10_000).default(0), marks: z.string().trim().max(120).default(''), siteId: z.string().optional() }).optional(),
  containerId: z.string().optional(),
})
const zQcItems = z.object({ items: z.array(z.object({ id: z.string().min(1).max(30), result: z.enum(['pass', 'fail', 'na']), note: z.string().trim().max(300).default('') })).max(20).default([]), sampleSize: z.number().int().min(0).max(1_000_000).optional() })
const zSampleReq = z.object({ note: z.string().trim().max(500).default(''), address: z.string().trim().max(300).default('') })
const zSampleQuote = z.object({ costUsd: z.number().min(0).max(5000), note: z.string().trim().max(300).default('') })
const zSampleShip = z.object({ courier: z.string().trim().min(2).max(40), tracking: z.string().trim().max(60).default(''), note: z.string().trim().max(300).default('') })
const zSampleFeedback = z.object({ result: z.enum(['approved', 'rejected']), note: z.string().trim().max(600).default('') })
const zAudit = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), score: z.number().int().min(0).max(100), result: z.enum(['pass', 'conditional', 'fail']), findings: z.string().trim().max(2000).default(''), categories: z.record(z.string(), z.number().int().min(0).max(10)).optional() })
const zMessage = z.object({ body: z.string().trim().min(1).max(2000) })
const zFile = z.object({ kind: z.enum(['photo', 'document', 'qc']).default('photo'), title: z.string().trim().min(1).max(120), mime: z.string().regex(/^(image\/(png|jpeg|webp)|application\/pdf)$/), data: z.string().min(10).max(4_200_000) })
const zSettings = z.object({ enabled: z.boolean().optional(), servicePct: z.number().min(0).max(0.5).optional(), minFeeUsd: z.number().min(0).max(10_000).optional(), findFeeUsd: z.number().min(0).max(10_000).optional(), depositPct: z.number().min(0.05).max(1).optional(), inspectionUsd: z.number().min(0).max(10_000).optional(), handlingUsd: z.number().min(0).max(10_000).optional(), cnyPerUsd: z.number().min(1).max(20).optional(), gbpPerUsd: z.number().min(0.3).max(2).optional(), note: z.string().trim().max(500).optional(), agentCommissionPct: z.number().min(0).max(1).optional(), sampleHandlingUsd: z.number().min(0).max(1000).optional() })
const zAssign = z.object({ agentUserId: z.string().min(1).nullable() })

/* ------------------------------------------------------------------ pricing */
/** Unit price for a quantity: the best matching price break, else the base price. */
export const tierPrice = (base: number, tiers: { minQty: number; unitPriceCny: number }[], qty: number) => tiers.filter((t) => qty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0]?.unitPriceCny ?? base
export function priceOut(tier: Tier, cfg: SourcingSettings, b: { unitPriceCny: number; qty: number; freightUsd?: number; insuranceUsd?: number; dutyEstUsd?: number; inspectionUsd?: number; handlingUsd?: number; serviceFeeUsd?: number }, origin: unknown = 'CN') {
  const factory = r2((b.unitPriceCny * b.qty) / rateFor(cfg, origin))
  const fee = b.serviceFeeUsd ?? (tier === 'find' ? cfg.findFeeUsd : r2(Math.max(cfg.minFeeUsd, factory * cfg.servicePct)))
  const inspection = tier === 'find' ? 0 : b.inspectionUsd ?? cfg.inspectionUsd; const handling = tier === 'find' ? 0 : b.handlingUsd ?? cfg.handlingUsd
  const freight = tier === 'find' ? 0 : b.freightUsd ?? 0; const insurance = tier === 'find' ? 0 : b.insuranceUsd ?? 0; const duty = tier === 'door' ? b.dutyEstUsd ?? 0 : 0
  const total = tier === 'find' ? fee : r2(factory + fee + inspection + handling + freight + insurance + duty)
  const deposit = tier === 'find' ? fee : r2(fee + inspection + factory * cfg.depositPct)
  return { factory, fee, inspection, handling, freight, insurance, duty, total, deposit }
}

/* ------------------------------------------------------------------ link import */
const PLATFORMS: [RegExp, string][] = [[/1688\.com/, '1688'], [/alibaba\.com/, 'alibaba'], [/aliexpress\.(com|us)/, 'aliexpress'], [/taobao\.com/, 'taobao'], [/tmall\.com/, 'tmall'], [/made-in-china\.com/, 'made-in-china'], [/dhgate\.com/, 'dhgate'],
  [/amazon\.co\.uk/, 'amazon-uk'], [/ebay\.co\.uk/, 'ebay-uk'], [/argos\.co\.uk/, 'argos'], [/currys\.co\.uk/, 'currys'], [/johnlewis\.com/, 'john-lewis'], [/boots\.com/, 'boots'], [/tesco\.com/, 'tesco'], [/next\.co\.uk/, 'next'], [/screwfix\.com/, 'screwfix'], [/costco\.co\.uk/, 'costco-uk'], [/booker\.co\.uk/, 'booker'],
  [/walmart\.com/, 'walmart'], [/target\.com/, 'target'], [/homedepot\.com/, 'home-depot'], [/lowes\.com/, 'lowes'], [/bestbuy\.com/, 'best-buy'], [/costco\.com/, 'costco'], [/samsclub\.com/, 'sams-club'], [/autozone\.com/, 'autozone'], [/rockauto\.com/, 'rockauto'], [/newegg\.com/, 'newegg'], [/ebay\.com/, 'ebay'], [/etsy\.com/, 'etsy'],
  [/amazon\./, 'amazon'], [/temu\.com/, 'temu'], [/shein\.com/, 'shein']]
const CNY_PLATFORMS = ['1688', 'taobao', 'tmall']
const GB_PLATFORMS = ['amazon-uk', 'ebay-uk', 'argos', 'currys', 'john-lewis', 'boots', 'tesco', 'next', 'screwfix', 'costco-uk', 'booker']
const US_PLATFORMS = ['walmart', 'target', 'home-depot', 'lowes', 'best-buy', 'costco', 'sams-club', 'autozone', 'rockauto', 'newegg', 'ebay', 'amazon', 'etsy']
/** Which country a listing is bought in, from its site (a .co.uk domain counts as the UK). */
export const originForLink = (platform: string, host: string): Origin | null => (CNY_PLATFORMS.includes(platform) || ['alibaba', 'made-in-china', 'dhgate', 'aliexpress'].includes(platform) ? 'CN' : GB_PLATFORMS.includes(platform) || /\.(co\.)?uk$/.test(host) ? 'GB' : US_PLATFORMS.includes(platform) ? 'US' : null)
const currencyFor = (platform: string, host: string) => { const o = originForLink(platform, host); return CNY_PLATFORMS.includes(platform) ? 'CNY' : o === 'GB' ? 'GBP' : 'USD' }
const decodeEntities = (t: string) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim()
const meta = (html: string, name: string) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i')) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i')); return m ? decodeEntities(m[1]) : '' }
const ld_has_offer = (html: string) => /application\/ld\+json/i.test(html) && /"offers"/.test(html)
/** Best-effort parse of a product page: open-graph, JSON-LD offers, and the usual price / MOQ markers. */
export function parseProductPage(url: string, html: string) {
  const platform = PLATFORMS.find(([re]) => re.test(url))?.[1] ?? 'web'
  const u = new URL(url); const productId = (u.pathname.match(/(?:offer|product|item|dp|p|detail)\/?[_-]?(\d{6,})/i)?.[1]) ?? (u.pathname.match(/[_/-](\d{8,})(?:\.html?)?$/i)?.[1]) ?? (u.searchParams.get('id') ?? u.searchParams.get('offerId') ?? '')
  let title = meta(html, 'og:title') || decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')); title = title.replace(/\s*[-|–]\s*(1688\.com|阿里巴巴|Alibaba\.com|AliExpress|Taobao|淘宝网|Amazon\.com|Made-in-China\.com).*$/i, '').slice(0, 200)
  const description = (meta(html, 'og:description') || meta(html, 'description')).slice(0, 1500)
  const image = meta(html, 'og:image') || (html.match(/"(?:imageUrl|mainImage|image)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] ?? '')
  let price: number | null = null; let currency = currencyFor(platform, u.hostname)
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]) } catch { return null } }).filter(Boolean)
  for (const d of ld.flatMap((x) => (Array.isArray(x) ? x : [x]))) { const offer = d?.offers ? (Array.isArray(d.offers) ? d.offers[0] : d.offers) : null; const p = Number(offer?.lowPrice ?? offer?.price); if (offer && p > 0) { price = p; if (offer.priceCurrency) currency = String(offer.priceCurrency).toUpperCase(); break } }
  if (price == null) { const m = html.match(/(?:"(?:price|lowPrice|minPrice|salePrice|promotionPrice|unitPrice)"\s*:\s*"?)(\d+(?:\.\d+)?)/i) ?? html.match(/[¥￥]\s*(\d+(?:\.\d+)?)/) ?? html.match(/(?:£|GBP\s?)\s*(\d+(?:\.\d+)?)/) ?? html.match(/(?:US\s?\$|USD\s?)\s*(\d+(?:\.\d+)?)/i); if (m) { price = Number(m[1]); if (/[¥￥]/.test(m[0])) currency = 'CNY'; if (/£|GBP/.test(m[0])) currency = 'GBP'; if (/US|USD/.test(m[0])) currency = 'USD' } }
  const moqM = html.match(/(?:起批|起订|Min\.?\s*Order|Minimum order|MOQ)[^\d]{0,20}(\d[\d,]{0,8})/i); const moq = moqM ? Number(moqM[1].replace(/,/g, '')) : null
  return { platform, productId, title, description, image, price, currency, moq }
}

/* ------------------------------------------------------------------ shared helpers (also used by payments) */
async function jobById(db: Db, id: string) { const { rows } = await db.query<Row>(`${JOB_SELECT} where j.id = $1 or j.ref = $1`, [id]); return rows[0] ?? null }
async function pushTimeline(db: Db, job: Row, status: string, note: string, by: string, extra: Record<string, unknown> = {}) {
  const timeline = (J(job.timeline) ?? []) as Row[]; timeline.push({ at: new Date().toISOString(), status, note, by })
  const sets = ['status = $2', 'timeline = $3', 'updated_at = now()']; const params: unknown[] = [job.id, status, JSON.stringify(timeline.slice(-60))]
  for (const [k, v] of Object.entries(extra)) { params.push(v); sets.push(`${k} = $${params.length}`) }
  if (status === 'closed' || status === 'cancelled') sets.push('closed_at = now()')
  await db.query(`update sourcing_requests set ${sets.join(', ')} where id = $1`, params)
}
const tellCustomer = async (db: Db, job: Row, title: string, body: string, dedupe: string) => { if (job.user_id) await notify(db, { userId: job.user_id, kind: 'sourcing', title, body, link: `/sourcing/${job.id}`, dedupe, emailSubject: title }) }
const tellAgents = async (db: Db, job: Row, title: string, body: string, dedupe: string) => {
  if (job.agent_user_id) await notify(db, { userId: job.agent_user_id, kind: 'sourcing', title, body, link: `/dashboard/sourcing/${job.id}`, dedupe, emailSubject: title })
  else await notifyShipperStaff(db, SOURCING_SHIPPER, { kind: 'sourcing', title, body, link: `/dashboard/sourcing/${job.id}`, dedupe }, ['owner', 'dispatcher', 'agent'])
}
/** Release every held payment of a stage to Ntemtem Sourcing's balance (the factory has to be paid). */
async function releaseStage(db: Db, job: Row, stage: 'fee' | 'deposit' | 'balance', reason: string) {
  await db.query(`update escrow_payments set status = 'released', released_at = now(), release_reason = $3 where sourcing_id = $1 and stage = $2 and status = 'held' and not coalesce(hold, false)`, [job.id, stage, reason])
}

/** Agent commission on a completed job: a share of the service fee, paid out by admin. */
async function earnCommission(db: Db, job: Row, feeUsd: number) {
  if (!job.agent_user_id || !(feeUsd > 0)) return
  const cfg = await sourcingSettings(db); const amount = r2(feeUsd * cfg.agentCommissionPct); if (!(amount > 0)) return
  const { rows } = await db.query('select 1 from agent_earnings where sourcing_id = $1', [job.id]); if (rows.length) return
  await db.query(`insert into agent_earnings (id,sourcing_id,agent_user_id,amount_usd,status,note) values ($1,$2,$3,$4,'earned',$5)`, ['ae_' + uid(), job.id, job.agent_user_id, amount, `${Math.round(cfg.agentCommissionPct * 100)}% of the $${feeUsd.toLocaleString()} service fee on ${job.ref}`])
  await notify(db, { userId: job.agent_user_id, kind: 'sourcing', title: `Commission earned on ${job.ref}: $${amount.toLocaleString()}`, body: 'It will be included in your next payout.', link: '/dashboard/sourcing?view=earnings', dedupe: `src:${job.id}:commission` })
}

/** Hook from payments.markPaid: a sourcing stage was paid → move the job on. */
export async function onSourcingPaid(db: Db, p: Row) {
  const job = await jobById(db, p.sourcing_id); if (!job) return
  const amount = Number(p.amount_usd)
  if (p.stage === 'fee') {
    await pushTimeline(db, job, 'closed', `Sourcing fee $${amount.toLocaleString()} paid — supplier contacts unlocked.`, job.contact_name)
    await releaseStage(db, job, 'fee', 'sourcing:fee')
    await earnCommission(db, job, amount)
    await tellCustomer(db, job, `Supplier contacts unlocked — ${job.ref}`, `Thanks — your $${amount.toLocaleString()} sourcing fee is received. Factory names and contacts are now on your request. Want us to handle the order too? Reply on the request and your agent will upgrade it.`, `src:${job.id}:fee`)
    await tellAgents(db, job, `${job.ref}: sourcing fee paid`, `${job.contact_name} paid $${amount.toLocaleString()} for the shortlist on "${job.title}".`, `src:${job.id}:fee:a`)
  } else if (p.stage === 'deposit') {
    await pushTimeline(db, job, 'deposit_paid', `Deposit $${amount.toLocaleString()} paid — held in escrow until the factory order is confirmed.`, job.contact_name)
    await tellCustomer(db, job, `Deposit received — ${job.ref}`, `$${amount.toLocaleString()} is held by Ntemtem. Your agent will now place the order with the factory in Ntemtem's name and confirm the production schedule.`, `src:${job.id}:dep`)
    await tellAgents(db, job, `${job.ref}: deposit paid — place the order`, `${job.contact_name} paid $${amount.toLocaleString()}. Place the PO with the factory and record the number, lead time and ready date.`, `src:${job.id}:dep:a`)
  } else if (p.stage === 'sample') {
    const sample = { ...(J(job.sample) ?? {}), status: 'paid', paidAt: new Date().toISOString() }
    await db.query('update sourcing_requests set sample = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(sample)])
    await tellCustomer(db, job, `Sample paid — ${job.ref}`, `$${amount.toLocaleString()} received. Your agent will order the sample and courier it to you with a tracking number.`, `src:${job.id}:sample:paid`)
    await tellAgents(db, job, `${job.ref}: sample paid — order it`, `${job.contact_name} paid $${amount.toLocaleString()} for a sample. Order it from the factory and courier it with tracking.`, `src:${job.id}:sample:paid:a`)
  } else if (p.stage === 'balance') {
    await pushTimeline(db, job, 'balance_paid', `Balance $${amount.toLocaleString()} paid.`, job.contact_name)
    await tellCustomer(db, job, `Balance received — ${job.ref}`, `$${amount.toLocaleString()} received. Your goods are being released to our ${ORIGINS[originOf(job)].hub} warehouse and booked onto the next sailing or flight.`, `src:${job.id}:bal`)
    await tellAgents(db, job, `${job.ref}: balance paid — collect & ship`, `${job.contact_name} paid the $${amount.toLocaleString()} balance. Pay the ${ORIGINS[originOf(job)].seller} balance, collect the goods and book the shipment.`, `src:${job.id}:bal:a`)
  }
}

/** Hook from notify.notifyShipmentStatus: the hand-off shipment moved. */
export async function sourcingOnShipmentStatus(db: Db, s: Row, status: ShipmentStatus) {
  try {
    if (status !== 'delivered') return
    const { rows } = await db.query<Row>(`${JOB_SELECT} where j.shipment_id = $1 and j.status not in ('delivered','closed','cancelled')`, [s.id])
    for (const job of rows) {
      await pushTimeline(db, job, 'delivered', `Shipment ${s.ref} delivered.`, 'Ntemtem')
      await tellCustomer(db, job, `Delivered — ${job.ref}`, `Your sourced order "${job.title}" has been delivered. Close the request from your dashboard and leave the team a review.`, `src:${job.id}:delivered`)
    }
  } catch (e) { console.error('[sourcing] shipment hook', e) }
}

/* ------------------------------------------------------------------ routes */
export function mountSourcing(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const isAgent = (u: ApiUser) => u.admin || (u.role === 'shipper' && u.shipperId === SOURCING_SHIPPER && u.staffRole !== 'driver')
  const agentOnly = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (!isAgent(u)) throw new HttpError(403, 'Ntemtem Sourcing team only.'); return u }
  const access = async (db: Db, req: Request, id: string) => {
    const u = await requireUser(db, req); const job = await jobById(db, id); if (!job) throw new HttpError(404, 'Sourcing request not found.')
    const agent = isAgent(u); const owner = u.role === 'customer' && job.user_id === u.id
    if (!agent && !owner) throw new HttpError(403, 'You do not have access to this request.')
    return { u, job, agent, owner, viewer: (u.admin ? 'admin' : agent ? 'agent' : 'customer') as 'admin' | 'agent' | 'customer' }
  }
  const quotesFor = async (db: Db, jobId: string) => (await db.query<Row>(`${QUOTE_SELECT} where q.sourcing_id = $1 order by q.status = 'accepted' desc, q.total_usd asc`, [jobId])).rows
  const paymentsFor = async (db: Db, jobId: string) => (await db.query<Row>(`${PAY_SELECT} where p.sourcing_id = $1 and p.status <> 'cancelled' order by p.created_at`, [jobId])).rows
  const acceptedQuote = async (db: Db, job: Row) => (job.accepted_quote_id ? (await db.query<Row>(`${QUOTE_SELECT} where q.id = $1`, [job.accepted_quote_id])).rows[0] ?? null : null)
  /** What's payable right now (stage + amount), or null. */
  const due = async (db: Db, job: Row, cfg: SourcingSettings) => {
    const paid = (await paymentsFor(db, job.id)).filter((p) => ['held', 'released', 'paid_out', 'direct'].includes(p.status)).map((p) => p.stage as string)
    const sample = J(job.sample) as Row | null
    if (sample?.status === 'quoted' && !paid.includes('sample')) return { stage: 'sample' as const, amountUsd: r2(Number(sample.costUsd)), items: [{ description: `Sample of "${job.title}" incl. factory charge, handling and courier — ${job.ref}`, amountUsd: r2(Number(sample.costUsd)), kind: 'sourcing' }] }
    const q = await acceptedQuote(db, job); if (!q) return null
    if (job.tier === 'find') return job.status === 'quoted' && !paid.includes('fee') ? { stage: 'fee' as const, amountUsd: r2(Number(q.service_fee_usd) || cfg.findFeeUsd), items: [{ description: `Sourcing fee — supplier shortlist for "${job.title}" (${job.ref})`, amountUsd: r2(Number(q.service_fee_usd) || cfg.findFeeUsd), kind: 'sourcing' }] } : null
    if (job.status === 'quoted' && !paid.includes('deposit')) return { stage: 'deposit' as const, amountUsd: Number(q.deposit_usd), items: [{ description: `Sourcing service fee — ${job.ref}`, amountUsd: Number(q.service_fee_usd), kind: 'sourcing' }, { description: `Quality inspection in ${ORIGINS[originOf(job)].name}`, amountUsd: Number(q.inspection_usd), kind: 'sourcing' }, { description: `${originOf(job) === 'CN' ? 'Factory' : 'Supplier'} deposit (${Math.round(cfg.depositPct * 100)}% of $${Number(q.factory_usd).toLocaleString()})`, amountUsd: r2(Number(q.deposit_usd) - Number(q.service_fee_usd) - Number(q.inspection_usd)), kind: 'sourcing' }] }
    if (job.status === 'inspected' && (J(job.qc)?.result === 'pass') && !paid.includes('balance')) {
      const bal = r2(Number(q.total_usd) - Number(q.deposit_usd))
      const items = [{ description: `${originOf(job) === 'CN' ? 'Factory' : 'Supplier'} balance — ${job.ref}`, amountUsd: r2(Number(q.factory_usd) - (Number(q.deposit_usd) - Number(q.service_fee_usd) - Number(q.inspection_usd))), kind: 'sourcing' }, { description: `${ORIGINS[originOf(job)].hub} warehouse handling & export`, amountUsd: Number(q.handling_usd), kind: 'sourcing' }, { description: `${job.mode === 'air' ? 'Air' : 'Ocean'} freight to ${countryByCode(job.destination)?.name ?? job.destination}`, amountUsd: Number(q.freight_usd), kind: 'freight' }]
      if (Number(q.insurance_usd) > 0) items.push({ description: 'All-risk cargo insurance', amountUsd: Number(q.insurance_usd), kind: 'insurance' })
      if (Number(q.duty_est_usd) > 0) items.push({ description: 'Customs duty & clearance (estimate, reconciled at delivery)', amountUsd: Number(q.duty_est_usd), kind: 'sourcing' })
      return { stage: 'balance' as const, amountUsd: bal, items }
    }
    return null
  }
  const detail = async (db: Db, job: Row, viewer: 'customer' | 'agent' | 'admin') => {
    const cfg = await sourcingSettings(db); const pcfg = await paymentSettings(db)
    const out = jobOut(job, viewer); const quotes = await quotesFor(db, job.id); const payments = await paymentsFor(db, job.id)
    const { rows: msgs } = await db.query<Row>(`select * from sourcing_messages where sourcing_id = $1 order by created_at desc limit 100`, [job.id])
    const { rows: files } = await db.query<Row>(`select id, kind, title, mime, size, uploaded_by, uploaded_by_role, created_at from sourcing_files where sourcing_id = $1 order by created_at desc`, [job.id])
    const d = !['closed', 'cancelled'].includes(job.status) ? await due(db, job, cfg) : null
    return {
      job: out, quotes: quotes.map((q) => quoteOut(q, out.supplierRevealed)), payments: payments.map(paymentStage),
      messages: msgs.reverse().map((m) => ({ id: m.id, author: m.author, role: m.role, body: m.body, at: ISO(m.created_at), mine: false })),
      files: files.map((f) => ({ id: f.id, kind: f.kind, title: f.title, mime: f.mime, size: Number(f.size), by: f.uploaded_by, role: f.uploaded_by_role, at: ISO(f.created_at), url: `/api/sourcing/${job.id}/files/${f.id}` })),
      due: d, canPay: viewer === 'customer' && !!d && pcfg.enabled && stripeMode() !== 'off', online: pcfg.enabled && stripeMode() !== 'off', steps: STEPS.map((id) => ({ id, label: stepLabels[id] })), settings: publicPricing(cfg),
    }
  }

  /* ---- public ---- */
  r.get('/sourcing/config', wrap(async (_req, res) => {
    const db = await getDb(); const cfg = await sourcingSettings(db)
    const { rows: ag } = await db.query<Row>(`select count(*)::int as n from staff where shipper_id = $1 and status <> 'removed'`, [SOURCING_SHIPPER])
    const { rows: sup } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where verified)::int as v from suppliers where active`)
    const { rows: done } = await db.query<Row>(`select count(*)::int as n from sourcing_requests where status in ('shipped','delivered','closed')`)
    res.set('Cache-Control', 'no-store')
    res.json({ enabled: cfg.enabled, tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })), pricing: publicPricing(cfg), origins: Object.values(ORIGINS).map((o) => ({ ...o, perUsd: rateFor(cfg, o.code) })), stats: { agents: ag[0]?.n ?? 0, suppliers: sup[0]?.n ?? 0, verifiedSuppliers: sup[0]?.v ?? 0, completed: done[0]?.n ?? 0 }, steps: STEPS.map((id) => ({ id, label: stepLabels[id] })) })
  }))

  /* ---- customer ---- */
  r.post('/sourcing', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'customer') throw new HttpError(403, 'Sign in as a customer to request sourcing.')
    const cfg = await sourcingSettings(db); if (!cfg.enabled) throw new HttpError(409, 'Sourcing requests are paused right now.')
    const b = zRequest.parse(req.body); if (!countryByCode(b.destination)) throw new HttpError(400, 'Pick a destination country we ship to.')
    const id = 'src_' + uid(); const ref = 'SRC-' + makeRef().slice(3)
    const links = b.reference && !b.links.includes(b.reference.url) ? [b.reference.url, ...b.links].slice(0, 6) : b.links
    await db.query(`insert into sourcing_requests (id,ref,user_id,tier,title,description,links,quantity,unit,target_price_usd,destination,destination_city,mode,deadline,contact_name,contact_email,contact_phone,company,status,timeline,reference,origin_country) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'requested',$19,$20,$21)`,
      [id, ref, u.id, b.tier, b.title, b.description, JSON.stringify(links), b.quantity, b.unit, b.targetPriceUsd ?? null, b.destination, b.destinationCity, b.mode, b.deadline ?? null, b.contactName, b.contactEmail, b.contactPhone, b.company, JSON.stringify([{ at: new Date().toISOString(), status: 'requested', note: `${TIERS[b.tier].label} from ${ORIGINS[b.origin].name} — ${b.quantity} ${b.unit}${b.reference ? ` · from ${b.reference.platform}` : ''}`, by: b.contactName }]), b.reference ? JSON.stringify(b.reference) : null, b.origin])
    const job = await jobById(db, id)
    await tellCustomer(db, job, `Sourcing request received — ${ref}`, `Thanks ${b.contactName.split(' ')[0]}. Our ${ORIGINS[b.origin].name} sourcing team will pick up "${b.title}" within one business day and start on supplier options. You'll get a message here as soon as an agent is assigned.`, `src:${id}:new`)
    await notifyShipperStaff(db, SOURCING_SHIPPER, { kind: 'sourcing', title: `New sourcing request ${ref} (${ORIGINS[b.origin].flag} ${ORIGINS[b.origin].short}): ${b.title}`, body: `${TIERS[b.tier].label} · buy in ${ORIGINS[b.origin].name} · ${b.quantity.toLocaleString()} ${b.unit} → ${countryByCode(b.destination)?.name}${b.targetPriceUsd ? ` · target $${b.targetPriceUsd}` : ''}. Assign an agent.`, link: `/dashboard/sourcing/${id}`, dedupe: `src:${id}:new:a` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json(await detail(db, job, 'customer'))
  }))
  r.get('/sourcing/mine', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`${JOB_SELECT} where j.user_id = $1 order by (j.status in ('closed','cancelled')) asc, j.updated_at desc`, [u.id])
    res.set('Cache-Control', 'no-store'); res.json({ requests: rows.map((j) => jobOut(j, 'customer')) })
  }))
  r.get('/sourcing/:id', wrap(async (req, res) => {
    const db = await getDb(); const { job, viewer, u } = await access(db, req, String(req.params.id))
    const out = await detail(db, job, viewer); out.messages = out.messages.map((m) => ({ ...m, mine: m.author === u.name }))
    res.set('Cache-Control', 'no-store'); res.json(out)
  }))
  r.post('/sourcing/:id/accept', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Only the customer accepts a quote.')
    if (job.status !== 'quoted') throw new HttpError(409, 'There is no open quote to accept.')
    const b = z.object({ quoteId: z.string().min(1), qty: z.number().int().min(1).max(10_000_000).optional() }).parse(req.body)
    let { rows } = await db.query<Row>(`${QUOTE_SELECT} where q.id = $1 and q.sourcing_id = $2`, [b.quoteId, job.id]); let q = rows[0]; if (!q) throw new HttpError(404, 'Quote not found.')
    // Bulk: the customer may take a different quantity — reprice from the breaks and the same freight line.
    if (b.qty && b.qty !== Number(q.qty)) {
      if (Number(q.moq) > 0 && b.qty < Number(q.moq)) throw new HttpError(400, `The factory's minimum is ${Number(q.moq).toLocaleString()} ${job.unit}.`)
      const cfg = await sourcingSettings(db); const tiers = (J(q.tiers) ?? []) as { minQty: number; unitPriceCny: number }[]
      const unit = tierPrice(Number(q.base_price_cny ?? q.unit_price_cny), tiers, b.qty); const freightScale = b.qty / Number(q.qty)
      const px = priceOut(job.tier as Tier, cfg, { unitPriceCny: unit, qty: b.qty, freightUsd: r2(Number(q.freight_usd) * freightScale), insuranceUsd: r2(Number(q.insurance_usd) * freightScale), dutyEstUsd: r2(Number(q.duty_est_usd) * freightScale) }, originOf(job))
      await db.query(`update sourcing_quotes set unit_price_cny=$2, qty=$3, factory_usd=$4, service_fee_usd=$5, freight_usd=$6, insurance_usd=$7, duty_est_usd=$8, total_usd=$9, deposit_usd=$10 where id = $1`, [q.id, unit, b.qty, px.factory, px.fee, px.freight, px.insurance, px.duty, px.total, px.deposit])
      await db.query('update sourcing_requests set quantity = $2 where id = $1', [job.id, b.qty])
      rows = (await db.query<Row>(`${QUOTE_SELECT} where q.id = $1`, [q.id])).rows; q = rows[0]
    }
    await db.query(`update sourcing_quotes set status = case when id = $2 then 'accepted' else 'rejected' end where sourcing_id = $1`, [job.id, q.id])
    const timeline = (J(job.timeline) ?? []) as Row[]; timeline.push({ at: new Date().toISOString(), status: 'quoted', note: `Accepted option "${q.title}"${b.qty ? ` for ${b.qty.toLocaleString()} ${job.unit}` : ''} — $${Number(q.total_usd).toLocaleString()} landed.`, by: u.name })
    await db.query(`update sourcing_requests set accepted_quote_id = $2, timeline = $3, updated_at = now() where id = $1`, [job.id, q.id, JSON.stringify(timeline.slice(-60))])
    await tellAgents(db, job, `${job.ref}: ${u.name} accepted "${q.title}"`, `Waiting on the ${job.tier === 'find' ? 'sourcing fee' : 'deposit'} of $${Number(job.tier === 'find' ? q.service_fee_usd : q.deposit_usd).toLocaleString()}.`, `src:${job.id}:accept:${q.id}`)
    res.json(await detail(db, await jobById(db, job.id), 'customer'))
  }))
  r.post('/sourcing/:id/checkout', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Only the customer can pay.')
    const pcfg = await paymentSettings(db); if (!pcfg.enabled || stripeMode() === 'off') throw new HttpError(409, 'Online payments are not available right now — your agent will send bank details.')
    const cfg = await sourcingSettings(db); const dd = await due(db, job, cfg); if (!dd) throw new HttpError(409, 'Nothing to pay right now.')
    await db.query(`update escrow_payments set status = 'cancelled' where sourcing_id = $1 and stage = $2 and status = 'pending'`, [job.id, dd.stage])
    const id = 'esc_' + uid(); const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const session = await stripe('/checkout/sessions', {
      mode: 'payment', client_reference_id: id, customer_email: u.email || undefined, success_url: `${base}/#/sourcing/${job.id}?paid=${id}`, cancel_url: `${base}/#/sourcing/${job.id}?paid=cancel`,
      metadata: { payment_id: id, sourcing_id: job.id, sourcing_ref: job.ref, stage: dd.stage }, payment_intent_data: { description: `Ntemtem Sourcing ${job.ref} — ${dd.stage}`, metadata: { payment_id: id, sourcing_ref: job.ref } },
      line_items: dd.items.map((i) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(i.amountUsd * 100), product_data: { name: i.description } } })),
    })
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,status,provider,provider_session_id,sourcing_id,stage) values ($1,null,$2,$3,$4,$5,'pending','stripe',$6,$7,$8)`, [id, SOURCING_SHIPPER, u.id, JSON.stringify(dd.items), dd.amountUsd, session.id, job.id, dd.stage])
    res.status(201).json({ url: session.url, paymentId: id })
  }))
  r.post('/sourcing/:id/payments/:pid/verify', wrap(async (req, res) => {
    const db = await getDb(); const { job } = await access(db, req, String(req.params.id))
    const { rows } = await db.query<Row>(`${PAY_SELECT} where p.id = $1 and p.sourcing_id = $2`, [req.params.pid, job.id]); let p = rows[0]; if (!p) throw new HttpError(404, 'Payment not found.')
    if (p.status === 'pending' && p.provider === 'stripe' && p.provider_session_id && stripeMode() !== 'off') {
      const session = await stripe<Row>(`/checkout/sessions/${p.provider_session_id}`)
      if (session.payment_status === 'paid') p = await markPaid(db, p, { intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, method: session.payment_method_types?.[0] ?? 'card' })
    }
    res.json({ payment: paymentStage(p) })
  }))
  /** Agent/admin records money that arrived by bank or mobile money. */
  r.post('/sourcing/:id/payments/record', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    const cfg = await sourcingSettings(db); const dd = await due(db, job, cfg); if (!dd) throw new HttpError(409, 'Nothing is due on this request.')
    const b = z.object({ method: z.enum(['bank', 'cash', 'mobile_money', 'card', 'other']), note: z.string().trim().max(200).default('') }).parse(req.body)
    const id = 'esc_' + uid()
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,status,provider,method,sourcing_id,stage) values ($1,null,$2,$3,$4,$5,'pending','manual',$6,$7,$8)`, [id, SOURCING_SHIPPER, job.user_id, JSON.stringify(dd.items), dd.amountUsd, b.method, job.id, dd.stage])
    const { rows } = await db.query<Row>(`${PAY_SELECT} where p.id = $1`, [id])
    await markPaid(db, rows[0], { method: b.method, direct: true, by: u.name })
    res.status(201).json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.post('/sourcing/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { job, u, viewer } = await access(db, req, String(req.params.id)); const b = zMessage.parse(req.body)
    if (['closed', 'cancelled'].includes(job.status)) throw new HttpError(409, 'This request is closed.')
    const id = 'msg_' + uid(); await db.query(`insert into sourcing_messages (id,sourcing_id,user_id,author,role,body) values ($1,$2,$3,$4,$5,$6)`, [id, job.id, u.id, u.name, viewer, b.body])
    await db.query('update sourcing_requests set updated_at = now() where id = $1', [job.id])
    if (viewer === 'customer') await tellAgents(db, job, `${job.ref}: message from ${u.name}`, b.body.slice(0, 160), `src:${job.id}:msg:${id}`)
    else await tellCustomer(db, job, `${u.name} (Ntemtem Sourcing) — ${job.ref}`, b.body.slice(0, 160), `src:${job.id}:msg:${id}`)
    res.status(201).json({ message: { id, author: u.name, role: viewer, body: b.body, at: new Date().toISOString(), mine: true } })
  }))
  r.post('/sourcing/:id/files', wrap(async (req, res) => {
    const db = await getDb(); const { job, u, viewer } = await access(db, req, String(req.params.id)); const b = zFile.parse(req.body)
    const data = b.data.replace(/^data:[^;]+;base64,/, ''); const size = Math.floor((data.length * 3) / 4)
    if (size > 3_000_000) throw new HttpError(413, 'Keep files under 3 MB.')
    const id = 'sf_' + uid(); await db.query(`insert into sourcing_files (id,sourcing_id,kind,title,mime,size,data,uploaded_by,uploaded_by_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, job.id, b.kind, b.title, b.mime, size, data, u.name, viewer])
    await db.query('update sourcing_requests set updated_at = now() where id = $1', [job.id])
    if (viewer !== 'customer') await tellCustomer(db, job, `${b.kind === 'qc' ? 'Inspection photos' : b.kind === 'photo' ? 'New photos' : 'New document'} on ${job.ref}`, `${u.name} added "${b.title}".`, `src:${job.id}:file:${id}`)
    res.status(201).json({ file: { id, kind: b.kind, title: b.title, mime: b.mime, size, by: u.name, role: viewer, at: new Date().toISOString(), url: `/api/sourcing/${job.id}/files/${id}` } })
  }))
  r.get('/sourcing/:id/files/:fid', wrap(async (req, res) => {
    const db = await getDb(); const { job } = await access(db, req, String(req.params.id))
    const { rows } = await db.query<Row>('select * from sourcing_files where id = $1 and sourcing_id = $2', [req.params.fid, job.id]); const f = rows[0]; if (!f) throw new HttpError(404, 'File not found.')
    res.set('Content-Type', f.mime); res.set('Cache-Control', 'private, max-age=3600'); res.set('Content-Disposition', `inline; filename="${String(f.title).replace(/[^\w.-]+/g, '_')}${f.mime === 'application/pdf' ? '.pdf' : f.mime === 'image/png' ? '.png' : f.mime === 'image/webp' ? '.webp' : '.jpg'}"`)
    res.send(Buffer.from(f.data, 'base64'))
  }))
  r.post('/sourcing/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Customers cancel their own requests; the team cancels from the board.')
    if (!['requested', 'assigned', 'sourcing', 'quoted'].includes(job.status)) throw new HttpError(409, 'Once a deposit is paid, ask your agent to cancel — a refund may apply.')
    const b = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {})
    await db.query(`update escrow_payments set status = 'cancelled' where sourcing_id = $1 and status = 'pending'`, [job.id])
    await pushTimeline(db, job, 'cancelled', b.reason || 'Cancelled by customer.', u.name)
    await tellAgents(db, job, `${job.ref} cancelled by ${u.name}`, b.reason || 'No reason given.', `src:${job.id}:cancel`)
    res.json(await detail(db, await jobById(db, job.id), 'customer'))
  }))
  r.post('/sourcing/:id/close', wrap(async (req, res) => {
    const db = await getDb(); const { job, u, viewer } = await access(db, req, String(req.params.id))
    if (!['delivered', 'shipped'].includes(job.status)) throw new HttpError(409, 'Close the request once the goods are delivered.')
    await pushTimeline(db, job, 'closed', 'Closed — thanks for sourcing with Ntemtem.', u.name)
    res.json(await detail(db, await jobById(db, job.id), viewer))
  }))

  /* ---- team board ---- */
  r.get('/sourcing', wrap(async (req, res) => {
    const db = await getDb(); const u = await agentOnly(db, req)
    const mine = req.query.mine === '1'; const params: unknown[] = []; const where: string[] = []
    if (mine) { params.push(u.id); where.push(`j.agent_user_id = $${params.length}`) }
    if (typeof req.query.status === 'string' && req.query.status) { params.push(req.query.status); where.push(`j.status = $${params.length}`) }
    const { rows } = await db.query<Row>(`${JOB_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by (j.status in ('closed','cancelled')) asc, (j.agent_user_id is null) desc, j.updated_at desc limit 300`, params)
    const { rows: agents } = await db.query<Row>(`select u.id, u.name, st.city, st.role, (select count(*) from sourcing_requests j where j.agent_user_id = u.id and j.status not in ('closed','cancelled'))::int as open from staff st join users u on u.id = st.user_id where st.shipper_id = $1 and st.status <> 'removed' order by u.name`, [SOURCING_SHIPPER])
    const { rows: owner } = await db.query<Row>(`select u.id, u.name from users u where u.shipper_id = $1 and not exists (select 1 from staff st where st.user_id = u.id and st.shipper_id = $1)`, [SOURCING_SHIPPER])
    res.set('Cache-Control', 'no-store')
    res.json({ requests: rows.map((j) => jobOut(j, u.admin ? 'admin' : 'agent')), agents: [...owner.map((o) => ({ id: o.id, name: o.name, city: '', role: 'owner', open: rows.filter((j) => j.agent_user_id === o.id && !['closed', 'cancelled'].includes(j.status)).length })), ...agents.map((a) => ({ id: a.id, name: a.name, city: a.city, role: a.role, open: Number(a.open) }))], me: u.id, isAdmin: u.admin })
  }))
  r.post('/sourcing/:id/assign', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    const b = zAssign.parse(req.body)
    if (['closed', 'cancelled'].includes(job.status)) throw new HttpError(409, 'This request is closed.')
    const target = b.agentUserId ?? u.id
    const { rows } = await db.query<Row>(`select u.id, u.name from users u where u.id = $1 and (u.shipper_id = $2 or u.is_admin)`, [target, SOURCING_SHIPPER]); if (!rows[0]) throw new HttpError(404, 'That person is not on the sourcing team.')
    const extra: Record<string, unknown> = { agent_user_id: target }
    const status = job.status === 'requested' ? 'assigned' : job.status
    await pushTimeline(db, job, status, `${rows[0].name} is your sourcing agent.`, u.name, extra)
    await tellCustomer(db, job, `${rows[0].name} is on your request — ${job.ref}`, `${rows[0].name} from our ${ORIGINS[originOf(job)].name} team is now sourcing "${job.title}". Expect supplier options within a few days; you can message them any time from the request.`, `src:${job.id}:assigned:${target}`)
    if (target !== u.id) await notify(db, { userId: target, kind: 'sourcing', title: `Assigned: ${job.ref} — ${job.title}`, body: `${TIERS[job.tier as Tier].label} · ${Number(job.quantity).toLocaleString()} ${job.unit} → ${countryByCode(job.destination)?.name}.`, link: `/dashboard/sourcing/${job.id}`, dedupe: `src:${job.id}:assigned:${target}:a` })
    res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.post('/sourcing/:id/quotes', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    if (!['assigned', 'sourcing', 'quoted'].includes(job.status)) throw new HttpError(409, 'Quotes can only be added before the customer pays.')
    const b = zQuote.parse(req.body); const cfg = await sourcingSettings(db)
    const { rows: sp } = await db.query<Row>('select * from suppliers where id = $1', [b.supplierId]); if (!sp[0]) throw new HttpError(404, 'Supplier not found.')
    const tiers = b.tiers.filter((t) => t.minQty > 1).sort((x, y) => x.minQty - y.minQty)
    const unit = tierPrice(b.unitPriceCny, tiers, b.qty)
    const { factory, fee, inspection, handling, freight, insurance, duty, total, deposit } = priceOut(job.tier as Tier, cfg, { ...b, unitPriceCny: unit }, originOf(job))
    const id = 'sq_' + uid()
    await db.query(`insert into sourcing_quotes (id,sourcing_id,supplier_id,title,unit_price_cny,qty,moq,lead_days,factory_usd,service_fee_usd,inspection_usd,handling_usd,freight_usd,insurance_usd,duty_est_usd,total_usd,deposit_usd,notes,sample_available,status,created_by,tiers,base_price_cny,currency) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'proposed',$20,$21,$22,$23)`,
      [id, job.id, b.supplierId, b.title, unit, b.qty, b.moq, b.leadDays, factory, fee, inspection, handling, freight, insurance, duty, total, deposit, b.notes, b.sampleAvailable, u.name, JSON.stringify(tiers), b.unitPriceCny, ORIGINS[originOf(job)].currency])
    const n = (await quotesFor(db, job.id)).length
    await pushTimeline(db, job, 'quoted', `${u.name} added option "${b.title}" — $${total.toLocaleString()} landed${job.tier === 'find' ? '' : ` ($${deposit.toLocaleString()} deposit)`}.`, u.name)
    await tellCustomer(db, job, n === 1 ? `Your supplier options are ready — ${job.ref}` : `New option added — ${job.ref}`, `${u.name} found "${b.title}" from a ${[sp[0].city, ORIGINS[asOrigin(sp[0].country)].short].filter(Boolean).join(', ')} ${ORIGINS[originOf(job)].seller}: ${b.qty.toLocaleString()} ${job.unit} at ${localPrice(b.unitPriceCny, originOf(job))} each, ${b.leadDays} days lead time, $${total.toLocaleString()} landed. Review and accept on your request.`, `src:${job.id}:quote:${id}`)
    res.status(201).json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.delete('/sourcing/:id/quotes/:qid', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    await db.query(`delete from sourcing_quotes where id = $1 and sourcing_id = $2 and status = 'proposed'`, [req.params.qid, job.id])
    if (!(await quotesFor(db, job.id)).length && job.status === 'quoted') await db.query(`update sourcing_requests set status = 'sourcing', updated_at = now() where id = $1`, [job.id])
    res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.post('/sourcing/:id/step', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    const b = zStep.parse(req.body); const order = [...STEPS] as string[]
    if (['closed', 'cancelled'].includes(job.status)) throw new HttpError(409, 'This request is closed.')
    if (b.status === 'cancelled') {
      const { rows: held } = await db.query<Row>(`${PAY_SELECT} where p.sourcing_id = $1 and p.status in ('held','released')`, [job.id])
      if (held.length && !b.refund && !u.admin) throw new HttpError(409, 'Money has been collected — tick "refund" (admin) or settle with the customer first.')
      if (b.refund) { if (!u.admin) throw new HttpError(403, 'Only an admin can refund.'); for (const p of held) await refundPayment(db, p, null, b.note || 'Sourcing request cancelled') }
      await db.query(`update escrow_payments set status = 'cancelled' where sourcing_id = $1 and status = 'pending'`, [job.id])
      await pushTimeline(db, job, 'cancelled', b.note || 'Cancelled by Ntemtem Sourcing.', u.name)
      await tellCustomer(db, job, `${job.ref} was cancelled`, `${b.note || 'Our team cancelled this request.'}${held.length && b.refund ? ' Your payments are being refunded (3–10 business days).' : ''}`, `src:${job.id}:cancel`)
      return res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
    }
    if (!STEP_BY[b.status].includes('agent')) throw new HttpError(400, `"${stepLabels[b.status]}" happens automatically.`)
    if (order.indexOf(b.status) <= order.indexOf(job.status)) throw new HttpError(409, 'Requests only move forward.')
    const extra: Record<string, unknown> = {}; let note = b.note
    if (b.status === 'ordered') {
      if (!['deposit_paid'].includes(job.status)) throw new HttpError(409, 'Place the order once the deposit is paid.')
      const q = await acceptedQuote(db, job); if (!q) throw new HttpError(409, 'No accepted quote.')
      const po = { number: b.po?.number || `PO-${job.ref.slice(4)}`, incoterm: b.po?.incoterm ?? 'FOB', leadDays: b.po?.leadDays ?? Number(q.lead_days), readyBy: b.po?.readyBy ?? new Date(Date.now() + (b.po?.leadDays ?? Number(q.lead_days)) * 86400000).toISOString().slice(0, 10), factoryPaidCny: b.po?.factoryPaidCny ?? null, supplier: q.sup_name, placedAt: new Date().toISOString(), placedBy: u.name }
      extra.po = JSON.stringify(po); note = note || `PO ${po.number} placed with ${q.sup_name} (${po.incoterm}), ready by ${po.readyBy}.`
      await releaseStage(db, job, 'deposit', 'sourcing:ordered')
    }
    if (b.status === 'inspected') {
      if (!b.qc) throw new HttpError(400, 'Record the inspection result.')
      if (!['ordered', 'in_production'].includes(job.status)) throw new HttpError(409, 'Inspect after the order is placed.')
      extra.qc = JSON.stringify({ ...b.qc, items: b.qc.items ?? (J(job.qc)?.items ?? []), aql: aqlSample(Number(job.quantity)), at: new Date().toISOString(), by: u.name }); note = note || `Inspection ${b.qc.result}${b.qc.checked ? ` — ${b.qc.checked} checked, ${b.qc.defects} defects` : ''}.${b.qc.notes ? ` ${b.qc.notes}` : ''}`
      if (b.qc.result !== 'pass') { await pushTimeline(db, job, 'in_production', note, u.name, extra); await tellCustomer(db, job, `Inspection: ${b.qc.result} — ${job.ref}`, `${u.name} inspected the goods: ${b.qc.result}. ${b.qc.notes || 'The factory has been asked to fix the issues before anything ships.'}`, `src:${job.id}:qc:${Date.now()}`); return res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent')) }
    }
    if (b.status === 'received_cn') {
      if (!['balance_paid'].includes(job.status)) throw new HttpError(409, 'Collect the goods once the balance is paid.')
      const { rows: sites } = await db.query<Row>(`select * from sites where shipper_id = $1 and kind = 'origin' and active order by (country = $2) desc, (id = $3) desc, created_at limit 1`, [SOURCING_SHIPPER, originOf(job), ORIGINS[originOf(job)].site])
      const site = b.receipt?.siteId ? (await db.query<Row>('select * from sites where id = $1 and shipper_id = $2', [b.receipt.siteId, SOURCING_SHIPPER])).rows[0] : sites[0]
      const rc = { cartons: b.receipt?.cartons ?? 0, grossKg: b.receipt?.grossKg ?? 0, cbm: b.receipt?.cbm ?? 0, marks: b.receipt?.marks || job.ref, siteId: site?.id ?? null, siteName: site?.name ?? `${ORIGINS[originOf(job)].hub} warehouse`, receivedAt: new Date().toISOString(), by: u.name }
      extra.receipt = JSON.stringify(rc); note = note || `Received at ${rc.siteName}: ${rc.cartons} carton${rc.cartons === 1 ? '' : 's'}${rc.grossKg ? `, ${rc.grossKg} kg` : ''}${rc.cbm ? `, ${rc.cbm} m³` : ''}. Marks: ${rc.marks}.`
    }
    if (b.status === 'shipped') {
      if (!['balance_paid', 'received_cn'].includes(job.status)) throw new HttpError(409, 'Ship after the balance is paid.')
      if (!b.ship) throw new HttpError(400, 'Enter the shipment details (mode, ETA).')
      const q = await acceptedQuote(db, job)
      const sid = uid(); const ref = makeRef(); const from = `${b.ship.originCity || ORIGINS[originOf(job)].hub}, ${originOf(job)}`
      await db.query('insert into shipments (id,ref,shipper_id,user_id,mode,origin,destination,cargo,description,status,eta,customer,vessel_name,flight,departed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())',
        [sid, ref, SOURCING_SHIPPER, job.user_id, b.ship.mode, from, job.destination, b.ship.cargo, b.ship.description || `${Number(job.quantity).toLocaleString()} ${job.unit} — ${job.title} (sourced ${job.ref})`, 'in_transit', b.ship.eta, job.contact_name, b.ship.vesselName ?? null, b.ship.flight ?? null])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, 'in_transit', from, `Departed ${ORIGINS[originOf(job)].name} — sourced order ${job.ref}${q ? ` from ${q.sup_name}` : ''}. ${b.note || ''}`.trim()])
      if (job.user_id) await attachShipmentToClient(db, SOURCING_SHIPPER, job.user_id, sid, job.contact_name, job.contact_email)
      extra.shipment_id = sid; note = note || `Shipped ${b.ship.mode === 'air' ? 'by air' : 'by sea'} from ${b.ship.originCity || ORIGINS[originOf(job)].hub} — ${ref}, ETA ${b.ship.eta}.`
      // Consolidation: drop the order into one of our open containers; its stage decides the shipment status.
      if (b.containerId && b.ship.mode === 'ocean') {
        const { rows: cs } = await db.query<Row>(`select * from containers where id = $1 and shipper_id = $2 and status in ('booked','loading','gated_in')`, [b.containerId, SOURCING_SHIPPER]); const c = cs[0]
        if (!c) throw new HttpError(409, 'That container is not open for loading.')
        const st = c.status === 'gated_in' ? 'at_origin_port' : 'picked_up'
        await db.query('update shipments set container_id = $2, status = $3, departed_at = null, vessel_name = coalesce(nullif($4, \'\'), vessel_name), eta = coalesce($5, eta) where id = $1', [sid, c.id, st, c.vessel_name ?? '', c.eta ?? null])
        await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, st, c.origin_port || from, `Loaded into container ${c.ref}${c.number ? ` (${c.number})` : ''} by ${u.name}.`])
        if (c.status === 'booked') { await db.query(`update containers set status = 'loading' where id = $1`, [c.id]); await db.query(`insert into container_events (container_id,status,place,note,by_name) values ($1,'loading',$2,'First orders loaded.',$3)`, [c.id, c.origin_port || '', u.name]) }
        note = `${note} Consolidated in container ${c.ref}${c.number ? ` (${c.number})` : ''}${c.eta ? `, ETA ${String(c.eta).slice(0, 10)}` : ''}.`
      }
      await releaseStage(db, job, 'balance', 'sourcing:shipped')
      const q2 = await acceptedQuote(db, job); if (q2) await earnCommission(db, job, Number(q2.service_fee_usd))
    }
    await pushTimeline(db, job, b.status, note, u.name, extra)
    const fresh = await jobById(db, job.id)
    const bodies: Partial<Record<Step, string>> = {
      sourcing: `${u.name} is contacting ${ORIGINS[originOf(job)].sellers} for "${job.title}". Options usually land within 2–4 days.`, ordered: note, in_production: note || 'The factory has started production.', inspected: `${note} Review the photos and pay the balance to release the goods.`,
      received_cn: note || `Your goods are at our ${ORIGINS[originOf(job)].hub} warehouse and being packed for export.`, shipped: `${note} Track it from your dashboard.`, delivered: note || 'Delivered.', closed: 'Closed.',
    }
    await tellCustomer(db, fresh, `${jobOut(fresh, 'customer').statusLabel} — ${job.ref}`, bodies[b.status] ?? note, `src:${job.id}:${b.status}`)
    res.json(await detail(db, fresh, u.admin ? 'admin' : 'agent'))
  }))

  /* ---- link import: pre-fill a request from a 1688 / Alibaba / Taobao / Amazon page ---- */
  r.get('/sourcing/tools/import', wrap(async (req, res) => {
    const db = await getDb(); await requireUser(db, req)
    const raw = typeof req.query.url === 'string' ? req.query.url.trim() : ''; let url: URL
    try { url = new URL(raw); if (!/^https?:$/.test(url.protocol)) throw new Error() } catch { throw new HttpError(400, 'Paste a full product link, starting with https://') }
    const platform = PLATFORMS.find(([re]) => re.test(url.hostname))?.[1] ?? 'web'
    const cfg = await sourcingSettings(db)
    let html = ''; let fetched = false
    try {
      const target = process.env.LINK_IMPORT_PROXY ? `${process.env.LINK_IMPORT_PROXY}${encodeURIComponent(url.href)}` : url.href
      const r = await fetch(target, { signal: AbortSignal.timeout(9000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', accept: 'text/html,*/*;q=0.8', 'accept-language': originForLink(platform, url.hostname) === 'CN' ? 'zh-CN,zh;q=0.9,en;q=0.8' : originForLink(platform, url.hostname) === 'GB' ? 'en-GB,en;q=0.9' : 'en-US,en;q=0.9' } })
      if (r.ok) { html = (await r.text()).slice(0, 2_000_000); fetched = true }
    } catch { /* blocked or slow — fall back to what the link itself tells us */ }
    const p = html ? parseProductPage(url.href, html) : { platform, productId: (url.pathname.match(/(\d{6,})/)?.[1] ?? url.searchParams.get('id') ?? ''), title: '', description: '', image: '', price: null as number | null, currency: currencyFor(platform, url.hostname), moq: null as number | null }
    const toUsd = (n: number, cur: string) => (cur === 'USD' ? n : cur === 'GBP' ? n / cfg.gbpPerUsd : cur === 'CNY' ? n / cfg.cnyPerUsd : n)
    const priceUsd = p.price == null ? null : r2(toUsd(p.price, p.currency)); const priceCny = priceUsd == null ? null : p.currency === 'CNY' ? r2(p.price!) : r2(priceUsd * cfg.cnyPerUsd)
    const origin = originForLink(p.platform, url.hostname) ?? (p.currency === 'GBP' ? 'GB' : null)
    const wall = /\b(log ?in|sign ?in|verify|captcha|robot|access denied|unusual traffic)\b|登录|验证/i.test(p.title) || (html.length < 4000 && /log ?in|sign ?in|登录/i.test(html) && !p.price)
    if (wall) { p.title = ''; p.description = ''; p.image = ''; p.price = null }
    if (fetched && !p.title && p.price != null && !ld_has_offer(html)) p.price = null // a bare number on a bot-check page is not a price
    const blocked = fetched && (wall || (!p.title && !p.price))
    res.set('Cache-Control', 'no-store')
    res.json({ reference: { url: url.href, platform: p.platform, productId: p.productId, title: p.title, image: p.image, priceCny, priceUsd, price: p.price, currency: p.currency, origin, moq: p.moq }, origin, description: p.description, fetched, blocked, hint: !fetched ? `${p.platform === 'web' ? 'That site' : p.platform} didn't let us read the page — we saved the link; your agent will open it${origin ? ` in ${ORIGINS[origin].name}` : ''}.` : blocked ? `${p.platform} showed us a login wall; the link is saved and your agent will check the listing directly.` : p.price == null ? 'We found the listing but not a clear price — your agent will confirm it with the factory.' : origin && origin !== 'CN' ? `Reference price from ${p.platform} — your agent confirms stock and the best price (often lower from a wholesaler for bulk).` : `Reference price from ${p.platform} — factory quotes are usually lower for bulk and include our inspection.` })
  }))

  /* ---- reorders & standing orders ---- */
  const reorderFrom = async (db: Db, parent: Row, by: string, opts: { quantity?: number; auto?: boolean }) => {
    const q = await acceptedQuote(db, parent); if (!q) throw new HttpError(409, 'Reorders need a completed order with an accepted quote.')
    const cfg = await sourcingSettings(db); const qty = opts.quantity ?? Number(parent.quantity)
    const tiers = (J(q.tiers) ?? []) as { minQty: number; unitPriceCny: number }[]; const unit = tierPrice(Number(q.base_price_cny ?? q.unit_price_cny), tiers, qty); const scale = qty / Number(q.qty)
    const px = priceOut(parent.tier as Tier, cfg, { unitPriceCny: unit, qty, freightUsd: r2(Number(q.freight_usd) * scale), insuranceUsd: r2(Number(q.insurance_usd) * scale), dutyEstUsd: r2(Number(q.duty_est_usd) * scale) }, originOf(parent))
    const id = 'src_' + uid(); const ref = 'SRC-' + makeRef().slice(3); const qid = 'sq_' + uid(); const now = new Date().toISOString()
    await db.query(`insert into sourcing_requests (id,ref,user_id,tier,title,description,links,quantity,unit,target_price_usd,destination,destination_city,mode,contact_name,contact_email,contact_phone,company,status,agent_user_id,timeline,reference,parent_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'quoted',$18,$19,$20,$21)`,
      [id, ref, parent.user_id, parent.tier, parent.title, parent.description, parent.links, qty, parent.unit, parent.target_price_usd, parent.destination, parent.destination_city, parent.mode, parent.contact_name, parent.contact_email, parent.contact_phone, parent.company, parent.agent_user_id, JSON.stringify([{ at: now, status: 'requested', note: `${opts.auto ? 'Standing order' : 'Reorder'} of ${parent.ref} — ${qty.toLocaleString()} ${parent.unit}`, by }, ...(parent.agent_user_id ? [{ at: now, status: 'assigned', note: `${parent.agent_name ?? 'Your agent'} keeps this order.`, by: 'Ntemtem' }] : []), { at: now, status: 'quoted', note: `Repeat price from ${q.sup_name}: ${localPrice(unit, originOf(parent))} × ${qty.toLocaleString()} — $${px.total.toLocaleString()} landed. Accept to pay the deposit; your agent re-confirms with the factory.`, by: 'Ntemtem' }]), parent.reference, parent.id])
    await db.query(`insert into sourcing_quotes (id,sourcing_id,supplier_id,title,unit_price_cny,qty,moq,lead_days,factory_usd,service_fee_usd,inspection_usd,handling_usd,freight_usd,insurance_usd,duty_est_usd,total_usd,deposit_usd,notes,sample_available,status,created_by,tiers,base_price_cny) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,'proposed',$19,$20,$21)`,
      [qid, id, q.supplier_id, `${q.title} (repeat)`, unit, qty, q.moq, q.lead_days, px.factory, px.fee, px.inspection, px.handling, px.freight, px.insurance, px.duty, px.total, px.deposit, `Same supplier and spec as ${parent.ref}. Price carried over — subject to the factory's re-confirmation.`, 'Ntemtem', JSON.stringify(tiers), q.base_price_cny ?? q.unit_price_cny])
    await db.query('update sourcing_requests set origin_country = $2 where id = $1', [id, originOf(parent)]); await db.query('update sourcing_quotes set currency = $2 where id = $1', [qid, q.currency ?? ORIGINS[originOf(parent)].currency])
    const job = await jobById(db, id)
    await tellCustomer(db, job, `${opts.auto ? 'Standing order placed' : 'Reorder ready'} — ${ref}`, `${qty.toLocaleString()} ${parent.unit} of "${parent.title}" from the same ${ORIGINS[originOf(parent)].seller} at $${px.total.toLocaleString()} landed. Accept the option and pay the $${px.deposit.toLocaleString()} deposit to start production.`, `src:${id}:reorder`)
    await tellAgents(db, job, `${ref}: ${opts.auto ? 'standing order' : 'reorder'} of ${parent.ref}`, `${parent.contact_name} · ${qty.toLocaleString()} ${parent.unit} · re-confirm ${localPrice(unit, originOf(parent))} with ${q.sup_name}.`, `src:${id}:reorder:a`)
    return job
  }
  r.post('/sourcing/:id/reorder', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Customers reorder their own products.')
    if (!['shipped', 'delivered', 'closed'].includes(job.status)) throw new HttpError(409, 'Reorder once the first order has shipped.')
    const b = z.object({ quantity: z.number().int().min(1).max(10_000_000).optional() }).parse(req.body ?? {})
    const made = await reorderFrom(db, job, u.name, { quantity: b.quantity })
    res.status(201).json(await detail(db, made, 'customer'))
  }))
  r.put('/sourcing/:id/recurring', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Customers manage their standing orders.')
    if (!job.accepted_quote_id) throw new HttpError(409, 'Set up a standing order once this one has a confirmed price.')
    const b = zRecurring.parse(req.body); const cur = (J(job.recurring) ?? {}) as Row
    const nextAt = b.nextAt ?? cur.nextAt ?? new Date(Date.now() + b.everyWeeks * 7 * 86400000).toISOString().slice(0, 10)
    const rec = { active: b.active, everyWeeks: b.everyWeeks, nextAt, quantity: Number(job.quantity), updatedAt: new Date().toISOString(), by: u.name, placed: cur.placed ?? 0 }
    await db.query('update sourcing_requests set recurring = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(rec)])
    if (b.active) await tellAgents(db, job, `${job.ref}: standing order every ${b.everyWeeks} weeks`, `${u.name} wants ${Number(job.quantity).toLocaleString()} ${job.unit} repeated automatically from ${nextAt}.`, `src:${job.id}:recurring:${nextAt}`)
    res.json(await detail(db, await jobById(db, job.id), 'customer'))
  }))

  /* ---- agent "today": photo-first mobile feed ---- */
  r.get('/sourcing/team/today', wrap(async (req, res) => {
    const db = await getDb(); const u = await agentOnly(db, req)
    const { rows } = await db.query<Row>(`${JOB_SELECT} where j.status not in ('closed','cancelled') and (j.agent_user_id = $1 or j.agent_user_id is null) order by j.updated_at desc limit 100`, [u.id])
    const ids = rows.map((j) => j.id)
    const { rows: msgs } = ids.length ? await db.query<Row>(`select distinct on (sourcing_id) sourcing_id, author, role, body, created_at from sourcing_messages where sourcing_id = any($1::text[]) order by sourcing_id, created_at desc`, [ids]) : { rows: [] as Row[] }
    const { rows: photos } = ids.length ? await db.query<Row>(`select sourcing_id, count(*)::int as n from sourcing_files where sourcing_id = any($1::text[]) group by sourcing_id`, [ids]) : { rows: [] as Row[] }
    const action = (j: Row): { label: string; step?: Step; kind: 'step' | 'quote' | 'sample' | 'assign' | 'wait' | 'reply' } => {
      const sm = J(j.sample) as Row | null
      if (!j.agent_user_id) return { label: 'Take this request', kind: 'assign' }
      if (sm?.status === 'requested') return { label: 'Quote the sample', kind: 'sample' }
      if (sm?.status === 'paid') return { label: 'Ship the sample', kind: 'sample' }
      switch (j.status) {
        case 'assigned': return { label: 'Start sourcing', step: 'sourcing', kind: 'step' }
        case 'sourcing': return { label: 'Add supplier options', kind: 'quote' }
        case 'quoted': return { label: 'Waiting for the customer', kind: 'wait' }
        case 'deposit_paid': return { label: 'Place the factory order', step: 'ordered', kind: 'step' }
        case 'ordered': return { label: 'Photos from the line → In production', step: 'in_production', kind: 'step' }
        case 'in_production': return { label: 'Inspect & photograph', step: 'inspected', kind: 'step' }
        case 'inspected': return { label: 'Waiting for the balance', kind: 'wait' }
        case 'balance_paid': return { label: 'Receive at warehouse', step: 'received_cn', kind: 'step' }
        case 'received_cn': return { label: 'Ship it', step: 'shipped', kind: 'step' }
        case 'shipped': return { label: 'In transit', kind: 'wait' }
        default: return { label: stepLabels[j.status as Step] ?? j.status, kind: 'wait' }
      }
    }
    const items = rows.map((j) => { const m = msgs.find((x) => x.sourcing_id === j.id); const a = action(j); return { ...jobOut(j, u.admin ? 'admin' : 'agent'), action: m && m.role === 'customer' && new Date(m.created_at).getTime() > new Date(j.updated_at).getTime() - 1 && a.kind === 'wait' ? { label: 'Reply to the customer', kind: 'reply' as const } : a, lastMessage: m ? { author: m.author, role: m.role, body: String(m.body).slice(0, 140), at: ISO(m.created_at) } : null, photos: Number(photos.find((x) => x.sourcing_id === j.id)?.n ?? 0) } })
    const rank = { assign: 0, reply: 1, sample: 2, quote: 3, step: 4, wait: 9 }
    items.sort((a, b) => rank[a.action.kind] - rank[b.action.kind])
    res.set('Cache-Control', 'no-store'); res.json({ items, me: u.id, name: u.name })
  }))

  /* ---- samples ---- */
  r.post('/sourcing/:id/sample', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Customers request samples.')
    if (!['assigned', 'sourcing', 'quoted'].includes(job.status)) throw new HttpError(409, 'Samples are requested before the order is placed.')
    const cur = J(job.sample) as Row | null; if (cur && !['rejected', 'approved'].includes(cur.status)) throw new HttpError(409, 'A sample is already in progress.')
    const b = zSampleReq.parse(req.body)
    const sample = { status: 'requested', note: b.note, address: b.address, requestedAt: new Date().toISOString(), history: [...(cur?.history ?? []), ...(cur ? [{ ...cur, history: undefined }] : [])] }
    await db.query('update sourcing_requests set sample = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(sample)])
    await tellAgents(db, job, `${job.ref}: ${u.name} wants a sample`, `${b.note || 'No notes.'} Quote the sample cost (factory charge + courier) on the request.`, `src:${job.id}:sample:req:${Date.now()}`)
    res.json(await detail(db, await jobById(db, job.id), 'customer'))
  }))
  r.post('/sourcing/:id/sample/quote', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    const cur = J(job.sample) as Row | null; if (!cur || cur.status !== 'requested') throw new HttpError(409, 'No sample request to quote.')
    const b = zSampleQuote.parse(req.body); const cfg = await sourcingSettings(db)
    const sample = { ...cur, status: 'quoted', costUsd: r2(b.costUsd + cfg.sampleHandlingUsd), factoryUsd: b.costUsd, handlingUsd: cfg.sampleHandlingUsd, quoteNote: b.note, quotedAt: new Date().toISOString(), quotedBy: u.name }
    await db.query('update sourcing_requests set sample = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(sample)])
    await tellCustomer(db, job, `Sample quote — ${job.ref}`, `${u.name} can send you a sample for $${sample.costUsd.toLocaleString()} (factory + courier, incl. $${cfg.sampleHandlingUsd} handling). ${b.note} Pay from the request and it ships within a few days.`, `src:${job.id}:sample:quote:${Date.now()}`)
    res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.post('/sourcing/:id/sample/ship', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    const cur = J(job.sample) as Row | null; if (!cur || cur.status !== 'paid') throw new HttpError(409, 'The sample is shipped once it is paid.')
    const b = zSampleShip.parse(req.body)
    const sample = { ...cur, status: 'shipped', courier: b.courier, tracking: b.tracking, shipNote: b.note, shippedAt: new Date().toISOString(), shippedBy: u.name }
    await db.query('update sourcing_requests set sample = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(sample)])
    await db.query(`update escrow_payments set status = 'released', released_at = now(), release_reason = 'sourcing:sample' where sourcing_id = $1 and stage = 'sample' and status = 'held'`, [job.id])
    await tellCustomer(db, job, `Sample on its way — ${job.ref}`, `${b.courier}${b.tracking ? ` ${b.tracking}` : ''}. ${b.note} Tell us what you think once it arrives — approve it to move ahead with the order.`, `src:${job.id}:sample:ship`)
    res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.post('/sourcing/:id/sample/feedback', wrap(async (req, res) => {
    const db = await getDb(); const { job, owner, u } = await access(db, req, String(req.params.id)); if (!owner) throw new HttpError(403, 'Customers approve samples.')
    const cur = J(job.sample) as Row | null; if (!cur || cur.status !== 'shipped') throw new HttpError(409, 'Wait for the sample to arrive.')
    const b = zSampleFeedback.parse(req.body)
    const sample = { ...cur, status: b.result, feedback: b.note, feedbackAt: new Date().toISOString() }
    await db.query('update sourcing_requests set sample = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(sample)])
    await tellAgents(db, job, `${job.ref}: sample ${b.result} by ${u.name}`, b.note || (b.result === 'approved' ? 'Go ahead with the order.' : 'Find another option.'), `src:${job.id}:sample:fb:${Date.now()}`)
    res.json(await detail(db, await jobById(db, job.id), 'customer'))
  }))

  /* ---- QC checklist & report ---- */
  r.put('/sourcing/:id/qc/checklist', wrap(async (req, res) => {
    const db = await getDb(); const { job, agent, u } = await access(db, req, String(req.params.id)); if (!agent) throw new HttpError(403, 'Team only.')
    if (!['ordered', 'in_production', 'inspected'].includes(job.status)) throw new HttpError(409, 'The checklist is filled during production.')
    const b = zQcItems.parse(req.body); const cur = (J(job.qc) ?? {}) as Row
    const qc = { ...cur, items: b.items, sampleSize: b.sampleSize ?? cur.sampleSize ?? aqlSample(Number(job.quantity)).sampleSize, aql: aqlSample(Number(job.quantity)), draftBy: u.name, draftAt: new Date().toISOString() }
    await db.query('update sourcing_requests set qc = $2, updated_at = now() where id = $1', [job.id, JSON.stringify(qc)])
    res.json(await detail(db, await jobById(db, job.id), u.admin ? 'admin' : 'agent'))
  }))
  r.get('/sourcing/:id/qc-report', wrap(async (req, res) => {
    const db = await getDb(); const { job, viewer } = await access(db, req, String(req.params.id))
    const qc = J(job.qc) as Row | null; const q = await acceptedQuote(db, job)
    const { rows: photos } = await db.query<Row>(`select id, title, mime, uploaded_by, created_at from sourcing_files where sourcing_id = $1 and kind = 'qc' order by created_at`, [job.id])
    res.set('Cache-Control', 'no-store')
    res.json({ job: jobOut(job, viewer), qc, checklist: QC_ITEMS.map((i) => ({ ...i, ...(qc?.items ?? []).find((x: Row) => x.id === i.id) })), aql: aqlSample(Number(job.quantity)), supplier: q && (viewer !== 'customer' || jobOut(job, viewer).supplierRevealed) ? { name: q.sup_name, city: q.sup_city } : null, po: J(job.po), photos: photos.map((p) => ({ id: p.id, title: p.title, by: p.uploaded_by, at: ISO(p.created_at), url: `/api/sourcing/${job.id}/files/${p.id}` })) })
  }))

  /* ---- consolidation: our open containers ---- */
  r.get('/sourcing/containers/open', wrap(async (req, res) => {
    const db = await getDb(); await agentOnly(db, req)
    const { rows } = await db.query<Row>(`select c.*, (select count(*) from shipments s where s.container_id = c.id)::int as loaded from containers c where c.shipper_id = $1 and c.status in ('booked','loading','gated_in') order by c.cutoff_date nulls last, c.created_at desc`, [SOURCING_SHIPPER])
    res.set('Cache-Control', 'no-store'); res.json({ containers: rows.map((c) => ({ id: c.id, ref: c.ref, number: c.number, size: c.size, line: c.line, destination: c.destination, destinationPort: c.destination_port, originPort: c.origin_port, status: c.status, cutoffDate: c.cutoff_date ? String(c.cutoff_date).slice(0, 10) : null, etd: c.etd ? String(c.etd).slice(0, 10) : null, eta: c.eta ? String(c.eta).slice(0, 10) : null, loaded: Number(c.loaded) })) })
  }))

  /* ---- agent earnings ---- */
  r.get('/sourcing/team/earnings', wrap(async (req, res) => {
    const db = await getDb(); const u = await agentOnly(db, req)
    const { rows } = await db.query<Row>(`select e.*, j.ref, j.title, u.name as agent_name from agent_earnings e join sourcing_requests j on j.id = e.sourcing_id join users u on u.id = e.agent_user_id ${u.admin ? '' : 'where e.agent_user_id = $1'} order by e.earned_at desc limit 300`, u.admin ? [] : [u.id])
    const out = rows.map((e) => ({ id: e.id, sourcingId: e.sourcing_id, ref: e.ref, title: e.title, agentId: e.agent_user_id, agentName: e.agent_name, amountUsd: Number(e.amount_usd), status: e.status as 'earned' | 'paid', note: e.note, earnedAt: ISO(e.earned_at), paidAt: ISO(e.paid_at) }))
    res.set('Cache-Control', 'no-store'); res.json({ earnings: out, totals: { earnedUsd: r2(out.filter((e) => e.status === 'earned').reduce((n, e) => n + e.amountUsd, 0)), paidUsd: r2(out.filter((e) => e.status === 'paid').reduce((n, e) => n + e.amountUsd, 0)) }, isAdmin: u.admin })
  }))
  r.post('/admin/sourcing/sweep', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); await sweepStandingOrders(db); res.json({ ok: true }) }))
  r.post('/admin/sourcing/earnings/:id/paid', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireAdmin(db, req); const b = z.object({ reference: z.string().trim().max(80).default('') }).parse(req.body ?? {})
    const { rows } = await db.query<Row>(`update agent_earnings set status = 'paid', paid_at = now(), note = note || $2 where id = $1 and status = 'earned' returning *`, [req.params.id, b.reference ? ` · paid ${b.reference}` : ` · paid by ${u.name}`]); if (!rows[0]) throw new HttpError(404, 'Nothing to mark paid.')
    res.json({ ok: true })
  }))

  /* ---- supplier audits ---- */
  r.post('/suppliers/:id/audits', wrap(async (req, res) => {
    const db = await getDb(); const u = await agentOnly(db, req); const { rows } = await db.query<Row>('select * from suppliers where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Supplier not found.')
    const b = zAudit.parse(req.body); const id = 'aud_' + uid()
    await db.query(`insert into supplier_audits (id,supplier_id,auditor,audit_date,score,result,findings,categories) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, rows[0].id, u.name, b.date, b.score, b.result, b.findings, JSON.stringify(b.categories ?? {})])
    await db.query(`update suppliers set verified = $2, rating = case when $3 > 0 then round(($3 / 20.0)::numeric, 1) else rating end where id = $1`, [rows[0].id, b.result === 'pass', b.score])
    res.status(201).json({ supplier: supplierOut((await db.query<Row>(`${SUP_SELECT} where sp.id = $1`, [rows[0].id])).rows[0], true), audit: { id, auditor: u.name, date: b.date, score: b.score, result: b.result, findings: b.findings, categories: b.categories ?? {} } })
  }))
  r.get('/suppliers/:id/audits', wrap(async (req, res) => {
    const db = await getDb(); await agentOnly(db, req)
    const { rows } = await db.query<Row>('select * from supplier_audits where supplier_id = $1 order by audit_date desc', [req.params.id])
    res.json({ audits: rows.map((a) => ({ id: a.id, auditor: a.auditor, date: String(a.audit_date).slice(0, 10), score: Number(a.score), result: a.result, findings: a.findings, categories: J(a.categories) ?? {}, at: ISO(a.created_at) })) })
  }))

  /* ---- suppliers (team) ---- */
  r.get('/suppliers', wrap(async (req, res) => {
    const db = await getDb(); await agentOnly(db, req)
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; const country = typeof req.query.country === 'string' && req.query.country ? asOrigin(req.query.country) : null
    const where: string[] = []; const params: unknown[] = []
    if (q) { params.push(`%${q}%`); where.push(`(lower(sp.name) like $${params.length} or lower(sp.city) like $${params.length} or lower(sp.products::text) like $${params.length})`) }
    if (country) { params.push(country); where.push(`sp.country = $${params.length}`) }
    const { rows } = await db.query<Row>(`${SUP_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by sp.verified desc, sp.rating desc, sp.name limit 300`, params)
    res.set('Cache-Control', 'no-store'); res.json({ suppliers: rows.map((s) => supplierOut(s, true)) })
  }))
  r.post('/suppliers', wrap(async (req, res) => {
    const db = await getDb(); const u = await agentOnly(db, req); const b = zSupplier.parse(req.body); const id = 'sup_' + uid()
    await db.query(`insert into suppliers (id,name,city,province,products,contact,wechat,phone,website,storefront,notes,verified,rating,active,added_by,country) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [id, b.name, b.city, b.province, JSON.stringify(b.products), b.contact, b.wechat, b.phone, b.website, b.storefront, b.notes, b.verified && u.admin ? true : b.verified, b.rating, b.active, u.name, b.country ?? 'CN'])
    res.status(201).json({ supplier: supplierOut((await db.query<Row>(`${SUP_SELECT} where sp.id = $1`, [id])).rows[0], true) })
  }))
  r.patch('/suppliers/:id', wrap(async (req, res) => {
    const db = await getDb(); await agentOnly(db, req); const { rows } = await db.query<Row>('select * from suppliers where id = $1', [req.params.id]); const cur = rows[0]; if (!cur) throw new HttpError(404, 'Supplier not found.')
    const b = zSupplier.partial().parse(req.body)
    await db.query(`update suppliers set name=$2, city=$3, province=$4, products=$5, contact=$6, wechat=$7, phone=$8, website=$9, storefront=$10, notes=$11, verified=$12, rating=$13, active=$14, country=$15 where id=$1`,
      [cur.id, b.name ?? cur.name, b.city ?? cur.city, b.province ?? cur.province, JSON.stringify(b.products ?? J(cur.products)), b.contact ?? cur.contact, b.wechat ?? cur.wechat, b.phone ?? cur.phone, b.website ?? cur.website, b.storefront ?? cur.storefront, b.notes ?? cur.notes, b.verified ?? cur.verified, b.rating ?? cur.rating, b.active ?? cur.active, b.country ?? cur.country ?? 'CN'])
    res.json({ supplier: supplierOut((await db.query<Row>(`${SUP_SELECT} where sp.id = $1`, [cur.id])).rows[0], true) })
  }))

  /* ---- admin settings ---- */
  r.get('/admin/sourcing/settings', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json({ settings: await sourcingSettings(db) }) }))
  r.put('/admin/sourcing/settings', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zSettings.parse(req.body); const cur = await sourcingSettings(db); const next = { ...cur, ...b }
    await db.query(`insert into settings (id,value,updated_at) values ('sourcing',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(next)])
    res.json({ settings: await sourcingSettings(db) })
  }))
}

/** Standing orders whose next date has arrived become reorders. Runs every 6 hours. */
export async function sweepStandingOrders(db: Db) {
  const { rows } = await db.query<Row>(`${JOB_SELECT} where j.recurring is not null and (j.recurring->>'active')::boolean and (j.recurring->>'nextAt')::date <= current_date`)
  for (const parent of rows) {
    try {
      const rec = J(parent.recurring) as Row; const q = await (async () => (parent.accepted_quote_id ? (await db.query<Row>(`${QUOTE_SELECT} where q.id = $1`, [parent.accepted_quote_id])).rows[0] : null))()
      if (!q) continue
      // Same logic as the reorder route, kept inline to avoid dragging the router in here.
      const cfg = await sourcingSettings(db); const qty = Number(rec.quantity ?? parent.quantity); const tiers = (J(q.tiers) ?? []) as { minQty: number; unitPriceCny: number }[]
      const unit = tierPrice(Number(q.base_price_cny ?? q.unit_price_cny), tiers, qty); const scale = qty / Number(q.qty)
      const px = priceOut(parent.tier as Tier, cfg, { unitPriceCny: unit, qty, freightUsd: r2(Number(q.freight_usd) * scale), insuranceUsd: r2(Number(q.insurance_usd) * scale), dutyEstUsd: r2(Number(q.duty_est_usd) * scale) }, originOf(parent))
      const id = 'src_' + uid(); const ref = 'SRC-' + makeRef().slice(3); const qid = 'sq_' + uid(); const now = new Date().toISOString()
      await db.query(`insert into sourcing_requests (id,ref,user_id,tier,title,description,links,quantity,unit,target_price_usd,destination,destination_city,mode,contact_name,contact_email,contact_phone,company,status,agent_user_id,timeline,reference,parent_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'quoted',$18,$19,$20,$21)`,
        [id, ref, parent.user_id, parent.tier, parent.title, parent.description, parent.links, qty, parent.unit, parent.target_price_usd, parent.destination, parent.destination_city, parent.mode, parent.contact_name, parent.contact_email, parent.contact_phone, parent.company, parent.agent_user_id, JSON.stringify([{ at: now, status: 'requested', note: `Standing order of ${parent.ref} — ${qty.toLocaleString()} ${parent.unit}`, by: 'Ntemtem' }, { at: now, status: 'quoted', note: `Repeat price from ${q.sup_name}: ${localPrice(unit, originOf(parent))} × ${qty.toLocaleString()} — $${px.total.toLocaleString()} landed.`, by: 'Ntemtem' }]), parent.reference, parent.id])
      await db.query(`insert into sourcing_quotes (id,sourcing_id,supplier_id,title,unit_price_cny,qty,moq,lead_days,factory_usd,service_fee_usd,inspection_usd,handling_usd,freight_usd,insurance_usd,duty_est_usd,total_usd,deposit_usd,notes,sample_available,status,created_by,tiers,base_price_cny) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,'proposed','Ntemtem',$19,$20)`,
        [qid, id, q.supplier_id, `${q.title} (repeat)`, unit, qty, q.moq, q.lead_days, px.factory, px.fee, px.inspection, px.handling, px.freight, px.insurance, px.duty, px.total, px.deposit, `Standing order from ${parent.ref}.`, JSON.stringify(tiers), q.base_price_cny ?? q.unit_price_cny])
      await db.query('update sourcing_requests set origin_country = $2 where id = $1', [id, originOf(parent)]); await db.query('update sourcing_quotes set currency = $2 where id = $1', [qid, q.currency ?? ORIGINS[originOf(parent)].currency])
      const next = new Date(new Date(rec.nextAt).getTime() + Number(rec.everyWeeks) * 7 * 86400000).toISOString().slice(0, 10)
      await db.query('update sourcing_requests set recurring = $2 where id = $1', [parent.id, JSON.stringify({ ...rec, nextAt: next, placed: Number(rec.placed ?? 0) + 1, lastPlacedAt: now, lastChildId: id })])
      const job = await jobById(db, id)
      await tellCustomer(db, job, `Standing order placed — ${ref}`, `${qty.toLocaleString()} ${parent.unit} of "${parent.title}" at $${px.total.toLocaleString()} landed. Accept and pay the $${px.deposit.toLocaleString()} deposit to start production, or pause the standing order from ${parent.ref}. Next one: ${next}.`, `src:${id}:standing`)
      await tellAgents(db, job, `${ref}: standing order of ${parent.ref}`, `${parent.contact_name} · ${qty.toLocaleString()} ${parent.unit} · re-confirm ${localPrice(unit, originOf(parent))} with ${q.sup_name}.`, `src:${id}:standing:a`)
    } catch (e) { console.error('[sourcing] standing order', parent.ref, e) }
  }
}
export function startSourcingSweeps(getDb: () => Promise<Db>) {
  const run = () => getDb().then(sweepStandingOrders).catch((e) => console.error('[sourcing] sweep', e))
  setTimeout(run, 20_000); setInterval(run, 6 * 3600_000)
}

/** Platform-owned shipper + demo agents in Guangzhou, London and Houston + a few suppliers in each. Idempotent. */
export async function seedSourcingDemo(db: Db) {
  await db.query(`insert into shippers (id,name,tagline,hq,founded,modes,destinations,origins,cargo,rating,reviews,verified,response_hours,on_time,services,about,price_index,plan,initials,hue,demo,verified_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16,$17,$18,$19,false,now()) on conflict (id) do nothing`,
    [SOURCING_SHIPPER, 'Ntemtem Sourcing', 'Source, buy, inspect and ship from China — one team, one price', 'Guangzhou, China', 2026, JSON.stringify(['ocean', 'air']), JSON.stringify(['GH', 'NG', 'LR', 'TG', 'CI', 'SL', 'SN']), JSON.stringify(['Guangzhou, CN', 'Shenzhen, CN', 'Yiwu, CN']), JSON.stringify(['commercial', 'boxes', 'pallets', 'container20', 'container40']), 5, 0, 24, 98, JSON.stringify(['Supplier sourcing', 'Factory audits', 'Quality inspection', 'Consolidation', 'Export documents']), 'Ntemtem’s own sourcing team in Guangzhou, Shenzhen and Yiwu. We buy in Ntemtem’s name, inspect before anything ships, and hand your goods to the ocean or air leg.', 100, 'pro', 'SS', '#F5B82E'])
  const { rows: ex } = await db.query('select 1 from users where email = $1', ['china@shipsync.demo'])
  if (!ex.length) {
    const bcrypt = await import('bcryptjs'); const hash = await bcrypt.default.hash('shipsync', 10)
    await db.query(`insert into users (id,email,name,password_hash,role,shipper_id) values ('u_cn_wei','china@shipsync.demo','Wei Zhang',$1,'shipper',$2) on conflict (email) do nothing`, [hash, SOURCING_SHIPPER])
    await db.query(`insert into staff (id,shipper_id,user_id,name,email,phone,role,status,base,city) values ('stf_cn_wei',$1,'u_cn_wei','Wei Zhang','china@shipsync.demo','+86 20 8888 0101','owner','active','origin','Guangzhou') on conflict (id) do nothing`, [SOURCING_SHIPPER])
  }
  await db.query(`insert into sites (id,shipper_id,name,kind,address,city,country,free_days,rate_usd,vehicle_rate_usd,hours,active) values ('site_cn_gz',$1,'Guangzhou consolidation warehouse','origin','Huangpu District, Guangzhou','Guangzhou','CN',14,0.8,20,'Mon–Sat 9:00–18:00',true) on conflict (id) do nothing`, [SOURCING_SHIPPER])
  await db.query(`insert into sites (id,shipper_id,name,kind,address,city,country,free_days,rate_usd,vehicle_rate_usd,hours,active) values ('site_uk_lon',$1,'London sourcing warehouse','origin','Thurrock, Essex (for Tilbury)','London','GB',14,1.2,30,'Mon–Fri 9:00–17:30',true), ('site_us_hou',$1,'Houston sourcing warehouse','origin','Port of Houston area, TX','Houston','US',14,1,30,'Mon–Fri 8:00–17:00',true) on conflict (id) do nothing`, [SOURCING_SHIPPER])
  // One team, three buying countries.
  await db.query(`update shippers set tagline = 'Source, buy, inspect and ship from China, the UK and the USA — one team, one price', origins = $2, about = $3 where id = $1 and tagline like '%from China — one team%'`, [SOURCING_SHIPPER, JSON.stringify(['Guangzhou, CN', 'Shenzhen, CN', 'Yiwu, CN', 'London, GB', 'Houston, US']), 'Ntemtem’s own sourcing team in China, the UK and the USA. We buy in Ntemtem’s name, inspect before anything ships, and hand your goods to the ocean or air leg.'])
  const { rows: agents } = await db.query('select email from users where email in ($1, $2)', ['uk@shipsync.demo', 'usa@shipsync.demo'])
  if (agents.length < 2) {
    const bcrypt = await import('bcryptjs'); const hash = await bcrypt.default.hash('shipsync', 10)
    for (const [uidv, email, name, phone, city] of [['u_uk_grace', 'uk@shipsync.demo', 'Grace Bennett', '+44 20 7946 0101', 'London'], ['u_us_marcus', 'usa@shipsync.demo', 'Marcus Reed', '+1 713 555 0177', 'Houston']]) {
      await db.query(`insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,'shipper',$5) on conflict (email) do nothing`, [uidv, email, name, hash, SOURCING_SHIPPER])
      await db.query(`insert into staff (id,shipper_id,user_id,name,email,phone,role,status,base,city) values ($1,$2,$3,$4,$5,$6,'agent','active','origin',$7) on conflict (id) do nothing`, ['stf_' + uidv.slice(2), SOURCING_SHIPPER, uidv, name, email, phone, city])
    }
  }
  const westSup: [string, string, string, string, string, string[], string, string, string, string, boolean, number][] = [
    ['sup_uk_1', 'GB', 'Midlands Wholesale Supplies Ltd', 'Birmingham', 'West Midlands', ['Toiletries', 'Baby products', 'Household cleaning'], 'Priya Shah', '+44 121 496 0102', 'midlandswholesale.example.co.uk', '', true, 4.6],
    ['sup_uk_2', 'GB', 'Northern School & Uniform Co.', 'Manchester', 'Greater Manchester', ['School uniforms', 'Shoes', 'Stationery'], 'Tom Ellis', '+44 161 496 0103', 'northernuniform.example.co.uk', '', true, 4.5],
    ['sup_uk_3', 'GB', 'Refurb Direct UK', 'London', 'Greater London', ['Laptops', 'Phones', 'Tablets'], 'Daniel Okafor', '+44 20 7946 0104', 'refurbdirect.example.co.uk', '', false, 4.2],
    ['sup_us_1', 'US', 'Gulf Coast Auto & Truck Parts', 'Houston', 'Texas', ['Auto parts', 'Truck parts', 'Tyres'], 'Luis Garza', '+1 713 555 0105', 'gulfcoastparts.example.com', '', true, 4.7],
    ['sup_us_2', 'US', 'Lone Star Tools & Generators', 'Dallas', 'Texas', ['Power tools', 'Generators', 'Solar kits'], 'Karen Moore', '+1 214 555 0106', 'lonestartools.example.com', '', true, 4.5],
    ['sup_us_3', 'US', 'Liberty Medical Supply', 'Newark', 'New Jersey', ['Medical supplies', 'Lab equipment', 'Hospital beds'], 'Ruth Adeyemi', '+1 973 555 0107', 'libertymed.example.com', '', true, 4.8],
  ]
  for (const s of westSup) await db.query(`insert into suppliers (id,country,name,city,province,products,contact,wechat,phone,website,storefront,notes,verified,rating,active,added_by) values ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10,'',$11,$12,true,'Ntemtem') on conflict (id) do nothing`, [s[0], s[1], s[2], s[3], s[4], JSON.stringify(s[5]), s[6], s[7], s[8], s[9], s[10], s[11]])
  const { rows } = await db.query(`select 1 from suppliers where country = 'CN' limit 1`); if (rows.length) return
  const list: [string, string, string, string, string[], string, string, string, string, string, boolean, number][] = [
    ['sup_demo_1', 'Guangzhou Huaxin Household Co.', 'Guangzhou', 'Guangdong', ['Kitchenware', 'Plastic housewares', 'Storage'], 'Ms. Lin Mei', 'linmei-hx', '+86 136 0000 1101', 'huaxin-house.example.cn', 'https://huaxin.1688.com', true, 4.8],
    ['sup_demo_2', 'Shenzhen Brightwave Electronics', 'Shenzhen', 'Guangdong', ['Solar lanterns', 'Power banks', 'LED lighting'], 'Mr. Chen Wei', 'chenwei-bw', '+86 135 0000 2202', 'brightwave.example.cn', 'https://brightwave.en.alibaba.com', true, 4.7],
    ['sup_demo_3', 'Yiwu Golden Thread Textiles', 'Yiwu', 'Zhejiang', ['Fabrics', 'School uniforms', 'Bags'], 'Ms. Zhao Yan', 'zhaoyan-gt', '+86 137 0000 3303', '', 'https://goldenthread.1688.com', true, 4.6],
    ['sup_demo_4', 'Foshan Everlast Furniture', 'Foshan', 'Guangdong', ['Office chairs', 'School desks', 'Steel furniture'], 'Mr. Huang Lei', 'huanglei-el', '+86 138 0000 4404', 'everlast-fs.example.cn', '', false, 4.3],
    ['sup_demo_5', 'Ningbo Ocean Motor Parts', 'Ningbo', 'Zhejiang', ['Motorcycle parts', 'Tyres', 'Batteries'], 'Mr. Wang Tao', 'wangtao-om', '+86 139 0000 5505', '', 'https://oceanmotor.en.alibaba.com', true, 4.5],
  ]
  for (const s of list) await db.query(`insert into suppliers (id,name,city,province,products,contact,wechat,phone,website,storefront,notes,verified,rating,active,added_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'',$11,$12,true,'Ntemtem') on conflict (id) do nothing`, [s[0], s[1], s[2], s[3], JSON.stringify(s[4]), s[5], s[6], s[7], s[8], s[9], s[10], s[11]])
  // One demo request so the boards aren't empty: Abena wants solar lanterns for a shop in Kumasi.
  const { rows: demoUser } = await db.query<Row>(`select id from users where email = 'demo@shipsync.demo'`)
  if (demoUser[0]) {
    const id = 'src_demo_lanterns'
    await db.query(`insert into sourcing_requests (id,ref,user_id,tier,title,description,links,quantity,unit,target_price_usd,destination,destination_city,mode,contact_name,contact_email,contact_phone,company,status,agent_user_id,timeline) values ($1,'SRC-DEMO01',$2,'order','Solar lanterns with phone charging','Rechargeable solar lanterns (around 5 W panel, USB out, 8–12 h light) for a shop in Kumasi. Boxed retail packaging with English manual. Open to brands; CE/RoHS preferred.','["https://www.alibaba.com/showroom/solar-lantern.html"]',500,'pcs',6,'GH','Kumasi','ocean','Abena Owusu','demo@shipsync.demo','+1 917 555 0142','Owusu Trading','sourcing','u_cn_wei',$3) on conflict (id) do nothing`,
      [id, demoUser[0].id, JSON.stringify([{ at: new Date(Date.now() - 2 * 86400000).toISOString(), status: 'requested', note: 'Order & inspect — 500 pcs', by: 'Abena Owusu' }, { at: new Date(Date.now() - 86400000).toISOString(), status: 'assigned', note: 'Wei Zhang is your sourcing agent.', by: 'Ntemtem' }, { at: new Date(Date.now() - 80000000).toISOString(), status: 'sourcing', note: 'Contacting three Shenzhen factories.', by: 'Wei Zhang' }])])
    await db.query(`insert into sourcing_messages (id,sourcing_id,user_id,author,role,body) values ('msg_demo_1',$1,'u_cn_wei','Wei Zhang','agent','Hi Abena — I have samples from two Shenzhen factories arriving tomorrow. Do you want the version with a built-in radio as well, or just light + charging?') on conflict (id) do nothing`, [id])
  }
}
