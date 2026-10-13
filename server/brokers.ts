/**
 * Customs-broker marketplace — licensed clearing agents at Tema, Takoradi, Lagos (Apapa / Tin Can)
 * and Onne listed with their fees. A customer or the shipper books one on a shipment; the broker
 * works the job from a no-login portal (`/#/broker/<token>`): accept, documents received, assessed
 * (which records the official duty on the shipment), duty paid, released, delivered to the yard.
 *
 * Brokers are platform listings (admin-verified); they do not need a Ship Sync account.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { emailProvider, emailTemplate, notify, notifyShipperStaff, sendEmail } from './notify'
import { cargoLabel, countryByCode, type CargoType } from '../src/lib/data'

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
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')

export const JOB_STEPS = ['requested', 'accepted', 'documents', 'assessed', 'duty_paid', 'released', 'done'] as const
export type JobStep = (typeof JOB_STEPS)[number]
export const jobStepLabels: Record<JobStep | 'cancelled' | 'declined', string> = { requested: 'Requested', accepted: 'Accepted by broker', documents: 'Documents lodged', assessed: 'Assessed by customs', duty_paid: 'Duty paid', released: 'Released from port', done: 'Cleared & handed over', cancelled: 'Cancelled', declined: 'Declined by broker' }
const CARGO = ['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial'] as const

export const brokerOut = (b: Row, full = false) => ({
  id: b.id, name: b.name, company: b.company, country: b.country, countryName: countryByCode(b.country)?.name ?? b.country, ports: J(b.ports) as string[], licenceNo: b.licence_no, licenceAuthority: b.licence_authority,
  phone: full ? b.phone : '', whatsapp: full ? b.whatsapp : '', email: full ? b.email : '', about: b.about, specialties: J(b.specialties) as string[], fees: J(b.fees) as Record<CargoType, number>, dutyAdvance: !!b.duty_advance,
  rating: Number(b.rating), reviews: Number(b.reviews), verified: !!b.verified, responseHours: Number(b.response_hours), initials: b.initials, hue: b.hue, active: !!b.active, jobs: Number(b.n_jobs ?? 0),
})
export const jobOut = (j: Row) => ({
  id: j.id, shipmentId: j.shipment_id, shipmentRef: j.ref ?? undefined, customer: j.customer ?? undefined, destination: j.destination ?? undefined, cargo: j.cargo ?? undefined, shipperId: j.shipper_id, shipperName: j.shipper_name ?? undefined,
  broker: { id: j.broker_id, name: j.b_name, company: j.b_company, phone: j.b_phone, whatsapp: j.b_whatsapp, email: j.b_email, initials: j.b_initials, hue: j.b_hue, verified: !!j.b_verified },
  status: j.status as JobStep | 'cancelled' | 'declined', feeUsd: Number(j.fee_usd), dutyLocal: j.duty_local == null ? null : Number(j.duty_local), dutyCurrency: j.duty_currency ?? null, reference: j.reference ?? '', notes: j.notes ?? '', bookedBy: j.booked_by, bookedByRole: j.booked_by_role,
  timeline: (J(j.timeline) ?? []) as { at: string; status: string; note: string; by: string }[], createdAt: ISO(j.created_at), updatedAt: ISO(j.updated_at),
})

const BROKER_SELECT = `select b.*, (select count(*) from broker_jobs j where j.broker_id = b.id and j.status not in ('cancelled','declined'))::int as n_jobs from brokers b`
const JOB_SELECT = `select j.*, s.ref, s.customer, s.destination, s.cargo, s.user_id as s_user_id, s.status as s_status, sh.name as shipper_name, b.name as b_name, b.company as b_company, b.phone as b_phone, b.whatsapp as b_whatsapp, b.email as b_email, b.initials as b_initials, b.hue as b_hue, b.verified as b_verified
  from broker_jobs j join shipments s on s.id = j.shipment_id join shippers sh on sh.id = j.shipper_id join brokers b on b.id = j.broker_id`

const zBroker = z.object({
  name: z.string().trim().min(2).max(80), company: z.string().trim().max(80).default(''), country: z.enum(['GH', 'NG', 'LR', 'TG', 'CI', 'SL', 'SN']), ports: z.array(z.string().trim().min(2).max(40)).min(1).max(6),
  licenceNo: z.string().trim().max(40).default(''), licenceAuthority: z.string().trim().max(60).default(''), phone: z.string().trim().max(30).default(''), whatsapp: z.string().trim().max(30).default(''), email: z.string().trim().email().or(z.literal('')).default(''),
  about: z.string().trim().max(600).default(''), specialties: z.array(z.string().trim().min(2).max(40)).max(8).default([]), fees: z.object(Object.fromEntries(CARGO.map((c) => [c, z.number().min(0).max(100_000).optional()])) as Record<(typeof CARGO)[number], z.ZodOptional<z.ZodNumber>>),
  dutyAdvance: z.boolean().default(false), responseHours: z.number().int().min(1).max(168).default(24), verified: z.boolean().default(false), active: z.boolean().default(true),
})
const zBook = z.object({ brokerId: z.string().min(1), note: z.string().trim().max(400).default('') })
const zStep = z.object({ status: z.enum([...JOB_STEPS, 'declined', 'cancelled']), note: z.string().trim().max(400).default(''), dutyLocal: z.number().min(0).max(1_000_000_000).optional(), dutyCurrency: z.string().trim().max(3).optional(), reference: z.string().trim().max(60).optional(), feeUsd: z.number().min(0).max(100_000).optional() })

export function mountBrokers(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const jobFor = async (db: Db, sid: string) => (await db.query<Row>(`${JOB_SELECT} where j.shipment_id = $1 and j.status not in ('cancelled','declined') order by j.created_at desc limit 1`, [sid])).rows[0] ?? null
  const jobById = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${JOB_SELECT} where j.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Clearance job not found.'); return rows[0] }
  const jobByToken = async (db: Db, token: string) => { const { rows } = await db.query<Row>(`${JOB_SELECT} where j.token = $1`, [token]); if (!rows[0]) throw new HttpError(404, 'This link is not valid.'); return rows[0] }

  /** Apply a step: timeline, duty confirmation on 'assessed', notifications to both sides. `by` is who did it. */
  const advance = async (db: Db, job: Row, b: z.infer<typeof zStep>, by: string, byRole: 'broker' | 'office' | 'customer' | 'admin') => {
    const order = [...JOB_STEPS] as string[]
    if (['cancelled', 'declined', 'done'].includes(job.status)) throw new HttpError(409, `This job is already ${jobStepLabels[job.status as JobStep]?.toLowerCase() ?? job.status}.`)
    if (b.status !== 'cancelled' && b.status !== 'declined' && order.indexOf(b.status) < order.indexOf(job.status)) throw new HttpError(409, 'Jobs only move forward.')
    if (b.status === 'declined' && byRole !== 'broker') throw new HttpError(403, 'Only the broker can decline.')
    if (b.status === 'assessed' && (b.dutyLocal == null || !(b.dutyLocal >= 0))) throw new HttpError(400, 'Enter the assessed duty amount.')
    const timeline = (J(job.timeline) ?? []) as Row[]; timeline.push({ at: new Date().toISOString(), status: b.status, note: b.note, by })
    await db.query(`update broker_jobs set status = $2, notes = case when $3 = '' then notes else $3 end, duty_local = coalesce($4, duty_local), duty_currency = coalesce($5, duty_currency), reference = coalesce($6, reference), fee_usd = coalesce($7, fee_usd), timeline = $8, updated_at = now() where id = $1`,
      [job.id, b.status, b.note, b.dutyLocal ?? null, b.dutyCurrency?.toUpperCase() ?? null, b.reference ?? null, b.feeUsd ?? null, JSON.stringify(timeline.slice(-40))])
    const label = jobStepLabels[b.status]
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [job.shipment_id, job.s_status, job.destination, `Customs clearance (${job.b_name}): ${label}${b.status === 'assessed' && b.dutyLocal != null ? ` — ${(b.dutyCurrency ?? job.duty_currency ?? 'GHS').toUpperCase()} ${b.dutyLocal.toLocaleString()}${b.reference ? ` (${b.reference})` : ''}` : ''}${b.note ? ` — ${b.note}` : ''}`])
    if (b.status === 'assessed' && b.dutyLocal != null) {
      // Official assessment → the shipment's duty card shows it instead of the estimate.
      const { rows: ss } = await db.query<Row>('select duty from shipments where id = $1', [job.shipment_id]); const saved = (J(ss[0]?.duty) as Row | null) ?? {}
      const confirmed = { amountLocal: b.dutyLocal, currency: (b.dutyCurrency ?? job.duty_currency ?? (job.destination === 'NG' ? 'NGN' : 'GHS')).toUpperCase(), reference: b.reference ?? '', note: b.note || `Assessed via ${job.b_name}`, by: by, at: new Date().toISOString() }
      await db.query('update shipments set duty = $2 where id = $1', [job.shipment_id, JSON.stringify({ ...saved, confirmed })])
    }
    if (byRole !== 'customer' && job.s_user_id) await notify(db, { userId: job.s_user_id, kind: 'customs', title: `${label} — ${job.ref}`, body: b.status === 'assessed' ? `Customs assessed ${(b.dutyCurrency ?? job.duty_currency ?? 'GHS').toUpperCase()} ${(b.dutyLocal ?? 0).toLocaleString()} on your shipment${b.reference ? ` (${b.reference})` : ''}. ${job.b_name} will arrange payment and release.` : b.status === 'declined' ? `${job.b_name} can't take this job${b.note ? `: ${b.note}` : ''}. Pick another broker from the shipment page.` : `${job.b_name}: ${b.note || label.toLowerCase()}.`, link: `/dashboard?tab=shipments&s=${job.shipment_id}`, dedupe: `cust:${job.id}:${b.status}`, emailSubject: `${label} — ${job.ref}` })
    if (byRole !== 'office') await notifyShipperStaff(db, job.shipper_id, { kind: 'customs', title: `${job.ref}: ${label}`, body: `${job.b_name} · ${job.customer}${b.note ? ` — ${b.note}` : ''}${b.status === 'assessed' ? ` · duty ${(b.dutyCurrency ?? 'GHS').toUpperCase()} ${(b.dutyLocal ?? 0).toLocaleString()}` : ''}`, link: `/dashboard/shipments?q=${job.ref}&b=all`, dedupe: `cust:${job.id}:${b.status}:o` }, ['owner', 'dispatcher', 'agent'])
  }

  /* ---- public directory ---- */
  r.get('/brokers', wrap(async (req, res) => {
    const db = await getDb()
    const dest = typeof req.query.destination === 'string' && req.query.destination.length === 2 ? req.query.destination.toUpperCase() : null
    const params: unknown[] = []; const where = ['b.active']
    if (dest) { params.push(dest); where.push(`b.country = $${params.length}`) }
    const { rows } = await db.query<Row>(`${BROKER_SELECT} where ${where.join(' and ')} order by b.verified desc, b.rating desc, b.reviews desc`, params)
    res.set('Cache-Control', 'no-store'); res.json({ brokers: rows.map((b) => brokerOut(b, false)) })
  }))

  /* ---- per shipment ---- */
  r.get('/shipments/:id/customs', wrap(async (req, res) => {
    const db = await getDb(); const { s, office, owner } = await access(db, req, String(req.params.id))
    const job = await jobFor(db, s.id)
    const { rows } = await db.query<Row>(`${BROKER_SELECT} where b.active and b.country = $1 order by b.verified desc, b.rating desc`, [s.destination])
    const fee = (b: Row) => Number((J(b.fees) as Row)?.[s.cargo] ?? 0)
    res.set('Cache-Control', 'no-store')
    res.json({ job: job ? jobOut(job) : null, brokers: rows.map((b) => ({ ...brokerOut(b, false), feeUsd: fee(b) })), supported: ['GH', 'NG'].includes(s.destination), canBook: (office || owner) && !job, canManage: office, steps: JOB_STEPS.map((id) => ({ id, label: jobStepLabels[id] })) })
  }))
  r.post('/shipments/:id/customs', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req, String(req.params.id))
    if (!office && !owner) throw new HttpError(403, 'Not allowed.')
    if (await jobFor(db, s.id)) throw new HttpError(409, 'A broker is already on this shipment.')
    const b = zBook.parse(req.body)
    const { rows: bs } = await db.query<Row>(`${BROKER_SELECT} where b.id = $1 and b.active`, [b.brokerId]); const broker = bs[0]; if (!broker) throw new HttpError(404, 'Broker not found.')
    if (broker.country !== s.destination) throw new HttpError(400, `${broker.name} clears at ${countryByCode(broker.country)?.name ?? broker.country}, not ${countryByCode(s.destination)?.name ?? s.destination}.`)
    const fee = Number((J(broker.fees) as Row)?.[s.cargo] ?? 0)
    const id = 'job_' + uid(); const token = randomBytes(12).toString('base64url')
    await db.query(`insert into broker_jobs (id,shipment_id,broker_id,shipper_id,user_id,booked_by,booked_by_role,status,fee_usd,duty_currency,notes,token,timeline) values ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11,$12)`,
      [id, s.id, broker.id, s.shipper_id, u.id, u.name, office ? 'office' : 'customer', fee, s.destination === 'NG' ? 'NGN' : 'GHS', b.note, token, JSON.stringify([{ at: new Date().toISOString(), status: 'requested', note: b.note, by: u.name }])])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.destination, `Customs broker booked: ${broker.name}${broker.company ? ` (${broker.company})` : ''} — ${cargoLabel(s.cargo as CargoType).toLowerCase()} clearance $${fee}.`])
    // Tell the broker (email with the portal link) and the other side.
    const link = `${appUrl()}/#/broker/${token}`
    if (broker.email && emailProvider().id !== 'off') { try { await sendEmail(broker.email, `New clearance job — ${s.ref} at ${s.destination === 'NG' ? 'Lagos' : 'Tema'}`, emailTemplate({ name: broker.name, title: `Clearance request: ${s.ref}`, body: `${u.company ?? u.name} booked you to clear ${cargoLabel(s.cargo as CargoType).toLowerCase()} for ${s.customer} (${s.origin} → ${s.destination}). Fee on file: $${fee}. ${b.note ? `Note: ${b.note}` : ''} Open the job to accept it and keep everyone updated.`, link, cta: 'Open the job' })) } catch (e) { console.error('[brokers] email', e) } }
    if (!owner && s.user_id) await notify(db, { userId: s.user_id, kind: 'customs', title: `Customs broker booked for ${s.ref}`, body: `${broker.name}${broker.company ? ` (${broker.company})` : ''} will clear your goods at ${s.destination === 'NG' ? 'Lagos' : 'Tema'}. Clearance fee $${fee}.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `cust:${id}:booked` })
    if (!office) await notifyShipperStaff(db, s.shipper_id, { kind: 'customs', title: `${s.customer} booked ${broker.name} to clear ${s.ref}`, body: `Clearance fee $${fee}. The broker's job link is on the shipment.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `cust:${id}:booked:o` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json({ job: jobOut(await jobById(db, id)), portalLink: link })
  }))
  r.get('/customs/jobs/:id/link', wrap(async (req, res) => {
    const db = await getDb(); const job = await jobById(db, String(req.params.id)); const { office, u } = await access(db, req, job.shipment_id); if (!office && !u.admin) throw new HttpError(403, 'Office only.')
    res.json({ portalLink: `${appUrl()}/#/broker/${job.token}` })
  }))
  r.post('/customs/jobs/:id/step', wrap(async (req, res) => {
    const db = await getDb(); const job = await jobById(db, String(req.params.id)); const { u, office, owner } = await access(db, req, job.shipment_id)
    const b = zStep.parse(req.body)
    if (owner && !office && !u.admin && b.status !== 'cancelled') throw new HttpError(403, 'Only the broker or the shipper updates the job; you can cancel it.')
    await advance(db, job, b, u.name, u.admin && !office ? 'admin' : office ? 'office' : 'customer')
    res.json({ job: jobOut(await jobById(db, job.id)) })
  }))

  /* ---- broker portal (no login) ---- */
  r.get('/broker/:token', wrap(async (req, res) => {
    const db = await getDb(); const job = await jobByToken(db, String(req.params.token))
    const { rows: docs } = await db.query<Row>(`select id, kind, title, share_token from documents where shipment_id = $1 and visibility = 'shared' order by created_at desc`, [job.shipment_id])
    const { rows: cons } = await db.query<Row>(`select c.name, c.phone, c.address, c.city from client_consignees c join shipments s on s.consignee_id = c.id where s.id = $1`, [job.shipment_id])
    const { rows: pieces } = await db.query<Row>('select count(*)::int as n from pieces where shipment_id = $1', [job.shipment_id])
    const { rows: veh } = await db.query<Row>('select vin, year, make, model, engine_l, body, declared_value_usd from shipment_vehicles where shipment_id = $1', [job.shipment_id])
    const { rows: cont } = await db.query<Row>(`select c.number, c.vessel_name, c.eta from containers c join shipments s on s.container_id = c.id where s.id = $1`, [job.shipment_id])
    res.set('Cache-Control', 'no-store')
    res.json({ job: jobOut(job), shipment: { ref: job.ref, customer: job.customer, destination: job.destination, cargo: job.cargo, cargoLabel: cargoLabel(job.cargo as CargoType), status: job.s_status, pieces: pieces[0]?.n ?? 0, consignee: cons[0] ?? null, vehicle: veh[0] ? { vin: veh[0].vin, label: [veh[0].year, veh[0].make, veh[0].model].filter(Boolean).join(' '), engineL: veh[0].engine_l, body: veh[0].body, valueUsd: veh[0].declared_value_usd } : null, container: cont[0] ? { number: cont[0].number, vessel: cont[0].vessel_name, eta: ISO(cont[0].eta)?.slice(0, 10) } : null }, documents: docs.map((x) => ({ id: x.id, kind: x.kind, title: x.title, link: x.share_token ? `/#/doc/${x.share_token}` : null })), steps: JOB_STEPS.map((id) => ({ id, label: jobStepLabels[id] })) })
  }))
  r.post('/broker/:token/step', wrap(async (req, res) => {
    const db = await getDb(); const job = await jobByToken(db, String(req.params.token))
    const b = zStep.parse(req.body); if (b.status === 'cancelled') throw new HttpError(403, 'Brokers decline rather than cancel.')
    await advance(db, job, b, job.b_name, 'broker')
    res.json({ job: jobOut(await jobById(db, job.id)) })
  }))

  /* ---- office: my jobs ---- */
  r.get('/customs/jobs', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>(`${JOB_SELECT} where j.shipper_id = $1 order by (j.status in ('cancelled','declined','done')) asc, j.updated_at desc limit 200`, [u.shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ jobs: rows.map(jobOut) })
  }))

  /* ---- admin: listings ---- */
  r.get('/admin/brokers', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); const { rows } = await db.query<Row>(`${BROKER_SELECT} order by b.country, b.verified desc, b.name`); res.json({ brokers: rows.map((b) => brokerOut(b, true)) }) }))
  r.post('/admin/brokers', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zBroker.parse(req.body)
    const id = 'brk_' + uid(); const initials = b.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); const hue = ['#E3B54A', '#2DD4BF', '#38BDF8', '#F472B6', '#A78BFA', '#FB923C'][Math.floor(Math.random() * 6)]
    await db.query(`insert into brokers (id,name,company,country,ports,licence_no,licence_authority,phone,whatsapp,email,about,specialties,fees,duty_advance,response_hours,verified,active,initials,hue) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, b.name, b.company, b.country, JSON.stringify(b.ports), b.licenceNo, b.licenceAuthority, b.phone, b.whatsapp, b.email, b.about, JSON.stringify(b.specialties), JSON.stringify(b.fees), b.dutyAdvance, b.responseHours, b.verified, b.active, initials, hue])
    res.status(201).json({ broker: brokerOut((await db.query<Row>(`${BROKER_SELECT} where b.id = $1`, [id])).rows[0], true) })
  }))
  r.patch('/admin/brokers/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>('select * from brokers where id = $1', [req.params.id]); const cur = rows[0]; if (!cur) throw new HttpError(404, 'Broker not found.')
    const b = zBroker.partial().parse(req.body)
    await db.query(`update brokers set name=$2, company=$3, country=$4, ports=$5, licence_no=$6, licence_authority=$7, phone=$8, whatsapp=$9, email=$10, about=$11, specialties=$12, fees=$13, duty_advance=$14, response_hours=$15, verified=$16, active=$17 where id=$1`,
      [cur.id, b.name ?? cur.name, b.company ?? cur.company, b.country ?? cur.country, JSON.stringify(b.ports ?? J(cur.ports)), b.licenceNo ?? cur.licence_no, b.licenceAuthority ?? cur.licence_authority, b.phone ?? cur.phone, b.whatsapp ?? cur.whatsapp, b.email ?? cur.email, b.about ?? cur.about, JSON.stringify(b.specialties ?? J(cur.specialties)), JSON.stringify(b.fees ? { ...J(cur.fees), ...b.fees } : J(cur.fees)), b.dutyAdvance ?? cur.duty_advance, b.responseHours ?? cur.response_hours, b.verified ?? cur.verified, b.active ?? cur.active])
    res.json({ broker: brokerOut((await db.query<Row>(`${BROKER_SELECT} where b.id = $1`, [cur.id])).rows[0], true) })
  }))
}

/** Six fictional brokers so the marketplace has something to show. Idempotent. */
export async function seedBrokersDemo(db: Db) {
  const { rows } = await db.query('select 1 from brokers limit 1'); if (rows.length) return
  const list: [string, string, string, string, string[], string, string, string, string, string, string, string[], Row, boolean, number, number, number, boolean, string, string][] = [
    ['brk_tema_1', 'Kwabena Osei', 'Osei Clearing Services', 'GH', ['Tema', 'Takoradi'], 'CEPS-CA-1182', 'GRA Customs Division', '+233 24 400 1182', '+233 24 400 1182', 'kwabena@oseiclearing.demo', 'Fifteen years at Tema. Personal effects, barrels and vehicles; we pre-lodge the ICUMS declaration so your goods clear within 48 hours of discharge.', ['Personal effects', 'Vehicles', 'Barrels', 'Returning residents'], { barrels: 60, boxes: 60, pallets: 110, vehicle: 220, container20: 380, container40: 520, commercial: 300 }, true, 4.9, 212, 4, true, 'KO', '#E3B54A'],
    ['brk_tema_2', 'Abena Sarpong', 'Sarpong & Co. Freight Agents', 'GH', ['Tema'], 'CEPS-CA-2290', 'GRA Customs Division', '+233 20 777 2290', '+233 20 777 2290', 'abena@sarpongagents.demo', 'Commercial cargo specialists — FDA, GSA and Ministry permits handled alongside the declaration.', ['Commercial cargo', 'Pharma & food permits', 'Containers'], { barrels: 70, boxes: 70, pallets: 100, vehicle: 260, container20: 350, container40: 480, commercial: 260 }, false, 4.7, 96, 6, true, 'AS', '#2DD4BF'],
    ['brk_tema_3', 'Yaw Boadu', '', 'GH', ['Tema'], 'CEPS-CA-3301', 'GRA Customs Division', '+233 27 555 3301', '', 'yaw@boaduclearing.demo', 'Independent agent, good rates on barrels and boxes for families.', ['Barrels', 'Personal effects'], { barrels: 45, boxes: 45, pallets: 90, vehicle: 200, container20: 320, container40: 450, commercial: 280 }, false, 4.5, 41, 12, false, 'YB', '#38BDF8'],
    ['brk_tak_1', 'Efua Mensah', 'Western Gate Logistics', 'GH', ['Takoradi'], 'CEPS-CA-4410', 'GRA Customs Division', '+233 24 222 4410', '+233 24 222 4410', 'efua@westerngate.demo', 'Takoradi port — vehicles and project cargo for the Western Region.', ['Vehicles', 'Project cargo'], { barrels: 65, boxes: 65, pallets: 120, vehicle: 210, container20: 400, container40: 540, commercial: 320 }, true, 4.6, 58, 8, true, 'EM', '#F472B6'],
    ['brk_lag_1', 'Chinedu Okafor', 'Okafor Customs Brokerage', 'NG', ['Lagos (Apapa)', 'Lagos (Tin Can)'], 'NCS-LIC-0871', 'Nigeria Customs Service', '+234 803 555 0871', '+234 803 555 0871', 'chinedu@okaforbrokerage.demo', 'Licensed at Apapa and Tin Can Island. Vehicles (VIN valuation handled), containers and groupage.', ['Vehicles', 'Containers', 'Groupage'], { barrels: 80, boxes: 80, pallets: 140, vehicle: 350, container20: 520, container40: 700, commercial: 400 }, true, 4.8, 174, 5, true, 'CO', '#A78BFA'],
    ['brk_lag_2', 'Ngozi Adeyemi', 'Adeyemi Freight Agents', 'NG', ['Lagos (Apapa)', 'Onne'], 'NCS-LIC-1130', 'Nigeria Customs Service', '+234 802 555 1130', '', 'ngozi@adeyemiagents.demo', 'Personal effects and small commercial lots; SONCAP and NAFDAC paperwork.', ['Personal effects', 'SONCAP / NAFDAC'], { barrels: 70, boxes: 70, pallets: 130, vehicle: 380, container20: 500, container40: 680, commercial: 360 }, false, 4.4, 63, 10, true, 'NA', '#FB923C'],
  ]
  for (const b of list) await db.query(`insert into brokers (id,name,company,country,ports,licence_no,licence_authority,phone,whatsapp,email,about,specialties,fees,duty_advance,rating,reviews,response_hours,verified,initials,hue,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true) on conflict (id) do nothing`, [b[0], b[1], b[2], b[3], JSON.stringify(b[4]), b[5], b[6], b[7], b[8], b[9], b[10], JSON.stringify(b[11]), JSON.stringify(b[12]), b[13], b[14], b[15], b[16], b[17], b[18], b[19]])
}
