/**
 * Export compliance for shipments leaving the United States.
 *
 *   EEI (Electronic Export Information) through AES is needed when a single Schedule B line is worth more than
 *   US$2,500, for every used vehicle, and for anything needing an export licence. The shipper files it and
 *   records the ITN (Internal Transaction Number) here, or records the exemption it relied on.
 *   Vehicles also need the title (and documents) presented to CBP at least 72 hours before export — tracked
 *   by the vehicle checklist in vehicles.ts; this module reads that state.
 *
 *   We can't see Schedule B lines, so the check is conservative: total declared value over $2,500 means
 *   "EEI likely needed — confirm per Schedule B number", unless the shipper records an exemption.
 *   Shipments leaving the US cannot be moved to "At origin port"/"In transit" by hand until this is cleared.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
export const EEI_THRESHOLD_USD = 2500
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '))
const CANADIAN = /^(toronto|montreal|montréal|vancouver|calgary|edmonton|ottawa|winnipeg|mississauga|brampton|hamilton|halifax|quebec|québec|surrey|markham|regina|saskatoon|victoria|kitchener|london, on)/i
/** "Houston, TX" → true; "Toronto, CA" / "London, UK" → false. */
export function isUsOrigin(origin: string) {
  const m = /,\s*([A-Z]{2})\s*$/.exec(origin.trim()); if (!m) return false
  return US_STATES.has(m[1]) && !(m[1] === 'CA' && CANADIAN.test(origin.trim()))
}
export const EXEMPTIONS = [
  ['NOEEI 30.37(a)', 'Every Schedule B line is $2,500 or less, and no licence is needed'],
  ['NOEEI 30.37(b)', 'Shipped under a licence exception that doesn’t need EEI'],
  ['NOEEI 30.37(q)', 'Personal effects of a person leaving the US (not for sale)'],
  ['NOEEI 30.37(x)', 'Gift parcels and humanitarian donations within the limits'],
] as const
export type ExportState = {
  applies: boolean; required: boolean; reasons: string[]; valueUsd: number | null; vehicle: boolean
  itn: string; exemption: string; filedBy: string; filedAt: string | null
  titleOk: boolean | null; titleStep: string | null; cleared: string; note: string
}
/** Work out what this shipment needs; keeps what the shipper already recorded. */
export async function evaluateExport(db: Db, s: Row): Promise<ExportState> {
  const prev = J<Partial<ExportState>>(s.export_compliance, {})
  const applies = isUsOrigin(String(s.origin ?? ''))
  const booking = J<Row>(s.booking, {})
  let valueUsd: number | null = booking.declaredValueUsd != null ? Number(booking.declaredValueUsd) : null
  if (valueUsd == null && s.request_id) { const { rows } = await db.query<Row>('select declared_value_usd from requests where id = $1', [s.request_id]); if (rows[0]?.declared_value_usd != null) valueUsd = Number(rows[0].declared_value_usd) }
  const duty = J<Row>(s.duty, {}); if (valueUsd == null && duty?.input?.valueUsd != null) valueUsd = Number(duty.input.valueUsd)
  if (prev.valueUsd != null) valueUsd = prev.valueUsd
  const vehicle = s.cargo === 'vehicle'
  let titleStep: string | null = null
  if (vehicle) { const { rows } = await db.query<Row>('select export_step from shipment_vehicles where shipment_id = $1', [s.id]); titleStep = rows[0]?.export_step ?? 'pending' }
  const reasons: string[] = []
  if (applies && vehicle) reasons.push('Used vehicles always need an EEI filing, and the title must reach CBP 72 hours before export.')
  if (applies && valueUsd != null && valueUsd > EEI_THRESHOLD_USD) reasons.push(`Declared value $${valueUsd.toLocaleString()} is over $${EEI_THRESHOLD_USD.toLocaleString()} — EEI is needed for any Schedule B line over that.`)
  if (applies && valueUsd == null && !vehicle) reasons.push('No declared value yet — add it to know whether EEI is needed.')
  const required = applies && (vehicle || (valueUsd != null && valueUsd > EEI_THRESHOLD_USD))
  const itn = String(prev.itn ?? ''), exemption = vehicle ? '' : String(prev.exemption ?? '')
  const titleOk = vehicle ? ['cbp_filed', 'cleared', 'loaded'].includes(titleStep ?? '') : null
  const filingOk = !!itn || !!exemption
  const cleared = !applies ? 'not-us' : !required && valueUsd != null ? 'under-threshold' : required && filingOk && (titleOk ?? true) ? (itn ? `ITN ${itn}` : exemption) : ''
  const st: ExportState = { applies, required, reasons, valueUsd, vehicle, itn, exemption, filedBy: String(prev.filedBy ?? ''), filedAt: prev.filedAt ?? null, titleOk, titleStep, cleared, note: String(prev.note ?? '') }
  await db.query('update shipments set export_compliance = $2 where id = $1', [s.id, JSON.stringify(st)])
  return st
}
/** Blocks hand-moving a US export past origin until the filing is recorded. */
export async function assertExportCleared(db: Db, s: Row, next: string) {
  if (!['at_origin_port', 'in_transit'].includes(next)) return
  const st = await evaluateExport(db, s)
  if (st.applies && st.required && !st.cleared) {
    const e = new Error(st.vehicle && !st.titleOk ? 'This vehicle’s title hasn’t been filed with CBP yet (72-hour rule). Update the vehicle checklist and record the ITN before it leaves.' : 'This shipment needs an EEI filing before it leaves the US. Record the ITN (or the exemption) under Export filing.') as Error & { httpStatus?: number }
    e.httpStatus = 409; throw e
  }
}

