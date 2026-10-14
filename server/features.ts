/**
 * Feature switches and plans.
 *   Switches: a global on/off per feature (settings.features) plus per-shipper overrides
 *   (shippers.feature_overrides). featureOn(db, key, shipperId) is what the code checks.
 *   Plans: Starter / Pro / Enterprise with perks; a trial gives Pro perks. hasPerk() checks them.
 */
import type { Db } from './db'

type Row = Record<string, any>
export const FEATURES = [
  { key: 'autoQuotes', label: 'Instant quotes from rate cards', body: 'Rate cards with auto-send reply to matching requests in seconds.' },
  { key: 'whatsapp', label: 'WhatsApp to recipients', body: 'Recipient messages try WhatsApp first, then fall back to SMS.' },
  { key: 'insurance', label: 'Cargo insurance', body: 'Clients can buy cover at booking; shippers earn commission.' },
  { key: 'groupage', label: 'Shared barrels & containers', body: 'Shippers can open shared space and clients can reserve it.' },
  { key: 'analytics', label: 'Analytics page', body: 'The shipper analytics page and insights.' },
  { key: 'weeklyReport', label: 'Monday report', body: 'The weekly email / WhatsApp summary to owners.' },
  { key: 'campaigns', label: 'Win-back campaigns', body: 'Bulk messages to clients by email, SMS or WhatsApp.' },
  { key: 'webhooks', label: 'Webhooks', body: 'Signed status events sent to shippers’ own systems.' },
  { key: 'trackingWidget', label: 'Tracking widget', body: 'The embeddable tracking box for shippers’ websites.' },
] as const
export type FeatureKey = (typeof FEATURES)[number]['key']

let cache: { at: number; global: Record<string, boolean>; over: Map<string, Record<string, boolean>> } | null = null
export const clearFeatureCache = () => { cache = null }
async function load(db: Db) {
  if (cache && Date.now() - cache.at < 20_000) return cache
  const { rows } = await db.query<Row>(`select value from settings where id = 'features'`)
  const global: Record<string, boolean> = typeof rows[0]?.value === 'string' ? JSON.parse(rows[0].value) : rows[0]?.value ?? {}
  const { rows: o } = await db.query<Row>(`select id, feature_overrides from shippers where feature_overrides is not null and feature_overrides::text <> '{}'`)
  cache = { at: Date.now(), global, over: new Map(o.map((x) => [x.id, typeof x.feature_overrides === 'string' ? JSON.parse(x.feature_overrides) : x.feature_overrides])) }
  return cache
}
export async function featureOn(db: Db, key: FeatureKey, shipperId?: string | null) {
  const c = await load(db)
  const o = shipperId ? c.over.get(shipperId)?.[key] : undefined
  if (typeof o === 'boolean') return o
  return c.global[key] !== false
}
export async function featureMap(db: Db, shipperId?: string | null) {
  const out: Record<string, boolean> = {}; for (const f of FEATURES) out[f.key] = await featureOn(db, f.key, shipperId); return out
}
export async function globalFeatures(db: Db) { return (await load(db)).global }

/* ---------------- plans ---------------- */
export type Plan = 'starter' | 'pro' | 'enterprise'
export type Perk = 'brand' | 'campaigns' | 'webhooks' | 'fullAnalytics' | 'accountingExport' | 'loadPlanner'
export const PLAN_ORDER: Plan[] = ['starter', 'pro', 'enterprise']
export const PLANS: Record<Plan, { label: string; priceUsd: number; team: number | null; perks: Perk[]; blurb: string }> = {
  starter: { label: 'Starter', priceUsd: 0, team: 3, perks: [], blurb: 'Requests, quotes, shipments, invoices and tracking. Up to 3 team members.' },
  pro: { label: 'Pro', priceUsd: 149, team: 15, perks: ['brand', 'campaigns', 'fullAnalytics', 'accountingExport', 'loadPlanner'], blurb: 'Branded page, full analytics, campaigns, load planner and accounting export. Up to 15 team members.' },
  enterprise: { label: 'Enterprise', priceUsd: 499, team: null, perks: ['brand', 'campaigns', 'fullAnalytics', 'accountingExport', 'loadPlanner', 'webhooks'], blurb: 'Everything in Pro plus webhooks, unlimited team and featured placement in the directory.' },
}
export const PERK_LABELS: Record<Perk, string> = { brand: 'Branded page', campaigns: 'Win-back campaigns', webhooks: 'Webhooks', fullAnalytics: 'Full analytics', accountingExport: 'Accounting export', loadPlanner: 'Container load planner' }
export async function planPrices(db: Db): Promise<Record<Plan, number>> {
  const { rows } = await db.query<Row>(`select value from settings where id = 'plans'`)
  const v = (typeof rows[0]?.value === 'string' ? JSON.parse(rows[0].value) : rows[0]?.value) ?? {}
  return { starter: 0, pro: Number(v.pro ?? PLANS.pro.priceUsd), enterprise: Number(v.enterprise ?? PLANS.enterprise.priceUsd) }
}
/** Plan in force, counting a running trial as Pro. */
export function effectivePlan(s: Row): { plan: Plan; billed: Plan; trial: boolean; trialEndsAt: string | null } {
  const billed = (PLAN_ORDER.includes(s.plan) ? s.plan : 'starter') as Plan
  const ends = s.trial_ends_at ? new Date(s.trial_ends_at).getTime() : null
  const trial = billed === 'starter' && (ends == null || ends > Date.now())
  return { plan: trial ? 'pro' : billed, billed, trial, trialEndsAt: ends ? new Date(ends).toISOString() : null }
}
export async function hasPerk(db: Db, shipperId: string, perk: Perk) {
  const { rows } = await db.query<Row>('select plan, trial_ends_at from shippers where id = $1', [shipperId]); if (!rows[0]) return false
  return PLANS[effectivePlan(rows[0]).plan].perks.includes(perk)
}
export async function requirePerk(db: Db, shipperId: string, perk: Perk, Err: new (status: number, message: string) => Error) {
  if (!(await hasPerk(db, shipperId, perk))) { const need = PLAN_ORDER.find((p) => PLANS[p].perks.includes(perk)) ?? 'pro'; throw new Err(402, `${PERK_LABELS[perk]} is part of the ${PLANS[need].label} plan. Upgrade under Plan & billing.`) }
}
