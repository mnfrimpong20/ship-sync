import type { Request, Response, NextFunction, Router } from 'express'
import type { Db } from './db'
import type { ApiUser } from './api'
import { countryByCode, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const DAY = 86400000
const num = (v: unknown) => Number(v ?? 0)
const J = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : [])
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const startOfWeek = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x }
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
/** Percentage change, null when the previous period is empty. */
const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? null : 0)

export interface AttentionItem { kind: 'lead' | 'shipment' | 'invoice' | 'run' | 'followup' | 'vehicle' | 'profile'; severity: 'critical' | 'warning' | 'info'; title: string; body: string; to: string; at?: string | null }

/** The shipper overview: KPIs with trend, 12-week series, lane mix, pipeline, attention list and recent activity. */
export function mountInsights(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  r.get('/shipper/overview', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    const sid = u.shipperId
    const now = new Date(); const t30 = new Date(now.getTime() - 30 * DAY); const t60 = new Date(now.getTime() - 60 * DAY); const t90 = new Date(now.getTime() - 90 * DAY)
    const weeks = 12; const w0 = startOfWeek(new Date(now.getTime() - (weeks - 1) * 7 * DAY))

    const { rows: shipper } = await db.query<Row>('select * from shippers where id = $1', [sid])
    const me = shipper[0]; if (!me) throw new HttpError(404, 'Shipper not found.')
    const dests = J(me.destinations); const modes = J(me.modes)

    // ---- leads: open requests on my lanes I haven't quoted
    const { rows: openReqs } = await db.query<Row>(`select r.*, (select count(*) from quotes q where q.request_id = r.id)::int as quote_count, exists(select 1 from quotes q where q.request_id = r.id and q.shipper_id = $1) as mine
      from requests r where r.status = 'open' order by r.created_at desc`, [sid])
    const leads = openReqs.filter((x) => !x.mine && dests.includes(x.destination) && (x.mode === 'either' || modes.includes(x.mode)))
    const staleLeads = leads.filter((x) => now.getTime() - new Date(x.created_at).getTime() > DAY)

    // ---- quotes
    const { rows: quotes } = await db.query<Row>(`select q.*, r.created_at as req_created, r.destination, r.origin, r.contact_name from quotes q join requests r on r.id = q.request_id where q.shipper_id = $1 and q.sent_at >= $2`, [sid, new Date(w0.getTime() - 90 * DAY)])
    const q30 = quotes.filter((q) => new Date(q.sent_at) >= t30); const qPrev = quotes.filter((q) => new Date(q.sent_at) >= t60 && new Date(q.sent_at) < t30)
    const decided = quotes.filter((q) => new Date(q.sent_at) >= t90 && (q.status === 'accepted' || q.status === 'declined'))
    const wonAll = quotes.filter((q) => new Date(q.sent_at) >= t90 && q.status === 'accepted')
    const winRate = pct(wonAll.length, decided.length)
    const respHours = quotes.filter((q) => new Date(q.sent_at) >= t90).map((q) => (new Date(q.sent_at).getTime() - new Date(q.req_created).getTime()) / 3600000).filter((h) => h >= 0)
    const avgResponse = respHours.length ? Math.round((respHours.reduce((a, b) => a + b, 0) / respHours.length) * 10) / 10 : null
    const avgQuote = q30.length ? Math.round(q30.reduce((a, q) => a + num(q.price), 0) / q30.length) : null

    // ---- shipments
    const { rows: ships } = await db.query<Row>(`select s.*, (select max(at) from shipment_events e where e.shipment_id = s.id) as last_event from shipments s where s.shipper_id = $1`, [sid])
    const active = ships.filter((s) => s.status !== 'delivered')
    const delivered30 = ships.filter((s) => s.status === 'delivered' && s.last_event && new Date(s.last_event) >= t30)
    const deliveredPrev = ships.filter((s) => s.status === 'delivered' && s.last_event && new Date(s.last_event) >= t60 && new Date(s.last_event) < t30)
    const late = active.filter((s) => s.eta && new Date(s.eta) < new Date(now.toISOString().slice(0, 10)))
    const stale = active.filter((s) => s.last_event && now.getTime() - new Date(s.last_event).getTime() > 7 * DAY && !late.includes(s))
    const byStatus = statusOrder.map((st) => ({ status: st, label: statusLabels[st as ShipmentStatus], n: ships.filter((s) => s.status === st).length }))
    const laneMap = new Map<string, number>()
    for (const s of ships) if (new Date(s.created_at) >= t90) laneMap.set(s.destination, (laneMap.get(s.destination) ?? 0) + 1)
    const lanes = [...laneMap].map(([code, n]) => ({ code, name: countryByCode(code)?.name ?? code, n })).sort((a, b) => b.n - a.n)
    const laneTotal = lanes.reduce((a, l) => a + l.n, 0)

    // ---- money
    const { rows: invoices } = await db.query<Row>(`select i.*, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)::int as paid from invoices i where i.shipper_id = $1`, [sid])
    const { rows: pays } = await db.query<Row>(`select p.*, i.number from payments p join invoices i on i.id = p.invoice_id where i.shipper_id = $1 and p.at >= $2`, [sid, new Date(t60.toISOString().slice(0, 10))])
    const inv30 = invoices.filter((i) => i.status !== 'void' && i.status !== 'draft' && new Date(i.issued_at) >= t30)
    const invPrev = invoices.filter((i) => i.status !== 'void' && i.status !== 'draft' && new Date(i.issued_at) >= t60 && new Date(i.issued_at) < t30)
    const invoiced30 = inv30.reduce((a, i) => a + num(i.total), 0); const invoicedPrev = invPrev.reduce((a, i) => a + num(i.total), 0)
    const collected30 = pays.filter((p) => new Date(p.at) >= t30).reduce((a, p) => a + num(p.amount), 0)
    const collectedPrev = pays.filter((p) => new Date(p.at) < t30).reduce((a, p) => a + num(p.amount), 0)
    const open = invoices.filter((i) => i.status === 'sent')
    const outstanding = open.reduce((a, i) => a + Math.max(0, num(i.total) - num(i.paid)), 0)
    const overdue = open.filter((i) => i.due_at && new Date(i.due_at) < now && num(i.total) - num(i.paid) > 0)

    // ---- ops
    const today = now.toISOString().slice(0, 10)
    const { rows: runs } = await db.query<Row>(`select r.*, s.name as driver_name, (select count(*) from run_stops st where st.run_id = r.id)::int as stops, (select count(*) from run_stops st where st.run_id = r.id and st.status = 'pending')::int as pending from runs r left join staff s on s.id = r.driver_id where r.shipper_id = $1 and r.status in ('planned','in_progress') order by r.run_date asc`, [sid])
    const runsToday = runs.filter((x) => dateOnly(x.run_date) <= today)
    const { rows: vehicles } = await db.query<Row>('select status from vehicles where shipper_id = $1', [sid])
    const { rows: team } = await db.query<Row>(`select role, status from staff where shipper_id = $1`, [sid])
    const { rows: followups } = await db.query<Row>(`select a.*, c.name as client_name from client_activities a join clients c on c.id = a.client_id where a.shipper_id = $1 and a.type = 'reminder' and a.done = false and a.due_at is not null and a.due_at <= $2 order by a.due_at asc`, [sid, new Date(now.getTime() + DAY)])
    const { rows: clients } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where created_at >= $2)::int as new30 from clients where shipper_id = $1 and status = 'active'`, [sid, t30])
    const { rows: activity } = await db.query<Row>(`select a.id, a.type, a.body, a.at, c.name as client_name, c.id as client_id from client_activities a join clients c on c.id = a.client_id where a.shipper_id = $1 order by a.at desc limit 8`, [sid])

    // ---- weekly series
    const series = Array.from({ length: weeks }, (_, i) => { const start = new Date(w0.getTime() + i * 7 * DAY); return { week: start.toISOString().slice(0, 10), quotes: 0, won: 0, booked: 0, invoiced: 0 } })
    const bucket = (dt: unknown) => { const t = new Date(dt as string).getTime(); const i = Math.floor((t - w0.getTime()) / (7 * DAY)); return i >= 0 && i < weeks ? i : -1 }
    for (const q of quotes) { const i = bucket(q.sent_at); if (i >= 0) { series[i].quotes++; if (q.status === 'accepted') series[i].won++ } }
    for (const s of ships) { const i = bucket(s.created_at); if (i >= 0) series[i].booked++ }
    for (const inv of invoices) if (inv.status !== 'void' && inv.status !== 'draft') { const i = bucket(inv.issued_at); if (i >= 0) series[i].invoiced += num(inv.total) }

    // ---- attention list (most urgent first)
    const attention: AttentionItem[] = []
    for (const l of staleLeads.slice(0, 3)) attention.push({ kind: 'lead', severity: 'warning', title: `Lead waiting ${Math.floor((now.getTime() - new Date(l.created_at).getTime()) / DAY)}d: ${l.origin} → ${countryByCode(l.destination)?.name ?? l.destination}`, body: `${l.contact_name} · ${l.quote_count} competing quote${l.quote_count === 1 ? '' : 's'}. Customers see your response time.`, to: '/dashboard/shipper?view=leads', at: iso(l.created_at) })
    for (const s of late.slice(0, 3)) attention.push({ kind: 'shipment', severity: 'critical', title: `${s.ref} is past its ETA (${dateOnly(s.eta)})`, body: `${statusLabels[s.status as ShipmentStatus]} · ${s.customer}. Update the status or the ETA so the customer isn’t guessing.`, to: '/dashboard/shipments' })
    for (const i of overdue.slice(0, 3)) attention.push({ kind: 'invoice', severity: 'critical', title: `${i.number} overdue — $${(num(i.total) - num(i.paid)).toLocaleString()} outstanding`, body: `Due ${dateOnly(i.due_at)}. Send a reminder or record the payment.`, to: `/dashboard/invoices/${i.id}` })
    for (const s of stale.slice(0, 2)) attention.push({ kind: 'shipment', severity: 'warning', title: `${s.ref} hasn’t moved in ${Math.floor((now.getTime() - new Date(s.last_event).getTime()) / DAY)} days`, body: `Still “${statusLabels[s.status as ShipmentStatus]}”. Add an update so tracking stays honest.`, to: '/dashboard/shipments' })
    for (const f of followups.slice(0, 3)) attention.push({ kind: 'followup', severity: new Date(f.due_at) < now ? 'warning' : 'info', title: `Follow up with ${f.client_name}`, body: f.body, to: `/dashboard/clients/${f.client_id}?tab=activity`, at: iso(f.due_at) })
    for (const x of runsToday.slice(0, 2)) attention.push({ kind: 'run', severity: 'info', title: `${x.name} · ${x.pending} of ${x.stops} stops to go`, body: `${x.driver_name ?? 'No driver assigned'} · ${x.status === 'in_progress' ? 'On the road now' : 'Planned for today'}`, to: `/dashboard/routes/${x.id}` })
    if (vehicles.some((v) => v.status === 'maintenance')) attention.push({ kind: 'vehicle', severity: 'info', title: `${vehicles.filter((v) => v.status === 'maintenance').length} vehicle${vehicles.filter((v) => v.status === 'maintenance').length === 1 ? '' : 's'} in maintenance`, body: 'Not available for runs until marked back in service.', to: '/dashboard/fleet' })
    if (!me.verified) attention.push({ kind: 'profile', severity: 'warning', title: 'Your company isn’t verified yet', body: 'Verified shippers rank higher and win more quotes. Complete your profile to start the check.', to: '/dashboard/shipper?view=profile' })
    const sevRank = { critical: 0, warning: 1, info: 2 }
    attention.sort((a, b) => sevRank[a.severity] - sevRank[b.severity])

    res.json({
      period: { from: t30.toISOString(), to: now.toISOString() },
      kpis: {
        leads: { value: leads.length, hint: `${staleLeads.length} waiting > 24h` },
        quotes: { value: q30.length, prev: qPrev.length, delta: delta(q30.length, qPrev.length), hint: avgQuote != null ? `avg $${avgQuote.toLocaleString()}` : 'No quotes yet' },
        winRate: { value: winRate, hint: `${wonAll.length} won of ${decided.length} decided · 90 days` },
        response: { value: avgResponse, hint: 'avg hours to first quote · 90 days' },
        active: { value: active.length, hint: `${late.length} late · ${stale.length} stale` },
        delivered: { value: delivered30.length, prev: deliveredPrev.length, delta: delta(delivered30.length, deliveredPrev.length), hint: `${me.on_time}% on-time record` },
        invoiced: { value: invoiced30, prev: invoicedPrev, delta: delta(invoiced30, invoicedPrev), hint: `${inv30.length} invoice${inv30.length === 1 ? '' : 's'}` },
        collected: { value: collected30, prev: collectedPrev, delta: delta(collected30, collectedPrev), hint: outstanding ? `$${outstanding.toLocaleString()} outstanding` : 'Nothing outstanding' },
        outstanding: { value: outstanding, hint: overdue.length ? `${overdue.length} overdue` : `${open.length} open invoice${open.length === 1 ? '' : 's'}` },
        clients: { value: clients[0]?.n ?? 0, hint: `${clients[0]?.new30 ?? 0} new this month` },
      },
      series, lanes: lanes.map((l) => ({ ...l, share: laneTotal ? Math.round((l.n / laneTotal) * 100) : 0 })), byStatus,
      pipeline: { leads: leads.length, quoted: q30.length, won: q30.filter((q) => q.status === 'accepted').length },
      ops: { runsToday: runsToday.map((x) => ({ id: x.id, name: x.name, kind: x.kind, status: x.status, driver: x.driver_name ?? null, stops: x.stops, pending: x.pending })), vehicles: { total: vehicles.length, available: vehicles.filter((v) => v.status === 'available').length, onRun: vehicles.filter((v) => v.status === 'on_run').length, maintenance: vehicles.filter((v) => v.status === 'maintenance').length }, team: { active: team.filter((t) => t.status === 'active').length, drivers: team.filter((t) => t.role === 'driver' && t.status === 'active').length, invited: team.filter((t) => t.status === 'invited').length }, followupsDue: followups.length },
      attention: attention.slice(0, 8),
      leads: leads.slice(0, 4).map((l) => ({ id: l.id, ref: l.ref, origin: l.origin, destination: l.destination, mode: l.mode, cargo: l.cargo, contact: l.contact_name, createdAt: iso(l.created_at), competing: l.quote_count })),
      activity: activity.map((a) => ({ id: a.id, type: a.type, body: a.body, at: iso(a.at), clientName: a.client_name, clientId: a.client_id })),
    })
  }))
}
