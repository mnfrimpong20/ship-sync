/**
 * Vehicle flow — shipping a car, SUV, van or truck to West Africa is its own job: VIN, title and lien
 * status, running or not, RoRo vs container, the US export paperwork (title to CBP 72 hours before
 * departure, AES filing), handover at the yard, and the duty that ICUMS will assess on arrival.
 *
 * One `vehicles` row per shipment (and the same shape captured on a quote request so shippers can
 * price RoRo vs container properly). VIN decoding uses NHTSA vPIC when reachable (`VPIC_URL`
 * override for tests) and falls back to a built-in WMI / model-year decode.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)

/* ------------------------------------------------------------------ VIN */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i
const TRANSLIT: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 }
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
/** North-American VINs carry a check digit in position 9; elsewhere it is not guaranteed, so we only flag, never reject. */
export function vinCheckDigitOk(vin: string) {
  const v = vin.toUpperCase(); if (!VIN_RE.test(v)) return false
  if (!/^[1-5]/.test(v)) return true
  const sum = [...v].reduce((n, ch, i) => n + (/\d/.test(ch) ? Number(ch) : TRANSLIT[ch] ?? 0) * WEIGHTS[i], 0)
  const check = sum % 11; const expected = check === 10 ? 'X' : String(check)
  return v[8] === expected
}
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'
export function modelYearFromVin(vin: string): number | null {
  const c = vin.toUpperCase()[9]; const i = YEAR_CODES.indexOf(c); if (i < 0) return null
  // Position 7 being a letter means 2010+ for North-American VINs; otherwise it is ambiguous (1980–2009 vs 2010–2039). Pick the most recent plausible year.
  const base = 1980 + i; const later = 2010 + i
  const now = new Date().getFullYear() + 1
  if (/[A-Z]/.test(vin.toUpperCase()[6])) return later <= now ? later : base
  return later <= now && later - 2010 <= 15 ? later : base
}
const WMI: [RegExp, string][] = [[/^1HG|^2HG|^JHM|^SHH|^19X|^5FN|^1HJ|^JH4|^19U/, 'Honda'], [/^JT|^4T|^5T|^2T|^JTD|^JTE|^JTH|^JTJ|^1NX|^SB1/, 'Toyota'], [/^1FA|^1FT|^1FM|^1FD|^3FA|^2FM|^WF0|^1ZV|^MAJ/, 'Ford'], [/^1G1|^1GC|^2G1|^3GC|^1GN|^KL1|^1G6|^1GY|^1GK|^1GT/, 'GM / Chevrolet'], [/^1N4|^JN1|^JN8|^5N1|^3N1|^1N6/, 'Nissan'], [/^KMH|^KM8|^5NP|^5NM|^KNA|^KND|^5XY|^5XX|^3KP/, 'Hyundai / Kia'], [/^WBA|^WBS|^WBX|^5UX|^WBY/, 'BMW'], [/^WDB|^WDC|^WDD|^4JG|^W1K|^W1N|^55S/, 'Mercedes-Benz'], [/^WAU|^WA1|^WUA/, 'Audi'], [/^WVW|^WVG|^3VW|^1VW/, 'Volkswagen'], [/^1C4|^1C3|^2C4|^3C4|^1J4|^1J8/, 'Chrysler / Jeep / Dodge'], [/^JM1|^JM3|^3MZ|^4F2/, 'Mazda'], [/^JF1|^JF2|^4S3|^4S4/, 'Subaru'], [/^SAL|^SAJ/, 'Land Rover / Jaguar'], [/^YV1|^YV4|^LVY/, 'Volvo'], [/^5YJ|^7SA/, 'Tesla'], [/^JA3|^JA4|^4A3|^4A4/, 'Mitsubishi'], [/^ZFF|^ZFA|^ZAR/, 'Fiat / Alfa Romeo / Ferrari']]
export function makeFromVin(vin: string) { const v = vin.toUpperCase(); return WMI.find(([re]) => re.test(v))?.[1] ?? null }

