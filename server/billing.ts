/**
 * Plans & billing.
 *   GET  /billing                    plan in force, trial, usage vs limits, prices, perks (owner / finance)
 *   POST /billing/checkout {plan}    Stripe Checkout in subscription mode → { url }
 *   GET  /billing/confirm?session=   activate after the redirect back (also done by the webhook)
 *   POST /billing/cancel | /billing/resume
 *   GET  /admin/billing              MRR, plans, trials, churn, list
 *   PUT  /admin/billing/prices       { pro, enterprise }
 *   POST /admin/billing/:shipperId   { plan, trialDays?, note? } — manual plan / comp / extend trial
 *   GET|PUT /admin/features …        feature switches (global + per shipper)
 *   GET  /features                   the caller's effective switches + plan perks (for the UI)
 */
import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'
import { stripe, stripeMode } from './payments'
import { notifyShipperStaff } from './notify'
import { audit } from './audit'
import { FEATURES, PLANS, PLAN_ORDER, PERK_LABELS, clearFeatureCache, effectivePlan, featureMap, globalFeatures, planPrices, type Plan } from './features'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const appUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
const evId = () => 'sbe_' + randomBytes(6).toString('hex')

async function setPlan(db: Db, shipperId: string, plan: Plan, o: { status?: string; provider?: string; amount?: number; sessionId?: string | null; customerId?: string | null; subscriptionId?: string | null; periodEnd?: Date | null; by?: string; kind?: string; note?: string }) {
  await db.query('update shippers set plan = $2 where id = $1', [shipperId, plan])
  if (plan === 'starter') {
    await db.query(`update subscriptions set status = 'canceled', canceled_at = now(), updated_at = now() where shipper_id = $1 and status <> 'canceled'`, [shipperId])
  } else {
    await db.query(`insert into subscriptions (shipper_id,plan,status,provider,amount_usd,session_id,customer_id,subscription_id,current_period_end,note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (shipper_id) do update set plan = $2, status = $3, provider = $4, amount_usd = $5, session_id = coalesce($6, subscriptions.session_id), customer_id = coalesce($7, subscriptions.customer_id), subscription_id = coalesce($8, subscriptions.subscription_id), current_period_end = $9, cancel_at_period_end = false, canceled_at = null, note = $10, updated_at = now()`,
    [shipperId, plan, o.status ?? 'active', o.provider ?? 'manual', o.amount ?? 0, o.sessionId ?? null, o.customerId ?? null, o.subscriptionId ?? null, o.periodEnd ?? null, o.note ?? ''])
  }
  await db.query('insert into subscription_events (id,shipper_id,kind,plan,amount_usd,by_name) values ($1,$2,$3,$4,$5,$6)', [evId(), shipperId, o.kind ?? 'change', plan, o.amount ?? 0, o.by ?? ''])
}

/** Called from the Stripe webhook first; true when the event was a subscription event. */
export async function handleBillingEvent(db: Db, evt: Row): Promise<boolean> {
  const obj: Row = evt.data?.object ?? {}
  const ref = String(obj.client_reference_id ?? '')
  if ((evt.type === 'checkout.session.completed') && (obj.mode === 'subscription' || ref.startsWith('sub:'))) {
    const [, shipperId, plan] = ref.split(':')
    if (shipperId && PLAN_ORDER.includes(plan as Plan)) await activate(db, shipperId, plan as Plan, obj)
    return true
  }
  if (evt.type === 'customer.subscription.deleted') {
    const { rows } = await db.query<Row>('select shipper_id from subscriptions where subscription_id = $1', [obj.id ?? ''])
    if (rows[0]) { await setPlan(db, rows[0].shipper_id, 'starter', { kind: 'canceled', by: 'Stripe' }); await notifyShipperStaff(db, rows[0].shipper_id, { kind: 'system', title: 'Your plan moved to Starter', body: 'The subscription ended. You can upgrade again any time under Plan & billing.', link: '/dashboard/billing' }, ['owner']) }
    return true
  }
  if (evt.type === 'customer.subscription.updated' || evt.type === 'invoice.payment_failed') {
    const subId = evt.type === 'invoice.payment_failed' ? obj.subscription : obj.id
    const status = evt.type === 'invoice.payment_failed' ? 'past_due' : obj.status
    await db.query(`update subscriptions set status = coalesce($2, status), cancel_at_period_end = coalesce($3, cancel_at_period_end), current_period_end = coalesce($4, current_period_end), updated_at = now() where subscription_id = $1`, [subId ?? '', status ?? null, typeof obj.cancel_at_period_end === 'boolean' ? obj.cancel_at_period_end : null, obj.current_period_end ? new Date(obj.current_period_end * 1000) : null])
    return true
  }
  return false
}
async function activate(db: Db, shipperId: string, plan: Plan, session: Row) {
  const { rows } = await db.query<Row>('select session_id, status, plan from subscriptions where shipper_id = $1', [shipperId])
  if (rows[0]?.session_id === session.id && rows[0]?.status === 'active' && rows[0]?.plan === plan) return
  const prices = await planPrices(db)
  let periodEnd = new Date(Date.now() + 30 * 86400000)
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null
  if (subId) { try { const s = await stripe<Row>(`/subscriptions/${subId}`); if (s.current_period_end) periodEnd = new Date(s.current_period_end * 1000) } catch { /* mock or unavailable */ } }
  await setPlan(db, shipperId, plan, { status: 'active', provider: 'stripe', amount: prices[plan], sessionId: session.id, customerId: typeof session.customer === 'string' ? session.customer : null, subscriptionId: subId, periodEnd, kind: 'upgrade', by: 'Stripe' })
  await notifyShipperStaff(db, shipperId, { kind: 'system', title: `You’re on ${PLANS[plan].label}`, body: 'Thanks — the new features are switched on for your whole team.', link: '/dashboard/billing', dedupe: `plan:${shipperId}:${session.id}` }, ['owner', 'finance'])
}

