/**
 * Growth tools for shippers.
 *   Monday report     sweep (Mondays from 12:00 UTC) → owners get last week's numbers + top insights by email,
 *                     optional WhatsApp. GET|PUT /shipper/weekly-report, POST /shipper/weekly-report/preview
 *   Campaigns         GET /campaigns, GET /campaigns/audience?kind=dormant|all|recent, POST /campaigns (send),
 *                     GET /campaigns/:id — recipients, delivery and who booked within 30 days
 *   Load planner      GET /containers/planner — waiting ocean shipments (est. CBM/kg), open containers with
 *                     fill and cutoff warnings, and a greedy fill suggestion; daily half-empty alert
 *   Quote templates   GET|POST /quote-templates, DELETE /quote-templates/:id
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'
import { emailTemplate, notifyShipperStaff, sendEmail } from './notify'
import { sendText } from './sms'
import { featureOn, requirePerk } from './features'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const DAY = 86400000
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const num = (v: unknown) => Number(v ?? 0) || 0
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

/* ============================== Monday report ============================== */
const weekKey = (d = new Date()) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
export interface WeeklyPrefs { email: boolean; whatsapp: boolean; phone: string }
async function weeklyPrefs(db: Db, sid: string): Promise<WeeklyPrefs> { const { rows } = await db.query<Row>('select prefs from shippers where id = $1', [sid]); return { email: true, whatsapp: false, phone: '', ...((J(rows[0]?.prefs) ?? {}).weeklyReport ?? {}) } }

/** Builds the report from the same numbers as the analytics page (last 7 days vs the 7 before). */
export async function buildWeekly(db: Db, sid: string) {
  const { computeAnalytics } = await import('./analytics')
  const { rows: [sh] } = await db.query<Row>('select id, name from shippers where id = $1', [sid])
  const owner: ApiUser = { id: 'report', name: 'Owner', email: '', role: 'shipper', shipperId: sid, admin: false, staffRole: 'owner' }
  const Err = class extends Error { constructor(public status: number, m: string) { super(m) } }
  const a = await computeAnalytics(db, owner, { days: 7 }, Err) as Row
  const k = (x: Row | undefined) => x?.value ?? null
  const d = (x: Row | undefined) => (x?.delta == null ? '' : ` (${x.delta > 0 ? '+' : ''}${x.delta}${x.unit === 'pts' ? ' pts' : '%'})`)
  const lines: string[] = []
  if (a.sales) lines.push(`Requests on your lanes: ${k(a.sales.kpis.requests)}${d(a.sales.kpis.requests)} · quoted ${k(a.sales.kpis.quoted)} · won ${k(a.sales.kpis.won)} (${money(k(a.sales.kpis.bookedValue) ?? 0)})`, `Median reply time: ${k(a.sales.kpis.responseMedianH) ?? '—'} h · win rate ${k(a.sales.kpis.winRate) ?? '—'}%${d(a.sales.kpis.winRate)}`)
  if (a.operations) lines.push(`Delivered: ${k(a.operations.kpis.delivered)} · on time ${k(a.operations.kpis.onTimePct) ?? '—'}% · active now ${a.operations.kpis.active} (${a.operations.kpis.late} past ETA)`)
  if (a.finance) lines.push(`Invoiced ${money(k(a.finance.kpis.invoiced) ?? 0)}${d(a.finance.kpis.invoiced)} · collected ${money(k(a.finance.kpis.collected) ?? 0)} · overdue ${money(a.finance.kpis.overdue)}`)
  if (a.profit) lines.push(`Gross margin ${a.profit.grossMarginPct ?? '—'}% on shipments invoiced this week`)
  const top = (a.insights as Row[]).slice(0, 3)
  const subject = `${sh?.name ?? 'Your'} week: ${a.sales ? `${k(a.sales.kpis.won)} won · ` : ''}${a.finance ? `${money(k(a.finance.kpis.invoiced) ?? 0)} invoiced` : 'your numbers'}`
  const body = `${lines.join('\n')}\n\nWorth a look:\n${top.map((i, n) => `${n + 1}. ${i.title}`).join('\n') || 'Nothing urgent — a steady week.'}`
  const html = emailTemplate({ title: `Your week at ${sh?.name ?? 'Ship Sync'}`, body: `${lines.map(esc).join('<br>')}<br><br><b>Worth a look</b><br>${top.map((i, n) => `${n + 1}. ${esc(i.title)} — <span style="color:#9fb0c0">${esc(i.body)}</span>`).join('<br>') || 'Nothing urgent — a steady week.'}`, link: '/dashboard/analytics', cta: 'Open analytics' })
  const whatsapp = `${sh?.name ?? 'Ship Sync'} — last 7 days\n${lines.join('\n')}\n\n${top.map((i, n) => `${n + 1}. ${i.title}`).join('\n')}\n${appUrl()}/#/dashboard/analytics`
  return { subject, body, html, whatsapp, week: weekKey() }
}
export async function sendWeekly(db: Db, sid: string, o: { preview?: boolean; to?: ApiUser } = {}) {
  const r = await buildWeekly(db, sid); const p = await weeklyPrefs(db, sid); let sent = 0
  if (o.preview && o.to) { if (o.to.email) { await sendEmail(o.to.email, `[Preview] ${r.subject}`, r.html); sent++ } }
  else {
    if (p.email) sent += await notifyShipperStaff(db, sid, { kind: 'system', title: r.subject, body: r.body, link: '/dashboard/analytics', emailHtml: r.html, dedupe: `weekly:${sid}:${r.week}` }, ['owner'])
  }
  if (p.whatsapp && p.phone) { try { await sendText(p.phone, r.whatsapp, 'whatsapp'); sent++ } catch (e) { console.error('[weekly] whatsapp', e) } }
  return { ...r, sent }
}
export async function sweepWeekly(db: Db, force = false) {
  const now = new Date(); if (!force && (now.getUTCDay() !== 1 || now.getUTCHours() < 12)) return 0
  const { rows } = await db.query<Row>(`select id from shippers where not demo and id <> 'ship-sync-sourcing'`)
  let n = 0
  for (const s of rows) {
    if (!(await featureOn(db, 'weeklyReport', s.id))) continue
    const { rows: done } = await db.query('select 1 from notifications where dedupe like $1 limit 1', [`weekly:${s.id}:${weekKey()}%`]); if (done.length) continue
    try { await sendWeekly(db, s.id); n++ } catch (e) { console.error('[weekly]', s.id, e) }
  }
  return n
}