export interface Decoded { vin: string; valid: boolean; checkDigitOk: boolean; year: number | null; make: string | null; model: string | null; trim: string | null; body: string | null; engineL: number | null; cylinders: number | null; fuel: string | null; driveType: string | null; plantCountry: string | null; source: 'vpic' | 'builtin'; warnings: string[] }
export async function decodeVin(raw: string): Promise<Decoded> {
  const vin = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const valid = VIN_RE.test(vin); const checkDigitOk = valid && vinCheckDigitOk(vin)
  const warnings: string[] = []
  if (!valid) warnings.push('A VIN is 17 characters and never contains I, O or Q.')
  else if (!checkDigitOk) warnings.push('The check digit does not match — double-check the VIN on the door jamb or title.')
  const builtin: Decoded = { vin, valid, checkDigitOk, year: valid ? modelYearFromVin(vin) : null, make: valid ? makeFromVin(vin) : null, model: null, trim: null, body: null, engineL: null, cylinders: null, fuel: null, driveType: null, plantCountry: null, source: 'builtin', warnings }
  if (!valid) return builtin
  const base = (process.env.VPIC_URL || 'https://vpic.nhtsa.dot.gov/api/vehicles').replace(/\/$/, '')
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000)
    const res = await fetch(`${base}/DecodeVinValues/${vin}?format=json`, { signal: ctl.signal }); clearTimeout(t)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { Results?: Row[] }; const r = data.Results?.[0]; if (!r) throw new Error('empty')
    const num = (x: unknown) => (x == null || x === '' ? null : Number(x))
    const str = (x: unknown) => (x == null || x === '' ? null : String(x))
    const year = num(r.ModelYear), make = str(r.Make), model = str(r.Model)
    if (!make && !year) throw new Error('nothing decoded')
    if (r.ErrorCode && String(r.ErrorCode) !== '0' && r.ErrorText) warnings.push(String(r.ErrorText).split(';')[0].trim())
    return { ...builtin, year: year ?? builtin.year, make: make ? make.charAt(0) + make.slice(1).toLowerCase() : builtin.make, model, trim: str(r.Trim), body: str(r.BodyClass), engineL: num(r.DisplacementL), cylinders: num(r.EngineCylinders), fuel: str(r.FuelTypePrimary), driveType: str(r.DriveType), plantCountry: str(r.PlantCountry), source: 'vpic', warnings }
  } catch { if (!warnings.length) warnings.push('Decoded offline (year and make only) — fill in the model yourself.'); return builtin }
}

/* ------------------------------------------------------------------ shapes */
export const CHECKLIST = [
  ['title', 'Original title (or certified copy) — no photocopies'],
  ['id', 'Government ID of the owner matching the title'],
  ['lien', 'Lien release letter from the lender (if the title shows a lien)'],
  ['bill_of_sale', 'Bill of sale / power of attorney if the shipper is not the owner'],
  ['keys', 'At least one key handed over'],
  ['fuel', 'Fuel tank a quarter or less'],
  ['personal_items', 'Personal items removed (RoRo) or listed on the packing list (container)'],
  ['photos', 'Condition photos taken at handover (all sides, odometer, interior)'],
] as const
export type ChecklistKey = (typeof CHECKLIST)[number][0]
export const EXPORT_STEPS = ['pending', 'docs_received', 'cbp_filed', 'cleared', 'loaded'] as const
export type ExportStep = (typeof EXPORT_STEPS)[number]
export const exportStepLabels: Record<ExportStep, string> = { pending: 'Documents outstanding', docs_received: 'Documents received', cbp_filed: 'Filed with CBP (72-hour rule)', cleared: 'Cleared for export', loaded: 'Loaded / on board' }

