/**
 * Booking space with the shipping line from a container — DCSA Booking 2.0 (the standard Maersk, Hapag-Lloyd,
 * CMA CGM, ONE, MSC and others publish), or a booking-request email to the line's desk when there's no API.
 *
 *   A shipper adds a connection: the line, the DCSA Booking API base URL, their API key and header, and their
 *   service contract (or just the booking desk email). From a container we send a booking request
 *   (POL/POD as UN/LOCODEs, equipment, weight, commodity, cut-off), keep the carrier's request reference, and
 *   poll for status every 15 minutes. When the line confirms, the carrier booking number, vessel, voyage and ETD
 *   land on the container — which then hands over to track & trace.
 *   Keys are encrypted (secrets.ts) and never sent back to the browser.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { mask, seal, unseal } from './secrets'
import { notifyShipperStaff, emailProvider, emailTemplate, sendEmail } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

export const LINES: Record<string, string> = { MAEU: 'Maersk', MSCU: 'MSC', CMDU: 'CMA CGM', HLCU: 'Hapag-Lloyd', ONEY: 'ONE', GRIU: 'Grimaldi', OTHER: 'Other line' }
/** Common ports on Ntemtem lanes → UN/LOCODE. Shippers can also type a code directly. */
const PORTS: [RegExp, string][] = [
  [/houston/i, 'USHOU'], [/newark|new york|elizabeth|nyc/i, 'USNYC'], [/baltimore/i, 'USBAL'], [/savannah/i, 'USSAV'], [/norfolk|virginia/i, 'USORF'], [/charleston/i, 'USCHS'], [/miami/i, 'USMIA'], [/jacksonville/i, 'USJAX'], [/los angeles|long beach/i, 'USLAX'], [/philadelphia/i, 'USPHL'], [/boston/i, 'USBOS'],
  [/montr[eé]al/i, 'CAMTR'], [/halifax/i, 'CAHAL'], [/felixstowe/i, 'GBFXT'], [/london gateway|tilbury/i, 'GBLGP'], [/southampton/i, 'GBSOU'], [/antwerp/i, 'BEANR'], [/rotterdam/i, 'NLRTM'], [/hamburg/i, 'DEHAM'], [/le havre/i, 'FRLEH'],
  [/tema/i, 'GHTEM'], [/takoradi/i, 'GHTKD'], [/apapa|lagos/i, 'NGAPP'], [/tin ?can/i, 'NGTIN'], [/onne/i, 'NGONN'], [/lom[eé]/i, 'TGLFW'], [/abidjan/i, 'CIABJ'], [/san.p[eé]dro/i, 'CISPY'], [/dakar/i, 'SNDKR'], [/monrovia/i, 'LRMLW'], [/freetown/i, 'SLFNA'], [/cotonou/i, 'BJCOO'], [/douala/i, 'CMDLA'], [/mombasa/i, 'KEMBA'],
]
const DEFAULT_POD: Record<string, string> = { GH: 'GHTEM', NG: 'NGAPP', TG: 'TGLFW', CI: 'CIABJ', SN: 'SNDKR', LR: 'LRMLW', SL: 'SLFNA', BJ: 'BJCOO', CM: 'CMDLA', KE: 'KEMBA' }
export function unlocode(text: string, country?: string): string {
  const t = String(text ?? '').trim(); if (/^[A-Z]{2}[A-Z2-9]{3}$/.test(t.toUpperCase()) && t.length === 5) return t.toUpperCase()
  return PORTS.find(([re]) => re.test(t))?.[1] ?? (country ? DEFAULT_POD[country] ?? '' : '')
}
const ISO_EQUIP: Record<string, string> = { '20ft': '22G1', '40ft': '42G1', '40hc': '45G1', '45hc': 'L5G1' }

const connOut = async (db: Db, c: Row) => ({ id: c.id, line: c.line, lineName: LINES[c.line] ?? c.line, label: c.label, mode: c.mode as 'dcsa' | 'email', baseUrl: c.base_url, keyHeader: c.key_header, keyHint: mask(await unseal(db, c.api_key)), contract: c.service_contract, bookingEmail: c.booking_email, active: !!c.active, lastOkAt: ISO(c.last_ok_at), lastError: c.last_error ?? '' })
const bookingOut = (b: Row) => ({ id: b.id, containerId: b.container_id, connectionId: b.connection_id, line: b.line, mode: b.mode as 'dcsa' | 'email', requestRef: b.carrier_request_ref ?? '', bookingRef: b.carrier_booking_ref ?? '', status: b.status as string, statusDetail: b.status_detail ?? '', pol: b.pol, pod: b.pod, equipment: b.equipment, error: b.error ?? '', createdBy: b.created_by, createdAt: ISO(b.created_at), lastPolledAt: ISO(b.last_polled_at), confirmed: J<Row | null>(b.confirmed, null) })