/* ============================== load planner ============================== */
export const CAPACITY: Record<string, { cbm: number; kg: number; label: string }> = { '20ft': { cbm: 28, kg: 25000, label: '20ft' }, '40ft': { cbm: 58, kg: 26500, label: '40ft' }, '40hc': { cbm: 68, kg: 26500, label: '40ft high cube' }, reefer: { cbm: 54, kg: 26000, label: '40ft reefer' } }
export const UNIT_CBM: Record<string, number> = { barrels: 0.26, boxes: 0.12, pallets: 1.3, vehicle: 14, container20: 28, container40: 58, crates: 0.6, other: 0.3 }
const UNIT_KG: Record<string, number> = { barrels: 110, boxes: 25, pallets: 350, vehicle: 1600, container20: 9000, container40: 15000, crates: 120, other: 40 }
function sizeOf(s: Row) {
  const b = J(s.booking) ?? {}; const qty = Math.max(1, num(b.quantity) || num(s.quantity) || 1)
  const dims = String(b.dims ?? '').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|in|m)?/i)
  let cbm = (UNIT_CBM[s.cargo] ?? 0.3) * qty
  if (dims) { const f = dims[4]?.toLowerCase() === 'in' ? 0.0254 : dims[4]?.toLowerCase() === 'm' ? 1 : 0.01; cbm = Number(dims[1]) * f * Number(dims[2]) * f * Number(dims[3]) * f * qty }
  const kg = num(b.weightKg) || (UNIT_KG[s.cargo] ?? 40) * qty
  return { cbm: Math.round(cbm * 100) / 100, kg: Math.round(kg), qty, estimated: !dims && !num(b.weightKg) }
}
export async function planner(db: Db, sid: string) {
  const { rows: waiting } = await db.query<Row>(`select s.id, s.ref, s.customer, s.cargo, s.origin, s.destination, s.status, s.booking, s.created_at, r.quantity, r.ready_date from shipments s left join requests r on r.id = s.request_id where s.shipper_id = $1 and s.mode = 'ocean' and s.container_id is null and s.cancelled_at is null and s.status in ('booked','picked_up','at_origin_port') and s.cargo not in ('container20','container40') order by coalesce(r.ready_date, s.created_at::date)`, [sid])
  const { rows: open } = await db.query<Row>(`select c.*, (select count(*) from shipments s where s.container_id = c.id)::int as n from containers c where c.shipper_id = $1 and c.status in ('booked','loading') order by c.cutoff_date nulls last`, [sid])
  const ids = open.map((c) => c.id)
  const { rows: loaded } = ids.length ? await db.query<Row>(`select s.container_id, s.cargo, s.booking, r.quantity from shipments s left join requests r on r.id = s.request_id where s.container_id = any($1) and s.cancelled_at is null`, [ids]) : { rows: [] as Row[] }
  const w = waiting.map((s) => ({ id: s.id, ref: s.ref, customer: s.customer, cargo: s.cargo, origin: s.origin, destination: s.destination, status: s.status, readyDate: s.ready_date ? ISO(s.ready_date)!.slice(0, 10) : null, ...sizeOf(s) }))
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
  const pool = [...w]
  const containers = open.map((c) => {
    const cap = CAPACITY[c.size] ?? CAPACITY['40ft']
    const mine = loaded.filter((l) => l.container_id === c.id).map(sizeOf)
    const cbm = mine.reduce((a, x) => a + x.cbm, 0); const kg = mine.reduce((a, x) => a + x.kg, 0)
    const fill = Math.round(Math.max(cbm / cap.cbm, kg / cap.kg) * 100)
    const cutoff = c.cutoff_date ? ISO(c.cutoff_date)!.slice(0, 10) : null
    const daysToCutoff = cutoff ? Math.round((new Date(cutoff + 'T12:00:00Z').getTime() - today) / DAY) : null
    // greedy: the earliest-ready waiting shipments for the same destination that still fit
    const suggest: string[] = []; let sc = cbm, sk = kg
    for (const s of pool) { if (s.destination !== c.destination) continue; if (sc + s.cbm <= cap.cbm * 0.95 && sk + s.kg <= cap.kg) { suggest.push(s.id); sc += s.cbm; sk += s.kg } }
    for (const id of suggest) pool.splice(pool.findIndex((p) => p.id === id), 1)
    return { id: c.id, ref: c.ref, number: c.number, size: c.size, sizeLabel: cap.label, destination: c.destination, status: c.status, cutoff, daysToCutoff, shipments: c.n, cbm: Math.round(cbm * 10) / 10, kg: Math.round(kg), capacityCbm: cap.cbm, capacityKg: cap.kg, fillPct: fill, warning: daysToCutoff != null && daysToCutoff <= 7 && fill < 60, suggest, suggestFillPct: Math.round(Math.max(sc / cap.cbm, sk / cap.kg) * 100) }
  })
  const totalCbm = pool.reduce((a, s) => a + s.cbm, 0)
  const recommend = (cbm: number, kg: number) => { for (const k of ['20ft', '40ft', '40hc'] as const) if (cbm <= CAPACITY[k].cbm * 0.95 && kg <= CAPACITY[k].kg) return { size: k, label: CAPACITY[k].label, fillPct: Math.round(Math.max(cbm / CAPACITY[k].cbm, kg / CAPACITY[k].kg) * 100), containers: 1 }; const n = Math.ceil(cbm / (CAPACITY['40hc'].cbm * 0.95)); return { size: '40hc', label: CAPACITY['40hc'].label, fillPct: Math.round((cbm / (n * CAPACITY['40hc'].cbm)) * 100), containers: n } }
  return { waiting: w, containers, leftover: { shipments: pool.length, cbm: Math.round(totalCbm * 10) / 10, kg: Math.round(pool.reduce((a, s) => a + s.kg, 0)), recommend: pool.length ? recommend(totalCbm, pool.reduce((a, s) => a + s.kg, 0)) : null }, capacity: CAPACITY, unitCbm: UNIT_CBM }
}
export async function sweepHalfEmpty(db: Db) {
  const { rows } = await db.query<Row>(`select distinct shipper_id from containers where status in ('booked','loading') and cutoff_date between current_date and current_date + 5`)
  for (const r of rows) {
    const p = await planner(db, r.shipper_id)
    for (const c of p.containers.filter((x) => x.warning && (x.daysToCutoff ?? 99) <= 5)) await notifyShipperStaff(db, r.shipper_id, { kind: 'container_update', title: `${c.ref} is ${c.fillPct}% full, cutoff in ${c.daysToCutoff} day${c.daysToCutoff === 1 ? '' : 's'}`, body: c.suggest.length ? `${c.suggest.length} waiting shipment${c.suggest.length === 1 ? '' : 's'} would take it to ${c.suggestFillPct}%. Open the load planner.` : 'Offer the space as a shared barrel or container to fill it before cutoff.', link: '/dashboard/containers?view=planner', dedupe: `halfempty:${c.id}:${c.cutoff}` }, ['owner', 'dispatcher'])
  }
}