export const vehicleOut = (v: Row) => ({
  id: v.id, shipmentId: v.shipment_id ?? null, requestId: v.request_id ?? null, vin: v.vin ?? '', year: v.year == null ? null : Number(v.year), make: v.make ?? '', model: v.model ?? '', trim: v.trim ?? '', body: v.body ?? '', engineL: v.engine_l == null ? null : Number(v.engine_l), fuel: v.fuel ?? '', color: v.color ?? '', mileage: v.mileage == null ? null : Number(v.mileage),
  running: !!v.running, method: (v.method ?? 'roro') as 'roro' | 'container', titleStatus: (v.title_status ?? 'clean') as 'clean' | 'lien' | 'salvage' | 'rebuilt', lienHolder: v.lien_holder ?? '', titleInHand: !!v.title_in_hand, ownerName: v.owner_name ?? '', declaredValueUsd: v.declared_value_usd == null ? null : Number(v.declared_value_usd),
  personalItems: v.personal_items ?? '', notes: v.notes ?? '', decoded: J(v.decoded), checklist: (J(v.checklist) ?? {}) as Partial<Record<ChecklistKey, boolean>>, exportStep: (v.export_step ?? 'pending') as ExportStep, aesItn: v.aes_itn ?? '',
  handover: J(v.handover) as { location: string; date: string; contact: string; note: string } | null, updatedAt: ISO(v.updated_at),
})
const zVehicle = z.object({
  vin: z.string().trim().toUpperCase().max(17).default(''), year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().default(null), make: z.string().trim().max(60).default(''), model: z.string().trim().max(60).default(''), trim: z.string().trim().max(60).default(''), body: z.string().trim().max(60).default(''),
  engineL: z.number().min(0).max(20).nullable().default(null), fuel: z.string().trim().max(30).default(''), color: z.string().trim().max(30).default(''), mileage: z.number().int().min(0).max(2_000_000).nullable().default(null),
  running: z.boolean().default(true), method: z.enum(['roro', 'container']).default('roro'), titleStatus: z.enum(['clean', 'lien', 'salvage', 'rebuilt']).default('clean'), lienHolder: z.string().trim().max(80).default(''), titleInHand: z.boolean().default(false), ownerName: z.string().trim().max(80).default(''),
  declaredValueUsd: z.number().min(0).max(5_000_000).nullable().default(null), personalItems: z.string().trim().max(500).default(''), notes: z.string().trim().max(600).default(''),
})
export const zRequestVehicle = z.object({ vin: z.string().trim().toUpperCase().max(17).default(''), year: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().default(null), make: z.string().trim().max(60).default(''), model: z.string().trim().max(60).default(''), running: z.boolean().default(true), method: z.enum(['roro', 'container']).default('roro'), titleStatus: z.enum(['clean', 'lien', 'salvage', 'rebuilt']).default('clean') })
const zChecklist = z.object({ checklist: z.object(Object.fromEntries(CHECKLIST.map((c) => [c[0], z.boolean().optional()])) as Record<ChecklistKey, z.ZodOptional<z.ZodBoolean>>) })
const zExport = z.object({ step: z.enum(EXPORT_STEPS), aesItn: z.string().trim().max(40).optional(), note: z.string().trim().max(300).default('') })
const zHandover = z.object({ location: z.string().trim().min(2).max(160), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), contact: z.string().trim().max(80).default(''), note: z.string().trim().max(300).default('') })

