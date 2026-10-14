/**
 * Cargo insurance at checkout — all-risk cover on the declared value, sold on the platform.
 *
 * The product (rates by goods class, minimum premium, cover cap, deductible, commission) is platform
 * configuration in `settings` (admin-editable), so an insurer / MGA can be plugged in without touching
 * the flow: the policy row carries the provider name and the certificate number we issue.
 *
 *   customer  quote → add cover (policy active, premium due) → file a claim
 *   shipper   collect the premium with the freight invoice → mark collected; see claims
 *   admin     set the product; review policies and claims; settle or decline
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { shipmentContext } from './documents'
import { cargoLabel, type CargoType } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const r2 = (n: number) => Math.round(n * 100) / 100

export interface InsuranceProduct {
  enabled: boolean; provider: string; coverage: string
  /** Premium as a fraction of declared value, by cargo class. */
  rates: Record<CargoType, number>
  minPremiumUsd: number; maxValueUsd: number; deductiblePct: number
  /** Ship Sync's share of the premium. */
  commissionPct: number
  terms: string
}
export const DEFAULT_PRODUCT: InsuranceProduct = {
  enabled: true, provider: 'Ship Sync Cover (underwriting partner to be announced)', coverage: 'All-risk, door to door',
  rates: { barrels: 0.02, boxes: 0.02, pallets: 0.02, vehicle: 0.015, container20: 0.015, container40: 0.015, commercial: 0.025 },
  minPremiumUsd: 15, maxValueUsd: 25000, deductiblePct: 0.05, commissionPct: 0.25,
  terms: 'Covers loss or damage from the moment the goods are received by the shipper until handover to the consignee, including transit at sea or by air. Excludes inherent vice, improper packing, undeclared items, cash, documents and wear and tear. Claims must be reported within 14 days of delivery with photos. Settlement is limited to the declared value less the deductible.',
}

export async function getProduct(db: Db): Promise<InsuranceProduct> {
  const { rows } = await db.query<Row>(`select value from settings where id = 'insurance'`)
  const v = rows[0]?.value; const saved = v ? (typeof v === 'string' ? JSON.parse(v) : v) : {}
  return { ...DEFAULT_PRODUCT, ...saved, rates: { ...DEFAULT_PRODUCT.rates, ...(saved.rates ?? {}) } }
}

export function quotePremium(p: InsuranceProduct, cargo: CargoType, valueUsd: number) {
  const value = Math.max(0, Math.min(p.maxValueUsd, valueUsd))
  const rate = p.rates[cargo] ?? 0.02
  const premium = Math.max(p.minPremiumUsd, r2(value * rate))
  return { valueUsd: value, rate, premiumUsd: r2(premium), commissionUsd: r2(premium * p.commissionPct), deductibleUsd: r2(value * p.deductiblePct), capped: valueUsd > p.maxValueUsd }
}

export const policyOut = (p: Row) => ({
  id: p.id, shipmentId: p.shipment_id, shipmentRef: p.ref ?? undefined, customer: p.customer ?? undefined, shipperId: p.shipper_id, shipperName: p.shipper_name ?? undefined, certificateNo: p.certificate_no, provider: p.provider, coverage: p.coverage,
  declaredValueUsd: Number(p.declared_value_usd), rate: Number(p.rate), premiumUsd: Number(p.premium_usd), commissionUsd: Number(p.commission_usd), deductibleUsd: Number(p.deductible_usd),
  status: p.status as 'active' | 'cancelled' | 'claim_open' | 'claim_paid' | 'claim_declined', paymentStatus: p.payment_status as 'due' | 'collected', startsAt: ISO(p.starts_at), endsAt: ISO(p.ends_at), documentId: p.document_id ?? null,
  claim: p.claim ? (typeof p.claim === 'string' ? JSON.parse(p.claim) : p.claim) : null, createdAt: ISO(p.created_at),
})

