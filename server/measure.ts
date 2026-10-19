/**
 * Weigh & measure: per-piece weight and dimensions recorded at pickup or in the warehouse (keyboard, or a
 * USB/Bluetooth scale read in the browser), rolled up to actual kg, m³, volumetric and chargeable weight and
 * compared with what the customer declared when it was quoted.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'
import { ensurePieces } from './labels'
import { notify } from './notify'
import { parseDims, totals, type PieceDims } from '../src/lib/weights'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const N = (v: unknown) => (v == null ? null : Number(v))
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const dimsOf = (p: Row): PieceDims => ({ weightKg: N(p.weight_kg), lengthCm: N(p.length_cm), widthCm: N(p.width_cm), heightCm: N(p.height_cm) })

/** What the customer told us at quote time, as a rough total for comparison. */
async function declared(db: Db, s: Row) {
  const b = J<Row>(s.booking, {})
  let weightKg: number | null = b.weightKg != null ? Number(b.weightKg) : null
  let dims: string = b.dims ?? ''
  let qty = Number(b.quantity ?? 0) || null
  if (s.request_id && (weightKg == null || !dims)) { const { rows } = await db.query<Row>('select weight_kg, dims, quantity from requests where id = $1', [s.request_id]); weightKg ??= N(rows[0]?.weight_kg); dims ||= rows[0]?.dims ?? ''; qty ??= N(rows[0]?.quantity) }
  const d = parseDims(dims)
  const est = d && qty ? totals(Array.from({ length: qty }, () => ({ weightKg: weightKg != null ? weightKg / qty! : null, ...d })), s.mode) : null
  return { weightKg, dims, quantity: qty, chargeableKg: est ? est.chargeableKg : weightKg, cbm: est?.cbm ?? null }
}

export async function measureView(db: Db, s: Row) {
  const pieces = await ensurePieces(db, s)
  const t = totals(pieces.map(dimsOf), s.mode)
  const dec = await declared(db, s)
  const diffPct = dec.chargeableKg && t.measured === t.pieces ? Math.round(((t.chargeableKg - dec.chargeableKg) / dec.chargeableKg) * 100) : null
  return {
    mode: s.mode as 'air' | 'ocean', pieces: pieces.map((p) => ({ id: p.id, seq: Number(p.seq), labelCode: p.label_code, ...dimsOf(p), measuredAt: ISO(p.measured_at), measuredBy: p.measured_by ?? '' })),
    totals: t, declared: dec, diffPct,
  }
}

const num = (max: number) => z.number().min(0).max(max).nullable().optional()
const zMeasure = z.object({ weightKg: num(30000), lengthCm: num(1500), widthCm: num(1500), heightCm: num(1500), source: z.enum(['scale', 'manual']).default('manual') })

export function mountMeasure(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const access = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const staff = u.role === 'shipper' && s.shipper_id === u.shipperId
    if (!staff && !(u.role === 'customer' && s.user_id === u.id) && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, staff }
  }
  r.get('/shipments/:id/measure', wrap(async (req, res) => {
    const db = await getDb(); const { s, staff } = await access(db, req)
    res.set('Cache-Control', 'no-store'); res.json({ ...(await measureView(db, s)), canEdit: staff })
  }))
  r.put('/shipments/:id/pieces/:pid/measure', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, staff } = await access(db, req); if (!staff) throw new HttpError(403, 'Only the shipper’s team records weights.')
    const b = zMeasure.parse(req.body)
    const { rows } = await db.query<Row>('select * from pieces where id = $1 and shipment_id = $2', [String(req.params.pid), s.id]); if (!rows[0]) throw new HttpError(404, 'Piece not found.')
    const before = await measureView(db, s)
    await db.query(`update pieces set weight_kg = $2, length_cm = $3, width_cm = $4, height_cm = $5, measured_at = now(), measured_by = $6, weight_source = $7 where id = $1`, [rows[0].id, b.weightKg ?? null, b.lengthCm ?? null, b.widthCm ?? null, b.heightCm ?? null, u.name, b.source])
    const v = await measureView(db, s)
    // First time every piece is measured: one event on the timeline, and tell the customer if it's well over what they declared.
    if (v.totals.measured === v.totals.pieces && before.totals.measured < before.totals.pieces) {
      const t = v.totals
      await db.query('update shipments set measured = $2 where id = $1', [s.id, JSON.stringify({ ...t, at: new Date().toISOString(), by: u.name })])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `Weighed and measured: ${t.pieces} piece${t.pieces === 1 ? '' : 's'}, ${t.actualKg} kg actual, ${s.mode === 'air' ? `${t.chargeableKg} kg chargeable` : `${t.cbm} m³`}.`])
      void import('./autopilot').then((m) => m.onMeasured(db, s, v)).catch((e) => console.error('[autopilot] reprice', e))
      void import('./rules').then((m) => m.fireRules(db, s.shipper_id, 'shipment.measured', { shipment: s, measure: { diffPct: v.diffPct, chargeableKg: v.totals.chargeableKg } })).catch(() => {})
      if (s.user_id && v.diffPct != null && v.diffPct >= 10) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref} weighed in ${v.diffPct}% above your estimate`, body: `${s.mode === 'air' ? `Chargeable weight ${t.chargeableKg} kg` : `${t.cbm} m³`} against ${v.declared.chargeableKg} kg declared. Your shipper may update the price — check the shipment.`, link: `/dashboard?tab=shipments&open=${s.id}`, dedupe: `measure:${s.id}` })
    }
    res.json({ ...v, canEdit: true })
  }))
}