/* ============================== campaigns ============================== */
const zCampaign = z.object({
  name: z.string().trim().min(2).max(80), channel: z.enum(['email', 'sms', 'whatsapp']), subject: z.string().trim().max(120).default(''), message: z.string().trim().min(10).max(1200),
  audience: z.enum(['dormant', 'all', 'recent', 'custom']), clientIds: z.array(z.string().max(60)).max(500).default([]), test: z.boolean().optional(),
})
async function audience(db: Db, sid: string, kind: string, ids: string[] = []) {
  const { rows } = await db.query<Row>(`select c.id, c.name, c.company, c.email, c.phone, c.whatsapp, (select count(*) from shipments s where s.client_id = c.id and s.cancelled_at is null)::int as shipments, (select max(created_at) from shipments s where s.client_id = c.id) as last_at from clients c where c.shipper_id = $1 and c.status = 'active'`, [sid])
  const now = Date.now()
  const list = rows.filter((c) => kind === 'custom' ? ids.includes(c.id) : kind === 'dormant' ? c.shipments >= 2 && c.last_at && now - new Date(c.last_at).getTime() > 90 * DAY : kind === 'recent' ? c.last_at && now - new Date(c.last_at).getTime() <= 90 * DAY : true)
  return list.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email, phone: c.whatsapp || c.phone, shipments: c.shipments, lastAt: ISO(c.last_at) }))
}
const fill = (t: string, c: { name: string; company?: string }, sh: Row, link: string) => t.replace(/\{name\}/g, String(c.name).split(' ')[0]).replace(/\{company\}/g, c.company || c.name).replace(/\{shipper\}/g, sh.name).replace(/\{link\}/g, link)
async function refreshBookings(db: Db, campaignId: string) {
  await db.query(`update campaign_recipients cr set booked_shipment_id = s.id, booked_at = s.created_at from shipments s where cr.campaign_id = $1 and cr.booked_shipment_id is null and cr.client_id is not null and s.client_id = cr.client_id and cr.sent_at is not null and s.created_at > cr.sent_at and s.created_at < cr.sent_at + interval '30 days' and s.cancelled_at is null`, [campaignId])
}

