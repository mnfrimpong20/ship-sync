import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Bell, BadgeDollarSign, Boxes, CheckCircle2, Clock, Globe2, Info, Landmark, Lock, RefreshCw, Ship, TrendingUp, Users } from 'lucide-react'
import { api } from '../lib/store'
import { countryByCode } from '../lib/data'
import { Pill, fmtDateTime, Flag } from './ui'
import { Spark } from './ShipperOverview'

/* ---------- types ---------- */
type WeekPoint = { week: string; count: number }
export interface Business {
  realOnly: boolean
  revenue: { takeRate: { all: number; last30: number }; sourcingFees: { all: number; last30: number }; sourcingGoods: { all: number; last30: number }; subscriptionsMrr: number; planCounts: Record<string, number>; gmv: { all: number; last30: number }; refunded: number; totalLast30: number }
  escrow: { heldGross: number; heldNet: number; onHold: number; heldCount: number; availableToShippers: number; payoutsRequested: number; payoutsRequestedCount: number; payoutsPaid30: number }
  series: { signups: WeekPoint[]; shipperSignups: WeekPoint[]; requests: WeekPoint[]; bookings: WeekPoint[]; sourcing: WeekPoint[]; gmv: WeekPoint[] }
  funnel: { requests: number; quoted: number; booked: number; quotesPerRequest: number; hoursToFirstQuote: number; quoteRatePct: number; bookRatePct: number }
  demand: { destinations: { destination: string; requests: number; shippersQuoting: number }[]; lanes: { origin: string; destination: string; mode: string; requests: number; unquoted: number }[]; modes: Record<string, number> }
  sourcing: { open: number; valueUsd: number; byStage: { stage: string; count: number }[]; agentOwedUsd: number; agentPaidUsd: number }
  shippers: { total: number; verified: number; new30: number; active30: number }
  customers: { total: number; new30: number; bookedEver: number }
  reviews: { last90: number; avg: number }
  generatedAt: string
}
export interface Exception { kind: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; link: string; since: string; id: string }

export const adminApi = {
  business: () => api<Business>('/admin/business'),
  exceptions: () => api<{ exceptions: Exception[]; counts: { high: number; medium: number; low: number }; generatedAt: string }>('/admin/exceptions'),
}

const money = (v: number) => `$${Math.round(v).toLocaleString()}`
const errMsg = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)

/** Twelve weeks, filled in so a quiet week shows as zero rather than vanishing. */
function fill(points: WeekPoint[]) {
  const out: number[] = []; const now = new Date(); now.setUTCHours(0, 0, 0, 0); now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - i * 7); const k = d.toISOString().slice(0, 10); out.push(points.find((p) => p.week === k)?.count ?? 0) }
  return out
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

