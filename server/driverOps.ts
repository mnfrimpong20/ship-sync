import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { isDriverRole } from '../src/lib/roles'
import { notify, notifyShipperStaff } from './notify'
import { normalisePhone, sendText, smsProvider } from './sms'
import { distanceKm } from '../src/lib/geo'
import { ensurePieces, pieceOut } from './labels'
import { markPaid } from './momo'
import { csvCell as safeCsvCell } from '../src/lib/csvCell'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const money = (n: number) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
/** Rough rates for driver expenses in local money (same env overrides as the duty flow). */
export const FX: Record<string, number> = { USD: 1, GHS: Number(process.env.GHS_PER_USD || 11), NGN: Number(process.env.NGN_PER_USD || 1550), XOF: Number(process.env.XOF_PER_USD || 600), GBP: 0.79, EUR: 0.92 }
export const toUsd = (amount: number, cur: string) => Math.round((amount / (FX[cur] ?? 1)) * 100) / 100
const phoneOf = (raw: string) => (raw ? normalisePhone(raw, 'US') ?? normalisePhone(raw, 'GH') : null)
async function text(to: string, body: string) { const n = phoneOf(to); if (!n || smsProvider().id === 'off') return false; try { await sendText(n, body); return true } catch (e) { console.error('[driver] text', e); return false } }

/* ---------------- helpers used by other modules ---------------- */

/** Delivery runs: each stop with a receiver phone gets a 4-digit code by text when the run starts. */
export async function issueDeliveryCodes(db: Db, runId: string) {
  const { rows } = await db.query<Row>(`select st.*, sh.ref, sh.shipper_id, s2.name as shipper_name from run_stops st join runs r on r.id = st.run_id left join shipments sh on sh.id = st.shipment_id left join shippers s2 on s2.id = r.shipper_id where st.run_id = $1 and r.kind = 'delivery' and st.status = 'pending' and st.code is null and st.shipment_id is not null`, [runId])
  for (const st of rows) {
    const code = String(1000 + Math.floor(Math.random() * 9000))
    await db.query('update run_stops set code = $2 where id = $1', [st.id, code])
    if (st.phone) await text(st.phone, `${st.shipper_name ?? 'Ntemtem'}: your delivery ${st.ref} is out today. Give the driver this code when it arrives: ${code}. Don't share it before then.`)
  }
}

/** Tell the run's driver about a change made by the office (new stop, new order). Push + bell. */
export async function notifyDriver(db: Db, runId: string, title: string, body: string) {
  const { rows } = await db.query<Row>(`select r.id, r.status, s.user_id from runs r join staff s on s.id = r.driver_id where r.id = $1`, [runId])
  const r = rows[0]; if (!r?.user_id || !['planned', 'in_progress'].includes(r.status)) return
  await notify(db, { userId: r.user_id, kind: 'shipment_status', title, body, link: `/dashboard/routes/${runId}`, dedupe: `drv:${runId}:${Math.floor(Date.now() / 60000)}` })
}

/** For the public tracking page: how close the driver is (never the exact position). */
export async function driverForShipment(db: Db, shipmentId: string) {
  const { rows } = await db.query<Row>(`select st.id, st.seq, st.near_at, st.run_id, r.kind, s.name as driver, p.at as seen, p.lat, p.lon, st.lat as slat, st.lon as slon
    from run_stops st join runs r on r.id = st.run_id left join staff s on s.id = r.driver_id left join driver_positions p on p.staff_id = r.driver_id and p.run_id = r.id
    where st.shipment_id = $1 and st.status = 'pending' and r.status = 'in_progress' order by r.run_date desc limit 1`, [shipmentId])
  const x = rows[0]; if (!x) return null
  const { rows: ahead } = await db.query<{ n: number }>(`select count(*)::int as n from run_stops where run_id = $1 and status = 'pending' and seq < $2`, [x.run_id, x.seq])
  const km = x.lat != null && x.slat != null ? distanceKm([Number(x.lon), Number(x.lat)], [Number(x.slon), Number(x.slat)]) : null
  return { driver: String(x.driver ?? '').split(' ')[0], kind: x.kind as string, stopsAway: ahead[0].n, near: !!x.near_at, km: km == null ? null : Math.round(km * 10) / 10, lastSeen: ISO(x.seen) }
}

/* ---------------- routes ---------------- */
const zPhoto = z.string().max(600_000).regex(/^data:image\/(jpeg|png|webp);base64,/)
const zSig = z.string().max(120_000).regex(/^data:image\/png;base64,/)

const RECEIPT_KINDS = ['fuel', 'toll', 'parking', 'repair', 'meal', 'other'] as const
const RECEIPT_CUR = ['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR'] as const
export async function readReceipt(photo: string): Promise<{ ai: boolean; amount?: number; currency?: string; kind?: string; vendor?: string }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim(); if (!key) return { ai: false }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(photo); if (!m) return { ai: true }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch((process.env.ANTHROPIC_API_URL?.trim() || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({
      model: process.env.RECEIPT_MODEL?.trim() || process.env.ASSISTANT_MODEL?.trim() || 'claude-haiku-5-5', max_tokens: 200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
        { type: 'text', text: `This is a receipt a delivery driver paid. Reply with JSON only: {"amount": total paid as a number, "currency": one of ${RECEIPT_CUR.join('/')}, "kind": one of ${RECEIPT_KINDS.join('/')}, "vendor": shop name}. Use null for anything you can't read. Ghana cedis are GHS, naira NGN, CFA XOF.` },
      ] }] }) })
    if (!r.ok) return { ai: true }
    const j = await r.json() as { content?: { type: string; text?: string }[] }
    const txt = (j.content ?? []).map((c) => c.text ?? '').join(''); const js = /\{[\s\S]*\}/.exec(txt); if (!js) return { ai: true }
    const o = JSON.parse(js[0]) as Record<string, unknown>
    const amount = typeof o.amount === 'number' && o.amount > 0 && o.amount < 1_000_000 ? Math.round(o.amount * 100) / 100 : undefined
    const currency = RECEIPT_CUR.includes(o.currency as never) ? String(o.currency) : undefined
    const kind = RECEIPT_KINDS.includes(o.kind as never) ? String(o.kind) : undefined
    const vendor = typeof o.vendor === 'string' ? o.vendor.slice(0, 60) : undefined
    return { ai: true, amount, currency, kind, vendor }
  } catch { return { ai: true } } finally { clearTimeout(timer) }
}

