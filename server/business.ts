/**
 * The founder's view: how Ntemtem is doing as a company, and what on the platform needs a human today.
 *   GET /admin/business    revenue by stream, escrow position, growth series, conversion, lane demand, sourcing pipeline
 *   GET /admin/exceptions  stuck or waiting things across every module, grouped, with links
 * Everything is computed from existing tables; nothing here writes.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { hideDemoShippers, type Db } from './db'
import { STEPS } from './sourcing'

type Row = Record<string, any>
interface Deps { getDb: () => Promise<Db>; requireAdmin: (db: Db, req: Request) => Promise<unknown>; wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void }

const PLAN_USD: Record<string, number> = { starter: 0, pro: 149, enterprise: 499 }
const SOURCING = 'ship-sync-sourcing'
const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100
const day = (d: unknown) => new Date(d as string).toISOString().slice(0, 10)
/** Demo rows are excluded from the business numbers once demo shippers are hidden — then the dashboard shows the real company only. */
const realOnly = () => hideDemoShippers()

export async function businessSnapshot(db: Db) {
  const real = realOnly()
  const shipperFilter = real ? `and s.demo = false` : ''
  const userFilter = real ? `and u.email not like '%.demo'` : ''

  // --- revenue by stream ---
  const { rows: rev } = await db.query<Row>(`
    select
      coalesce(sum(case when p.sourcing_id is null and p.status in ('held','released','paid_out') then p.fee_usd end),0)::float as take_rate_all,
      coalesce(sum(case when p.sourcing_id is null and p.status in ('held','released','paid_out') and p.paid_at > now() - interval '30 days' then p.fee_usd end),0)::float as take_rate_30,
      coalesce(sum(case when p.sourcing_id is not null and p.stage = 'fee' and p.status in ('held','released','paid_out') then p.amount_usd end),0)::float as sourcing_fees_all,
      coalesce(sum(case when p.sourcing_id is not null and p.stage = 'fee' and p.status in ('held','released','paid_out') and p.paid_at > now() - interval '30 days' then p.amount_usd end),0)::float as sourcing_fees_30,
      coalesce(sum(case when p.sourcing_id is not null and p.stage in ('deposit','balance','sample') and p.status in ('held','released','paid_out') then p.amount_usd end),0)::float as sourcing_goods_all,
      coalesce(sum(case when p.sourcing_id is not null and p.stage in ('deposit','balance','sample') and p.status in ('held','released','paid_out') and p.paid_at > now() - interval '30 days' then p.amount_usd end),0)::float as sourcing_goods_30,
      coalesce(sum(case when p.status in ('held','released','paid_out') then p.amount_usd end),0)::float as gmv_all,
      coalesce(sum(case when p.status in ('held','released','paid_out') and p.paid_at > now() - interval '30 days' then p.amount_usd end),0)::float as gmv_30,
      coalesce(sum(case when p.status = 'refunded' then p.amount_usd end),0)::float as refunded_all
    from escrow_payments p join shippers s on s.id = p.shipper_id where true ${shipperFilter}`)
  const { rows: plans } = await db.query<Row>(`select plan, count(*)::int as n from shippers s where s.id <> '${SOURCING}' ${shipperFilter} group by plan`)
  const mrr = plans.reduce((a, p) => a + (PLAN_USD[p.plan] ?? 0) * n(p.n), 0)
  const planCounts = Object.fromEntries(plans.map((p) => [p.plan, n(p.n)]))

  // --- escrow position (platform-wide, shippers' money we hold) ---
  const { rows: esc } = await db.query<Row>(`
    select
      coalesce(sum(case when p.status = 'held' then p.amount_usd end),0)::float as held_gross,
      coalesce(sum(case when p.status = 'held' then p.net_usd end),0)::float as held_net,
      coalesce(sum(case when p.status = 'held' and coalesce(p.hold,false) then p.amount_usd end),0)::float as on_hold,
      coalesce(sum(case when p.status = 'released' and p.payout_id is null then p.net_usd end),0)::float as available_to_shippers,
      count(*) filter (where p.status = 'held')::int as held_count
    from escrow_payments p join shippers s on s.id = p.shipper_id where true ${shipperFilter}`)
  const { rows: po } = await db.query<Row>(`select coalesce(sum(case when o.status = 'requested' then o.amount_usd end),0)::float as requested, count(*) filter (where o.status = 'requested')::int as requested_count, coalesce(sum(case when o.status = 'paid' and o.paid_at > now() - interval '30 days' then o.amount_usd end),0)::float as paid_30 from payouts o join shippers s on s.id = o.shipper_id where true ${shipperFilter}`)

  // --- growth: last 12 weeks ---
  const weeks = async (table: string, col: string, extra = '') => {
    const { rows } = await db.query<Row>(`select date_trunc('week', ${col})::date as wk, count(*)::int as c from ${table} where ${col} > now() - interval '12 weeks' ${extra} group by 1 order by 1`)
    return rows.map((r) => ({ week: day(r.wk), count: n(r.c) }))
  }
  const series = {
    signups: await weeks('users u', 'u.created_at', userFilter),
    shipperSignups: await weeks('shippers s', 's.created_at', `and s.id <> '${SOURCING}' ${shipperFilter}`),
    requests: await weeks('requests r join users u on u.id = r.user_id', 'r.created_at', userFilter),
    bookings: await weeks('shipments sh join shippers s on s.id = sh.shipper_id', 'sh.created_at', shipperFilter),
    sourcing: await weeks('sourcing_requests sr', 'sr.created_at', ''),
    gmv: (await db.query<Row>(`select date_trunc('week', p.paid_at)::date as wk, coalesce(sum(p.amount_usd),0)::float as v from escrow_payments p join shippers s on s.id = p.shipper_id where p.paid_at > now() - interval '12 weeks' and p.status in ('held','released','paid_out') ${shipperFilter} group by 1 order by 1`)).rows.map((r) => ({ week: day(r.wk), count: r2(n(r.v)) })),
  }

  // --- funnel & conversion (last 90 days) ---
  const { rows: fun } = await db.query<Row>(`
    select
      count(*)::int as requests,
      count(*) filter (where exists (select 1 from quotes q where q.request_id = r.id))::int as quoted,
      count(*) filter (where r.status = 'accepted' or exists (select 1 from shipments sh where sh.request_id = r.id))::int as booked,
      coalesce(avg((select count(*) from quotes q where q.request_id = r.id)),0)::float as quotes_per_request,
      coalesce(avg(extract(epoch from ((select min(q.sent_at) from quotes q where q.request_id = r.id) - r.created_at)) / 3600),0)::float as hours_to_first_quote
    from requests r join users u on u.id = r.user_id where r.created_at > now() - interval '90 days' ${userFilter}`)
  const funnel = { requests: n(fun[0].requests), quoted: n(fun[0].quoted), booked: n(fun[0].booked), quotesPerRequest: r2(n(fun[0].quotes_per_request)), hoursToFirstQuote: r2(n(fun[0].hours_to_first_quote)), quoteRatePct: fun[0].requests ? Math.round((n(fun[0].quoted) / n(fun[0].requests)) * 100) : 0, bookRatePct: fun[0].quoted ? Math.round((n(fun[0].booked) / n(fun[0].quoted)) * 100) : 0 }

  // --- lane demand (90 days): requests by destination and by origin city → destination ---
  const { rows: dest } = await db.query<Row>(`select r.destination, count(*)::int as requests, count(distinct q.shipper_id)::int as shippers_quoting from requests r join users u on u.id = r.user_id left join quotes q on q.request_id = r.id where r.created_at > now() - interval '90 days' ${userFilter} group by r.destination order by requests desc limit 8`)
  const { rows: lanes } = await db.query<Row>(`select split_part(r.origin, ',', 1) as origin, r.destination, r.mode, count(*)::int as requests, count(*) filter (where not exists (select 1 from quotes q where q.request_id = r.id))::int as unquoted from requests r join users u on u.id = r.user_id where r.created_at > now() - interval '90 days' ${userFilter} group by 1,2,3 order by requests desc limit 10`)
  const { rows: modes } = await db.query<Row>(`select r.mode, count(*)::int as c from requests r join users u on u.id = r.user_id where r.created_at > now() - interval '90 days' ${userFilter} group by 1`)

  // --- sourcing pipeline ---
  const { rows: sp } = await db.query<Row>(`select status, count(*)::int as c, coalesce(sum(coalesce((select q.total_usd from sourcing_quotes q where q.id = sr.accepted_quote_id), sr.target_price_usd * sr.quantity, 0)),0)::float as value from sourcing_requests sr where sr.status not in ('closed','cancelled') group by status`)
  const sourcing = { open: sp.reduce((a, r) => a + n(r.c), 0), valueUsd: r2(sp.reduce((a, r) => a + n(r.value), 0)), byStage: STEPS.map((s) => ({ stage: s, count: n(sp.find((r) => r.status === s)?.c) })).filter((x) => x.count > 0) }
  const { rows: ae } = await db.query<Row>(`select coalesce(sum(case when status = 'earned' then amount_usd end),0)::float as owed, coalesce(sum(case when status = 'paid' then amount_usd end),0)::float as paid from agent_earnings`)

  // --- shipper health ---
  const { rows: sh } = await db.query<Row>(`select count(*)::int as total, count(*) filter (where verified)::int as verified, count(*) filter (where created_at > now() - interval '30 days')::int as new_30, count(*) filter (where exists (select 1 from quotes q where q.shipper_id = s.id and q.sent_at > now() - interval '30 days'))::int as active_30 from shippers s where s.id <> '${SOURCING}' ${shipperFilter}`)
  const { rows: cu } = await db.query<Row>(`select count(*)::int as total, count(*) filter (where u.created_at > now() - interval '30 days')::int as new_30, count(*) filter (where exists (select 1 from shipments sh where sh.user_id = u.id))::int as booked_ever from users u where u.role = 'customer' and not coalesce(u.is_admin,false) ${userFilter}`)
  const { rows: rv } = await db.query<Row>(`select count(*)::int as n, coalesce(avg(rating),0)::float as avg from reviews where status = 'published' and created_at > now() - interval '90 days'`)

  return {
    realOnly: real,
    revenue: {
      takeRate: { all: r2(n(rev[0].take_rate_all)), last30: r2(n(rev[0].take_rate_30)) },
      sourcingFees: { all: r2(n(rev[0].sourcing_fees_all)), last30: r2(n(rev[0].sourcing_fees_30)) },
      sourcingGoods: { all: r2(n(rev[0].sourcing_goods_all)), last30: r2(n(rev[0].sourcing_goods_30)) },
      subscriptionsMrr: mrr, planCounts,
      gmv: { all: r2(n(rev[0].gmv_all)), last30: r2(n(rev[0].gmv_30)) }, refunded: r2(n(rev[0].refunded_all)),
      totalLast30: r2(n(rev[0].take_rate_30) + n(rev[0].sourcing_fees_30) + mrr),
    },
    escrow: { heldGross: r2(n(esc[0].held_gross)), heldNet: r2(n(esc[0].held_net)), onHold: r2(n(esc[0].on_hold)), heldCount: n(esc[0].held_count), availableToShippers: r2(n(esc[0].available_to_shippers)), payoutsRequested: r2(n(po[0].requested)), payoutsRequestedCount: n(po[0].requested_count), payoutsPaid30: r2(n(po[0].paid_30)) },
    series, funnel,
    demand: { destinations: dest.map((d) => ({ destination: d.destination, requests: n(d.requests), shippersQuoting: n(d.shippers_quoting) })), lanes: lanes.map((l) => ({ origin: l.origin, destination: l.destination, mode: l.mode, requests: n(l.requests), unquoted: n(l.unquoted) })), modes: Object.fromEntries(modes.map((m) => [m.mode, n(m.c)])) },
    sourcing: { ...sourcing, agentOwedUsd: r2(n(ae[0].owed)), agentPaidUsd: r2(n(ae[0].paid)) },
    shippers: { total: n(sh[0].total), verified: n(sh[0].verified), new30: n(sh[0].new_30), active30: n(sh[0].active_30) },
    customers: { total: n(cu[0].total), new30: n(cu[0].new_30), bookedEver: n(cu[0].booked_ever) },
    reviews: { last90: n(rv[0].n), avg: r2(n(rv[0].avg)) },
    generatedAt: new Date().toISOString(),
  }
}