/* ---------- business overview ---------- */
export function AdminBusiness() {
  const [b, setB] = useState<Business | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { adminApi.business().then(setB).catch((e) => setErr(errMsg(e, 'Could not load.'))) }, [])
  const s = useMemo(() => (b ? { signups: fill(b.series.signups), shippers: fill(b.series.shipperSignups), requests: fill(b.series.requests), bookings: fill(b.series.bookings), sourcing: fill(b.series.sourcing), gmv: fill(b.series.gmv) } : null), [b])
  if (err) return <p role="alert" className="mt-6 text-sm text-danger">{err}</p>
  if (!b || !s) return <p className="mt-6 text-sm text-text-muted">Loading the numbers…</p>
  const last4 = (a: number[]) => sum(a.slice(-4)); const prev4 = (a: number[]) => sum(a.slice(-8, -4))
  const delta = (a: number[]) => { const l = last4(a), p = prev4(a); return p === 0 ? null : Math.round(((l - p) / p) * 100) }
  const Delta = ({ a }: { a: number[] }) => { const d = delta(a); if (d == null) return <span className="text-[11px] text-text-muted">4-week total</span>; return <span className={`text-[11px] font-semibold ${d >= 0 ? 'text-teal' : 'text-danger'}`}>{d >= 0 ? '+' : ''}{d}% <span className="font-normal text-text-muted">vs prior 4 weeks</span></span> }
  const Tile = ({ label, value, hint, spark, icon: Icon, to, tone }: { label: string; value: string; hint?: React.ReactNode; spark?: number[]; icon: typeof Users; to?: string; tone?: 'gold' | 'teal' | 'sky' }) => {
    const color = tone === 'teal' ? 'var(--color-teal)' : tone === 'sky' ? 'var(--color-sky)' : 'var(--color-gold)'
    const body = <><div className="flex items-center justify-between"><p className="text-sm text-text-muted">{label}</p><Icon size={17} className="text-gold-deep" aria-hidden="true" /></div><div className="mt-2 flex items-end justify-between gap-3"><p className="font-heading text-[1.9rem] font-bold leading-none tabular-nums">{value}</p>{spark && <Spark values={spark} color={color} />}</div>{hint && <div className="mt-2 text-xs text-text-muted">{hint}</div>}</>
    const cls = 'card-dark block h-full p-5 transition-colors hover:border-gold/40'
    return to ? <Link to={to} className={`${cls} focus-ring`}>{body}</Link> : <div className={cls}>{body}</div>
  }
  const maxDest = Math.max(1, ...b.demand.destinations.map((d) => d.requests))
  const stageTotal = Math.max(1, b.sourcing.open)
  return (
    <div className="mt-8" data-testid="admin-business">
      {!b.realOnly && <p className="mb-4 rounded-lg bg-surface-2 px-4 py-2.5 text-xs text-text-muted"><Info size={13} className="mr-1 inline" aria-hidden="true" /> Demo shippers and demo accounts are included in these numbers. Set <span className="font-mono text-text">HIDE_DEMO_SHIPPERS=true</span> and only the real business is counted.</p>}

      <h3 className="eyebrow mb-3">Revenue</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Tile label="Revenue · last 30 days" value={money(b.revenue.totalLast30)} icon={BadgeDollarSign} hint={<>{money(b.revenue.takeRate.last30)} take-rate · {money(b.revenue.sourcingFees.last30)} sourcing fees · {money(b.revenue.subscriptionsMrr)} plans</>} />
        <Tile label="Platform GMV · 30 days" value={money(b.revenue.gmv.last30)} icon={TrendingUp} spark={s.gmv} hint={<Delta a={s.gmv} />} tone="teal" />
        <Tile label="Subscriptions (MRR)" value={money(b.revenue.subscriptionsMrr)} icon={Landmark} hint={<>{b.revenue.planCounts.enterprise ?? 0} enterprise · {b.revenue.planCounts.pro ?? 0} pro · {b.revenue.planCounts.starter ?? 0} starter — set by plan, not yet billed in-app</>} to="/admin?view=shippers" />
        <Tile label="Sourcing goods billed · 30 days" value={money(b.revenue.sourcingGoods.last30)} icon={Globe2} spark={s.sourcing} hint={<>{b.sourcing.open} open job{b.sourcing.open === 1 ? '' : 's'} worth ~{money(b.sourcing.valueUsd)} · agents owed {money(b.sourcing.agentOwedUsd)}</>} to="/admin?view=sourcing" tone="sky" />
      </div>

      <h3 className="eyebrow mb-3 mt-8">Money we hold</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Tile label="In escrow now" value={money(b.escrow.heldGross)} icon={Lock} hint={<>{b.escrow.heldCount} payment{b.escrow.heldCount === 1 ? '' : 's'} · {money(b.escrow.heldNet)} owed to shippers on release{b.escrow.onHold > 0 && <> · <span className="text-danger">{money(b.escrow.onHold)} on hold</span></>}</>} to="/admin?view=payments" />
        <Tile label="Released, not yet paid out" value={money(b.escrow.availableToShippers)} icon={Clock} hint="Sitting in shipper balances — they can request it any time." to="/admin?view=payments" />
        <Tile label="Payouts requested" value={money(b.escrow.payoutsRequested)} icon={ArrowRight} hint={<>{b.escrow.payoutsRequestedCount} waiting · {money(b.escrow.payoutsPaid30)} paid in the last 30 days</>} to="/admin?view=payments" />
        <Tile label="Refunded (all time)" value={money(b.revenue.refunded)} icon={AlertTriangle} hint={<>Take-rate earned all time: {money(b.revenue.takeRate.all)}</>} />
      </div>

      <h3 className="eyebrow mb-3 mt-8">Growth · last 12 weeks</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Tile label="Customer signups" value={String(last4(s.signups))} icon={Users} spark={s.signups} hint={<Delta a={s.signups} />} />
        <Tile label="New shippers" value={String(last4(s.shippers))} icon={Ship} spark={s.shippers} hint={<Delta a={s.shippers} />} to="/admin?view=shippers" tone="teal" />
        <Tile label="Quote requests" value={String(last4(s.requests))} icon={Boxes} spark={s.requests} hint={<Delta a={s.requests} />} />
        <Tile label="Bookings" value={String(last4(s.bookings))} icon={CheckCircle2} spark={s.bookings} hint={<Delta a={s.bookings} />} tone="sky" />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <div className="card-dark p-5">
          <h3 className="font-semibold">Request → quote → booking <span className="text-xs font-normal text-text-muted">· 90 days</span></h3>
          <ol className="mt-4 space-y-3" aria-label="Funnel">
            {[['Requests posted', b.funnel.requests, 100], ['Got at least one quote', b.funnel.quoted, b.funnel.quoteRatePct], ['Booked', b.funnel.booked, b.funnel.requests ? Math.round((b.funnel.booked / b.funnel.requests) * 100) : 0]].map(([l, v, pct]) => (
              <li key={String(l)}><div className="flex items-baseline justify-between text-sm"><span>{l}</span><span className="tabular-nums"><b>{v}</b> <span className="text-xs text-text-muted">{pct}%</span></span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div></li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-text-muted">{b.funnel.quotesPerRequest} quotes per request on average · first quote after {b.funnel.hoursToFirstQuote < 48 ? `${Math.round(b.funnel.hoursToFirstQuote)}h` : `${Math.round(b.funnel.hoursToFirstQuote / 24)}d`} · {b.funnel.bookRatePct}% of quoted requests book</p>
        </div>
        <div className="card-dark p-5">
          <h3 className="font-semibold">Where demand is <span className="text-xs font-normal text-text-muted">· requests, 90 days</span></h3>
          <ul className="mt-4 space-y-2.5" aria-label="Destinations">
            {b.demand.destinations.map((d) => (
              <li key={d.destination}><div className="flex items-baseline justify-between text-sm"><span><Flag code={d.destination} /> {countryByCode(d.destination)?.name ?? d.destination}</span><span className="tabular-nums text-xs text-text-muted"><b className="text-sm text-text">{d.requests}</b> · {d.shippersQuoting} shipper{d.shippersQuoting === 1 ? '' : 's'} quoting</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-teal" style={{ width: `${(d.requests / maxDest) * 100}%` }} /></div></li>
            ))}
            {b.demand.destinations.length === 0 && <li className="text-sm text-text-muted">No requests in the last 90 days.</li>}
          </ul>
          <p className="mt-3 text-xs text-text-muted">{Object.entries(b.demand.modes).map(([m, c]) => `${c} ${m}`).join(' · ')}</p>
        </div>
        <div className="card-dark p-5">
          <h3 className="font-semibold">Busiest lanes <span className="text-xs font-normal text-text-muted">· and gaps</span></h3>
          <ul className="mt-4 divide-y divide-border" aria-label="Lanes">
            {b.demand.lanes.slice(0, 8).map((l) => (
              <li key={`${l.origin}${l.destination}${l.mode}`} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="min-w-0 truncate">{l.origin} → {countryByCode(l.destination)?.name ?? l.destination} <span className="text-xs text-text-muted">{l.mode}</span></span><span className="shrink-0 tabular-nums text-xs text-text-muted"><b className="text-sm text-text">{l.requests}</b>{l.unquoted > 0 && <span className="ml-2 text-danger">{l.unquoted} unquoted</span>}</span></li>
            ))}
            {b.demand.lanes.length === 0 && <li className="py-2 text-sm text-text-muted">Nothing yet.</li>}
          </ul>
          <p className="mt-3 text-xs text-text-muted">Lanes with unquoted requests are where you need to recruit shippers.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card-dark p-5">
          <h3 className="font-semibold">Shippers</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-text-muted">Listed</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.shippers.total}</dd></div>
            <div><dt className="text-xs text-text-muted">Verified</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.shippers.verified}</dd></div>
            <div><dt className="text-xs text-text-muted">Quoted in last 30d</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.shippers.active30}</dd></div>
            <div><dt className="text-xs text-text-muted">Joined in last 30d</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.shippers.new30}</dd></div>
          </dl>
        </div>
        <div className="card-dark p-5">
          <h3 className="font-semibold">Customers</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-text-muted">Accounts</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.customers.total}</dd></div>
            <div><dt className="text-xs text-text-muted">Have booked</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.customers.bookedEver}</dd></div>
            <div><dt className="text-xs text-text-muted">Joined in last 30d</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.customers.new30}</dd></div>
            <div><dt className="text-xs text-text-muted">Reviews · 90d</dt><dd className="font-heading text-xl font-bold tabular-nums">{b.reviews.last90} <span className="text-sm font-normal text-text-muted">avg {b.reviews.avg || '—'}</span></dd></div>
          </dl>
        </div>
        <div className="card-dark p-5">
          <h3 className="font-semibold">Sourcing pipeline <span className="text-xs font-normal text-text-muted">· {b.sourcing.open} open</span></h3>
          <ul className="mt-3 space-y-1.5" aria-label="Sourcing stages">
            {b.sourcing.byStage.map((st) => <li key={st.stage} className="flex items-center gap-2 text-xs"><span className="w-28 shrink-0 truncate capitalize text-text-muted">{st.stage.replace(/_/g, ' ')}</span><span className="h-2 rounded-full bg-sky" style={{ width: `${Math.max(4, (st.count / stageTotal) * 100)}%` }} /><span className="tabular-nums">{st.count}</span></li>)}
            {b.sourcing.byStage.length === 0 && <li className="text-sm text-text-muted">No open sourcing jobs.</li>}
          </ul>
          <p className="mt-3 text-xs text-text-muted">Agents paid {money(b.sourcing.agentPaidUsd)} · owed {money(b.sourcing.agentOwedUsd)}</p>
        </div>
      </div>
      <p className="mt-4 text-[11px] text-text-muted">Computed live from the database at {fmtDateTime(b.generatedAt)}.</p>
    </div>
  )
}