const zProduct = z.object({
  enabled: z.boolean(), provider: z.string().trim().min(2).max(120), coverage: z.string().trim().min(2).max(120),
  rates: z.record(z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']), z.number().min(0).max(0.5)),
  minPremiumUsd: z.number().min(0).max(1000), maxValueUsd: z.number().min(100).max(10_000_000), deductiblePct: z.number().min(0).max(0.5), commissionPct: z.number().min(0).max(1), terms: z.string().trim().max(2000),
})
const zBuy = z.object({ declaredValueUsd: z.number().min(1).max(10_000_000), accept: z.literal(true) })
const zClaim = z.object({ description: z.string().trim().min(10).max(1500), amountUsd: z.number().min(1).max(10_000_000), contact: z.string().trim().max(80).default('') })
const zResolve = z.object({ outcome: z.enum(['paid', 'declined']), amountUsd: z.number().min(0).max(10_000_000).optional(), note: z.string().trim().max(500).default('') })
const SELECT = `select p.*, s.ref, s.customer, sh.name as shipper_name from insurance_policies p join shipments s on s.id = p.shipment_id join shippers sh on sh.id = p.shipper_id`

export function mountInsurance(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const policyFor = async (db: Db, shipmentId: string) => (await db.query<Row>(`${SELECT} where p.shipment_id = $1 and p.status <> 'cancelled' order by p.created_at desc limit 1`, [shipmentId])).rows[0] ?? null
  const byId = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${SELECT} where p.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Policy not found.'); return rows[0] }

  /** Public product summary (for marketing / quote wizard). */
  r.get('/insurance/product', wrap(async (_req, res) => { const p = await getProduct(await getDb()); res.json({ product: { ...p, commissionPct: undefined } }) }))
  r.post('/insurance/quote', wrap(async (req, res) => {
    const db = await getDb(); const p = await getProduct(db)
    const b = z.object({ cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']), valueUsd: z.number().min(0).max(10_000_000) }).parse(req.body)
    res.json({ quote: { ...quotePremium(p, b.cargo, b.valueUsd), commissionUsd: undefined }, enabled: p.enabled })
  }))

  /* ---- per shipment ---- */
  r.get('/shipments/:id/insurance', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    const p = await getProduct(db); const pol = await policyFor(db, s.id)
    const dutyVal = (() => { try { const dj = s.duty ? (typeof s.duty === 'string' ? JSON.parse(s.duty) : s.duty) : null; return Number(dj?.input?.valueUsd) || 0 } catch { return 0 } })()
    res.set('Cache-Control', 'no-store')
    res.json({ policy: pol ? policyOut(pol) : null, product: p.enabled ? { provider: p.provider, coverage: p.coverage, rate: p.rates[s.cargo as CargoType] ?? 0.02, minPremiumUsd: p.minPremiumUsd, maxValueUsd: p.maxValueUsd, deductiblePct: p.deductiblePct, terms: p.terms } : null, suggestedValueUsd: dutyVal || null, canBuy: !pol && p.enabled && ['booked', 'picked_up'].includes(s.status), canManage: office })
  }))
  r.post('/shipments/:id/insurance', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req, String(req.params.id))
    if (!owner && !office) throw new HttpError(403, 'Only the customer or the shipper can add cover.')
    const p = await getProduct(db); if (!p.enabled || !(await (await import('./features')).featureOn(db, 'insurance', s.shipper_id))) throw new HttpError(409, 'Insurance is not available right now.')
    if (!['booked', 'picked_up'].includes(s.status)) throw new HttpError(409, 'Cover must be added before the goods leave the origin.')
    if (await policyFor(db, s.id)) throw new HttpError(409, 'This shipment is already insured.')
    const b = zBuy.parse(req.body)
    const q = quotePremium(p, s.cargo as CargoType, b.declaredValueUsd)
    const id = 'pol_' + uid(); const cert = `SSC-${new Date().getFullYear()}-${s.ref.replace(/^SS-/, '')}`
    await db.query(`insert into insurance_policies (id,shipment_id,shipper_id,user_id,certificate_no,provider,coverage,declared_value_usd,rate,premium_usd,commission_usd,deductible_usd,status,payment_status,starts_at,ends_at,bought_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active','due',now(),$13,$14)`,
      [id, s.id, s.shipper_id, s.user_id ?? null, cert, p.provider, p.coverage, q.valueUsd, q.rate, q.premiumUsd, q.commissionUsd, q.deductibleUsd, new Date(Date.now() + 120 * 86400000), u.name])
    // Certificate into the documents vault.
    const ctx = await shipmentContext(db, s)
    const docId = 'doc_' + uid()
    const payload = { ...ctx, generatedAt: new Date().toISOString(), number: cert, policy: { certificateNo: cert, provider: p.provider, coverage: p.coverage, declaredValueUsd: q.valueUsd, rate: q.rate, premiumUsd: q.premiumUsd, deductibleUsd: q.deductibleUsd, terms: p.terms, startsAt: new Date().toISOString(), insured: s.customer, cargo: cargoLabel(s.cargo as CargoType) } }
    await db.query(`insert into documents (id,shipment_id,shipper_id,kind,title,filename,mime,size,payload,source,visibility,uploaded_by,uploaded_by_role) values ($1,$2,$3,'insurance',$4,'','',0,$5,'generated','shared','Ship Sync','shipper')`, [docId, s.id, s.shipper_id, `Insurance certificate ${cert}`, JSON.stringify(payload)])
    await db.query('update insurance_policies set document_id = $2 where id = $1', [id, docId])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `All-risk cover added: $${q.valueUsd.toLocaleString()} declared, premium $${q.premiumUsd} (${cert}).`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'insurance', title: `Cover added on ${s.ref} — collect $${q.premiumUsd}`, body: `${s.customer} insured $${q.valueUsd.toLocaleString()} of ${cargoLabel(s.cargo as CargoType).toLowerCase()}. Add the premium to the freight invoice and mark it collected.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `ins:${id}` }, ['owner', 'dispatcher', 'agent'])
    if (s.user_id && !owner) await notify(db, { userId: s.user_id, kind: 'insurance', title: `Your shipment ${s.ref} is insured`, body: `${u.name} added all-risk cover for $${q.valueUsd.toLocaleString()}. Certificate ${cert} is in your documents.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `ins:${id}:c` })
    res.status(201).json({ policy: policyOut(await byId(db, id)) })
  }))
  r.post('/insurance/:id/collected', wrap(async (req, res) => {
    const db = await getDb(); const pol = await byId(db, String(req.params.id)); const { office } = await access(db, req, pol.shipment_id)
    if (!office) throw new HttpError(403, 'Only the shipper can mark the premium collected.')
    await db.query(`update insurance_policies set payment_status = 'collected', collected_at = now() where id = $1`, [pol.id])
    res.json({ policy: policyOut(await byId(db, pol.id)) })
  }))
  r.post('/insurance/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const pol = await byId(db, String(req.params.id)); const { office, owner, u } = await access(db, req, pol.shipment_id)
    if (!office && !owner && !u.admin) throw new HttpError(403, 'Not allowed.')
    if (pol.status !== 'active') throw new HttpError(409, 'Only an active policy with no claim can be cancelled.')
    const { rows: sh } = await db.query<Row>('select status from shipments where id = $1', [pol.shipment_id])
    if (!['booked', 'picked_up'].includes(sh[0]?.status) && !u.admin) throw new HttpError(409, 'Cover can only be cancelled before the goods leave the origin.')
    await db.query(`update insurance_policies set status = 'cancelled' where id = $1`, [pol.id])
    if (pol.document_id) await db.query('delete from documents where id = $1', [pol.document_id])
    res.json({ ok: true })
  }))
  r.post('/insurance/:id/claim', wrap(async (req, res) => {
    const db = await getDb(); const pol = await byId(db, String(req.params.id)); const { owner, office, u } = await access(db, req, pol.shipment_id)
    if (!owner && !office) throw new HttpError(403, 'Not allowed.')
    if (pol.status !== 'active') throw new HttpError(409, pol.status === 'claim_open' ? 'A claim is already open on this policy.' : 'This policy cannot take a claim.')
    const b = zClaim.parse(req.body)
    const claim = { description: b.description, amountUsd: Math.min(b.amountUsd, Number(pol.declared_value_usd)), contact: b.contact, filedBy: u.name, filedAt: new Date().toISOString(), outcome: null as null | string, settledUsd: null as null | number, note: '', resolvedAt: null as null | string }
    await db.query(`update insurance_policies set status = 'claim_open', claim = $2 where id = $1`, [pol.id, JSON.stringify(claim)])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,(select status from shipments where id = $1),$2,$3)', [pol.shipment_id, '', `Insurance claim filed for $${claim.amountUsd.toLocaleString()} (${pol.certificate_no}).`])
    await notifyShipperStaff(db, pol.shipper_id, { kind: 'insurance', title: `Claim filed on ${pol.ref} — $${claim.amountUsd.toLocaleString()}`, body: `${u.name}: “${b.description.slice(0, 140)}”. Attach photos to the shipment's documents.`, link: `/dashboard/shipments?q=${pol.ref}&b=all`, dedupe: `claim:${pol.id}` }, ['owner', 'dispatcher'])
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'insurance', title: `Insurance claim: ${pol.ref} — $${claim.amountUsd.toLocaleString()}`, body: `${pol.shipper_name} · ${pol.certificate_no}. Review in Admin → Insurance.`, link: '/admin?tab=insurance', dedupe: `claim:${pol.id}:${a.id}` })
    res.status(201).json({ policy: policyOut(await byId(db, pol.id)) })
  }))
  r.post('/insurance/:id/resolve', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const pol = await byId(db, String(req.params.id))
    if (pol.status !== 'claim_open') throw new HttpError(409, 'No open claim on this policy.')
    const b = zResolve.parse(req.body)
    const claim = { ...(typeof pol.claim === 'string' ? JSON.parse(pol.claim) : pol.claim), outcome: b.outcome, settledUsd: b.outcome === 'paid' ? b.amountUsd ?? 0 : 0, note: b.note, resolvedAt: new Date().toISOString(), resolvedBy: admin.name }
    await db.query(`update insurance_policies set status = $2, claim = $3 where id = $1`, [pol.id, b.outcome === 'paid' ? 'claim_paid' : 'claim_declined', JSON.stringify(claim)])
    const title = b.outcome === 'paid' ? `Claim settled on ${pol.ref}: $${(b.amountUsd ?? 0).toLocaleString()}` : `Claim on ${pol.ref} declined`
    if (pol.user_id) await notify(db, { userId: pol.user_id, kind: 'insurance', title, body: b.note || (b.outcome === 'paid' ? 'The settlement will be paid to you shortly.' : 'See the note from the claims team.'), link: `/dashboard?tab=shipments&s=${pol.shipment_id}`, dedupe: `claim:${pol.id}:res` })
    await notifyShipperStaff(db, pol.shipper_id, { kind: 'insurance', title, body: b.note || '', link: `/dashboard/shipments?q=${pol.ref}&b=all`, dedupe: `claim:${pol.id}:res` }, ['owner', 'dispatcher'])
    res.json({ policy: policyOut(await byId(db, pol.id)) })
  }))

  /* ---- admin ---- */
  r.get('/admin/insurance', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`${SELECT} order by case p.status when 'claim_open' then 0 else 1 end, p.created_at desc limit 500`)
    const product = await getProduct(db)
    const totals = rows.filter((p) => p.status !== 'cancelled').reduce((t, p) => ({ premiums: t.premiums + Number(p.premium_usd), commission: t.commission + Number(p.commission_usd), insured: t.insured + Number(p.declared_value_usd), claims: t.claims + (p.status.startsWith('claim') ? 1 : 0) }), { premiums: 0, commission: 0, insured: 0, claims: 0 })
    res.json({ policies: rows.map(policyOut), product, totals })
  }))
  r.put('/admin/insurance/product', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const cur = await getProduct(db)
    const b = zProduct.parse({ ...cur, ...req.body, rates: { ...cur.rates, ...(req.body?.rates ?? {}) } })
    await db.query(`insert into settings (id,value,updated_at) values ('insurance',$1,now()) on conflict (id) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(b)])
    res.json({ product: await getProduct(db) })
  }))
}