/** Hourly: end canceled subscriptions at period end; warn owners 3 days before a trial ends. */
export async function sweepBilling(db: Db) {
  const { rows: ending } = await db.query<Row>(`select shipper_id from subscriptions where cancel_at_period_end and status <> 'canceled' and current_period_end is not null and current_period_end < now()`)
  for (const s of ending) await setPlan(db, s.shipper_id, 'starter', { kind: 'canceled', by: 'Period ended' })
  const { rows: trials } = await db.query<Row>(`select id, trial_ends_at from shippers where plan = 'starter' and trial_ends_at between now() and now() + interval '3 days' and not demo`)
  for (const t of trials) await notifyShipperStaff(db, t.id, { kind: 'system', title: 'Your Pro trial ends soon', body: `Trial ends ${new Date(t.trial_ends_at).toDateString()}. Choose a plan to keep the branded page, full analytics and campaigns.`, link: '/dashboard/billing', dedupe: `trial:${t.id}` }, ['owner'])
}
export function startBillingSweeps(getDb: () => Promise<Db>) { const run = () => getDb().then(sweepBilling).catch((e) => console.error('[billing]', e)); setTimeout(run, 50_000); setInterval(run, 3600_000) }

const zPlan = z.object({ plan: z.enum(['pro', 'enterprise']) })
const zAdminPlan = z.object({ plan: z.enum(['starter', 'pro', 'enterprise']), trialDays: z.number().int().min(0).max(365).optional(), note: z.string().trim().max(300).default(''), amountUsd: z.number().min(0).max(100000).optional() })