/* ---------- attention board ---------- */
const KIND_LABEL: Record<string, string> = { unquoted_request: 'No quote', late_shipment: 'Past ETA', stale_shipment: 'No update', escrow_waiting: 'Escrow waiting', escrow_on_hold: 'Escrow on hold', dispute: 'Dispute', payout_waiting: 'Payout', verification: 'Verification', sourcing: 'Sourcing', contact: 'Contact form', errors: 'Errors' }
const sevCls = { high: 'border-l-danger', medium: 'border-l-gold', low: 'border-l-sky' } as const
const sevIcon = { high: AlertTriangle, medium: Bell, low: Info } as const

export function AdminAttention() {
  const [d, setD] = useState<Awaited<ReturnType<typeof adminApi.exceptions>> | null>(null)
  const [err, setErr] = useState('')
  const [kind, setKind] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => { setBusy(true); return adminApi.exceptions().then(setD).catch((e) => setErr(errMsg(e, 'Could not load.'))).finally(() => setBusy(false)) }
  useEffect(() => { load() }, [])
  if (err) return <p role="alert" className="mt-6 text-sm text-danger">{err}</p>
  if (!d) return <p className="mt-6 text-sm text-text-muted">Looking across the platform…</p>
  const kinds = [...new Set(d.exceptions.map((e) => e.kind))]
  const list = d.exceptions.filter((e) => !kind || e.kind === kind)
  return (
    <div className="mt-8" data-testid="admin-attention">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={d.counts.high ? 'danger' : 'muted'}>{d.counts.high} urgent</Pill><Pill tone={d.counts.medium ? 'gold' : 'muted'}>{d.counts.medium} soon</Pill><Pill tone="muted">{d.counts.low} minor</Pill>
        <button onClick={() => setKind('')} aria-pressed={!kind} className={`ml-2 rounded-full border px-3 py-1 text-xs focus-ring ${!kind ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>All</button>
        {kinds.map((k) => <button key={k} onClick={() => setKind(k === kind ? '' : k)} aria-pressed={kind === k} className={`rounded-full border px-3 py-1 text-xs focus-ring ${kind === k ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{KIND_LABEL[k] ?? k} ({d.exceptions.filter((e) => e.kind === k).length})</button>)}
        <button onClick={load} disabled={busy} className="btn-ghost ml-auto !min-h-8 !px-2.5 text-xs"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden="true" /> Refresh</button>
      </div>
      {list.length === 0 ? (
        <div className="card-dark mt-5 flex items-center gap-3 p-5"><span className="grid h-10 w-10 place-items-center rounded-full bg-teal/15 text-teal"><CheckCircle2 size={18} aria-hidden="true" /></span><div><p className="font-semibold">All clear</p><p className="text-sm text-text-muted">Nothing on the platform is stuck or waiting on a person right now.</p></div></div>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2" aria-label="Needs attention">
          {list.map((e) => { const Sev = sevIcon[e.severity]; return (
            <li key={`${e.kind}:${e.id}`}>
              <Link to={e.link} className={`card-dark flex h-full gap-3 border-l-4 p-4 transition-colors hover:border-gold/40 focus-ring ${sevCls[e.severity]}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${e.severity === 'high' ? 'bg-danger/10 text-danger' : e.severity === 'medium' ? 'bg-gold/15 text-gold-deep' : 'bg-sky/10 text-sky'}`}><Sev size={16} aria-hidden="true" /></span>
                <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><Pill tone="muted">{KIND_LABEL[e.kind] ?? e.kind}</Pill><span className="text-[11px] text-text-muted">since {fmtDateTime(e.since)}</span></span><span className="mt-1 block text-sm font-semibold leading-tight">{e.title}</span><span className="mt-1 block text-xs text-text-muted">{e.detail}</span></span>
              </Link>
            </li>
          ) })}
        </ul>
      )}
      <p className="mt-4 text-[11px] text-text-muted">Rules: requests unquoted after 48h · shipments 2+ days past ETA or 10 days without an event · escrow held 45+ days, on hold, or after delivery · disputes idle 3+ days · payouts waiting 3+ days · shippers unverified 3+ days · sourcing jobs unassigned 24h, quotes unanswered 7 days, no movement 14 days · contact messages unanswered 24h · unresolved errors.</p>
    </div>
  )
}
