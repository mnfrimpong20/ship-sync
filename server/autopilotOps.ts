/**
 * Autopilot, operations side: containers (3), pickup planning (4), paperwork (6), destination charges (7).
 * Settings and the log live in autopilot.ts.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { normalisePhone, sendText, smsProvider } from './sms'
import { autopilotOf, logAuto } from './autopilot'
import { distanceKm } from '../src/lib/geo'
import { localCurrency, fmtMoney } from '../src/lib/address'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
async function once(db: Db, key: string) { const { rows } = await db.query<Row>('insert into autopilot_marks (key) values ($1) on conflict do nothing returning key', [key]); return !!rows[0] }
const errFn = (status: number, msg: string) => Object.assign(new Error(msg), { httpStatus: status })

/* ============================== 3 · containers ============================== */
export async function sweepContainers(db: Db) {
  const { rows: sh } = await db.query<Row>(`select distinct shipper_id from containers where status in ('booked','loading')`)
  const { planner } = await import('./growth'); const { loadIntoContainer } = await import('./containers')
  const today = new Date().toISOString().slice(0, 10)
  for (const { shipper_id: sid } of sh) {
    const cfg = await autopilotOf(db, sid); if (!cfg.containerFill) continue
    const p = await planner(db, sid)
    for (const c of p.containers) {
      // Auto-load the suggested shipments N days before the cut-off.
      if (cfg.autoLoadDays > 0 && c.suggest.length && c.daysToCutoff != null && c.daysToCutoff <= cfg.autoLoadDays && c.daysToCutoff >= 0 && (await once(db, `autoload:${c.id}:${today}`))) {
        const { rows } = await db.query<Row>('select * from containers where id = $1', [c.id])
        try {
          await loadIntoContainer(db, rows[0], c.suggest, 'Autopilot', errFn)
          const { rows: refs } = await db.query<Row>('select ref from shipments where id = any($1::text[])', [c.suggest])
          await logAuto(db, sid, 'container', `Loaded ${c.suggest.length} waiting shipment${c.suggest.length === 1 ? '' : 's'} into ${c.ref}`, { body: `${refs.map((r) => r.ref).join(', ')} — cut-off in ${c.daysToCutoff} day${c.daysToCutoff === 1 ? '' : 's'}.`, link: `/dashboard/containers/${c.id}` })
          await notifyShipperStaff(db, sid, { kind: 'container_update', title: `Autopilot loaded ${c.suggest.length} shipment${c.suggest.length === 1 ? '' : 's'} into ${c.ref}`, body: 'Check the container before the cut-off — you can unload anything that shouldn’t be there.', link: `/dashboard/containers/${c.id}`, dedupe: `autoload:${c.id}:${today}` }, ['owner', 'dispatcher'])
        } catch (e) { await logAuto(db, sid, 'container', `Couldn’t load ${c.ref} automatically`, { body: e instanceof Error ? e.message : String(e), link: `/dashboard/containers/${c.id}` }) }
      }
      // Full enough and no space booked with the line yet → prompt once.
      if (c.fillPct >= cfg.fillTargetPct) {
        const { rows: bk } = await db.query<Row>(`select 1 from containers c where c.id = $1 and (c.booking_ref <> '' or exists (select 1 from container_bookings b where b.container_id = c.id and b.status not in ('FAILED','REJECTED','DECLINED','CANCELLED')))`, [c.id])
        if (!bk[0] && (await once(db, `bookspace:${c.id}`))) {
          await notifyShipperStaff(db, sid, { kind: 'container_update', title: `${c.ref} is ${c.fillPct}% full — book space with the line`, body: c.cutoff ? `Cut-off ${c.cutoff}. Request the booking from the container page.` : 'Request the booking from the container page.', link: `/dashboard/containers/${c.id}`, dedupe: `bookspace:${c.id}` }, ['owner', 'dispatcher'])
          await logAuto(db, sid, 'container', `${c.ref} reached ${c.fillPct}% — asked the team to book space`, { link: `/dashboard/containers/${c.id}` })
        }
      }
    }
  }
}

/* ============================== 4 · pickup planning ============================== */
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const fmtClock = (m: number) => { const h = Math.floor(m / 60) % 24, mm = Math.round(m % 60); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return mm ? `${hh}:${String(mm).padStart(2, '0')}${ap}` : `${hh}${ap}` }
const localNow = (tz: string) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0'; return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24 } }
const addDay = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)