export function mountDriverOps(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  /** Signed-in shipper staff with their staff row. */
  const staffOf = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'For shipping company staff.')
    const { rows } = await db.query<Row>('select * from staff where user_id = $1 and shipper_id = $2', [u.id, u.shipperId])
    const me = rows[0] ?? { id: 'owner:' + u.id, name: u.name, role: u.staffRole ?? 'owner' }
    return { u, me, shipperId: u.shipperId, role: String(me.role), office: !isDriverRole(me.role) }
  }
  const officeOnly = async (db: Db, req: Request) => { const x = await staffOf(db, req); if (!x.office || !['owner', 'dispatcher', 'finance'].includes(x.role)) throw new HttpError(403, 'Owners, dispatchers and finance only.'); return x }
  /** The run (and optionally stop) — drivers only their own runs. */
  const onRun = async (db: Db, req: Request, withStop = false) => {
    const x = await staffOf(db, req)
    const { rows } = await db.query<Row>('select * from runs where id = $1 and shipper_id = $2', [String(req.params.id), x.shipperId]); const run = rows[0]
    if (!run) throw new HttpError(404, 'Run not found.')
    if (!x.office && run.driver_id !== x.me.id) throw new HttpError(403, 'Not your run.')
    let stop: Row | null = null; let sh: Row | null = null
    if (withStop) {
      const { rows: st } = await db.query<Row>('select * from run_stops where id = $1 and run_id = $2', [String(req.params.sid), run.id]); stop = st[0] ?? null
      if (!stop) throw new HttpError(404, 'Stop not found.')
      if (stop.shipment_id) sh = (await db.query<Row>('select * from shipments where id = $1', [stop.shipment_id])).rows[0] ?? null
    }
    return { ...x, run, stop, sh }
  }

  /* ---- one stop, everything the driver needs there ---- */
  r.get('/runs/:id/stops/:sid/details', wrap(async (req, res) => {
    const db = await getDb(); const { run, stop, sh } = await onRun(db, req, true)
    const out: Record<string, unknown> = { kind: run.kind, code: stop!.code ? { required: true, verified: !!stop!.code_ok } : { required: false, verified: false } }
    if (sh) {
      const pieces = await ensurePieces(db, sh)
      const { rows: scans } = await db.query<Row>('select piece_id, kind from run_piece_scans where run_id = $1', [run.id])
      out.shipment = { id: sh.id, ref: sh.ref, cargo: sh.cargo, description: sh.description, mode: sh.mode, destination: sh.destination, payToken: null }
      out.pieces = pieces.map((p) => ({ ...pieceOut(p), sticker: p.sticker ?? null, weightKg: p.weight_kg == null ? null : Number(p.weight_kg), loaded: scans.some((s) => s.piece_id === p.id && s.kind === 'load'), dropped: scans.some((s) => s.piece_id === p.id && s.kind === 'drop') }))
      out.supplies = (await db.query<Row>(`select id, name, qty, status, unit_usd from shipment_supplies where shipment_id = $1 and status <> 'cancelled' order by created_at`, [sh.id])).rows.map((x) => ({ id: x.id, name: x.name, qty: Number(x.qty), status: x.status, unitUsd: Number(x.unit_usd) }))
      out.suppliesDrop = J(stop!.supplies_drop)
      out.catalog = (await db.query<Row>('select id, name, price_usd, kind from shipper_supplies where shipper_id = $1 and active order by sort, created_at', [sh.shipper_id])).rows.map((x) => ({ id: x.id, name: x.name, priceUsd: Number(x.price_usd), kind: x.kind }))
      out.charges = (await db.query<Row>(`select id, amount, currency, reason, status from receiver_charges where shipment_id = $1 and status in ('due','paid') order by created_at`, [sh.id])).rows.map((x) => ({ id: x.id, amount: Number(x.amount), currency: x.currency, reason: x.reason, status: x.status }))
      out.documents = (await db.query<Row>(`select id, kind, title, created_at from documents where shipment_id = $1 order by created_at desc`, [sh.id])).rows.map((x) => ({ id: x.id, kind: x.kind, title: x.title, createdAt: ISO(x.created_at) }))
      out.adjustments = (await db.query<Row>(`select id, old_usd, new_usd, reason, status from price_adjustments where shipment_id = $1 and status in ('proposed','sent') order by created_at desc`, [sh.id])).rows.map((x) => ({ id: x.id, oldUsd: Number(x.old_usd), newUsd: Number(x.new_usd), reason: x.reason, status: x.status }))
      const { rows: inv } = await db.query<Row>(`select pay_token from invoices where shipment_id = $1 and status in ('sent','partial','draft') and pay_token is not null order by created_at limit 1`, [sh.id])
      out.payLink = inv[0]?.pay_token ? `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/pay/${inv[0].pay_token}` : null
      if (sh.cargo === 'vehicle') { const { rows: v } = await db.query<Row>('select year, make, model, vin, color, title_status from shipment_vehicles where shipment_id = $1', [sh.id]); out.vehicle = v[0] ? { year: v[0].year, make: v[0].make, model: v[0].model, vin: v[0].vin, color: v[0].color, titleStatus: v[0].title_status } : {} }
      out.vehicleReport = J(stop!.vehicle_report) ? { ...J(stop!.vehicle_report), photos: undefined, photoCount: Object.keys((J(stop!.vehicle_report) as Row).photos ?? {}).length } : null
      if (sh.consignee_id) {
        const { rows: c } = await db.query<Row>('select name, phone, address, city, gps, lat, lng from client_consignees where id = $1', [sh.consignee_id])
        if (c[0]) out.receiver = { name: c[0].name, phone: c[0].phone, address: c[0].address, city: c[0].city, gps: c[0].gps ?? '', lat: c[0].lat == null ? null : Number(c[0].lat), lng: c[0].lng == null ? null : Number(c[0].lng) }
      }
    }
    res.set('Cache-Control', 'no-store'); res.json(out)
  }))

  /* ---- pickup: pieces, supplies, vehicle report, price approval ---- */
  r.post('/runs/:id/stops/:sid/pieces', wrap(async (req, res) => {
    const db = await getDb(); const { sh } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const { count } = z.object({ count: z.number().int().min(1).max(200) }).parse(req.body)
    res.json({ pieces: (await ensurePieces(db, sh, count)).map(pieceOut) })
  }))
  /** A pre-printed sticker (any barcode) stuck on a piece at the door — scans of it find this piece from now on. */
  r.post('/runs/:id/stops/:sid/pieces/:pid/sticker', wrap(async (req, res) => {
    const db = await getDb(); const { sh } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const { code } = z.object({ code: z.string().trim().min(3).max(120) }).parse(req.body)
    const { rows: taken } = await db.query<Row>('select p.id, s.ref from pieces p join shipments s on s.id = p.shipment_id where upper(p.sticker) = upper($1) and s.shipper_id = $2 and p.id <> $3', [code, sh.shipper_id, String(req.params.pid)])
    if (taken[0]) throw new HttpError(409, `That sticker is already on ${taken[0].ref}.`)
    const { rows } = await db.query<Row>('update pieces set sticker = $3 where id = $1 and shipment_id = $2 returning *', [String(req.params.pid), sh.id, code])
    if (!rows[0]) throw new HttpError(404, 'Piece not found.')
    res.json({ piece: { ...pieceOut(rows[0]), sticker: code } })
  }))
  r.post('/runs/:id/stops/:sid/supplies', wrap(async (req, res) => {
    const db = await getDb(); const { me, stop, sh } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const b = z.object({ dropped: z.array(z.string()).max(50).default([]), sell: z.object({ supplyId: z.string(), qty: z.number().int().min(1).max(50) }).optional() }).parse(req.body)
    if (b.sell) {
      const { rows } = await db.query<Row>('select * from shipper_supplies where id = $1 and shipper_id = $2 and active', [b.sell.supplyId, sh.shipper_id]); const it = rows[0]; if (!it) throw new HttpError(404, 'That item isn’t available.')
      await db.query(`insert into shipment_supplies (id,shipment_id,supply_id,name,qty,unit_usd,added_by,kind) values ($1,$2,$3,$4,$5,$6,$7,$8)`, ['ssl_' + uid(), sh.id, it.id, it.name, b.sell.qty, Number(it.price_usd), `${me.name} (at the door)`, it.kind])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, stop!.label || '', `${b.sell.qty} × ${it.name} sold at the door by ${me.name}.`])
    }
    if (b.dropped.length) {
      await db.query('update run_stops set supplies_drop = $2 where id = $1', [stop!.id, JSON.stringify({ lines: b.dropped, by: me.name, at: new Date().toISOString() })])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, stop!.label || '', `Packing supplies dropped off by ${me.name}.`])
    }
    res.json({ ok: true })
  }))
  r.post('/runs/:id/stops/:sid/vehicle-report', wrap(async (req, res) => {
    const db = await getDb(); const { me, stop, sh } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const b = z.object({
      photos: z.object({ front: zPhoto.optional(), back: zPhoto.optional(), left: zPhoto.optional(), right: zPhoto.optional(), odometer: zPhoto.optional(), damage1: zPhoto.optional(), damage2: zPhoto.optional() }),
      checks: z.object({ title: z.boolean(), keys: z.boolean(), fuel: z.boolean(), personalItems: z.boolean().default(false) }), mileage: z.number().int().min(0).max(2_000_000).optional(),
      damage: z.string().trim().max(500).default(''), signerName: z.string().trim().min(2).max(80), signature: zSig,
    }).parse(req.body)
    if (!b.photos.front || !b.photos.back || !b.photos.left || !b.photos.right) throw new HttpError(400, 'Take a photo of all four sides.')
    await db.query('update run_stops set vehicle_report = $2 where id = $1', [stop!.id, JSON.stringify({ ...b, by: me.name, at: new Date().toISOString() })])
    // Tick the matching handover items on the vehicle record, if there is one.
    const { rows: v } = await db.query<Row>('select checklist from shipment_vehicles where shipment_id = $1', [sh.id])
    if (v[0]) await db.query('update shipment_vehicles set checklist = $2, mileage = coalesce($3, mileage), updated_at = now() where shipment_id = $1', [sh.id, JSON.stringify({ ...(J(v[0].checklist) ?? {}), title: b.checks.title || undefined, keys: b.checks.keys || undefined, fuel: b.checks.fuel || undefined }), b.mileage ?? null])
    const flags = [!b.checks.title && 'no title', !b.checks.keys && 'no keys', !b.checks.fuel && 'fuel over a quarter', b.checks.personalItems && 'personal items inside'].filter(Boolean)
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, stop!.label || '', `Vehicle condition report by ${me.name}, signed by ${b.signerName}${b.mileage ? ` · ${b.mileage.toLocaleString()} miles` : ''}${b.damage ? ` · damage noted: ${b.damage}` : ''}.`])
    if (flags.length) await notifyShipperStaff(db, sh.shipper_id, { kind: 'shipment_status', title: `Vehicle pickup ${sh.ref}: ${flags.join(', ')}`, body: `${me.name} flagged this at the pickup.${b.damage ? ` Damage: ${b.damage}` : ''}`, link: `/dashboard/shipments?q=${sh.ref}&b=all` }, ['owner', 'dispatcher'])
    res.json({ ok: true, flags })
  }))
  r.post('/runs/:id/stops/:sid/approve-price', wrap(async (req, res) => {
    const db = await getDb(); const { me, sh } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const b = z.object({ adjustmentId: z.string(), signerName: z.string().trim().min(2).max(80), signature: zSig, decision: z.enum(['approve', 'decline']).default('approve') }).parse(req.body)
    const { rows } = await db.query<Row>(`select * from price_adjustments where id = $1 and shipment_id = $2 and status in ('proposed','sent')`, [b.adjustmentId, sh.id]); const a = rows[0]
    if (!a) throw new HttpError(409, 'This price change was already decided.')
    await db.query(`update price_adjustments set status = $2, decided_at = now(), decided_by = $3 where id = $1`, [a.id, b.decision === 'approve' ? 'approved' : 'declined', `${b.signerName} (signed at the door with ${me.name})`])
    if (b.decision === 'approve') {
      const { applyAdjustment } = await import('./autopilot')
      await applyAdjustment(db, sh, a, b.signerName)
    }
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, '', b.decision === 'approve' ? `${b.signerName} approved the updated price ${money(Number(a.new_usd))} at the door (signed).` : `${b.signerName} declined the updated price at the door.`])
    await notifyShipperStaff(db, sh.shipper_id, { kind: 'payment', title: `${b.signerName} ${b.decision === 'approve' ? 'approved' : 'declined'} the new price for ${sh.ref} at the door`, body: b.decision === 'approve' ? `${money(Number(a.new_usd))} is now due.` : 'Call them before it ships.', link: `/dashboard/shipments?q=${sh.ref}&b=all` }, ['owner', 'dispatcher', 'finance'])
    res.json({ ok: true })
  }))

  /* ---- loading the truck (delivery) and dropping at the warehouse (pickup) ---- */
  const runPieces = async (db: Db, runId: string) => {
    const { rows: stops } = await db.query<Row>('select st.id, st.seq, st.label, st.status, st.shipment_id, sh.ref from run_stops st left join shipments sh on sh.id = st.shipment_id where st.run_id = $1 order by st.seq', [runId])
    const { rows: pcs } = await db.query<Row>('select * from pieces where shipment_id = any($1::text[]) order by seq', [stops.map((s) => s.shipment_id).filter(Boolean)])
    const { rows: scans } = await db.query<Row>('select piece_id, kind, at from run_piece_scans where run_id = $1', [runId])
    return stops.filter((s) => s.shipment_id).map((s) => ({ stopId: s.id, seq: Number(s.seq), label: s.label, ref: s.ref, status: s.status, pieces: pcs.filter((p) => p.shipment_id === s.shipment_id).map((p) => ({ id: p.id, seq: Number(p.seq), labelCode: p.label_code, loaded: scans.some((x) => x.piece_id === p.id && x.kind === 'load'), dropped: scans.some((x) => x.piece_id === p.id && x.kind === 'drop') })) }))
  }
  r.get('/runs/:id/pieces', wrap(async (req, res) => { const db = await getDb(); const { run } = await onRun(db, req); res.set('Cache-Control', 'no-store'); res.json({ stops: await runPieces(db, run.id) }) }))
  r.post('/runs/:id/pieces/scan', wrap(async (req, res) => {
    const db = await getDb(); const { run, me } = await onRun(db, req)
    const b = z.object({ code: z.string().trim().min(3).max(120), kind: z.enum(['load', 'drop']) }).parse(req.body)
    const code = (b.code.match(/[A-Z]{2}-[A-Z0-9]{4,10}-P\d{1,3}/i)?.[0] ?? b.code).toUpperCase()
    const { rows } = await db.query<Row>('select p.*, sh.ref, sh.status as sh_status, sh.origin, sh.destination from pieces p join shipments sh on sh.id = p.shipment_id where (upper(p.label_code) = $1 or upper(p.sticker) = upper($3)) and sh.shipper_id = $2 limit 1', [code, run.shipper_id, b.code.trim()]); const p = rows[0]
    if (!p) throw new HttpError(404, `No piece with the code ${code}.`)
    const { rows: here } = await db.query<Row>('select id, label from run_stops where run_id = $1 and shipment_id = $2', [run.id, p.shipment_id])
    if (!here[0]) throw new HttpError(409, `${code} (${p.ref}) isn’t on this run — leave it on the shelf.`)
    const { rows: dup } = await db.query<Row>('insert into run_piece_scans (id,run_id,piece_id,kind,by_name) values ($1,$2,$3,$4,$5) on conflict (run_id, piece_id, kind) do nothing returning id', ['rps_' + uid(), run.id, p.id, b.kind, me.name])
    if (dup[0]) {
      await db.query('update pieces set last_scan_at = now(), last_scan_kind = $2, last_scan_place = $3, last_scan_by = $4 where id = $1', [p.id, b.kind === 'load' ? 'truck' : 'warehouse', b.kind === 'load' ? 'On the delivery truck' : 'Origin warehouse', me.name])
      if (b.kind === 'drop') {
        const { rows: left } = await db.query<{ n: number }>(`select count(*)::int as n from pieces pc where pc.shipment_id = $1 and not exists (select 1 from run_piece_scans x where x.piece_id = pc.id and x.run_id = $2 and x.kind = 'drop')`, [p.shipment_id, run.id])
        if (left[0].n === 0) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [p.shipment_id, p.sh_status, p.origin, `All pieces dropped at the warehouse by ${me.name}.`])
      }
    }
    res.json({ ok: true, already: !dup[0], piece: { labelCode: p.label_code, seq: Number(p.seq), ref: p.ref }, stop: here[0].label, stops: await runPieces(db, run.id) })
  }))

  /* ---- delivery: pin the door, receiver charges, papers ---- */
  r.post('/runs/:id/stops/:sid/pin', wrap(async (req, res) => {
    const db = await getDb(); const { stop, sh, me } = await onRun(db, req, true)
    const b = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).parse(req.body)
    await db.query('update run_stops set lat = $2, lon = $3 where id = $1', [stop!.id, b.lat, b.lon])
    if (sh?.consignee_id) await db.query('update client_consignees set lat = $2, lng = $3 where id = $1', [sh.consignee_id, b.lat, b.lon])
    if (sh) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, stop!.label || '', `Door location saved by ${me.name} for next time.`])
    res.json({ ok: true })
  }))
  r.post('/runs/:id/stops/:sid/charges/:cid', wrap(async (req, res) => {
    const db = await getDb(); const { sh, me } = await onRun(db, req, true); if (!sh) throw new HttpError(409, 'This stop has no shipment.')
    const b = z.object({ method: z.enum(['cash', 'momo_direct']), phone: z.string().trim().max(30).default('') }).parse(req.body)
    const { rows } = await db.query<Row>(`select * from receiver_charges where id = $1 and shipment_id = $2 and status = 'due'`, [String(req.params.cid), sh.id]); if (!rows[0]) throw new HttpError(409, 'This charge isn’t due any more.')
    await markPaid(db, rows[0], { method: b.method, phone: b.phone, by: `${me.name} (driver)`, settledTo: 'shipper' })
    res.json({ ok: true })
  }))

  /* ---- before the run: vehicle check ---- */
  r.post('/runs/:id/vehicle-check', wrap(async (req, res) => {
    const db = await getDb(); const { run, me, shipperId } = await onRun(db, req)
    const b = z.object({ items: z.record(z.string(), z.enum(['ok', 'issue'])), notes: z.string().trim().max(500).default(''), odometer: z.number().int().min(0).max(5_000_000).optional(), photo: zPhoto.optional(), safe: z.boolean() }).parse(req.body)
    const id = 'vc_' + uid(); const issues = Object.entries(b.items).filter(([, v]) => v === 'issue').map(([k]) => k)
    await db.query('insert into vehicle_checks (id,shipper_id,staff_id,run_id,vehicle_id,items,notes,odometer,photo,safe) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, shipperId, me.id, run.id, run.vehicle_id ?? null, JSON.stringify(b.items), b.notes, b.odometer ?? null, b.photo ?? null, b.safe])
    await db.query('update runs set vehicle_check = $2 where id = $1', [run.id, JSON.stringify({ id, at: new Date().toISOString(), by: me.name, issues, safe: b.safe, odometer: b.odometer ?? null })])
    if (run.vehicle_id && (!b.safe || issues.length)) {
      const note = `${new Date().toISOString().slice(0, 10)} check by ${me.name}: ${issues.join(', ') || 'issue'}${b.notes ? ` — ${b.notes}` : ''}`
      await db.query(`update vehicles set notes = trim(both from concat(notes, E'\\n', $2::text))${b.safe ? '' : `, status = 'maintenance'`} where id = $1`, [run.vehicle_id, note])
    }
    if (!b.safe || issues.length) await notifyShipperStaff(db, shipperId, { kind: 'system', title: b.safe ? `${me.name}: vehicle check found ${issues.length} issue${issues.length === 1 ? '' : 's'}` : `${me.name} says the vehicle isn’t safe to drive`, body: `${issues.join(', ')}${b.notes ? ` — ${b.notes}` : ''}. Run “${run.name}”.`, link: '/dashboard/fleet' }, ['owner', 'dispatcher'])
    res.json({ ok: true, issues })
  }))

  /* ---- live location and "arriving soon" ---- */
  r.post('/runs/:id/position', wrap(async (req, res) => {
    const db = await getDb(); const { run, me, shipperId } = await onRun(db, req)
    if (run.status !== 'in_progress') { res.json({ ok: false }); return }
    const b = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional() }).parse(req.body)
    await db.query(`insert into driver_positions (staff_id,shipper_id,run_id,lat,lon,accuracy,at) values ($1,$2,$3,$4,$5,$6,now()) on conflict (staff_id) do update set run_id = excluded.run_id, lat = excluded.lat, lon = excluded.lon, accuracy = excluded.accuracy, at = now()`, [me.id, shipperId, run.id, b.lat, b.lon, b.accuracy ?? null])
    // Within ~150 m of a pending stop (and a decent GPS fix): note the arrival time — the app asks "You've arrived?".
    const arrived: { id: string; label: string }[] = []
    if ((b.accuracy ?? 50) <= 120) {
      const { rows: here } = await db.query<Row>(`select id, label, lat, lon from run_stops where run_id = $1 and status = 'pending' and arrived_at is null and lat is not null`, [run.id])
      for (const st of here) if (distanceKm([b.lon, b.lat], [Number(st.lon), Number(st.lat)]) <= 0.15) { await db.query('update run_stops set arrived_at = now() where id = $1 and arrived_at is null', [st.id]); arrived.push({ id: st.id, label: st.label }) }
    }
    // Within ~2 km of a pending stop: one automatic "arriving soon" per stop.
    const { rows: stops } = await db.query<Row>(`select st.*, sh.ref, sh.user_id, sh.status as sh_status from run_stops st left join shipments sh on sh.id = st.shipment_id where st.run_id = $1 and st.status = 'pending' and st.near_at is null and st.lat is not null`, [run.id])
    const near: string[] = []
    for (const st of stops) {
      if (distanceKm([b.lon, b.lat], [Number(st.lon), Number(st.lat)]) > 2) continue
      const { rows: claimed } = await db.query<Row>('update run_stops set near_at = now() where id = $1 and near_at is null returning id', [st.id]); if (!claimed[0]) continue
      near.push(st.label)
      const msg = `${me.name.split(' ')[0]} is a few minutes away${run.kind === 'pickup' ? ' to collect your shipment' : ' with your delivery'}${st.ref ? ` (${st.ref})` : ''}. Please be ready.`
      if (st.phone) await text(st.phone, msg)
      if (st.shipment_id) {
        await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [st.shipment_id, st.sh_status, st.label || '', `Driver ${me.name.split(' ')[0]} is a few minutes away.`])
        if (st.user_id) await notify(db, { userId: st.user_id, kind: 'shipment_status', title: `${st.ref}: driver arriving soon`, body: msg, link: `/dashboard?tab=shipments&open=${st.shipment_id}`, dedupe: `near:${st.id}` })
      }
    }
    res.json({ ok: true, near, arrived })
  }))
  /** "I'm outside": one text to the receiver/sender, and it shows on their tracking. */
  r.post('/runs/:id/stops/:sid/outside', wrap(async (req, res) => {
    const db = await getDb(); const { run, me } = await onRun(db, req)
    if (run.status !== 'in_progress') throw new HttpError(409, 'Start the run first.')
    const { rows } = await db.query<Row>(`select st.*, sh.ref, sh.user_id, sh.status as sh_status from run_stops st left join shipments sh on sh.id = st.shipment_id where st.id = $1 and st.run_id = $2`, [String(req.params.sid), run.id]); const st = rows[0]
    if (!st) throw new HttpError(404, 'Stop not found.')
    if (st.status !== 'pending') throw new HttpError(409, 'This stop is already closed.')
    if (st.outside_at) { res.json({ ok: true, texted: false, already: true }); return }
    await db.query('update run_stops set outside_at = now(), arrived_at = coalesce(arrived_at, now()) where id = $1', [st.id])
    const first = me.name.split(' ')[0]
    const msg = `${first} is outside now${run.kind === 'pickup' ? ' to collect your shipment' : ' with your delivery'}${st.ref ? ` (${st.ref})` : ''}.`
    const texted = st.phone ? await text(st.phone, msg) : false
    if (st.shipment_id) {
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [st.shipment_id, st.sh_status, st.label || '', `Driver ${first} has arrived.`])
      if (st.user_id) await notify(db, { userId: st.user_id, kind: 'shipment_status', title: `${st.ref}: your driver is outside`, body: msg, link: `/dashboard?tab=shipments&open=${st.shipment_id}`, dedupe: `outside:${st.id}` })
    }
    res.json({ ok: true, texted, text: msg })
  }))
  r.get('/runs/positions', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, office } = await staffOf(db, req); if (!office) throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>(`select p.*, s.name, s.role, r.name as run_name, r.kind, (select count(*)::int from run_stops x where x.run_id = r.id and x.status = 'pending') as pending from driver_positions p join staff s on s.id = p.staff_id left join runs r on r.id = p.run_id where p.shipper_id = $1 and p.at > now() - interval '12 hours' and r.status = 'in_progress' order by p.at desc`, [shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ drivers: rows.map((x) => ({ staffId: x.staff_id, name: x.name, role: x.role, runId: x.run_id, runName: x.run_name, kind: x.kind, pending: Number(x.pending), lat: Number(x.lat), lon: Number(x.lon), at: ISO(x.at) })) })
  }))

  /* ---- incidents ---- */
  r.post('/runs/:id/incidents', wrap(async (req, res) => {
    const db = await getDb(); const { run, me, shipperId } = await onRun(db, req)
    const b = z.object({ stopId: z.string().optional(), kind: z.enum(['damage', 'accident', 'theft', 'injury', 'other']), description: z.string().trim().min(5, 'Say what happened.').max(2000), photos: z.array(zPhoto).max(4).default([]) }).parse(req.body)
    let shipmentId: string | null = null
    if (b.stopId) { const { rows } = await db.query<Row>('select shipment_id from run_stops where id = $1 and run_id = $2', [b.stopId, run.id]); shipmentId = rows[0]?.shipment_id ?? null }
    const id = 'inc_' + uid(); let claim = false
    if (shipmentId && ['damage', 'theft', 'accident'].includes(b.kind)) {
      const { rows: pol } = await db.query<Row>(`select * from insurance_policies where shipment_id = $1 and status = 'active' limit 1`, [shipmentId])
      if (pol[0]) {
        claim = true
        await db.query(`update insurance_policies set status = 'claim_open', claim = $2 where id = $1`, [pol[0].id, JSON.stringify({ description: `${b.kind}: ${b.description}`, amountUsd: 0, contact: '', filedBy: `${me.name} (driver incident report)`, filedAt: new Date().toISOString(), outcome: null, settledUsd: null, note: 'Filed from a driver incident report — amount to be assessed.' })])
        const { rows: admins } = await db.query<Row>('select id from users where is_admin')
        for (const a of admins) await notify(db, { userId: a.id, kind: 'insurance', title: `Insurance claim opened from a driver report`, body: `${b.kind} — ${b.description.slice(0, 120)}`, link: '/admin?tab=insurance' })
      }
    }
    await db.query('insert into incidents (id,shipper_id,run_id,stop_id,shipment_id,staff_id,by_name,kind,description,photos,claim) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, shipperId, run.id, b.stopId ?? null, shipmentId, me.id, me.name, b.kind, b.description, JSON.stringify(b.photos), claim])
    if (shipmentId) await db.query(`insert into shipment_events (shipment_id,status,place,note) values ($1,(select status from shipments where id = $1),'',$2)`, [shipmentId, `Incident reported by ${me.name}: ${b.kind}.${claim ? ' Insurance claim opened.' : ''}`])
    await notifyShipperStaff(db, shipperId, { kind: 'system', title: `${me.name} reported ${b.kind === 'other' ? 'a problem' : `a ${b.kind}`}`, body: `${b.description.slice(0, 160)}${claim ? ' · insurance claim opened' : ''}`, link: '/dashboard/drivers?tab=road' }, ['owner', 'dispatcher'])
    res.status(201).json({ ok: true, id, claim })
  }))
  r.get('/drivers/incidents', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await officeOnly(db, req)
    const { rows } = await db.query<Row>(`select i.*, sh.ref, r.name as run_name from incidents i left join shipments sh on sh.id = i.shipment_id left join runs r on r.id = i.run_id where i.shipper_id = $1 order by i.at desc limit 100`, [shipperId])
    res.json({ incidents: rows.map((x) => ({ id: x.id, kind: x.kind, description: x.description, photos: J(x.photos) ?? [], by: x.by_name, ref: x.ref ?? null, runId: x.run_id, runName: x.run_name, claim: !!x.claim, status: x.status, at: ISO(x.at) })) })
  }))
  r.patch('/drivers/incidents/:iid', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await officeOnly(db, req)
    const { status } = z.object({ status: z.enum(['open', 'closed']) }).parse(req.body)
    await db.query('update incidents set status = $3 where id = $1 and shipper_id = $2', [String(req.params.iid), shipperId, status]); res.json({ ok: true })
  }))

  /* ---- messages between the driver and the office, per run (optionally per stop) ---- */
  const msgOut = (m: Row) => ({ id: m.id, stopId: m.stop_id, from: m.from_name, side: m.from_side as 'driver' | 'office', body: m.body, audio: m.audio ?? null, at: ISO(m.at) })
  r.get('/runs/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { run, office } = await onRun(db, req)
    const { rows } = await db.query<Row>('select * from run_messages where run_id = $1 order by at asc limit 300', [run.id])
    await db.query(`update run_messages set ${office ? 'read_by_office' : 'read_by_driver'} = true where run_id = $1 and from_side = $2`, [run.id, office ? 'driver' : 'office'])
    res.set('Cache-Control', 'no-store'); res.json({ messages: rows.map(msgOut) })
  }))
  r.post('/runs/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { run, office, me, shipperId } = await onRun(db, req)
    const b = z.object({ stopId: z.string().optional(), body: z.string().trim().max(1000).default(''), audio: z.string().max(1_400_000).regex(/^data:audio\/[a-z0-9.+-]+(;codecs=[^;]+)?;base64,/).optional() }).parse(req.body)
    if (!b.body && !b.audio) throw new HttpError(400, 'Write a message or record a voice note.')
    const id = 'rm_' + uid()
    await db.query('insert into run_messages (id,run_id,stop_id,shipper_id,from_name,from_side,body,audio) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, run.id, b.stopId ?? null, shipperId, me.name, office ? 'office' : 'driver', b.body, b.audio ?? null])
    let where = ''
    if (b.stopId) { const { rows } = await db.query<Row>('select label from run_stops where id = $1', [b.stopId]); where = rows[0]?.label ? ` about ${rows[0].label}` : '' }
    const preview = b.body ? b.body.slice(0, 140) : 'Voice note'
    if (office) await notifyDriver(db, run.id, `Dispatch${where}: ${preview}`, `${me.name} on “${run.name}”.`)
    else await notifyShipperStaff(db, shipperId, { kind: 'system', title: `${me.name}${where}`, body: preview, link: `/dashboard/routes/${run.id}`, dedupe: `msg:${id}` }, ['owner', 'dispatcher'])
    res.status(201).json({ message: msgOut((await db.query<Row>('select * from run_messages where id = $1', [id])).rows[0]) })
  }))

  /* ---- expenses ---- */
  r.post('/drivers/expenses', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await staffOf(db, req)
    const b = z.object({ paidBy: z.enum(['driver', 'company']).default('driver'), runId: z.string().optional(), kind: z.enum(['fuel', 'toll', 'parking', 'repair', 'meal', 'other']), amount: z.number().positive().max(1_000_000), currency: z.enum(['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR']).default('USD'), photo: zPhoto.optional(), note: z.string().trim().max(300).default('') }).parse(req.body)
    if (b.runId) { const { rows } = await db.query<Row>('select id from runs where id = $1 and shipper_id = $2', [b.runId, shipperId]); if (!rows[0]) throw new HttpError(404, 'Run not found.') }
    const usd = toUsd(b.amount, b.currency); const id = 'dx_' + uid(); const costId = 'cost_' + uid()
    const cat = b.kind === 'fuel' || b.kind === 'repair' ? 'fuel' : b.kind === 'toll' || b.kind === 'parking' ? 'trucking' : 'other'
    await db.query('insert into costs (id,shipper_id,category,description,vendor,amount_usd,created_by) values ($1,$2,$3,$4,$5,$6,$7)', [costId, shipperId, cat, `${b.kind[0].toUpperCase() + b.kind.slice(1)} — ${me.name}${b.currency !== 'USD' ? ` (${b.currency} ${b.amount.toLocaleString()})` : ''}${b.note ? ` · ${b.note}` : ''}`, '', usd, me.name])
    await db.query('insert into driver_expenses (id,shipper_id,staff_id,run_id,kind,amount,currency,amount_usd,photo,note,cost_id,paid_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, shipperId, me.id, b.runId ?? null, b.kind, b.amount, b.currency, usd, b.photo ?? null, b.note, costId, b.paidBy])
    await notifyShipperStaff(db, shipperId, { kind: 'payment', title: `${me.name} logged ${b.kind}: ${b.currency} ${b.amount}`, body: b.paidBy === 'company' ? 'Paid with the company card.' : 'Approve it under Drivers → Pay to pay them back.', link: '/dashboard/drivers?tab=payroll', dedupe: `exp:${id}` }, ['owner', 'finance'])
    res.status(201).json({ ok: true, amountUsd: usd })
  }))
  /** Read a receipt photo (amount, currency, what for) so the driver only checks it. Needs ANTHROPIC_API_KEY; otherwise { ai: false }. */
  r.post('/drivers/expenses/read', wrap(async (req, res) => {
    const db = await getDb(); await staffOf(db, req)
    const { photo } = z.object({ photo: zPhoto }).parse(req.body)
    res.json(await readReceipt(photo))
  }))
  r.get('/drivers/expenses', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, office, me } = await staffOf(db, req)
    const { rows } = await db.query<Row>(`select e.*, s.name from driver_expenses e join staff s on s.id = e.staff_id where e.shipper_id = $1 ${office ? '' : 'and e.staff_id = $2'} and e.at > now() - interval '35 days' order by e.at desc`, office ? [shipperId] : [shipperId, me.id])
    res.json({ expenses: rows.map((x) => ({ id: x.id, name: x.name, kind: x.kind, amount: Number(x.amount), currency: x.currency, amountUsd: Number(x.amount_usd), hasPhoto: !!x.photo, photo: office ? x.photo : undefined, note: x.note, runId: x.run_id, at: ISO(x.at) })) })
  }))

  /* ---- shifts ---- */
  const shiftOut = (x: Row) => { const br = (J(x.breaks) ?? []) as { start: string; end?: string }[]; const end = x.end_at ? new Date(x.end_at).getTime() : Date.now(); const brMs = br.reduce((n, b) => n + ((b.end ? new Date(b.end).getTime() : Date.now()) - new Date(b.start).getTime()), 0); const fl = (J(x.flags) ?? {}) as Record<string, unknown>; return { id: x.id, start: ISO(x.start_at), end: ISO(x.end_at), onBreak: br.some((b) => !b.end), breaks: br, auto: fl.autoClosed ? (fl.confirm as 'pending' | 'confirmed' | 'fixed') ?? 'pending' : null, hours: Math.max(0, Math.round(((end - new Date(x.start_at).getTime() - brMs) / 3600000) * 100) / 100) } }
  r.get('/shifts/me', wrap(async (req, res) => {
    const db = await getDb(); const { me } = await staffOf(db, req)
    await import('./driverHr').then((m) => m.closeStaleShift(db, me.id)).catch((e) => console.error('[shift] auto-close', e))
    res.set('Cache-Control', 'no-store'); res.json(await myShifts(db, me.id))
  }))
  const myShifts = async (db: Db, staffId: string) => {
    const { rows } = await db.query<Row>(`select * from shifts where staff_id = $1 and start_at > now() - interval '7 days' order by start_at desc`, [staffId])
    const list = rows.map(shiftOut)
    return { current: list.find((s) => !s.end) ?? null, review: list.find((s) => s.auto === 'pending') ?? null, week: Math.round(list.reduce((n, s) => n + s.hours, 0) * 10) / 10, shifts: list }
  }
  /** "That's right" or the real clock-out time, for a shift that closed itself. */
  r.post('/shifts/:id/confirm', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await staffOf(db, req)
    const b = z.object({ end: z.string().datetime({ offset: true }).optional() }).parse(req.body ?? {})
    const { rows } = await db.query<Row>('select * from shifts where id = $1 and staff_id = $2', [String(req.params.id), me.id]); const x = rows[0]
    if (!x) throw new HttpError(404, 'Shift not found.')
    const fl = (J(x.flags) ?? {}) as Record<string, unknown>
    if (!fl.autoClosed || fl.confirm !== 'pending') throw new HttpError(409, 'This shift doesn’t need checking.')
    if (x.paid_slip) throw new HttpError(409, 'This shift is already on a payslip — ask the office to correct it.')
    if (b.end) {
      const end = new Date(b.end).getTime(); const start = new Date(x.start_at).getTime()
      if (end <= start) throw new HttpError(400, 'Clock-out must be after you clocked in.')
      if (end > Date.now()) throw new HttpError(400, 'That time is in the future.')
      if (end - start > 24 * 3600000) throw new HttpError(400, 'That makes the shift longer than 24 hours — ask the office to correct it.')
      const br = ((J(x.breaks) ?? []) as { start: string; end?: string }[]).filter((k) => new Date(k.start).getTime() < end).map((k) => (k.end && new Date(k.end).getTime() <= end ? k : { ...k, end: b.end! }))
      const edits = [...((J(x.edits) ?? []) as Row[]), { by: me.name, at: new Date().toISOString(), reason: 'Corrected the automatic clock-out.', before: { start: ISO(x.start_at), end: ISO(x.end_at) } }]
      await db.query('update shifts set end_at = $2, breaks = $3, flags = $4, edits = $5 where id = $1', [x.id, b.end, JSON.stringify(br), JSON.stringify({ ...fl, confirm: 'fixed' }), JSON.stringify(edits)])
      const hs = await import('./driverHr').then((m) => m.hrSettings(db, shipperId)); const { rows: sb } = await db.query<Row>('select base from staff where id = $1', [me.id])
      let when = b.end; try { when = new Intl.DateTimeFormat('en-US', { timeZone: sb[0]?.base === 'destination' ? hs.tzDestination : hs.tzOrigin, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(b.end)) } catch { /* bad tz */ }
      await notifyShipperStaff(db, shipperId, { kind: 'system', title: `${me.name} corrected their clock-out`, body: `The shift that closed itself now ends ${when}. Check it on the timesheet.`, link: '/dashboard/hr?tab=hours' }, ['owner', 'dispatcher']).catch(() => {})
    } else await db.query('update shifts set flags = $2 where id = $1', [x.id, JSON.stringify({ ...fl, confirm: 'confirmed' })])
    res.json(await myShifts(db, me.id))
  }))
  r.post('/shifts/clock', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await staffOf(db, req)
    const { action } = z.object({ action: z.enum(['in', 'break', 'resume', 'out']) }).parse(req.body)
    const { rows } = await db.query<Row>('select * from shifts where staff_id = $1 and end_at is null order by start_at desc limit 1', [me.id]); const cur = rows[0]
    const now = new Date().toISOString()
    if (action === 'in') { if (cur) throw new HttpError(409, 'You’re already clocked in.'); await db.query('insert into shifts (id,shipper_id,staff_id) values ($1,$2,$3)', ['sh_' + uid(), shipperId, me.id]) }
    else {
      if (!cur) throw new HttpError(409, 'You’re not clocked in.')
      const br = (J(cur.breaks) ?? []) as { start: string; end?: string }[]
      if (action === 'break') { if (br.some((b) => !b.end)) throw new HttpError(409, 'Already on a break.'); br.push({ start: now }) }
      if (action === 'resume' || action === 'out') for (const b of br) if (!b.end) b.end = now
      await db.query(`update shifts set breaks = $2${action === 'out' ? ', end_at = now()' : ''} where id = $1`, [cur.id, JSON.stringify(br)])
    }
    res.json(await myShifts(db, me.id))
  }))

  /* ---- cash handover ---- */
  const cashDue = async (db: Db, shipperId: string, staffId?: string) => {
    const { rows } = await db.query<Row>(`select st.id, st.label, st.collected, st.done_at, r.name as run_name, r.driver_id, s.name from run_stops st join runs r on r.id = st.run_id join staff s on s.id = r.driver_id where r.shipper_id = $1 ${staffId ? 'and r.driver_id = $2' : ''} and st.collected is not null and st.handed_over_id is null`, staffId ? [shipperId, staffId] : [shipperId])
    return rows.map((x) => ({ stopId: x.id as string, label: x.label as string, runName: x.run_name as string, driverId: x.driver_id as string, name: x.name as string, ...(J(x.collected) as { method: string; amountUsd: number }) })).filter((x) => x.method === 'cash')
  }
  r.get('/drivers/cash', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, office, me } = await staffOf(db, req)
    if (!office) { const due = await cashDue(db, shipperId, me.id); const { rows: last } = await db.query<Row>('select * from cash_handovers where staff_id = $1 order by at desc limit 5', [me.id]); res.json({ due: due.reduce((n, x) => n + x.amountUsd, 0), stops: due, handovers: last.map((h) => ({ id: h.id, expected: Number(h.expected), received: Number(h.received), at: ISO(h.at), by: h.by_name, note: h.note })) }); return }
    if (!['owner', 'dispatcher', 'finance'].includes((await staffOf(db, req)).role)) throw new HttpError(403, 'Owners, dispatchers and finance only.')
    const due = await cashDue(db, shipperId)
    const byDriver = new Map<string, { staffId: string; name: string; due: number; stops: Row[] }>()
    for (const x of due) { const k = byDriver.get(x.driverId) ?? { staffId: x.driverId, name: x.name, due: 0, stops: [] }; k.due += x.amountUsd; k.stops.push(x); byDriver.set(x.driverId, k) }
    const { rows: hist } = await db.query<Row>(`select h.*, s.name from cash_handovers h join staff s on s.id = h.staff_id where h.shipper_id = $1 and h.at > now() - interval '35 days' order by h.at desc`, [shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ drivers: [...byDriver.values()], handovers: hist.map((h) => ({ id: h.id, name: h.name, expected: Number(h.expected), received: Number(h.received), diff: Math.round((Number(h.received) - Number(h.expected)) * 100) / 100, at: ISO(h.at), by: h.by_name, note: h.note })) })
  }))
  r.post('/drivers/:staffId/cash', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await officeOnly(db, req)
    const b = z.object({ received: z.number().min(0).max(10_000_000), note: z.string().trim().max(300).default(''), deduct: z.boolean().default(false) }).parse(req.body)
    const due = await cashDue(db, shipperId, String(req.params.staffId)); if (!due.length) throw new HttpError(409, 'Nothing to hand over for this driver.')
    const expected = Math.round(due.reduce((n, x) => n + x.amountUsd, 0) * 100) / 100; const id = 'ch_' + uid()
    await db.query('insert into cash_handovers (id,shipper_id,staff_id,expected,received,stops,by_name,note) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, shipperId, String(req.params.staffId), expected, b.received, JSON.stringify(due.map((x) => x.stopId)), me.name, b.note])
    await db.query('update run_stops set handed_over_id = $2 where id = any($1::text[])', [due.map((x) => x.stopId), id])
    const diff = Math.round((b.received - expected) * 100) / 100
    if (diff < 0 && b.deduct) await db.query('insert into pay_adjustments (id,shipper_id,staff_id,kind,amount,currency,note,installments,remaining,created_by) values ($1,$2,$3,$4,$5,$6,$7,1,$5,$8)', ['pa_' + uid(), shipperId, String(req.params.staffId), 'shortfall', -diff, 'USD', `Cash handover ${new Date().toISOString().slice(0, 10)}${b.note ? ` — ${b.note}` : ''}`, me.name])
    const { rows: drv } = await db.query<Row>('select user_id, name from staff where id = $1', [String(req.params.staffId)])
    if (drv[0]?.user_id) await notify(db, { userId: drv[0].user_id, kind: 'payment', title: diff === 0 ? `Cash handover confirmed — ${money(b.received)}` : `Cash handover: ${money(b.received)} received, ${money(expected)} expected`, body: diff === 0 ? `${me.name} confirmed it. Thank you.` : `${diff < 0 ? `${money(-diff)} short` : `${money(diff)} over`}. ${b.note || 'Talk to the office.'}`, link: '/dashboard/runs' })
    if (diff !== 0) await notifyShipperStaff(db, shipperId, { kind: 'payment', title: `Cash mismatch: ${drv[0]?.name ?? 'driver'} ${diff < 0 ? `${money(-diff)} short` : `${money(diff)} over`}`, body: `Expected ${money(expected)}, received ${money(b.received)}. Recorded by ${me.name}.`, link: '/dashboard/drivers?tab=cash' }, ['owner', 'finance'])
    res.json({ ok: true, expected, received: b.received, diff })
  }))

  /* ---- performance, timesheets and pay ---- */
  r.get('/drivers/stats', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, office, me } = await staffOf(db, req)
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))
    const { rows: drivers } = await db.query<Row>(`select * from staff where shipper_id = $1 and role in ('pickup_driver','delivery_driver','driver') ${office ? '' : 'and id = $2'} order by name`, office ? [shipperId] : [shipperId, me.id])
    const out = []
    for (const dr of drivers) {
      const { rows: st } = await db.query<Row>(`select st.status, st.skip_reason, st.done_at, st.eta_to, st.pod, r.run_date, r.id as run_id, r.kind from run_stops st join runs r on r.id = st.run_id where r.driver_id = $1 and r.run_date >= current_date - $2::int and r.status in ('in_progress','done')`, [dr.id, days])
      const done = st.filter((x) => x.status === 'done'); const skipped = st.filter((x) => x.status === 'skipped')
      const timed = done.filter((x) => x.eta_to && x.done_at); const onTime = timed.filter((x) => new Date(x.done_at).toTimeString().slice(0, 5) <= String(x.eta_to)).length
      const runs = new Set(st.map((x) => x.run_id)).size; const daysWorked = new Set(st.map((x) => String(x.run_date).slice(0, 10))).size
      const reasons: Record<string, number> = {}; for (const x of skipped) reasons[x.skip_reason || 'other'] = (reasons[x.skip_reason || 'other'] ?? 0) + 1
      const { rows: sh } = await db.query<Row>(`select start_at, end_at, breaks from shifts where staff_id = $1 and start_at >= now() - ($2::int || ' days')::interval`, [dr.id, days])
      const hours = Math.round(sh.map(shiftOut).reduce((n, s) => n + s.hours, 0) * 10) / 10
      const pay = (J(dr.pay) ?? {}) as { perStop?: number; perRun?: number; perHour?: number; currency?: string }
      const earned = Math.round(((pay.perStop ?? 0) * done.length + (pay.perRun ?? 0) * runs + (pay.perHour ?? 0) * hours) * 100) / 100
      out.push({ staffId: dr.id, name: dr.name, role: dr.role, runs, stops: st.length, done: done.length, skipped: skipped.length, completionPct: st.length ? Math.round((done.length / st.length) * 100) : null, onTimePct: timed.length ? Math.round((onTime / timed.length) * 100) : null, perDay: daysWorked ? Math.round((done.length / daysWorked) * 10) / 10 : 0, reasons, hours, pay, earned })
    }
    res.set('Cache-Control', 'no-store'); res.json({ days, drivers: out })
  }))
  r.put('/drivers/:staffId/pay', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, role } = await officeOnly(db, req)
    { const { rows: t } = await db.query<Row>('select role from staff where id = $1 and shipper_id = $2', [String(req.params.staffId), shipperId]); if (t[0] && !isDriverRole(t[0].role) && !['owner', 'finance'].includes(role)) throw new HttpError(403, 'Only the owner or finance can set office pay.') }
    const b = z.object({ perStop: z.number().min(0).max(10000).default(0), perRun: z.number().min(0).max(100000).default(0), perHour: z.number().min(0).max(1000).default(0), monthly: z.number().min(0).max(10_000_000).default(0), currency: z.enum(['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR']).default('USD') }).parse(req.body)
    const { rows } = await db.query<Row>('update staff set pay = $3 where id = $1 and shipper_id = $2 returning id', [String(req.params.staffId), shipperId, JSON.stringify(b)]); if (!rows[0]) throw new HttpError(404, 'Person not found.')
    res.json({ ok: true, pay: b })
  }))
  r.get('/drivers/timesheet.csv', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await officeOnly(db, req)
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14))
    const { rows } = await db.query<Row>(`select sh.*, s.name, s.role from shifts sh join staff s on s.id = sh.staff_id where sh.shipper_id = $1 and sh.start_at >= now() - ($2::int || ' days')::interval order by s.name, sh.start_at`, [shipperId, days])
    const lines = [['Name', 'Role', 'Clock in', 'Clock out', 'Breaks (min)', 'Hours'].join(',')]
    for (const x of rows) { const o = shiftOut(x); const brMin = Math.round(o.breaks.reduce((n, b) => n + ((b.end ? new Date(b.end).getTime() : Date.now()) - new Date(b.start).getTime()), 0) / 60000); lines.push([x.name, x.role, o.start, o.end ?? 'still on shift', brMin, o.hours].map((v) => safeCsvCell(v)).join(',')) }
    res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="timesheet-${new Date().toISOString().slice(0, 10)}.csv"`); res.send(lines.join('\n'))
  }))
  r.get('/drivers/shifts', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await officeOnly(db, req)
    const { rows } = await db.query<Row>(`select sh.*, s.name from shifts sh join staff s on s.id = sh.staff_id where sh.shipper_id = $1 and sh.start_at >= now() - interval '14 days' order by sh.start_at desc`, [shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ shifts: rows.map((x) => ({ ...shiftOut(x), name: x.name, staffId: x.staff_id })) })
  }))
  r.get('/drivers/messages', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await officeOnly(db, req)
    const { rows } = await db.query<Row>(`select m.*, r.name as run_name, st.label as stop_label from run_messages m join runs r on r.id = m.run_id left join run_stops st on st.id = m.stop_id where m.shipper_id = $1 and m.at > now() - interval '3 days' order by m.at desc limit 50`, [shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ messages: rows.map((m) => ({ ...msgOut(m), runId: m.run_id, runName: m.run_name, stopLabel: m.stop_label ?? null, unread: m.from_side === 'driver' && !m.read_by_office })) })
  }))
}