async function dcsa(db: Db, c: Row, method: 'GET' | 'POST', path: string, body?: unknown) {
  const key = await unseal(db, c.api_key)
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json', 'API-Version': '2.0.0' }
  if (key) { if ((c.key_header || 'Authorization').toLowerCase() === 'authorization') headers.authorization = key.startsWith('Bearer ') ? key : `Bearer ${key}`; else headers[c.key_header] = key }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000)
  try {
    const r = await fetch(String(c.base_url).replace(/\/$/, '') + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal })
    const text = await r.text(); let j: Row = {}; try { j = text ? JSON.parse(text) : {} } catch { j = { raw: text.slice(0, 300) } }
    if (!r.ok) throw new Error(j.errors?.[0]?.message || j.message || j.errorMessage || `The line answered ${r.status}`)
    return j
  } finally { clearTimeout(t) }
}

/** The DCSA Booking 2.0 request for one container. */
async function buildRequest(db: Db, cont: Row, conn: Row, b: { equipment: string; units: number; commodity: string; weightKg: number; pol: string; pod: string; etd: string | null }) {
  const { rows: sh } = await db.query<Row>('select name, hq from shippers where id = $1', [cont.shipper_id])
  return {
    receiptTypeAtOrigin: 'CY', deliveryTypeAtDestination: 'CY', cargoMovementTypeAtOrigin: 'FCL', cargoMovementTypeAtDestination: 'FCL',
    serviceContractReference: conn.service_contract || undefined, isPartialLoadAllowed: false, isExportDeclarationRequired: true, isImportLicenseRequired: false, isEquipmentSubstitutionAllowed: false,
    communicationChannelCode: 'AO', expectedDepartureDate: b.etd ?? undefined, carrierCode: conn.line !== 'OTHER' ? conn.line : undefined, carrierCodeListProvider: 'SMDG',
    requestedEquipments: [{ ISOEquipmentCode: ISO_EQUIP[b.equipment] ?? '42G1', units: b.units, isShipperOwned: false, commodities: [{ commodityType: b.commodity, cargoGrossWeight: { value: b.weightKg, unit: 'KGM' } }] }],
    documentParties: { bookingAgent: { partyName: sh[0]?.name ?? 'Shipper' }, shipper: { partyName: sh[0]?.name ?? 'Shipper' } },
    shipmentLocations: [{ location: { locationType: 'UNLO', UNLocationCode: b.pol }, locationTypeCode: 'POL' }, { location: { locationType: 'UNLO', UNLocationCode: b.pod }, locationTypeCode: 'POD' }],
    references: [{ type: 'FF', value: cont.ref }],
  }
}