/** Split a day's pickups into runs, order the stops, assign drivers and give every customer an arrival window. */
export async function planPickups(db: Db, sid: string, date: string, opts: { notify: boolean; by: string }) {
  const cfg = await autopilotOf(db, sid)
  const { rows: runs } = await db.query<Row>(`select * from runs where shipper_id = $1 and kind = 'pickup' and run_date = $2 and status = 'planned' order by created_at`, [sid, date])
  if (!runs.length) return { runs: 0, stops: 0, texted: 0 }
  const { rows: stops } = await db.query<Row>(`select st.*, pr.window_start, pr.window_end, pr.city, sh.user_id from run_stops st left join pickup_requests pr on pr.stop_id = st.id left join shipments sh on sh.id = st.shipment_id where st.run_id = any($1::text[]) and st.status = 'pending'`, [runs.map((r) => r.id)])
  if (!stops.length) return { runs: runs.length, stops: 0, texted: 0 }
  const { rows: drivers } = await db.query<Row>(`select id, name, user_id from staff where shipper_id = $1 and role in ('pickup_driver','driver') and status = 'active' order by name`, [sid])
  const need = Math.max(1, Math.ceil(stops.length / cfg.maxStopsPerRun))
  // Sweep clustering: order stops by bearing around their centre, then cut into equal slices (no coords → by town).
  const geo = stops.filter((s) => s.lat != null && s.lon != null)
  const cx = geo.length ? geo.reduce((a, s) => a + Number(s.lon), 0) / geo.length : 0, cy = geo.length ? geo.reduce((a, s) => a + Number(s.lat), 0) / geo.length : 0
  const ordered = [...stops].sort((a, b) => { const ga = a.lat != null, gb = b.lat != null; if (ga && gb) return Math.atan2(Number(a.lat) - cy, Number(a.lon) - cx) - Math.atan2(Number(b.lat) - cy, Number(b.lon) - cx); if (ga !== gb) return ga ? -1 : 1; return String(a.city ?? a.address).localeCompare(String(b.city ?? b.address)) })
  const groups: Row[][] = Array.from({ length: need }, () => []); const per = Math.ceil(ordered.length / need)
  ordered.forEach((s, i) => groups[Math.min(need - 1, Math.floor(i / per))].push(s))
  // Enough runs for the groups (reuse the existing ones first).
  const target = [...runs]
  while (target.length < need) { const id = 'run_' + uid(); await db.query(`insert into runs (id,shipper_id,name,kind,run_date,start_label,start_lat,start_lon,notes) values ($1,$2,$3,'pickup',$4,$5,$6,$7,'Split by Autopilot.')`, [id, sid, `Pickups ${date} · ${target.length + 1}`, date, runs[0].start_label ?? '', runs[0].start_lat, runs[0].start_lon]); target.push({ ...runs[0], id, driver_id: null }) }
  const { optimiseOrder } = await import('./ops')
  let texted = 0, di = 0
  for (let g = 0; g < need; g++) {
    const run = target[g]; const list = groups[g]; if (!list.length) continue
    const start = run.start_lat != null && run.start_lon != null ? { lat: Number(run.start_lat), lon: Number(run.start_lon) } : null
    const order = optimiseOrder(start, list.map((s) => ({ lat: s.lat == null ? undefined : Number(s.lat), lon: s.lon == null ? undefined : Number(s.lon) })))
    let t = toMin(cfg.dayStart); let prev: { lat: number; lon: number } | null = start
    let driver = run.driver_id ? drivers.find((x) => x.id === run.driver_id) : undefined
    if (!driver && drivers.length) { driver = drivers[di++ % drivers.length]; await db.query('update runs set driver_id = $2 where id = $1', [run.id, driver.id]) }
    for (let k = 0; k < order.length; k++) {
      const s = list[order[k]]
      const here = s.lat != null ? { lat: Number(s.lat), lon: Number(s.lon) } : null
      t += prev && here ? Math.round((distanceKm([prev.lon, prev.lat], [here.lon, here.lat]) * 1.3 / 35) * 60) : 20 // 35 km/h average, roads ~1.3× straight line
      if (s.window_start && t < toMin(s.window_start)) t = toMin(s.window_start)
      const from = Math.max(toMin(cfg.dayStart), Math.floor((t - 30) / 30) * 30); let to = from + 120
      if (s.window_end) to = Math.min(to, Math.max(from + 60, toMin(s.window_end)))
      await db.query('update run_stops set run_id = $2, seq = $3, eta_from = $4, eta_to = $5 where id = $1', [s.id, run.id, k, fmtClock(from), fmtClock(to)])
      t += 15; if (here) prev = here // ~15 min at each door
      if (opts.notify && cfg.textWindows && (await once(db, `window:${s.id}:${date}`))) {
        const { rows: ss } = s.shipment_id ? await db.query<Row>('select s.ref, s.user_id, sh.name as shipper_name from shipments s join shippers sh on sh.id = s.shipper_id where s.id = $1', [s.shipment_id]) : { rows: [] as Row[] }
        const ref = ss[0]?.ref ?? ''; const msg = `${ss[0]?.shipper_name ?? 'Your shipper'} will collect ${ref ? `${ref} ` : ''}on ${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} between ${fmtClock(from)} and ${fmtClock(to)}. Please have everything packed and labelled.`
        if (ss[0]?.user_id) await notify(db, { userId: ss[0].user_id, kind: 'pickup', title: `Pickup window: ${fmtClock(from)}–${fmtClock(to)}`, body: msg, link: '/dashboard?tab=shipments', dedupe: `window:${s.id}:${date}` })
        if (smsProvider().id !== 'off' && s.phone) { const to2 = normalisePhone(s.phone, 'US'); if (to2) await sendText(to2, msg).then(() => { texted++ }).catch(() => {}) }
      }
    }
    if (opts.notify && driver?.user_id) await notify(db, { userId: driver.user_id, kind: 'pickup', title: `Your pickups for ${date}: ${list.length} stop${list.length === 1 ? '' : 's'}`, body: `First stop from ${cfg.dayStart}. The route is in order in your app.`, link: '/dashboard/runs', dedupe: `drv:${run.id}:${date}` })
  }
  await logAuto(db, sid, 'pickups', `Planned ${stops.length} pickup${stops.length === 1 ? '' : 's'} for ${date} on ${need} run${need === 1 ? '' : 's'}`, { body: `${drivers.length ? `Drivers: ${target.slice(0, need).map((r) => drivers.find((x) => x.id === r.driver_id)?.name ?? '—').join(', ')}.` : 'No drivers set up — assign them on the run.'}${opts.notify && cfg.textWindows ? ' Customers got their arrival window.' : ''}`, link: '/dashboard/pickups' })
  return { runs: need, stops: stops.length, texted }
}
export async function sweepPickups(db: Db) {
  const { rows } = await db.query<Row>(`select distinct shipper_id from runs where kind = 'pickup' and status = 'planned' and run_date between current_date and current_date + 2`)
  for (const { shipper_id: sid } of rows) {
    const cfg = await autopilotOf(db, sid); if (!cfg.pickupPlanning) continue
    const now = localNow(cfg.timezone); if (now.hour < cfg.planHour) continue
    const tomorrow = addDay(now.date, 1)
    if (!(await once(db, `plan:${sid}:${tomorrow}`))) continue
    await planPickups(db, sid, tomorrow, { notify: true, by: 'Autopilot' }).catch((e) => logAuto(db, sid, 'pickups', `Couldn’t plan pickups for ${tomorrow}`, { body: e instanceof Error ? e.message : String(e) }))
  }
}