/* ============================== routes ============================== */
const zTemplate = z.object({ name: z.string().trim().min(2).max(60), mode: z.enum(['ocean', 'air']).default('ocean'), cargo: z.string().max(40).default(''), unitPrice: z.number().min(0).max(1_000_000), minCharge: z.number().min(0).max(1_000_000).default(0), pickupFee: z.number().min(0).max(100000).default(0), deliveryFee: z.number().min(0).max(100000).default(0), insurancePct: z.number().min(0).max(20).default(0), transitDays: z.number().int().min(1).max(120).default(35), validDays: z.number().int().min(1).max(90).default(14), kind: z.enum(['firm', 'estimate']).default('firm'), includes: z.array(z.string().max(40)).max(10).default([]), notes: z.string().trim().max(600).default('') })
const tplOut = (t: Row) => ({ id: t.id, name: t.name, mode: t.mode, cargo: t.cargo, unitPrice: num(t.unit_price), minCharge: num(t.min_charge), pickupFee: num(t.pickup_fee), deliveryFee: num(t.delivery_fee), insurancePct: num(t.insurance_pct), transitDays: Number(t.transit_days), validDays: Number(t.valid_days), kind: t.kind, includes: J(t.includes) ?? [], notes: t.notes })

export function mountGrowth(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const shipper = async (db: Db, req: Request, roles?: string[]) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Shippers only.'); if (roles && !roles.includes(u.staffRole ?? 'owner')) throw new HttpError(403, `Only ${roles.join(', ')} can do this.`); return u }

  // Monday report
  r.get('/shipper/weekly-report', wrap(async (req, res) => { const db = await getDb(); const u = await shipper(db, req); res.json({ prefs: await weeklyPrefs(db, u.shipperId!), on: await featureOn(db, 'weeklyReport', u.shipperId) }) }))
  r.put('/shipper/weekly-report', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req, ['owner', 'dispatcher'])
    const b = z.object({ email: z.boolean(), whatsapp: z.boolean(), phone: z.string().trim().max(30).default('') }).parse(req.body)
    if (b.whatsapp && !/^\+?\d[\d\s-]{7,}$/.test(b.phone)) throw new HttpError(400, 'Add the WhatsApp number in international format, e.g. +1 713 555 0100.')
    await db.query(`update shippers set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('weeklyReport', $2::jsonb) where id = $1`, [u.shipperId, JSON.stringify(b)])
    res.json({ prefs: b })
  }))
  r.post('/shipper/weekly-report/preview', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req, ['owner', 'dispatcher'])
    const x = await sendWeekly(db, u.shipperId!, { preview: true, to: u })
    res.json({ subject: x.subject, body: x.body, whatsapp: x.whatsapp, sent: x.sent })
  }))

  // campaigns
  r.get('/campaigns/audience', wrap(async (req, res) => { const db = await getDb(); const u = await shipper(db, req); res.json({ clients: await audience(db, u.shipperId!, String(req.query.kind ?? 'dormant')) }) }))
  r.get('/campaigns', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req)
    const { rows } = await db.query<Row>(`select c.*, (select count(*) from campaign_recipients r where r.campaign_id = c.id)::int as total, (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status = 'sent')::int as sent, (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status = 'failed')::int as failed from campaigns c where c.shipper_id = $1 order by c.created_at desc limit 50`, [u.shipperId])
    for (const c of rows) await refreshBookings(db, c.id)
    const { rows: booked } = rows.length ? await db.query<Row>(`select r.campaign_id, count(*)::int as n, coalesce(sum((select sum(i.total) from invoices i where i.shipment_id = r.booked_shipment_id)),0)::float as rev from campaign_recipients r where r.campaign_id = any($1) and r.booked_shipment_id is not null group by r.campaign_id`, [rows.map((c) => c.id)]) : { rows: [] as Row[] }
    res.json({ campaigns: rows.map((c) => { const b = booked.find((x) => x.campaign_id === c.id); return { id: c.id, name: c.name, channel: c.channel, audience: c.audience, sentAt: ISO(c.sent_at), createdBy: c.created_by, total: c.total, sent: c.sent, failed: c.failed, booked: b?.n ?? 0, revenue: Math.round(b?.rev ?? 0), conversionPct: c.sent ? Math.round(((b?.n ?? 0) / c.sent) * 100) : null } }), enabled: await featureOn(db, 'campaigns', u.shipperId) })
  }))
  r.get('/campaigns/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req)
    const { rows: [c] } = await db.query<Row>('select * from campaigns where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); if (!c) throw new HttpError(404, 'Campaign not found.')
    await refreshBookings(db, c.id)
    const { rows } = await db.query<Row>(`select r.*, s.ref as booked_ref from campaign_recipients r left join shipments s on s.id = r.booked_shipment_id where r.campaign_id = $1 order by r.name`, [c.id])
    res.json({ campaign: { id: c.id, name: c.name, channel: c.channel, subject: c.subject, message: c.message, audience: c.audience, sentAt: ISO(c.sent_at) }, recipients: rows.map((x) => ({ id: x.id, clientId: x.client_id, name: x.name, to: x.to_addr, status: x.status, error: x.error, sentAt: ISO(x.sent_at), bookedRef: x.booked_ref ?? null, bookedAt: ISO(x.booked_at) })) })
  }))
  r.post('/campaigns', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req, ['owner', 'dispatcher', 'agent'])
    if (!(await featureOn(db, 'campaigns', u.shipperId))) throw new HttpError(403, 'Campaigns are switched off for your account.')
    await requirePerk(db, u.shipperId!, 'campaigns', HttpError)
    const b = zCampaign.parse(req.body)
    if (b.channel === 'email' && !b.subject) throw new HttpError(400, 'Add a subject line for an email campaign.')
    const { rows: [sh] } = await db.query<Row>('select id, name, brand from shippers where id = $1', [u.shipperId])
    const slug = (J(sh.brand) ?? {}).slug || String(sh.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const link = `${appUrl()}/#/order/${slug}`
    let list = await audience(db, u.shipperId!, b.audience, b.clientIds)
    if (b.test) list = [{ id: '', name: u.name, company: '', email: u.email, phone: '', shipments: 0, lastAt: null }]
    const reach = list.filter((c) => (b.channel === 'email' ? /@/.test(c.email) : /\d{7,}/.test(String(c.phone).replace(/\D/g, ''))))
    if (!reach.length) throw new HttpError(400, b.channel === 'email' ? 'None of these clients has an email address.' : 'None of these clients has a phone number.')
    const { rows: [recent] } = await db.query<Row>(`select count(*)::int as n from campaigns where shipper_id = $1 and created_at > now() - interval '24 hours'`, [u.shipperId])
    if (!b.test && Number(recent?.n ?? 0) >= 5) throw new HttpError(429, 'That’s 5 campaigns today — send more tomorrow so clients don’t feel spammed.')
    const id = 'cmp_' + uid()
    await db.query(`insert into campaigns (id,shipper_id,name,channel,subject,message,audience,status,sent_at,created_by) values ($1,$2,$3,$4,$5,$6,$7,'sent',now(),$8)`, [id, u.shipperId, b.test ? `[Test] ${b.name}` : b.name, b.channel, b.subject, b.message, b.test ? 'test' : b.audience, u.name])
    for (const c of reach) await db.query(`insert into campaign_recipients (id,campaign_id,client_id,name,to_addr,channel) values ($1,$2,$3,$4,$5,$6)`, ['cr_' + uid(), id, c.id || null, c.name, b.channel === 'email' ? c.email : c.phone, b.channel])
    void (async () => {
      const { rows } = await db.query<Row>(`select * from campaign_recipients where campaign_id = $1`, [id])
      for (const x of rows) {
        const c = list.find((l) => (l.id || '') === (x.client_id ?? '')) ?? { name: x.name, company: '' }
        const text = fill(b.message, c, sh, link)
        try {
          if (b.channel === 'email') await sendEmail(x.to_addr, fill(b.subject, c, sh, link), emailTemplate({ title: fill(b.subject, c, sh, link), body: esc(text).replace(/\n/g, '<br>'), link, cta: `Book with ${sh.name}`, name: String(c.name).split(' ')[0] }))
          else await sendText(x.to_addr, `${text}\n${link}`, b.channel === 'whatsapp' && (await featureOn(db, 'whatsapp', u.shipperId)) ? 'whatsapp' : 'sms')
          await db.query(`update campaign_recipients set status = 'sent', sent_at = now() where id = $1`, [x.id])
        } catch (e) { await db.query(`update campaign_recipients set status = 'failed', error = $2 where id = $1`, [x.id, String(e instanceof Error ? e.message : e).slice(0, 200)]) }
      }
    })().catch((e) => console.error('[campaign]', e))
    res.status(201).json({ id, recipients: reach.length, skipped: list.length - reach.length })
  }))

  // load planner
  r.get('/containers/planner', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !can(u, 'containers')) throw new HttpError(403, 'Container access is needed for this.')
    await requirePerk(db, u.shipperId, 'loadPlanner', HttpError)
    res.json(await planner(db, u.shipperId))
  }))

  // quote templates
  r.get('/quote-templates', wrap(async (req, res) => { const db = await getDb(); const u = await shipper(db, req); const { rows } = await db.query<Row>('select * from quote_templates where shipper_id = $1 order by name', [u.shipperId]); res.json({ templates: rows.map(tplOut) }) }))
  r.post('/quote-templates', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipper(db, req); const b = zTemplate.parse(req.body)
    const { rows: [n] } = await db.query<Row>('select count(*)::int as n from quote_templates where shipper_id = $1', [u.shipperId]); if (Number(n?.n) >= 50) throw new HttpError(409, 'That’s 50 templates — delete one first.')
    const id = 'qt_' + uid()
    await db.query(`insert into quote_templates (id,shipper_id,name,mode,cargo,unit_price,min_charge,pickup_fee,delivery_fee,insurance_pct,transit_days,valid_days,kind,includes,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, u.shipperId, b.name, b.mode, b.cargo, b.unitPrice, b.minCharge, b.pickupFee, b.deliveryFee, b.insurancePct, b.transitDays, b.validDays, b.kind, JSON.stringify(b.includes), b.notes])
    const { rows } = await db.query<Row>('select * from quote_templates where id = $1', [id]); res.status(201).json({ template: tplOut(rows[0]) })
  }))
  r.delete('/quote-templates/:id', wrap(async (req, res) => { const db = await getDb(); const u = await shipper(db, req); await db.query('delete from quote_templates where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); res.json({ ok: true }) }))
}

export function startGrowthSweeps(getDb: () => Promise<Db>) {
  const run = () => getDb().then(async (db) => { await sweepWeekly(db); await sweepHalfEmpty(db) }).catch((e) => console.error('[growth]', e))
  setTimeout(run, 70_000); setInterval(run, 3600_000)
}