const zExport = z.object({
  itn: z.string().trim().toUpperCase().regex(/^$|^X\d{14}$/, 'An ITN is an X followed by 14 digits, e.g. X20261018123456.').default(''),
  exemption: z.string().trim().max(40).default(''),
  valueUsd: z.number().min(0).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(300).default(''),
})
export function mountCompliance(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const access = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    if (!office && !(u.role === 'customer' && s.user_id === u.id) && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office }
  }
  r.get('/shipments/:id/export', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req)
    res.set('Cache-Control', 'no-store'); res.json({ export: await evaluateExport(db, s), canEdit: office, exemptions: EXEMPTIONS.map(([code, label]) => ({ code, label })), threshold: EEI_THRESHOLD_USD })
  }))
  r.put('/shipments/:id/export', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office } = await access(db, req); if (!office) throw new HttpError(403, 'Only the shipper records export filings.')
    const b = zExport.parse(req.body)
    if (b.exemption && !EXEMPTIONS.some(([c]) => c === b.exemption)) throw new HttpError(400, 'Pick one of the listed exemptions.')
    if (s.cargo === 'vehicle' && b.exemption) throw new HttpError(400, 'Vehicles can’t use an EEI exemption — record the ITN.')
    const prev = J<Row>(s.export_compliance, {})
    const filed = (b.itn && b.itn !== prev.itn) || (b.exemption && b.exemption !== prev.exemption)
    const next = { ...prev, itn: b.itn, exemption: b.itn ? '' : b.exemption, note: b.note, ...(b.valueUsd !== undefined ? { valueUsd: b.valueUsd } : {}), ...(filed ? { filedBy: u.name, filedAt: new Date().toISOString() } : {}) }
    await db.query('update shipments set export_compliance = $2 where id = $1', [s.id, JSON.stringify(next)])
    if (filed) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, b.itn ? `Export declaration filed (ITN ${b.itn}).` : `No EEI needed — ${b.exemption}.`])
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [s.id])
    res.json({ export: await evaluateExport(db, rows[0]), canEdit: true, exemptions: EXEMPTIONS.map(([code, label]) => ({ code, label })), threshold: EEI_THRESHOLD_USD })
  }))
}

/* ------------------------------------------------------------------ sender declaration (prohibited & restricted items) */
export const DECLARATION_VERSION = '2026-10'
export const RESTRICTED_KINDS = [
  ['batteries', 'Lithium batteries or power banks (loose or in devices)'],
  ['aerosols', 'Perfume, aerosols, nail polish or other flammable liquids'],
  ['food', 'Food, drinks or spices'],
  ['medicine', 'Medicines or supplements'],
  ['electronics', 'Used phones, laptops or other electronics'],
  ['cash', 'Cash, gold or jewellery over US$10,000 in value'],
] as const
export const PROHIBITED = ['Firearms, ammunition, weapon parts', 'Explosives, fireworks, gas cylinders', 'Illegal drugs', 'Counterfeit or pirated goods', 'Live animals or plants', 'Anything banned at the destination']
export const zDeclaration = z.object({ accepted: z.literal(true, { message: 'Please confirm the shipment declaration.' }), includes: z.array(z.enum(['batteries', 'aerosols', 'food', 'medicine', 'electronics', 'cash'])).max(6).default([]) }, { message: 'Please confirm the shipment declaration.' })