/* ============================== 6 · paperwork ============================== */
export async function onContainerStage(db: Db, c: Row, stage: string) {
  if (!['gated_in', 'sailed'].includes(stage)) return
  const cfg = await autopilotOf(db, c.shipper_id); if (!cfg.paperwork) return
  if (!(await once(db, `docs:${c.id}`))) return
  const { generateDocument } = await import('./documents')
  const { rows: ships } = await db.query<Row>('select * from shipments where container_id = $1 and cancelled_at is null', [c.id])
  let bl = 0, sli = 0
  for (const s of ships) {
    try { await generateDocument(db, s, 'bill_of_lading', 'shipper', 'Autopilot'); bl++ } catch { /* not ready */ }
    if (J<Row | null>(s.export_compliance, null)?.applies) { try { await generateDocument(db, s, 'export_instructions', 'shipper', 'Autopilot'); sli++ } catch { /* skip */ } }
  }
  if (bl || sli) await logAuto(db, c.shipper_id, 'paperwork', `Drafted paperwork for ${c.ref}`, { body: `${bl} house bill${bl === 1 ? '' : 's'} of lading${sli ? `, ${sli} letter${sli === 1 ? '' : 's'} of instruction for the export filing` : ''}. Check and share them from each shipment’s documents.`, link: `/dashboard/containers/${c.id}` })
}
/** Air and loose shipments: letter of instruction as soon as the export check says it applies. */
export async function onBookedPaperwork(db: Db, s: Row) {
  const cfg = await autopilotOf(db, s.shipper_id); if (!cfg.paperwork) return
  if (!J<Row | null>(s.export_compliance, null)?.applies || !(await once(db, `sli:${s.id}`))) return
  try { const { generateDocument } = await import('./documents'); await generateDocument(db, s, 'export_instructions', 'shipper', 'Autopilot'); await logAuto(db, s.shipper_id, 'paperwork', `Drafted the letter of instruction for ${s.ref}`, { link: `/dashboard/shipments?q=${s.ref}&b=all`, ref: s.ref }) } catch { /* skip */ }
}