/** Copy the vehicle captured on a quote request onto the shipment it became. */
export async function vehicleFromRequest(db: Db, requestId: string | null, shipmentId: string) {
  if (!requestId) return
  const { rows } = await db.query<Row>('select vehicle from requests where id = $1', [requestId]); const v = J(rows[0]?.vehicle) as Row | null
  if (!v) return
  const decoded = v.vin && VIN_RE.test(v.vin) ? await decodeVin(v.vin).catch(() => null) : null
  await db.query(`insert into shipment_vehicles (id,shipment_id,request_id,vin,year,make,model,body,engine_l,fuel,running,method,title_status,decoded) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (shipment_id) do nothing`,
    ['veh_' + uid(), shipmentId, requestId, v.vin ?? '', v.year ?? decoded?.year ?? null, v.make || decoded?.make || '', v.model || decoded?.model || '', decoded?.body ?? '', decoded?.engineL ?? null, decoded?.fuel ?? '', v.running ?? true, v.method ?? 'roro', v.titleStatus ?? 'clean', decoded ? JSON.stringify(decoded) : null])
}
/** Duty estimator defaults from the vehicle on file. */
export async function vehicleDutyDefaults(db: Db, shipmentId: string) {
  const { rows } = await db.query<Row>('select * from shipment_vehicles where shipment_id = $1', [shipmentId]); const v = rows[0]; if (!v) return null
  const body = String(v.body ?? '').toLowerCase()
  const kind: 'car' | 'suv' | 'van' | 'truck' = /truck|pickup/.test(body) ? 'truck' : /van|bus/.test(body) ? 'van' : /suv|sport utility|crossover|wagon/.test(body) ? 'suv' : 'car'
  return { year: v.year == null ? null : Number(v.year), cc: v.engine_l == null ? null : Math.round(Number(v.engine_l) * 1000), kind, valueUsd: v.declared_value_usd == null ? null : Number(v.declared_value_usd) }
}

