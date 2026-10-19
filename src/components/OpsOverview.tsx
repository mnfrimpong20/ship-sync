/** Operations overview — the "Operations" tab on the shipper overview and "Activity & spending" in the customer portal.
 *  Four headline tiles (vs the previous period), a volume chart (shipments or money), the status split, recent activity
 *  and an action list. Chart colours come from the validated --viz-* tokens in index.css. */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, CalendarRange, Container, Info, Package, Ship, Star, Truck, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { operationsApi, rangeLabels, type Operations, type OpsKpi, type OpsRange } from '../lib/operations'
import { money, fmtDateTime } from './ui'
import { fadeUp, stagger } from '../lib/motion'

const SLOT: Record<string, string> = { pickup: 'var(--viz-1)', origin: 'var(--viz-2)', transit: 'var(--viz-4)', destination: 'var(--viz-5)', delivered: 'var(--viz-3)' }
const RANGE_KEY = 'ss-ops-range'

function Tile({ label, value, sub, icon: Icon, kpi, testid }: { label: string; value: string; sub: string; icon: LucideIcon; kpi?: OpsKpi; testid?: string }) {
  const d = kpi?.delta
  return (
    <motion.div variants={fadeUp} className="card-dark p-5" data-testid={testid}>
      <div className="flex items-center gap-2 text-sm text-text-muted"><span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2"><Icon size={16} aria-hidden="true" /></span>{label}</div>
      <p className="mt-3 font-heading text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{sub}</p>
      {kpi && <p className="mt-1 text-xs">{d == null ? <span className="text-text-muted">{kpi.prev ? 'Same as before' : 'No activity in the period before'}</span> : <span className={d >= 0 ? 'text-teal' : 'text-danger'}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% <span className="text-text-muted">vs the period before</span></span>}</p>}
    </motion.div>
  )
}