/* ---------------- exceptions ---------------- */

export interface Exception { kind: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; link: string; since: string; id: string }

export async function platformExceptions(db: Db) {
  const out: Exception[] = []
  const age = (d: unknown) => { const h = (Date.now() - new Date(String(d)).getTime()) / 3_600_000; return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }

  const { rows: unq } = await db.query<Row>(`select r.id, r.ref, r.origin, r.destination, r.mode, r.cargo, r.created_at, r.contact_name from requests r where r.status = 'open' and r.created_at < now() - interval '48 hours' and not exists (select 1 from quotes q where q.request_id = r.id) order by r.created_at asc limit 50`)
  for (const r of unq) out.push({ kind: 'unquoted_request', severity: 'high', id: r.id, title: `${r.ref} has no quote after ${age(r.created_at)}`, detail: `${r.origin} → ${r.destination} · ${r.mode} · ${r.cargo} · ${r.contact_name}`, link: `/shippers?destination=${encodeURIComponent(r.destination)}`, since: new Date(r.created_at).toISOString() })

  const { rows: late } = await db.query<Row>(`select sh.id, sh.ref, sh.status, sh.eta, sh.customer, s.name as shipper, (select max(at) from shipment_events e where e.shipment_id = sh.id) as last_event from shipments sh join shippers s on s.id = sh.shipper_id where sh.status <> 'delivered' and sh.eta < current_date - 2 order by sh.eta asc limit 50`)
  for (const r of late) out.push({ kind: 'late_shipment', severity: 'high', id: r.id, title: `${r.ref} is ${Math.round((Date.now() - new Date(r.eta).getTime()) / 86_400_000)} days past ETA`, detail: `${r.shipper} · ${r.status.replace(/_/g, ' ')} · ${r.customer}`, link: `/track?ref=${r.ref}`, since: new Date(r.eta).toISOString() })

  const { rows: stale } = await db.query<Row>(`select sh.id, sh.ref, sh.status, sh.customer, s.name as shipper, coalesce((select max(at) from shipment_events e where e.shipment_id = sh.id), sh.created_at) as last_event from shipments sh join shippers s on s.id = sh.shipper_id where sh.status not in ('delivered') and sh.eta >= current_date - 2 and coalesce((select max(at) from shipment_events e where e.shipment_id = sh.id), sh.created_at) < now() - interval '10 days' order by last_event asc limit 50`)
  for (const r of stale) out.push({ kind: 'stale_shipment', severity: 'medium', id: r.id, title: `${r.ref} has had no update for ${age(r.last_event)}`, detail: `${r.shipper} · ${r.status.replace(/_/g, ' ')} · ${r.customer}`, link: `/track?ref=${r.ref}`, since: new Date(r.last_event).toISOString() })

  const { rows: held } = await db.query<Row>(`select p.id, p.amount_usd, p.paid_at, coalesce(p.hold,false) as hold, sh.ref, sh.status, s.name as shipper from escrow_payments p join shipments sh on sh.id = p.shipment_id join shippers s on s.id = p.shipper_id where p.status = 'held' and (coalesce(p.hold,false) or sh.status in ('delivered') or p.paid_at < now() - interval '45 days') order by p.paid_at asc limit 50`)
  for (const r of held) out.push({ kind: r.hold ? 'escrow_on_hold' : 'escrow_waiting', severity: r.hold ? 'medium' : 'high', id: r.id, title: r.hold ? `$${n(r.amount_usd).toLocaleString()} on ${r.ref} is on hold` : `$${n(r.amount_usd).toLocaleString()} on ${r.ref} still in escrow after ${age(r.paid_at)}`, detail: `${r.shipper} · shipment ${r.status.replace(/_/g, ' ')}`, link: `/admin?view=payments`, since: new Date(r.paid_at).toISOString() })

  const { rows: dsp } = await db.query<Row>(`select d.id, d.reason, d.status, d.created_at, d.updated_at, d.amount_claimed_usd, sh.ref, s.name as shipper from disputes d join shipments sh on sh.id = d.shipment_id join shippers s on s.id = d.shipper_id where d.status in ('open','under_review','escalated') and d.updated_at < now() - interval '3 days' order by d.created_at asc limit 50`)
  for (const r of dsp) out.push({ kind: 'dispute', severity: 'high', id: r.id, title: `Dispute on ${r.ref} open ${age(r.created_at)}${r.amount_claimed_usd ? ` · $${n(r.amount_claimed_usd).toLocaleString()} claimed` : ''}`, detail: `${r.reason} · ${r.shipper} · ${r.status.replace(/_/g, ' ')} · last activity ${age(r.updated_at)} ago`, link: `/admin?view=disputes`, since: new Date(r.created_at).toISOString() })

  const { rows: pay } = await db.query<Row>(`select o.id, o.amount_usd, o.requested_at, s.name as shipper from payouts o join shippers s on s.id = o.shipper_id where o.status = 'requested' and o.requested_at < now() - interval '3 days' order by o.requested_at asc limit 50`)
  for (const r of pay) out.push({ kind: 'payout_waiting', severity: 'medium', id: r.id, title: `${r.shipper} payout of $${n(r.amount_usd).toLocaleString()} waiting ${age(r.requested_at)}`, detail: 'Pay it out or reject it with a note.', link: `/admin?view=payments`, since: new Date(r.requested_at).toISOString() })

  const { rows: ver } = await db.query<Row>(`select s.id, s.name, s.created_at from shippers s where not s.verified and s.demo = false and s.created_at < now() - interval '3 days' order by s.created_at asc limit 50`)
  for (const r of ver) out.push({ kind: 'verification', severity: 'medium', id: r.id, title: `${r.name} waiting for verification ${age(r.created_at)}`, detail: 'Review licence and insurance, then verify or reject.', link: `/admin`, since: new Date(r.created_at).toISOString() })

  const { rows: src } = await db.query<Row>(`select id, ref, title, status, updated_at, created_at, agent_user_id from sourcing_requests where status not in ('closed','cancelled','delivered') and ((status = 'requested' and created_at < now() - interval '24 hours') or (status = 'quoted' and updated_at < now() - interval '7 days') or (status not in ('requested','quoted') and updated_at < now() - interval '14 days')) order by updated_at asc limit 50`)
  for (const r of src) {
    const why = r.status === 'requested' ? `unassigned for ${age(r.created_at)}` : r.status === 'quoted' ? `quote unanswered for ${age(r.updated_at)}` : `no movement for ${age(r.updated_at)}`
    out.push({ kind: 'sourcing', severity: r.status === 'requested' ? 'high' : 'medium', id: r.id, title: `${r.ref} ${why}`, detail: `${r.title} · ${String(r.status).replace(/_/g, ' ')}`, link: `/dashboard/sourcing/${r.id}`, since: new Date(r.updated_at).toISOString() })
  }

  const { rows: cm } = await db.query<Row>(`select id, name, topic, created_at from contact_messages where not handled and created_at < now() - interval '24 hours' order by created_at asc limit 20`)
  for (const r of cm) out.push({ kind: 'contact', severity: 'low', id: r.id, title: `${r.name} wrote about ${r.topic} ${age(r.created_at)} ago — unanswered`, detail: 'Reply from the contact inbox under System.', link: `/admin?view=system`, since: new Date(r.created_at).toISOString() })

  const { rows: er } = await db.query<Row>(`select count(*)::int as c, min(created_at) as first from app_errors where resolved_at is null`)
  if (n(er[0].c) > 0) out.push({ kind: 'errors', severity: n(er[0].c) > 10 ? 'high' : 'low', id: 'errors', title: `${er[0].c} unresolved error${n(er[0].c) === 1 ? '' : 's'} in the log`, detail: 'Server 500s and browser crashes — look for a pattern.', link: `/admin?view=system`, since: new Date(er[0].first).toISOString() })

  const order = { high: 0, medium: 1, low: 2 }
  out.sort((a, b) => order[a.severity] - order[b.severity] || a.since.localeCompare(b.since))
  const counts = { high: out.filter((x) => x.severity === 'high').length, medium: out.filter((x) => x.severity === 'medium').length, low: out.filter((x) => x.severity === 'low').length }
  return { exceptions: out, counts, generatedAt: new Date().toISOString() }
}

export function mountBusiness(r: Router, d: Deps) {
  const { getDb, requireAdmin, wrap } = d
  r.get('/admin/business', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json(await businessSnapshot(db)) }))
  r.get('/admin/exceptions', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json(await platformExceptions(db)) }))
}