/** Ask the line for the latest state; apply a confirmation to the container. */
export async function pollBooking(db: Db, bk: Row) {
  if (bk.mode !== 'dcsa' || !bk.carrier_request_ref || ['CONFIRMED', 'REJECTED', 'DECLINED', 'CANCELLED', 'COMPLETED'].includes(bk.status)) return bk
  const { rows: cs } = await db.query<Row>('select * from line_connections where id = $1', [bk.connection_id]); const conn = cs[0]; if (!conn) return bk
  try {
    const j = await dcsa(db, conn, 'GET', `/bookings/${encodeURIComponent(bk.carrier_request_ref)}`)
    const status = String(j.bookingStatus ?? j.status ?? bk.status).toUpperCase()
    const leg = (j.transportPlan ?? [])[0] ?? {}
    const confirmed = status === 'CONFIRMED' ? { bookingRef: j.carrierBookingReference ?? '', vesselName: leg.vesselName ?? leg.vessel?.name ?? '', voyage: leg.carrierExportVoyageNumber ?? leg.voyage ?? '', etd: (leg.plannedDepartureDate ?? '').slice(0, 10) || null, cutoff: (j.shipmentCutOffTimes ?? []).find((x: Row) => /FCO|DCO/i.test(x.cutOffDateTimeCode ?? ''))?.cutOffDateTime?.slice(0, 10) ?? null } : null
    await db.query(`update container_bookings set status = $2, status_detail = $3, carrier_booking_ref = coalesce(nullif($4,''), carrier_booking_ref), confirmed = coalesce($5, confirmed), last_polled_at = now(), error = '' where id = $1`, [bk.id, status, j.amendedBookingStatus ?? j.reason ?? '', j.carrierBookingReference ?? '', confirmed ? JSON.stringify(confirmed) : null])
    await db.query(`update line_connections set last_ok_at = now(), last_error = '' where id = $1`, [conn.id])
    if (status !== bk.status && ['CONFIRMED', 'REJECTED', 'DECLINED'].includes(status)) {
      const { rows: [c] } = await db.query<Row>('select * from containers where id = $1', [bk.container_id])
      if (c && confirmed) {
        await db.query(`update containers set booking_ref = coalesce(nullif($2,''), booking_ref), line = $3, vessel_name = coalesce(nullif($4,''), vessel_name), voyage = coalesce(nullif($5,''), voyage), etd = coalesce($6::date, etd), cutoff_date = coalesce($7::date, cutoff_date) where id = $1`, [c.id, confirmed.bookingRef, LINES[bk.line] ?? bk.line, confirmed.vesselName, confirmed.voyage, confirmed.etd, confirmed.cutoff])
        await db.query(`insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,$3,$4,'Shipping line','carrier','BOOKED')`, [c.id, c.status, c.origin_port, `Booking confirmed by ${LINES[bk.line] ?? 'the line'}: ${confirmed.bookingRef}${confirmed.vesselName ? ` on ${confirmed.vesselName}` : ''}.`])
      }
      if (c) await notifyShipperStaff(db, c.shipper_id, { kind: 'container_update', title: status === 'CONFIRMED' ? `${LINES[bk.line] ?? 'Line'} confirmed ${c.ref}${confirmed?.bookingRef ? ` — ${confirmed.bookingRef}` : ''}` : `${LINES[bk.line] ?? 'The line'} ${status.toLowerCase()} the booking for ${c.ref}`, body: status === 'CONFIRMED' ? 'Booking number, vessel and dates are on the container.' : (j.reason ?? 'Open the container to rebook.'), link: `/dashboard/containers/${c.id}`, dedupe: `bk:${bk.id}:${status}` }, ['owner', 'dispatcher'])
    }
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); await db.query(`update container_bookings set last_polled_at = now(), error = $2 where id = $1`, [bk.id, msg.slice(0, 300)]); await db.query(`update line_connections set last_error = $2 where id = $1`, [conn.id, msg.slice(0, 300)]) }
  const { rows } = await db.query<Row>('select * from container_bookings where id = $1', [bk.id]); return rows[0]
}
export function startBookingSweeps(getDb: () => Promise<Db>) {
  setInterval(() => { void (async () => { const db = await getDb(); const { rows } = await db.query<Row>(`select * from container_bookings where mode = 'dcsa' and status not in ('CONFIRMED','REJECTED','DECLINED','CANCELLED','COMPLETED','FAILED') and created_at > now() - interval '30 days'`); for (const b of rows) await pollBooking(db, b) })().catch((e) => console.error('[booking] sweep', e)) }, 15 * 60_000).unref?.()
}

const zConn = z.object({
  line: z.enum(Object.keys(LINES) as [string, ...string[]]), label: z.string().trim().max(60).default(''), mode: z.enum(['dcsa', 'email']),
  baseUrl: z.string().trim().url().max(300).or(z.literal('')).default(''), apiKey: z.string().trim().max(500).optional(), keyHeader: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/, 'Header names are letters, digits and dashes.').default('Authorization'),
  contract: z.string().trim().max(60).default(''), bookingEmail: z.string().trim().email().or(z.literal('')).default(''), active: z.boolean().default(true),
})
const zBook = z.object({ connectionId: z.string(), equipment: z.enum(['20ft', '40ft', '40hc', '45hc']), units: z.number().int().min(1).max(20).default(1), commodity: z.string().trim().min(3, 'Describe the goods (e.g. personal effects, used household goods).').max(120), weightKg: z.number().min(100).max(40000), pol: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z2-9]{3}$/, 'Port of loading as a UN/LOCODE, e.g. USHOU.'), pod: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z2-9]{3}$/, 'Port of discharge as a UN/LOCODE, e.g. GHTEM.'), etd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) })

