/**
 * Duty & landed-cost estimator.
 *
 * Ghana follows the GRA / ICUMS assessment structure (ECOWAS CET duty bands, VAT 15% + NHIL 2.5% + GETFund 2.5%
 * on CIF + duty since the 2026 reform — the 1% COVID-19 levy was repealed from 1 Jan 2026 — plus the ECOWAS,
 * AU, EXIM and Special Import levies on CIF, the 1% examination fee and the over-age penalty on vehicles).
 * Nigeria is a coarser model of the NCS stack. Everything is an estimate: HS classification, the customs
 * valuation (GRA uses its own vehicle values, not the invoice) and the Bank of Ghana rate on the day all move
 * the number. The shipper can replace it with the official assessment once ICUMS issues one.
 *
 * Rates live in RATES below with the date they were checked, so updating them is a one-line change.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import { vehicleDutyDefaults } from './vehicles'
import type { Db } from './db'
import type { ApiUser } from './api'
import { notify } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

export const RATES_CHECKED = '2026-02'
export const GOODS = ['personal_effects', 'household_new', 'electronics', 'food', 'clothing_new', 'building', 'machinery', 'vehicle', 'motorcycle', 'other'] as const
export type GoodsKind = (typeof GOODS)[number]
export const goodsLabels: Record<GoodsKind, string> = {
  personal_effects: 'Used personal effects & household goods', household_new: 'New household items / furniture', electronics: 'Electronics & appliances', food: 'Food & provisions', clothing_new: 'New clothing & shoes',
  building: 'Building materials', machinery: 'Machinery & commercial goods', vehicle: 'Vehicle (car, SUV, van)', motorcycle: 'Motorcycle', other: 'Other goods',
}

const RATES = {
  GH: {
    // ECOWAS Common External Tariff bands by what diaspora shipments usually carry. Exact band depends on the HS code ICUMS assigns.
    duty: { personal_effects: 0.20, household_new: 0.20, electronics: 0.20, food: 0.20, clothing_new: 0.20, building: 0.10, machinery: 0.05, motorcycle: 0.10, other: 0.20 } as Record<Exclude<GoodsKind, 'vehicle'>, number>,
    vehicleDuty: (cc: number, kind: 'car' | 'suv' | 'van' | 'truck') => (kind === 'truck' || kind === 'van' ? 0.05 : cc <= 1900 ? 0.05 : cc <= 3000 ? 0.10 : 0.20),
    vat: 0.15, nhil: 0.025, getfund: 0.025, ecowas: 0.005, au: 0.002, exim: 0.0075, specialImport: 0.02, examination: 0.01, covid: 0,
    /** Over-age penalty on CIF for vehicles older than 10 years (Customs Act bands; verify on ICUMS for the exact year). */
    overage: (age: number) => (age <= 10 ? 0 : age <= 12 ? 0.05 : age <= 15 ? 0.20 : age <= 20 ? 0.50 : 1.0),
    fx: Number(process.env.GHS_PER_USD || 11.0), currency: 'GHS',
  },
  NG: {
    duty: { personal_effects: 0.20, household_new: 0.20, electronics: 0.20, food: 0.20, clothing_new: 0.35, building: 0.10, machinery: 0.05, motorcycle: 0.20, other: 0.20 } as Record<Exclude<GoodsKind, 'vehicle'>, number>,
    vehicleDuty: () => 0.20, vehicleLevy: 0.15, vat: 0.075, surcharge: 0.07, etls: 0.005, ciss: 0.01,
    fx: Number(process.env.NGN_PER_USD || 1550), currency: 'NGN',
  },
} as const