/* ============================== 7 · destination charges ============================== */
export async function onArrived(db: Db, s: Row) {
  const cfg = await autopilotOf(db, s.shipper_id); if (cfg.destinationCharges === 'off') return
  const duty = J<Row | null>(s.duty, null); if (!duty || duty.prepaid) return
  let amount = 0, currency = localCurrency(s.destination), basis = ''
  if (duty.confirmed?.amountLocal) { amount = Number(duty.confirmed.amountLocal); currency = String(duty.confirmed.currency || currency); basis = 'official customs assessment' }
  else if (duty.input?.valueUsd > 0) { const { estimateDuty } = await import('./duty'); const e = estimateDuty(duty.input); if (e.supported && e.totalLocal > 0) { amount = Math.ceil(e.totalLocal); currency = e.currency; basis = 'duty estimate' } }
  if (amount <= 0 || !(await once(db, `destcharge:${s.id}`))) return
  const { rows: ex } = await db.query<Row>(`select 1 from receiver_charges where shipment_id = $1 and reason ilike 'Duty%' and status <> 'cancelled'`, [s.id]); if (ex[0]) return
  const id = 'rc_' + uid(); const status = cfg.destinationCharges === 'send' ? 'due' : 'draft'
  await db.query('insert into receiver_charges (id,shipment_id,shipper_id,amount,currency,reason,status,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, s.id, s.shipper_id, amount, currency, `Duty and clearing (${basis})`, status, 'Autopilot'])
  if (status === 'due') { const { messageRecipient } = await import('./recipient'); await messageRecipient(db, s, 'charge', { force: true, note: 'Duty and clearing', amount: fmtMoney(amount, currency), by: 'Autopilot' }).catch(() => null) }
  await logAuto(db, s.shipper_id, 'destination', `${status === 'due' ? 'Sent' : 'Drafted'} the receiver’s duty charge for ${s.ref}: ${fmtMoney(amount, currency)}`, { body: `From the ${basis}.${status === 'draft' ? ' Check it and press Send on the shipment.' : ''}`, link: `/dashboard/shipments?q=${s.ref}&b=all`, ref: s.ref })
  if (status === 'draft') await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `${s.ref} landed — duty charge ready to send`, body: `${fmtMoney(amount, currency)} from the ${basis}. Check it and send it to the receiver.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `destcharge:${s.id}` }, ['owner', 'dispatcher', 'finance'])
}

export async function sweepOps(db: Db) {
  for (const [name, fn] of [['containers', sweepContainers], ['pickups', sweepPickups]] as const) await fn(db).catch((e) => console.error(`[autopilot] ${name}`, e))
}

export function mountAutopilotOps(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  r.post('/autopilot/plan-pickups', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.')
    const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notify: z.boolean().default(true) }).parse(req.body)
    const out = await planPickups(db, u.shipperId, b.date, { notify: b.notify, by: u.name })
    if (!out.stops) throw new HttpError(409, 'No pickups waiting on a run for that day.')
    res.json(out)
  }))
  r.post('/containers/:id/load-suggested', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    const { planner } = await import('./growth'); const p = await planner(db, u.shipperId); const c = p.containers.find((x) => x.id === String(req.params.id)); if (!c) throw new HttpError(404, 'Container not open.')
    if (!c.suggest.length) throw new HttpError(409, 'Nothing waiting fits this container.')
    const { rows } = await db.query<Row>('select * from containers where id = $1', [c.id]); const { loadIntoContainer } = await import('./containers')
    await loadIntoContainer(db, rows[0], c.suggest, u.name, (st, m) => new HttpError(st, m))
    res.json({ loaded: c.suggest.length })
  }))
  r.post('/shipments/:id/receiver-charges/:cid/send', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`select c.*, s.* , c.id as cid, c.status as cstatus from receiver_charges c join shipments s on s.id = c.shipment_id where c.id = $1 and c.shipment_id = $2`, [String(req.params.cid), String(req.params.id)]); const row = rows[0]
    if (!row || u.role !== 'shipper' || row.shipper_id !== u.shipperId) throw new HttpError(404, 'Charge not found.'); if (row.cstatus !== 'draft') throw new HttpError(409, 'Already sent.')
    const b = z.object({ amount: z.number().positive().max(1_000_000).optional() }).parse(req.body ?? {})
    await db.query(`update receiver_charges set status = 'due', amount = coalesce($2, amount) where id = $1`, [row.cid, b.amount ?? null])
    const { rows: s } = await db.query<Row>('select * from shipments where id = $1', [row.shipment_id]); const { messageRecipient } = await import('./recipient')
    await messageRecipient(db, s[0], 'charge', { force: true, note: row.reason, amount: fmtMoney(b.amount ?? Number(row.amount), row.currency), by: u.name }).catch(() => null)
    res.json({ ok: true })
  }))
  void D
}