export function mountVehicles(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const forShipment = async (db: Db, sid: string) => (await db.query<Row>('select * from shipment_vehicles where shipment_id = $1', [sid])).rows[0] ?? null
  const meta = { checklist: CHECKLIST.map(([id, label]) => ({ id, label })), exportSteps: EXPORT_STEPS.map((id) => ({ id, label: exportStepLabels[id] })) }

  r.get('/vehicles/decode/:vin', wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ decoded: await decodeVin(String(req.params.vin)) }) }))
  r.get('/shipments/:id/vehicle', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    const v = await forShipment(db, s.id)
    res.set('Cache-Control', 'no-store')
    res.json({ vehicle: v ? vehicleOut(v) : null, canManage: office, isVehicle: s.cargo === 'vehicle', meta })
  }))
  r.put('/shipments/:id/vehicle', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req, String(req.params.id))
    if (!office && !owner) throw new HttpError(403, 'Not allowed.')
    const b = zVehicle.parse(req.body)
    if (b.vin && !VIN_RE.test(b.vin)) throw new HttpError(400, 'A VIN is 17 characters and never contains I, O or Q.')
    const existing = await forShipment(db, s.id)
    const decoded = b.vin && b.vin !== existing?.vin ? await decodeVin(b.vin).catch(() => null) : existing ? J(existing.decoded) : null
    const vals = [s.id, b.vin, b.year ?? decoded?.year ?? null, b.make || decoded?.make || '', b.model || decoded?.model || '', b.trim || decoded?.trim || '', b.body || decoded?.body || '', b.engineL ?? decoded?.engineL ?? null, b.fuel || decoded?.fuel || '', b.color, b.mileage, b.running, b.method, b.titleStatus, b.lienHolder, b.titleInHand, b.ownerName, b.declaredValueUsd, b.personalItems, b.notes, decoded ? JSON.stringify(decoded) : null]
    if (existing) await db.query(`update shipment_vehicles set vin=$2, year=$3, make=$4, model=$5, trim=$6, body=$7, engine_l=$8, fuel=$9, color=$10, mileage=$11, running=$12, method=$13, title_status=$14, lien_holder=$15, title_in_hand=$16, owner_name=$17, declared_value_usd=$18, personal_items=$19, notes=$20, decoded=$21, updated_at=now() where shipment_id = $1`, vals)
    else await db.query(`insert into shipment_vehicles (shipment_id,vin,year,make,model,trim,body,engine_l,fuel,color,mileage,running,method,title_status,lien_holder,title_in_hand,owner_name,declared_value_usd,personal_items,notes,decoded,id,request_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, [...vals, 'veh_' + uid(), s.request_id ?? null])
    if (!existing || existing.method !== b.method || existing.title_status !== b.titleStatus) {
      const label = [b.year, b.make, b.model].filter(Boolean).join(' ') || 'Vehicle'
      if (owner) await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `Vehicle details on ${s.ref}: ${label}`, body: `${b.method === 'roro' ? 'RoRo' : 'Container'} · title ${b.titleStatus}${b.titleStatus === 'lien' ? ` (${b.lienHolder || 'lien holder not given'})` : ''} · ${b.running ? 'runs and drives' : 'NOT running — needs a forklift / winch'}.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `veh:${s.id}:${Date.now()}` }, ['owner', 'dispatcher', 'agent'])
    }
    res.json({ vehicle: vehicleOut((await forShipment(db, s.id))!) })
  }))
  r.patch('/shipments/:id/vehicle/checklist', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id)); if (!office) throw new HttpError(403, 'Only the shipper ticks the handover checklist.')
    const v = await forShipment(db, s.id); if (!v) throw new HttpError(409, 'Add the vehicle details first.')
    const b = zChecklist.parse(req.body); const merged = { ...(J(v.checklist) ?? {}), ...b.checklist }
    await db.query('update shipment_vehicles set checklist = $2, updated_at = now() where shipment_id = $1', [s.id, JSON.stringify(merged)])
    res.json({ vehicle: vehicleOut((await forShipment(db, s.id))!) })
  }))
  r.put('/shipments/:id/vehicle/handover', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req, String(req.params.id)); if (!office && !owner) throw new HttpError(403, 'Not allowed.')
    const v = await forShipment(db, s.id); if (!v) throw new HttpError(409, 'Add the vehicle details first.')
    const b = zHandover.parse(req.body)
    await db.query('update shipment_vehicles set handover = $2, updated_at = now() where shipment_id = $1', [s.id, JSON.stringify(b)])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, b.location, `Vehicle handover arranged for ${b.date} at ${b.location}${b.contact ? ` (${b.contact})` : ''}.`])
    if (owner) await notifyShipperStaff(db, s.shipper_id, { kind: 'pickup', title: `Vehicle handover ${b.date} — ${s.ref}`, body: `${s.customer} will bring the vehicle to ${b.location}.${b.note ? ` ${b.note}` : ''}`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `veh:${s.id}:ho:${b.date}` }, ['owner', 'dispatcher', 'agent'])
    else if (s.user_id) await notify(db, { userId: s.user_id, kind: 'pickup', title: `Bring your vehicle on ${b.date} — ${s.ref}`, body: `${u.company ?? 'Your shipper'} will receive it at ${b.location}${b.contact ? ` — ask for ${b.contact}` : ''}. Bring the original title, your ID and a key; fuel at a quarter or less.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `veh:${s.id}:ho:${b.date}:c`, emailSubject: `Vehicle handover — ${s.ref}` })
    res.json({ vehicle: vehicleOut((await forShipment(db, s.id))!) })
  }))
  r.post('/shipments/:id/vehicle/export', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id)); if (!office) throw new HttpError(403, 'Only the shipper updates export clearance.')
    const v = await forShipment(db, s.id); if (!v) throw new HttpError(409, 'Add the vehicle details first.')
    const b = zExport.parse(req.body)
    await db.query('update shipment_vehicles set export_step = $2, aes_itn = coalesce($3, aes_itn), updated_at = now() where shipment_id = $1', [s.id, b.step, b.aesItn ?? null])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `Export: ${exportStepLabels[b.step]}${b.aesItn ? ` · AES ITN ${b.aesItn}` : ''}${b.note ? ` — ${b.note}` : ''}`])
    if (s.user_id && (b.step === 'cleared' || b.step === 'docs_received')) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${exportStepLabels[b.step]} — ${s.ref}`, body: b.step === 'cleared' ? 'US Customs has released the vehicle for export. Next stop: the vessel.' : 'Your title and documents are in hand; the shipper files with US Customs next (72 hours before sailing).', link: `/track?ref=${s.ref}`, dedupe: `veh:${s.id}:exp:${b.step}` })
    res.json({ vehicle: vehicleOut((await forShipment(db, s.id))!) })
  }))
}