/** Single-series bar chart with gridlines, rounded data-ends and a hover tooltip. */
function Bars({ data, bucket, kind }: { data: Operations['series']; bucket: 'week' | 'month'; kind: 'shipments' | 'usd' }) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = data.map((d) => (kind === 'usd' ? d.usd : d.shipments))
  const max = Math.max(1, ...vals)
  const step0 = (() => { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p })()
  const step = kind === 'shipments' ? Math.max(1, Math.round(step0)) : step0
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const W = 640, H = 220, L = 44, B = 26, T = 8, plotW = W - L - 8, plotH = H - B - T
  const bw = plotW / Math.max(1, data.length)
  const fmt = (v: number) => (kind === 'usd' ? (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`) : String(v))
  const lab = (s: string) => { const d = new Date(s + 'T12:00:00Z'); return bucket === 'month' ? d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
  const every = Math.max(1, Math.ceil(data.length / 8))
  if (!vals.some((v) => v > 0)) return <p className="grid h-[220px] place-items-center text-sm text-text-muted">Nothing in this period yet.</p>
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${kind === 'usd' ? 'Money' : 'Shipments'} per ${bucket}: ${data.map((d, i) => `${lab(d.start)} ${fmt(vals[i])}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => { const y = T + plotH - (t / top) * plotH; return <g key={t}><line x1={L} x2={W - 8} y1={y} y2={y} stroke="var(--viz-grid)" /><text x={L - 6} y={y + 4} textAnchor="end" className="fill-[var(--color-text-muted)] text-[11px]">{fmt(t)}</text></g> })}
        {data.map((d, i) => {
          const v = vals[i]; const h = (v / top) * plotH; const x = L + i * bw; const w = Math.max(4, Math.min(42, bw - 6)); const cx = x + (bw - w) / 2; const y = T + plotH - h
          return (
            <g key={d.start} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={T} width={bw} height={plotH} fill="transparent" />
              {v > 0 && <path d={`M${cx},${T + plotH} L${cx},${y + Math.min(4, h)} Q${cx},${y} ${cx + Math.min(4, w / 2)},${y} L${cx + w - Math.min(4, w / 2)},${y} Q${cx + w},${y} ${cx + w},${y + Math.min(4, h)} L${cx + w},${T + plotH} Z`} fill="var(--viz-1)" opacity={hover == null || hover === i ? 1 : 0.45} />}
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-[var(--color-text-muted)] text-[11px]">{lab(d.start)}</text>}
            </g>
          )
        })}
        <line x1={L} x2={W - 8} y1={T + plotH} y2={T + plotH} stroke="var(--color-border)" />
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%`, top: 0 }} role="status">
          <p className="font-semibold">{bucket === 'week' ? `Week of ${lab(data[hover].start)}` : new Date(data[hover].start + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
          <p className="tabular-nums text-text-muted">{data[hover].shipments} shipment{data[hover].shipments === 1 ? '' : 's'} · {money(data[hover].usd)}</p>
        </div>
      )}
    </div>
  )
}

/** Donut with 2px gaps, total in the middle, and a labelled legend with counts (colour is never the only cue). */
function Donut({ rows }: { rows: Operations['statuses'] }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = rows.reduce((a, r) => a + r.n, 0)
  const R = 70, r0 = 46, C = 90
  let a0 = -Math.PI / 2
  const arcs = rows.filter((r) => r.n > 0).map((r) => {
    const frac = r.n / Math.max(1, total); const gap = rows.filter((x) => x.n > 0).length > 1 ? 0.025 : 0
    const s = a0 + gap / 2, e = a0 + frac * Math.PI * 2 - gap / 2; a0 += frac * Math.PI * 2
    const large = e - s > Math.PI ? 1 : 0
    const p = (ang: number, rad: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`
    const d = frac >= 0.999 ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r0} A${r0},${r0} 0 1 0 ${C},${C - r0} Z` : `M${p(s, R)} A${R},${R} 0 ${large} 1 ${p(e, R)} L${p(e, r0)} A${r0},${r0} 0 ${large} 0 ${p(s, r0)} Z`
    return { ...r, d }
  })
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(', ')}>
        {total === 0 ? <circle cx={C} cy={C} r={(R + r0) / 2} fill="none" stroke="var(--color-surface-2)" strokeWidth={R - r0} /> : arcs.map((a) => <path key={a.key} d={a.d} fill={SLOT[a.key]} opacity={hover == null || hover === a.key ? 1 : 0.4} onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}><title>{`${a.label}: ${a.n}`}</title></path>)}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-[var(--color-text)] font-heading text-[26px] font-bold">{total}</text>
        <text x={C} y={C + 16} textAnchor="middle" className="fill-[var(--color-text-muted)] text-[11px]">shipments</text>
      </svg>
      <ul className="w-full space-y-2 text-sm" data-testid="ops-status-legend">
        {rows.map((r) => (
          <li key={r.key} className={`flex items-center gap-2 rounded-md px-1 ${hover === r.key ? 'bg-surface-2' : ''}`} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: SLOT[r.key] }} aria-hidden="true" />
            <span className="flex-1">{r.label}</span><b className="tabular-nums">{r.n}</b><span className="w-12 text-right text-xs tabular-nums text-text-muted">{total ? Math.round((r.n / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OpsOverview({ scope }: { scope: 'shipper' | 'customer' }) {
  const [range, setRange] = useState<OpsRange>(() => { try { return (localStorage.getItem(RANGE_KEY) as OpsRange) || 'ytd' } catch { return 'ytd' } })
  const [d, setD] = useState<Operations | null>(null); const [error, setError] = useState('')
  const [kind, setKind] = useState<'shipments' | 'usd'>('shipments')
  useEffect(() => { let live = true; setError(''); (scope === 'shipper' ? operationsApi.shipper(range) : operationsApi.customer(range)).then((x) => live && setD(x)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load.')); return () => { live = false } }, [scope, range])
  const pick = (r: OpsRange) => { setRange(r); try { localStorage.setItem(RANGE_KEY, r) } catch { /* private mode */ } }
  const period = rangeLabels[range].toLowerCase()
  const k = d?.kpis
  const tiles = useMemo(() => {
    if (!k) return []
    return scope === 'shipper' ? [
      { label: 'Revenue', value: money(k.money.value), sub: `Collected · USD · ${period}`, icon: Wallet, kpi: k.money, testid: 'ops-revenue' },
      { label: 'Shipments', value: String(k.shipments.value), sub: `Picked up · ${period}`, icon: Package, kpi: k.shipments, testid: 'ops-shipments' },
      { label: 'Containers', value: String(k.third.value), sub: `Created · ${period}`, icon: Container, kpi: k.third, testid: 'ops-containers' },
      { label: 'Ratings', value: k.rating?.value != null ? `${k.rating.value} / 5` : '—', sub: k.rating?.count ? `${k.rating.count} customer review${k.rating.count === 1 ? '' : 's'} · ${period}` : 'Your overall rating', icon: Star, testid: 'ops-rating' },
    ] : [
      { label: 'Spent', value: money(k.money.value), sub: `Paid · USD · ${period}`, icon: Wallet, kpi: k.money, testid: 'ops-spent' },
      { label: 'Shipments', value: String(k.shipments.value), sub: `Booked · ${period}`, icon: Package, kpi: k.shipments, testid: 'ops-shipments' },
      { label: 'Delivered', value: String(k.third.value), sub: period, icon: Truck, kpi: k.third, testid: 'ops-delivered' },
      { label: 'On the way', value: String(k.onTheWay), sub: 'Right now', icon: Ship, testid: 'ops-ontheway' },
    ]
  }, [k, scope, period])
  return (
    <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6 space-y-6" data-testid="ops-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{scope === 'shipper' ? 'Your revenue, shipments, containers and customer experience.' : 'What you’ve shipped and spent, and what’s happening now.'}</p>
        <label className="inline-flex items-center gap-2 text-sm"><CalendarRange size={16} className="text-text-muted" aria-hidden="true" /><span className="sr-only">Period</span>
          <select className="input-dark !min-h-9 !w-auto text-sm" value={range} onChange={(e) => pick(e.target.value as OpsRange)} data-testid="ops-range">{(Object.keys(rangeLabels) as OpsRange[]).map((r) => <option key={r} value={r}>{rangeLabels[r]}</option>)}</select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!d ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-border bg-surface/60" />)}</div> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{tiles.map((t) => <Tile key={t.label} {...t} />)}</div>
          <div className="grid gap-6 xl:grid-cols-12">
            <motion.section variants={fadeUp} className="card-dark min-w-0 p-5 xl:col-span-7" aria-labelledby="ops-vol-h" data-testid="ops-volume">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><h2 id="ops-vol-h" className="!text-base">{kind === 'usd' ? (scope === 'shipper' ? 'Revenue' : 'Spending') : 'Shipment volume'}</h2><p className="text-xs text-text-muted">{kind === 'usd' ? (scope === 'shipper' ? 'Collected' : 'Paid') : scope === 'shipper' ? 'Shipments picked up' : 'Shipments booked'} per {d.bucket} · {period}</p></div>
                <div className="inline-flex rounded-full border border-border p-0.5 text-xs" role="radiogroup" aria-label="Measure">{([['shipments', 'Shipments'], ['usd', scope === 'shipper' ? 'Revenue' : 'Spending']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={`min-h-7 rounded-full px-3 font-semibold focus-ring ${kind === v ? 'bg-ink text-bg' : 'text-text-muted'}`}>{l}</button>)}</div>
              </div>
              <Bars data={d.series} bucket={d.bucket} kind={kind} />
            </motion.section>
            <motion.section variants={fadeUp} className="card-dark min-w-0 p-5 xl:col-span-5" aria-labelledby="ops-status-h" data-testid="ops-status">
              <h2 id="ops-status-h" className="!text-base">Shipment status</h2>
              <p className="mb-4 text-xs text-text-muted">Right now, plus deliveries in the period</p>
              <Donut rows={d.statuses} />
            </motion.section>
          </div>
          <div className="grid gap-6 xl:grid-cols-12">
            <motion.section variants={fadeUp} className="card-dark min-w-0 p-5 xl:col-span-7" aria-labelledby="ops-act-h" data-testid="ops-activity">
              <h2 id="ops-act-h" className="!text-base">Recent activity</h2>
              {d.activity.length === 0 ? <p className="mt-2 text-sm text-text-muted">No shipment updates yet.</p> : (
                <ol className="mt-3 space-y-3">{d.activity.map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    <span className="min-w-0 flex-1"><Link to={scope === 'shipper' ? `/dashboard/shipments?q=${a.ref}&b=all` : `/dashboard?tab=shipments&s=${a.shipmentId}`} className="font-semibold hover:text-gold-deep">{a.ref}</Link> · {a.label}{a.customer ? <span className="text-text-muted"> · {a.customer}</span> : null}{a.note ? <span className="block truncate text-xs text-text-muted">{a.note}</span> : <span className="block text-xs text-text-muted">{a.place}</span>}</span>
                    <time className="shrink-0 text-xs text-text-muted">{fmtDateTime(a.at)}</time>
                  </li>
                ))}</ol>
              )}
            </motion.section>
            <motion.section variants={fadeUp} className="card-dark min-w-0 p-5 xl:col-span-5" aria-labelledby="ops-ac-h" data-testid="ops-actions">
              <h2 id="ops-ac-h" className="!text-base">Action centre</h2>
              {d.actions.length === 0 ? <p className="mt-2 text-sm text-text-muted">Nothing needs you right now.</p> : (
                <ul className="mt-3 space-y-2">{d.actions.map((a) => (
                  <li key={a.key}><Link to={a.link} className={`flex items-start gap-3 rounded-xl border p-3 text-sm hover:bg-surface-2 focus-ring ${a.tone === 'critical' ? 'border-danger/40' : a.tone === 'warning' ? 'border-gold/50' : 'border-border'}`} data-testid={`ops-action-${a.key}`}>
                    {a.tone === 'info' ? <Info size={16} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" /> : <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${a.tone === 'critical' ? 'text-danger' : 'text-gold-deep'}`} aria-hidden="true" />}
                    <span className="min-w-0 flex-1"><b>{a.title}</b> <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-xs font-semibold tabular-nums">{a.n}</span><span className="block text-xs text-text-muted">{a.body}</span></span>
                    <ArrowRight size={14} className="mt-1 shrink-0 text-text-muted" aria-hidden="true" />
                  </Link></li>
                ))}</ul>
              )}
            </motion.section>
          </div>
        </>
      )}
    </motion.div>
  )
}
