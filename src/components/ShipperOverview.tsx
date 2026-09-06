import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, Bell, CalendarDays, Clock, FileText, Inbox, Info, MapPinned, Package, Send, Ship, TrendingDown, TrendingUp, Truck, UserPlus, Users, Wallet } from 'lucide-react'
import { insightsApi, type AttentionItem, type Kpi, type Overview, type WeekPoint } from '../lib/insights'
import { fmtDateTime, money } from './ui'
import { fadeUp, stagger } from '../lib/motion'

/* ---------- small pieces ---------- */
function Delta({ d }: { d?: number | null }) {
  if (d == null) return <span className="text-[11px] text-text-muted">new</span>
  if (d === 0) return <span className="text-[11px] text-text-muted">flat vs last 30d</span>
  const up = d > 0
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? 'text-teal' : 'text-danger'}`}>{up ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}{up ? '+' : ''}{d}% <span className="font-normal text-text-muted">vs last 30d</span></span>
}

/** Tiny area sparkline; the last point is emphasised. */
function Spark({ values, color = 'var(--color-gold)' }: { values: number[]; color?: string }) {
  const w = 120, h = 34, max = Math.max(1, ...values), n = values.length
  const pts = values.map((v, i) => [n === 1 ? w : (i / (n - 1)) * w, h - 3 - (v / max) * (h - 8)] as const)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="var(--color-surface)" strokeWidth="2" />
    </svg>
  )
}

function Tile({ label, kpi, format = (v) => String(v), spark, icon: Icon, to }: { label: string; kpi: Kpi; format?: (v: number) => string; spark?: number[]; icon: typeof Inbox; to?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between"><p className="text-sm text-text-muted">{label}</p><Icon size={17} className="text-gold-deep" aria-hidden="true" /></div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div><p className="font-heading text-[2rem] font-bold leading-none tabular-nums">{kpi.value == null ? '—' : format(kpi.value)}</p><p className="mt-1.5 text-xs text-text-muted">{kpi.hint}</p></div>
        {spark && <Spark values={spark} />}
      </div>
      {'delta' in kpi && <div className="mt-2"><Delta d={kpi.delta} /></div>}
    </>
  )
  const cls = 'card-dark block p-5 transition-colors hover:border-gold/40'
  return to ? <Link to={to} className={`${cls} focus-ring`}>{body}</Link> : <div className={cls}>{body}</div>
}

/* ---------- 12-week bar chart: quotes vs won ---------- */
function WeeklyChart({ series }: { series: WeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 200, padL = 28, padB = 26, padT = 10
  const max = Math.max(2, ...series.map((s) => s.quotes))
  const step = (W - padL) / series.length
  const bw = Math.min(22, step * 0.32)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const ticks = useMemo(() => { const t = new Set([0, Math.round(max / 2), max]); return [...t] }, [max])
  const label = (w: string) => new Date(w + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const h = hover != null ? series[hover] : null
  const totals = series.reduce((a, s) => ({ q: a.q + s.quotes, w: a.w + s.won }), { q: 0, w: 0 })
  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-gold" aria-hidden="true" /> Quotes sent <b className="text-text tabular-nums">{totals.q}</b></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-teal" aria-hidden="true" /> Won <b className="text-text tabular-nums">{totals.w}</b></span>
        <span className="ml-auto">Last 12 weeks</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Quotes sent and won per week, last 12 weeks" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeDasharray={t === 0 ? undefined : '2 4'} /><text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">{t}</text></g>)}
        {series.map((s, i) => {
          const x0 = padL + i * step + step / 2
          return (
            <g key={s.week} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
              <rect x={padL + i * step} y={padT} width={step} height={H - padT - padB} fill={hover === i ? 'var(--color-surface-2)' : 'transparent'} />
              <rect x={x0 - bw - 1} y={y(s.quotes)} width={bw} height={Math.max(0, y(0) - y(s.quotes))} rx="3" fill="var(--color-gold)" />
              <rect x={x0 + 1} y={y(s.won)} width={bw} height={Math.max(0, y(0) - y(s.won))} rx="3" fill="var(--color-teal)" />
              {(i % 3 === 0 || i === series.length - 1) && <text x={x0} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{label(s.week)}</text>}
            </g>
          )
        })}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-8 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow-dark)]" style={{ left: `calc(${((padL + hover * step + step / 2) / W) * 100}% - 70px)` }}>
          <p className="font-semibold">Week of {label(h.week)}</p>
          <p className="mt-0.5 text-text-muted"><span className="inline-block h-2 w-2 rounded-sm bg-gold" /> {h.quotes} quote{h.quotes === 1 ? '' : 's'} · <span className="inline-block h-2 w-2 rounded-sm bg-teal" /> {h.won} won · {h.booked} booked{h.invoiced ? ` · ${money(h.invoiced)} invoiced` : ''}</p>
        </div>
      )}
    </div>
  )
}

/* ---------- attention ---------- */
const sevStyle = { critical: 'border-l-danger', warning: 'border-l-gold', info: 'border-l-sky' } as const
const sevIcon = { critical: AlertTriangle, warning: Bell, info: Info } as const
const kindIcon = { lead: Inbox, shipment: Ship, invoice: FileText, run: MapPinned, followup: Bell, vehicle: Truck, profile: Users } as const
function Attention({ items }: { items: AttentionItem[] }) {
  if (!items.length) return <div className="card-dark flex items-center gap-3 p-4 text-sm"><span className="grid h-9 w-9 place-items-center rounded-full bg-teal/15 text-teal"><TrendingUp size={16} aria-hidden="true" /></span><div><p className="font-semibold">All clear</p><p className="text-text-muted">No late shipments, overdue invoices or waiting leads right now.</p></div></div>
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Needs your attention">
      {items.slice(0, 4).map((a, i) => { const Sev = sevIcon[a.severity]; const K = kindIcon[a.kind]; return (
        <li key={i}>
          <Link to={a.to} className={`card-dark flex h-full gap-3 border-l-4 p-4 transition-colors hover:border-gold/40 focus-ring ${sevStyle[a.severity]}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${a.severity === 'critical' ? 'bg-danger/10 text-danger' : a.severity === 'warning' ? 'bg-gold/15 text-gold-deep' : 'bg-sky/10 text-sky'}`}><K size={16} aria-hidden="true" /></span>
            <span className="min-w-0"><span className="flex items-start gap-1.5 text-sm font-semibold leading-tight"><Sev size={12} className="mt-0.5 shrink-0 opacity-70" aria-hidden="true" /><span className="line-clamp-2">{a.title}</span></span><span className="mt-1 line-clamp-2 block text-xs text-text-muted">{a.body}</span></span>
          </Link>
        </li>
      ) })}
    </ul>
  )
}

/* ---------- page section ---------- */
export default function ShipperOverview({ firstName }: { firstName: string }) {
  const [o, setO] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let live = true; insightsApi.overview().then((d) => live && setO(d)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load insights.')); return () => { live = false } }, [])
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  if (error) return <p role="alert" className="mt-6 text-sm text-danger">{error}</p>
  if (!o) return <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl border border-border bg-surface/60" />)}</div>
  const k = o.kpis
  const stageTotal = o.byStatus.reduce((a, s) => a + s.n, 0)
  const critical = o.attention.filter((a) => a.severity === 'critical').length
  const summary = critical ? `${critical} thing${critical === 1 ? '' : 's'} need${critical === 1 ? 's' : ''} attention today.` : o.attention.length ? `${o.attention.length} item${o.attention.length === 1 ? '' : 's'} to look at, nothing urgent.` : 'Everything is on track.'

  return (
    <motion.div initial="hidden" animate="show" variants={stagger} className="mt-8 space-y-8">
      {/* attention */}
      <motion.section variants={fadeUp} aria-labelledby="att-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="att-h" className="!text-lg">{greet}, {firstName}.</h2><p className="text-sm text-text-muted">{summary}</p></div>{o.attention.length > 4 && <span className="text-xs text-text-muted">+{o.attention.length - 4} more below</span>}</div>
        <Attention items={o.attention} />
      </motion.section>

      {/* KPIs */}
      <motion.section variants={fadeUp} aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Invoiced · 30 days" kpi={{ ...k.invoiced, hint: `${money(k.collected.value ?? 0)} collected · ${money(k.outstanding.value ?? 0)} outstanding` }} format={money} spark={o.series.map((s) => s.invoiced)} icon={Wallet} to="/dashboard/clients?filter=owing" />
        <Tile label="Quotes sent · 30 days" kpi={k.quotes} spark={o.series.map((s) => s.quotes)} icon={Send} to="/dashboard/shipper?view=leads" />
        <Tile label="Win rate · 90 days" kpi={k.winRate} format={(v) => `${v}%`} icon={TrendingUp} to="/dashboard/shipper?view=leads" />
        <Tile label="Active shipments" kpi={k.active} spark={o.series.map((s) => s.booked)} icon={Ship} to="/dashboard/shipments" />
      </motion.section>
      <motion.div variants={fadeUp} className="card-dark grid grid-cols-2 divide-x divide-border md:grid-cols-5">
        {[
          { l: 'New leads on your lanes', v: k.leads.value, h: k.leads.hint, i: Inbox, to: '/dashboard/shipper?view=leads' },
          { l: 'Avg first reply', v: k.response.value == null ? '—' : `${k.response.value}h`, h: k.response.hint, i: Clock, to: '/dashboard/shipper?view=leads' },
          { l: 'Delivered · 30 days', v: k.delivered.value, h: k.delivered.hint, i: Package, to: '/dashboard/shipments' },
          { l: 'Collected · 30 days', v: money(k.collected.value ?? 0), h: k.collected.delta != null ? `${k.collected.delta > 0 ? '+' : ''}${k.collected.delta}% vs last 30d` : k.collected.hint, i: Wallet, to: '/dashboard/clients?filter=owing' },
          { l: 'Active clients', v: k.clients.value, h: k.clients.hint, i: Users, to: '/dashboard/clients' },
        ].map((s) => <Link key={s.l} to={s.to} className="flex items-start gap-3 px-4 py-4 hover:bg-surface-2 focus-ring first:rounded-l-[var(--radius-lg)] last:rounded-r-[var(--radius-lg)]"><s.i size={16} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" /><span className="min-w-0"><span className="block text-xs text-text-muted">{s.l}</span><span className="block font-heading text-xl font-bold tabular-nums">{s.v}</span><span className="block truncate text-[11px] text-text-muted">{s.h}</span></span></Link>)}
      </motion.div>

      {/* charts + ops */}
      <div className="grid gap-6 xl:grid-cols-12">
        <motion.section variants={fadeUp} className="card-dark p-5 xl:col-span-7" aria-labelledby="chart-h">
          <div className="mb-1 flex items-center justify-between"><h2 id="chart-h" className="!text-base">Quotes & wins</h2><Link to="/dashboard/shipper?view=leads" className="text-xs text-text-muted hover:text-text focus-ring">Open leads →</Link></div>
          <WeeklyChart series={o.series} />
          <div className="mt-5 grid gap-5 border-t border-border pt-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Pipeline · 30 days</p>
              <ol className="flex items-center gap-2 text-sm">
                {[['Leads', o.pipeline.leads], ['Quoted', o.pipeline.quoted], ['Won', o.pipeline.won]].map(([l, v], i) => <li key={String(l)} className="flex items-center gap-2"><span className={`rounded-lg px-3 py-1.5 ${i === 2 ? 'bg-teal/15 text-teal' : 'bg-surface-2'}`}><b className="tabular-nums">{v}</b> <span className="text-text-muted">{l}</span></span>{i < 2 && <ArrowRight size={13} className="text-text-muted" aria-hidden="true" />}</li>)}
              </ol>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Lanes · 90 days</p>
              {o.lanes.length === 0 ? <p className="text-sm text-text-muted">No shipments yet.</p> : (
                <ul className="space-y-1.5">{o.lanes.slice(0, 4).map((l) => <li key={l.code} className="text-xs"><div className="flex justify-between"><span>{l.name}</span><span className="tabular-nums text-text-muted">{l.n} · {l.share}%</span></div><div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${l.share}%` }} /></div></li>)}</ul>
              )}
            </div>
          </div>
          {stageTotal > 0 && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Shipments by stage</p>
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={o.byStatus.filter((s) => s.n).map((s) => `${s.label}: ${s.n}`).join(', ')}>
                {o.byStatus.filter((s) => s.n).map((s, i, arr) => <div key={s.status} title={`${s.label}: ${s.n}`} style={{ width: `${(s.n / stageTotal) * 100}%`, background: s.status === 'delivered' ? 'var(--color-teal)' : `color-mix(in srgb, var(--color-gold) ${45 + Math.round((i / Math.max(1, arr.length - 1)) * 55)}%, var(--color-surface-2))`, marginRight: i < arr.length - 1 ? 2 : 0 }} />)}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">{o.byStatus.filter((s) => s.n).map((s) => <li key={s.status}><b className="text-text tabular-nums">{s.n}</b> {s.label}</li>)}</ul>
            </div>
          )}
        </motion.section>

        <div className="space-y-6 xl:col-span-5">
          <motion.section variants={fadeUp} className="card-dark p-5" aria-labelledby="ops-h">
            <div className="mb-3 flex items-center justify-between"><h2 id="ops-h" className="!text-base">Today’s operations</h2><Link to="/dashboard/routes" className="text-xs text-text-muted hover:text-text focus-ring">Routes →</Link></div>
            {o.ops.runsToday.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-text-muted">No runs on the road today. <Link to="/dashboard/routes/new" className="text-gold-deep hover:underline">Plan one →</Link></p> : (
              <ul className="space-y-2">{o.ops.runsToday.map((r) => <li key={r.id}><Link to={`/dashboard/routes/${r.id}`} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:border-gold/40 focus-ring"><span className={`grid h-8 w-8 place-items-center rounded-lg ${r.kind === 'pickup' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold-deep'}`}><MapPinned size={15} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.name}</span><span className="block text-xs text-text-muted">{r.driver ?? 'No driver'} · {r.pending} of {r.stops} stops left · {r.status === 'in_progress' ? 'on the road' : 'planned'}</span></span></Link></li>)}</ul>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <Link to="/dashboard/fleet" className="rounded-lg bg-surface-2 px-2 py-2.5 hover:bg-surface-2/70 focus-ring"><dt className="text-text-muted">Vehicles free</dt><dd className="font-heading text-lg font-bold tabular-nums">{o.ops.vehicles.available}<span className="text-xs font-normal text-text-muted">/{o.ops.vehicles.total}</span></dd></Link>
              <Link to="/dashboard/team" className="rounded-lg bg-surface-2 px-2 py-2.5 hover:bg-surface-2/70 focus-ring"><dt className="text-text-muted">Drivers active</dt><dd className="font-heading text-lg font-bold tabular-nums">{o.ops.team.drivers}</dd></Link>
              <Link to="/dashboard/clients" className="rounded-lg bg-surface-2 px-2 py-2.5 hover:bg-surface-2/70 focus-ring"><dt className="text-text-muted">Follow-ups due</dt><dd className={`font-heading text-lg font-bold tabular-nums ${o.ops.followupsDue ? 'text-gold-deep' : ''}`}>{o.ops.followupsDue}</dd></Link>
            </dl>
          </motion.section>

          <motion.section variants={fadeUp} className="card-dark p-5" aria-labelledby="qa-h">
            <h2 id="qa-h" className="mb-3 !text-base">Quick actions</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { to: '/dashboard/routes/new', l: 'Plan a run', i: MapPinned }, { to: '/dashboard/clients?new=1', l: 'Add a client', i: UserPlus },
                { to: '/dashboard/team', l: 'Invite teammate', i: Users }, { to: '/dashboard/fleet', l: 'Add a vehicle', i: Truck },
                { to: '/dashboard/shipments', l: 'Update a shipment', i: Ship }, { to: '/dashboard/shipper?view=profile', l: 'Edit profile', i: FileText },
              ].map((a) => <Link key={a.l} to={a.to} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 hover:border-gold/40 hover:bg-surface-2 focus-ring"><a.i size={15} className="text-gold-deep" aria-hidden="true" /> {a.l}</Link>)}
            </div>
          </motion.section>
        </div>
      </div>

      {/* leads + activity */}
      <div className="grid gap-6 xl:grid-cols-12">
        <motion.section variants={fadeUp} className="card-dark p-5 xl:col-span-7" aria-labelledby="leads2-h">
          <div className="mb-3 flex items-center justify-between"><h2 id="leads2-h" className="!text-base">Leads waiting on your lanes</h2><Link to="/dashboard/shipper?view=leads" className="text-xs text-text-muted hover:text-text focus-ring">All leads →</Link></div>
          {o.leads.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-text-muted">No open requests you haven’t quoted. New ones appear here the moment a customer posts them.</p> : (
            <ul className="divide-y divide-border">{o.leads.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{l.origin} → {l.destination} · {l.cargo}</span><span className="block text-xs text-text-muted">{l.contact} · {fmtDateTime(l.createdAt)} · {l.competing} competing quote{l.competing === 1 ? '' : 's'}</span></span><Link to="/dashboard/shipper?view=leads" className="btn-gold !min-h-9 !px-3 text-xs"><Send size={13} aria-hidden="true" /> Quote</Link></li>)}</ul>
          )}
        </motion.section>
        <motion.section variants={fadeUp} className="card-dark p-5 xl:col-span-5" aria-labelledby="act-h">
          <div className="mb-3 flex items-center justify-between"><h2 id="act-h" className="!text-base">Recent activity</h2><Link to="/dashboard/clients" className="text-xs text-text-muted hover:text-text focus-ring">Clients →</Link></div>
          {o.activity.length === 0 ? <p className="text-sm text-text-muted">Nothing logged yet.</p> : (
            <ul className="space-y-2.5">{o.activity.map((a) => <li key={a.id} className="flex gap-3 text-sm"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" /><span className="min-w-0"><span className="line-clamp-2">{a.body}</span><span className="block text-[11px] text-text-muted"><Link to={`/dashboard/clients/${a.clientId}`} className="hover:text-text">{a.clientName}</Link> · {fmtDateTime(a.at)}</span></span></li>)}</ul>
          )}
        </motion.section>
      </div>
      <motion.p variants={fadeUp} className="flex items-center gap-1.5 text-[11px] text-text-muted"><CalendarDays size={12} aria-hidden="true" /> 30-day figures compare with the previous 30 days. Win rate and response time use the last 90 days.</motion.p>
    </motion.div>
  )
}