export function mountLineBooking(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const managers = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.'); return u }

  r.get('/line-connections', wrap(async (req, res) => { const db = await getDb(); const u = await managers(db, req); const { rows } = await db.query<Row>('select * from line_connections where shipper_id = $1 order by created_at', [u.shipperId]); res.set('Cache-Control', 'no-store'); res.json({ connections: await Promise.all(rows.map((c) => connOut(db, c))), lines: LINES }) }))
  r.post('/line-connections', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zConn.parse(req.body)
    if (b.mode === 'dcsa' && !b.baseUrl) throw new HttpError(400, 'Add the line’s DCSA Booking API address.'); if (b.mode === 'dcsa' && !/^https:\/\//.test(b.baseUrl) && process.env.NODE_ENV === 'production' && !process.env.ALLOW_HTTP_CARRIER) throw new HttpError(400, 'The API address must start with https://')
    if (b.mode === 'email' && !b.bookingEmail) throw new HttpError(400, 'Add the line’s booking desk email.')
    const id = 'lc_' + uid()
    await db.query(`insert into line_connections (id,shipper_id,line,label,mode,base_url,api_key,key_header,service_contract,booking_email,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, u.shipperId, b.line, b.label, b.mode, b.baseUrl, await seal(db, b.apiKey ?? ''), b.keyHeader, b.contract, b.bookingEmail, b.active])
    const { rows } = await db.query<Row>('select * from line_connections where id = $1', [id]); res.status(201).json({ connection: await connOut(db, rows[0]) })
  }))
  r.put('/line-connections/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zConn.parse(req.body)
    const { rows: ex } = await db.query<Row>('select * from line_connections where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); if (!ex[0]) throw new HttpError(404, 'Not found.')
    const key = b.apiKey === undefined || b.apiKey === '' ? ex[0].api_key : await seal(db, b.apiKey) // blank keeps the saved key
    await db.query(`update line_connections set line=$2, label=$3, mode=$4, base_url=$5, api_key=$6, key_header=$7, service_contract=$8, booking_email=$9, active=$10 where id = $1`, [ex[0].id, b.line, b.label, b.mode, b.baseUrl, key, b.keyHeader, b.contract, b.bookingEmail, b.active])
    const { rows } = await db.query<Row>('select * from line_connections where id = $1', [ex[0].id]); res.json({ connection: await connOut(db, rows[0]) })
  }))
  r.delete('/line-connections/:id', wrap(async (req, res) => { const db = await getDb(); const u = await managers(db, req); await db.query('update line_connections set active = false where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); res.json({ ok: true }) }))

  /** Suggested values for the booking form, from the container. */
  r.get('/containers/:id/line-booking', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows: cs } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const c = cs[0]; if (!c) throw new HttpError(404, 'Container not found.')
    const { rows: bks } = await db.query<Row>('select * from container_bookings where container_id = $1 order by created_at desc', [c.id])
    const { rows: w } = await db.query<Row>(`select coalesce(sum(p.weight_kg),0)::float as kg from pieces p join shipments s on s.id = p.shipment_id where s.container_id = $1`, [c.id])
    const { rows: conns } = await db.query<Row>('select * from line_connections where shipper_id = $1 and active order by created_at', [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ bookings: bks.map(bookingOut), connections: await Promise.all(conns.map((x) => connOut(db, x))), suggest: { equipment: String(c.size ?? '40ft').toLowerCase().includes('20') ? '20ft' : String(c.size).toLowerCase().includes('hc') ? '40hc' : '40ft', pol: unlocode(c.origin_port), pod: unlocode(c.destination_port, c.destination), weightKg: Math.max(1000, Math.round(Number(w[0]?.kg ?? 0)) || 8000), commodity: 'Used household goods and personal effects', etd: D(c.etd) } })
  }))
  r.post('/containers/:id/line-booking', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zBook.parse(req.body)
    const { rows: cs } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const c = cs[0]; if (!c) throw new HttpError(404, 'Container not found.')
    const { rows: ks } = await db.query<Row>('select * from line_connections where id = $1 and shipper_id = $2 and active', [b.connectionId, u.shipperId]); const conn = ks[0]; if (!conn) throw new HttpError(404, 'Pick one of your line connections.')
    const { rows: open } = await db.query<Row>(`select 1 from container_bookings where container_id = $1 and status in ('SENT','RECEIVED','PENDING_UPDATE','UPDATE_RECEIVED','CONFIRMED','PENDING_AMENDMENT','REQUESTED')`, [c.id]); if (open[0]) throw new HttpError(409, 'This container already has a live booking request.')
    const request = await buildRequest(db, c, conn, b)
    const id = 'bk_' + uid()
    await db.query(`insert into container_bookings (id,container_id,shipper_id,connection_id,line,mode,request,status,pol,pod,equipment,created_by) values ($1,$2,$3,$4,$5,$6,$7,'SENDING',$8,$9,$10,$11)`, [id, c.id, u.shipperId, conn.id, conn.line, conn.mode, JSON.stringify(request), b.pol, b.pod, `${b.units}×${b.equipment}`, u.name])
    if (conn.mode === 'dcsa') {
      try {
        const j = await dcsa(db, conn, 'POST', '/bookings', request)
        const ref = String(j.carrierBookingRequestReference ?? j.bookingRequestReference ?? '')
        await db.query(`update container_bookings set status = 'RECEIVED', carrier_request_ref = $2 where id = $1`, [id, ref])
        await db.query(`update line_connections set last_ok_at = now(), last_error = '' where id = $1`, [conn.id])
        await db.query(`insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,$3,$4,$5,'manual','')`, [c.id, c.status, c.origin_port, `Booking requested from ${LINES[conn.line] ?? 'the line'} (${b.units}×${b.equipment}, ${b.pol} → ${b.pod}). Request ${ref}.`, u.name])
      } catch (e) { const msg = e instanceof Error ? e.message : String(e); await db.query(`update container_bookings set status = 'FAILED', error = $2 where id = $1`, [id, msg.slice(0, 300)]); await db.query(`update line_connections set last_error = $2 where id = $1`, [conn.id, msg.slice(0, 300)]); throw new HttpError(502, `The line didn’t accept the request: ${msg}`) }
    } else {
      const lines = [`Booking request — ${c.ref}`, `Equipment: ${b.units} × ${b.equipment.toUpperCase()}`, `From ${b.pol} to ${b.pod}`, b.etd ? `Wanted sailing: on or after ${b.etd}` : '', `Commodity: ${b.commodity}`, `Gross weight: ${b.weightKg.toLocaleString()} kg`, conn.service_contract ? `Service contract: ${conn.service_contract}` : '', `Our reference: ${c.ref}`, '', 'Please confirm with the booking number, vessel, voyage and cut-offs.'].filter((x) => x !== '')
      const sent = emailProvider().id !== 'off' ? await sendEmail(conn.booking_email, `Booking request ${c.ref} — ${b.units}×${b.equipment.toUpperCase()} ${b.pol}-${b.pod}`, emailTemplate({ title: `Booking request ${c.ref}`, body: lines.join('\n') })).then(() => true).catch(() => false) : false
      await db.query(`update container_bookings set status = 'REQUESTED', status_detail = $2 where id = $1`, [id, sent ? `Emailed to ${conn.booking_email}` : 'Email not configured — copy the request and send it yourself'])
      await db.query(`insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,$3,$4,$5,'manual','')`, [c.id, c.status, c.origin_port, `Booking request ${sent ? 'emailed' : 'prepared'} for ${LINES[conn.line] ?? 'the line'} (${b.units}×${b.equipment}, ${b.pol} → ${b.pod}).`, u.name])
    }
    const { rows } = await db.query<Row>('select * from container_bookings where id = $1', [id]); res.status(201).json({ booking: bookingOut(rows[0]), emailText: conn.mode === 'email' ? request : undefined })
  }))
  r.post('/line-bookings/:id/refresh', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows } = await db.query<Row>('select * from container_bookings where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Not found.')
    res.json({ booking: bookingOut(await pollBooking(db, rows[0])) })
  }))
  /** Email bookings: record the line's confirmation by hand. */
  r.post('/line-bookings/:id/confirm', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const b = z.object({ bookingRef: z.string().trim().min(3).max(40), vesselName: z.string().trim().max(60).default(''), voyage: z.string().trim().max(20).default(''), etd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }).parse(req.body)
    const { rows } = await db.query<Row>('select * from container_bookings where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); const bk = rows[0]; if (!bk) throw new HttpError(404, 'Not found.')
    await db.query(`update container_bookings set status = 'CONFIRMED', carrier_booking_ref = $2, confirmed = $3 where id = $1`, [bk.id, b.bookingRef, JSON.stringify({ ...b, cutoff: null })])
    await db.query(`update containers set booking_ref = $2, line = $3, vessel_name = coalesce(nullif($4,''), vessel_name), voyage = coalesce(nullif($5,''), voyage), etd = coalesce($6::date, etd) where id = $1`, [bk.container_id, b.bookingRef, LINES[bk.line] ?? bk.line, b.vesselName, b.voyage, b.etd])
    res.json({ ok: true })
  }))
}