export function mountBilling(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'finance'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and finance only.'); return u }

  r.get('/billing', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows: [s] } = await db.query<Row>('select id, plan, trial_ends_at from shippers where id = $1', [u.shipperId])
    const { rows: [sub] } = await db.query<Row>('select * from subscriptions where shipper_id = $1', [u.shipperId])
    const { rows: [team] } = await db.query<Row>(`select count(*)::int as n from staff where shipper_id = $1 and status in ('active','invited')`, [u.shipperId])
    const { rows: hist } = await db.query<Row>('select * from subscription_events where shipper_id = $1 order by at desc limit 12', [u.shipperId])
    const prices = await planPrices(db); const eff = effectivePlan(s)
    res.json({
      ...eff, prices, online: stripeMode() !== 'off', usage: { team: Number(team?.n ?? 0), teamLimit: PLANS[eff.plan].team },
      plans: PLAN_ORDER.map((p) => ({ key: p, label: PLANS[p].label, priceUsd: prices[p], team: PLANS[p].team, perks: PLANS[p].perks.map((k) => PERK_LABELS[k]), blurb: PLANS[p].blurb })),
      subscription: sub ? { plan: sub.plan, status: sub.status, provider: sub.provider, amountUsd: Number(sub.amount_usd), currentPeriodEnd: ISO(sub.current_period_end), cancelAtPeriodEnd: !!sub.cancel_at_period_end } : null,
      history: hist.map((h) => ({ kind: h.kind, plan: h.plan, amountUsd: Number(h.amount_usd ?? 0), at: ISO(h.at), by: h.by_name })),
    })
  }))
  r.post('/billing/checkout', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const { plan } = zPlan.parse(req.body)
    if (u.staffRole && u.staffRole !== 'owner') throw new HttpError(403, 'Only the owner can change the plan.')
    if (stripeMode() === 'off') throw new HttpError(409, 'Online billing isn’t switched on yet — contact Ship Sync and we’ll change your plan for you.')
    const prices = await planPrices(db); const base = appUrl(req)
    const session = await stripe<Row>('/checkout/sessions', {
      mode: 'subscription', client_reference_id: `sub:${u.shipperId}:${plan}`, customer_email: u.email,
      'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': Math.round(prices[plan] * 100), 'line_items[0][price_data][recurring][interval]': 'month', 'line_items[0][price_data][product_data][name]': `Ship Sync ${PLANS[plan].label}`,
      'metadata[kind]': 'subscription', 'metadata[shipper_id]': u.shipperId!, 'metadata[plan]': plan,
      success_url: `${base}/#/dashboard/billing?session={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/#/dashboard/billing?canceled=1`,
    })
    await db.query(`insert into subscription_events (id,shipper_id,kind,plan,amount_usd,by_name) values ($1,$2,'checkout',$3,$4,$5)`, [evId(), u.shipperId, plan, prices[plan], u.name])
    res.json({ url: session.url, sessionId: session.id })
  }))
  r.get('/billing/confirm', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const sid = String(req.query.session ?? '')
    if (!sid || stripeMode() === 'off') throw new HttpError(400, 'Nothing to confirm.')
    const s = await stripe<Row>(`/checkout/sessions/${encodeURIComponent(sid)}`)
    const [, shipperId, plan] = String(s.client_reference_id ?? '').split(':')
    if (shipperId !== u.shipperId) throw new HttpError(403, 'That checkout belongs to another company.')
    const paid = s.status === 'complete' || s.payment_status === 'paid'
    if (paid && PLAN_ORDER.includes(plan as Plan)) await activate(db, shipperId, plan as Plan, s)
    res.json({ active: paid, plan })
  }))
  r.post('/billing/cancel', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows: [sub] } = await db.query<Row>(`select * from subscriptions where shipper_id = $1 and status <> 'canceled'`, [u.shipperId])
    if (!sub) throw new HttpError(409, 'There is no paid plan to cancel.')
    if (sub.provider === 'stripe' && sub.subscription_id) { try { await stripe(`/subscriptions/${sub.subscription_id}`, { cancel_at_period_end: 'true' }) } catch (e) { console.error('[billing] cancel', e) } }
    const end = sub.current_period_end ?? new Date(Date.now() + 30 * 86400000)
    await db.query('update subscriptions set cancel_at_period_end = true, current_period_end = $2, updated_at = now() where shipper_id = $1', [u.shipperId, end])
    await db.query(`insert into subscription_events (id,shipper_id,kind,plan,by_name) values ($1,$2,'cancel_requested',$3,$4)`, [evId(), u.shipperId, sub.plan, u.name])
    res.json({ ok: true, endsAt: ISO(end) })
  }))
  r.post('/billing/resume', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows: [sub] } = await db.query<Row>(`select * from subscriptions where shipper_id = $1 and status <> 'canceled'`, [u.shipperId]); if (!sub) throw new HttpError(409, 'Nothing to resume.')
    if (sub.provider === 'stripe' && sub.subscription_id) { try { await stripe(`/subscriptions/${sub.subscription_id}`, { cancel_at_period_end: 'false' }) } catch (e) { console.error('[billing] resume', e) } }
    await db.query('update subscriptions set cancel_at_period_end = false, updated_at = now() where shipper_id = $1', [u.shipperId])
    res.json({ ok: true })
  }))

  /* ---------------- admin ---------------- */
  r.get('/admin/billing', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const prices = await planPrices(db)
    const { rows } = await db.query<Row>(`select s.id, s.name, s.plan, s.trial_ends_at, s.demo, s.created_at, b.status, b.provider, b.amount_usd, b.current_period_end, b.cancel_at_period_end, b.started_at, (select count(*)::int from staff st where st.shipper_id = s.id and st.status in ('active','invited')) as team from shippers s left join subscriptions b on b.shipper_id = s.id where s.id <> 'ship-sync-sourcing' order by s.name`)
    const list = rows.map((x) => { const e = effectivePlan(x); const paying = x.plan !== 'starter' && (!x.status || x.status === 'active' || x.status === 'past_due'); const amount = paying ? (x.amount_usd != null && Number(x.amount_usd) > 0 ? Number(x.amount_usd) : prices[x.plan as Plan] ?? 0) : 0
      return { id: x.id, name: x.name, demo: !!x.demo, plan: x.plan, effective: e.plan, trial: e.trial, trialEndsAt: e.trialEndsAt, status: x.status ?? (x.plan === 'starter' ? 'free' : 'manual'), provider: x.provider ?? 'manual', mrr: amount, periodEnd: ISO(x.current_period_end), cancelAtPeriodEnd: !!x.cancel_at_period_end, team: x.team } })
    const { rows: ev } = await db.query<Row>(`select kind, count(*)::int as n, coalesce(sum(amount_usd),0)::float as amt from subscription_events where at > now() - interval '30 days' group by kind`)
    const evs = Object.fromEntries(ev.map((e) => [e.kind, { n: e.n, amount: e.amt }]))
    const mrr = list.reduce((a, x) => a + x.mrr, 0)
    const byPlan = PLAN_ORDER.map((p) => ({ plan: p, label: PLANS[p].label, shippers: list.filter((x) => x.plan === p).length, mrr: list.filter((x) => x.plan === p).reduce((a, x) => a + x.mrr, 0) }))
    const trials = list.filter((x) => x.trial); const soon = trials.filter((x) => x.trialEndsAt && new Date(x.trialEndsAt).getTime() - Date.now() < 7 * 86400000)
    res.json({ prices, online: stripeMode() !== 'off', mrr, arr: mrr * 12, paying: list.filter((x) => x.mrr > 0).length, byPlan, trials: trials.length, trialsEndingSoon: soon.length, churn30: (evs.canceled?.n ?? 0), upgrades30: (evs.upgrade?.n ?? 0) + (evs.change?.n ?? 0), list })
  }))
  r.put('/admin/billing/prices', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const b = z.object({ pro: z.number().min(0).max(10000), enterprise: z.number().min(0).max(100000) }).parse(req.body)
    await db.query(`insert into settings (id,value,updated_at) values ('plans',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(b)])
    void admin; res.json({ prices: await planPrices(db) })
  }))
  r.post('/admin/billing/:id', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const b = zAdminPlan.parse(req.body)
    const { rows } = await db.query<Row>('select id, name from shippers where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Shipper not found.')
    const prices = await planPrices(db)
    await setPlan(db, rows[0].id, b.plan, { status: 'active', provider: 'manual', amount: b.amountUsd ?? prices[b.plan], by: admin.name, kind: 'admin', note: b.note })
    if (b.trialDays != null) await db.query(`update shippers set trial_ends_at = now() + ($2 || ' days')::interval where id = $1`, [rows[0].id, String(b.trialDays)])
    res.json({ ok: true })
  }))

  /* ---------------- feature switches ---------------- */
  r.get('/features', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const flags = await featureMap(db, u.shipperId)
    let plan: ReturnType<typeof effectivePlan> | null = null; let perks: string[] = []
    if (u.shipperId) { const { rows } = await db.query<Row>('select plan, trial_ends_at from shippers where id = $1', [u.shipperId]); if (rows[0]) { plan = effectivePlan(rows[0]); perks = PLANS[plan.plan].perks } }
    res.json({ flags, plan, perks })
  }))
  r.get('/admin/features', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const global = await globalFeatures(db)
    const { rows } = await db.query<Row>(`select id, name, feature_overrides from shippers where feature_overrides::text <> '{}' order by name`)
    res.json({ features: FEATURES.map((f) => ({ ...f, on: global[f.key] !== false })), overrides: rows.map((x) => ({ shipperId: x.id, name: x.name, flags: J(x.feature_overrides) })) })
  }))
  r.put('/admin/features', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = z.object({ key: z.enum(FEATURES.map((f) => f.key) as [string, ...string[]]), on: z.boolean() }).parse(req.body)
    const g = { ...(await globalFeatures(db)), [b.key]: b.on }
    await db.query(`insert into settings (id,value,updated_at) values ('features',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(g)])
    clearFeatureCache(); res.json({ ok: true })
  }))
  r.put('/admin/features/shippers/:id', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const b = z.object({ key: z.enum(FEATURES.map((f) => f.key) as [string, ...string[]]), value: z.boolean().nullable() }).parse(req.body)
    const { rows } = await db.query<Row>('select feature_overrides from shippers where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Shipper not found.')
    const o = { ...(J(rows[0].feature_overrides) ?? {}) }; if (b.value == null) delete o[b.key]; else o[b.key] = b.value
    await db.query('update shippers set feature_overrides = $2 where id = $1', [req.params.id, JSON.stringify(o)])
    clearFeatureCache(); void admin; void audit; res.json({ ok: true, flags: o })
  }))
}