export interface DutyInput {
  destination: string; goods: GoodsKind; valueUsd: number; freightUsd?: number; insuranceUsd?: number
  vehicle?: { year: number; cc: number; kind: 'car' | 'suv' | 'van' | 'truck' }
  fx?: number
  /** Returning resident / exempt personal effects — shows the exemption note and zeroes the duty line. */
  exemptPersonalEffects?: boolean
}
export interface DutyLine { key: string; label: string; rate: number | null; base: 'cif' | 'cif_duty' | 'duty' | 'fob' | 'fixed'; amount: number; note?: string }
export interface DutyEstimate {
  destination: string; currency: string; fx: number; checked: string; supported: boolean
  cifUsd: number; cifLocal: number; lines: DutyLine[]; totalLocal: number; totalUsd: number; landedUsd: number; effectiveRate: number
  notes: string[]; verifyUrl: string | null; confidence: 'low' | 'medium'
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function estimateDuty(i: DutyInput): DutyEstimate {
  const value = Math.max(0, i.valueUsd), freight = Math.max(0, i.freightUsd ?? 0), insurance = Math.max(0, i.insuranceUsd ?? (value * 0.01))
  const cifUsd = value + freight + insurance
  const dest = i.destination.toUpperCase()
  if (dest === 'GH') {
    const R = RATES.GH; const fx = i.fx && i.fx > 0 ? i.fx : R.fx
    const cif = cifUsd * fx
    const lines: DutyLine[] = []; const notes: string[] = []
    const isVehicle = i.goods === 'vehicle'
    const age = isVehicle && i.vehicle ? Math.max(0, new Date().getFullYear() - i.vehicle.year) : 0
    const dutyRate = i.exemptPersonalEffects && i.goods === 'personal_effects' ? 0 : isVehicle ? R.vehicleDuty(i.vehicle?.cc ?? 2000, i.vehicle?.kind ?? 'car') : R.duty[i.goods as Exclude<GoodsKind, 'vehicle'>]
    const duty = cif * dutyRate
    lines.push({ key: 'duty', label: 'Import duty', rate: dutyRate, base: 'cif', amount: r2(duty), note: isVehicle ? `${i.vehicle?.cc ?? '—'} cc · CET band for ${i.vehicle?.kind ?? 'car'}` : i.exemptPersonalEffects ? 'Exempt personal effects (returning resident)' : 'ECOWAS CET band for this goods type' })
    const vatBase = cif + duty
    lines.push({ key: 'nhil', label: 'NHIL', rate: R.nhil, base: 'cif_duty', amount: r2(vatBase * R.nhil) })
    lines.push({ key: 'getfund', label: 'GETFund levy', rate: R.getfund, base: 'cif_duty', amount: r2(vatBase * R.getfund) })
    lines.push({ key: 'vat', label: 'VAT', rate: R.vat, base: 'cif_duty', amount: r2(vatBase * R.vat), note: 'Flat on CIF + duty since the 2026 VAT reform (no cascading)' })
    lines.push({ key: 'ecowas', label: 'ECOWAS levy', rate: R.ecowas, base: 'cif', amount: r2(cif * R.ecowas) })
    lines.push({ key: 'au', label: 'African Union levy', rate: R.au, base: 'cif', amount: r2(cif * R.au) })
    lines.push({ key: 'exim', label: 'EXIM levy', rate: R.exim, base: 'cif', amount: r2(cif * R.exim) })
    if (!isVehicle) lines.push({ key: 'sil', label: 'Special import levy', rate: R.specialImport, base: 'cif', amount: r2(cif * R.specialImport) })
    if (isVehicle) {
      lines.push({ key: 'exam', label: 'Examination fee', rate: R.examination, base: 'cif', amount: r2(cif * R.examination) })
      const ov = R.overage(age)
      if (ov > 0) lines.push({ key: 'overage', label: `Over-age penalty (${age} yrs)`, rate: ov, base: 'cif', amount: r2(cif * ov), note: 'Vehicles over 10 years old attract a penalty on CIF' })
      notes.push('GRA values vehicles from its own database (not your invoice) — the official figure can differ noticeably.')
      if (age > 10) notes.push('Over-age penalty bands are indicative; ICUMS applies the exact band for the model year.')
    }
    if (i.goods === 'personal_effects' && !i.exemptPersonalEffects) notes.push('Used personal effects may be exempt for returning residents (6+ months abroad, goods owned 6+ months). Ask the shipper.')
    notes.push('Port handling, shipping-line charges, GSA/network fees and the clearing agent are extra and not in this figure.')
    const total = lines.reduce((n, l) => n + l.amount, 0)
    return { destination: 'GH', currency: 'GHS', fx, checked: RATES_CHECKED, supported: true, cifUsd: r2(cifUsd), cifLocal: r2(cif), lines, totalLocal: r2(total), totalUsd: r2(total / fx), landedUsd: r2(cifUsd + total / fx), effectiveRate: cif ? Math.round((total / cif) * 10000) / 10000 : 0, notes, verifyUrl: isVehicle ? 'https://external.unipassghana.com/cl/tm/tax/selectUsedVehicleTaxCalculate.do?decorator=popup&MENU_ID=IIM01S03V02' : 'https://external.unipassghana.com/cl/tm/tax/selectGeneralTaxCalculate.do?decorator=popup&MENU_ID=IIM01S03V01', confidence: isVehicle ? 'low' : 'medium' }
  }
  if (dest === 'NG') {
    const R = RATES.NG; const fx = i.fx && i.fx > 0 ? i.fx : R.fx
    const cif = cifUsd * fx; const fob = value * fx
    const lines: DutyLine[] = []; const notes: string[] = []
    const isVehicle = i.goods === 'vehicle'
    const dutyRate = isVehicle ? R.vehicleDuty() : R.duty[i.goods as Exclude<GoodsKind, 'vehicle'>]
    const duty = cif * dutyRate
    lines.push({ key: 'duty', label: 'Import duty', rate: dutyRate, base: 'cif', amount: r2(duty) })
    if (isVehicle) lines.push({ key: 'levy', label: 'Vehicle levy', rate: R.vehicleLevy, base: 'cif', amount: r2(cif * R.vehicleLevy), note: 'Used cars attract an additional levy' })
    lines.push({ key: 'surcharge', label: 'Port surcharge', rate: R.surcharge, base: 'duty', amount: r2(duty * R.surcharge) })
    lines.push({ key: 'ciss', label: 'CISS', rate: R.ciss, base: 'fob', amount: r2(fob * R.ciss) })
    lines.push({ key: 'etls', label: 'ECOWAS (ETLS)', rate: R.etls, base: 'cif', amount: r2(cif * R.etls) })
    const vatBase = cif + duty + duty * R.surcharge + (isVehicle ? cif * R.vehicleLevy : 0)
    lines.push({ key: 'vat', label: 'VAT', rate: R.vat, base: 'cif_duty', amount: r2(vatBase * R.vat), note: 'On CIF + duty + surcharge' })
    notes.push('Nigeria Customs values goods and vehicles from its own benchmarks; treat this as a rough guide and confirm with your shipper’s agent at Apapa / Tin Can.')
    notes.push('Terminal, shipping-line and agent charges are extra.')
    const total = lines.reduce((n, l) => n + l.amount, 0)
    return { destination: 'NG', currency: 'NGN', fx, checked: RATES_CHECKED, supported: true, cifUsd: r2(cifUsd), cifLocal: r2(cif), lines, totalLocal: r2(total), totalUsd: r2(total / fx), landedUsd: r2(cifUsd + total / fx), effectiveRate: cif ? Math.round((total / cif) * 10000) / 10000 : 0, notes, verifyUrl: null, confidence: 'low' }
  }
  return { destination: dest, currency: 'USD', fx: 1, checked: RATES_CHECKED, supported: false, cifUsd: r2(cifUsd), cifLocal: r2(cifUsd), lines: [], totalLocal: 0, totalUsd: 0, landedUsd: r2(cifUsd), effectiveRate: 0, notes: ['No duty model for this destination yet — the shipper will advise on clearance costs.'], verifyUrl: null, confidence: 'low' }
}

const zVehicle = z.object({ year: z.number().int().min(1960).max(new Date().getFullYear() + 1), cc: z.number().int().min(50).max(20000), kind: z.enum(['car', 'suv', 'van', 'truck']).default('car') })
const zInput = z.object({ destination: z.string().trim().length(2), goods: z.enum(GOODS), valueUsd: z.number().min(0).max(10_000_000), freightUsd: z.number().min(0).max(1_000_000).optional(), insuranceUsd: z.number().min(0).max(1_000_000).optional(), vehicle: zVehicle.optional(), fx: z.number().positive().max(100000).optional(), exemptPersonalEffects: z.boolean().optional() })
const zConfirm = z.object({ amountLocal: z.number().min(0).max(1e9), currency: z.string().trim().min(3).max(3).default('GHS'), reference: z.string().trim().max(60).default(''), note: z.string().trim().max(300).default('') })

export function mountDuty(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  r.post('/duty/estimate', wrap(async (req, res) => { res.json({ estimate: estimateDuty(zInput.parse(req.body)) }) }))
  r.get('/duty/meta', wrap(async (_req, res) => { res.json({ goods: GOODS.map((g) => ({ id: g, label: goodsLabels[g] })), checked: RATES_CHECKED, fx: { GH: RATES.GH.fx, NG: RATES.NG.fx }, supported: ['GH', 'NG'] }) }))

  const access = async (db: Db, req: Request, id: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [id]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && !isDriverRole(u.staffRole)
    if (!office && !(u.role === 'customer' && s.user_id === u.id)) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office }
  }
  const parse = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
  /** Saved inputs + live estimate + the shipper's confirmed assessment, if any. */
  r.get('/shipments/:id/duty', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    const saved = parse(s.duty) as { input?: DutyInput; confirmed?: { amountLocal: number; currency: string; reference: string; note: string; by: string; at: string } } | null
    let input: DutyInput = saved?.input ?? { destination: s.destination, goods: s.cargo === 'vehicle' ? 'vehicle' : 'personal_effects', valueUsd: 0 }
    if (!saved?.input && s.cargo === 'vehicle') { const vd = await vehicleDutyDefaults(db, s.id); if (vd) input = { ...input, valueUsd: vd.valueUsd ?? 0, vehicle: { year: vd.year ?? new Date().getFullYear() - 5, cc: vd.cc ?? 2000, kind: vd.kind } } }
    res.set('Cache-Control', 'no-store')
    res.json({ input, estimate: input.valueUsd > 0 ? estimateDuty(input) : null, confirmed: saved?.confirmed ?? null, canManage: office })
  }))
  r.put('/shipments/:id/duty', wrap(async (req, res) => {
    const db = await getDb(); const { s } = await access(db, req, String(req.params.id))
    const input = zInput.parse({ ...req.body, destination: s.destination })
    const saved = (parse(s.duty) as Row | null) ?? {}
    await db.query('update shipments set duty = $2 where id = $1', [s.id, JSON.stringify({ ...saved, input })])
    res.json({ input, estimate: estimateDuty(input) })
  }))
  /** The office records the official assessment once ICUMS / NCS issues it; the customer sees it as confirmed. */
  r.post('/shipments/:id/duty/confirm', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office } = await access(db, req, String(req.params.id))
    if (!office) throw new HttpError(403, 'Only the shipper can confirm the official assessment.')
    const b = zConfirm.parse(req.body)
    const saved = (parse(s.duty) as Row | null) ?? {}
    const confirmed = { ...b, currency: b.currency.toUpperCase(), by: u.name, at: new Date().toISOString() }
    await db.query('update shipments set duty = $2 where id = $1', [s.id, JSON.stringify({ ...saved, confirmed })])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.destination, `Customs assessment confirmed: ${confirmed.currency} ${b.amountLocal.toLocaleString()}${b.reference ? ` (${b.reference})` : ''}.`])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `Duty confirmed for ${s.ref}: ${confirmed.currency} ${b.amountLocal.toLocaleString()}`, body: `${u.company ?? 'Your shipper'} entered the official customs assessment${b.reference ? ` (${b.reference})` : ''}.${b.note ? ` “${b.note}”` : ''}`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `duty:${s.id}:${b.amountLocal}` })
    res.json({ confirmed })
  }))
  r.delete('/shipments/:id/duty/confirm', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    if (!office) throw new HttpError(403, 'Only the shipper can change this.')
    const saved = (parse(s.duty) as Row | null) ?? {}
    delete saved.confirmed
    await db.query('update shipments set duty = $2 where id = $1', [s.id, JSON.stringify(saved)])
    res.json({ ok: true })
  }))
}
