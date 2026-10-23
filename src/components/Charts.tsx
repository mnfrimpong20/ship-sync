/**
 * Small, dependency-free chart kit for the analytics pages. Inline SVG, viewBox-scaled, theme
 * tokens only. The focus series wears the brand colour; context series are muted grey; status
 * colours (danger) only ever mean "late / overdue" and always come with a text label.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Download, Minus, type LucideIcon } from 'lucide-react'
import { downloadCsv, type Kpi } from '../lib/analytics'

export const C = { focus: 'var(--color-gold)', context: 'color-mix(in oklab, var(--color-text-muted) 45%, transparent)', alt: 'var(--color-teal)', bad: 'var(--color-danger)' }

const fmtBucket = (iso: string, bucket: 'week' | 'month') => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', bucket === 'month' ? { month: 'short' } : { month: 'short', day: 'numeric' })

/* ------------------------------ stat tile ------------------------------ */
export function Delta({ k, better = 'up', suffix }: { k: Pick<Kpi, 'delta' | 'unit' | 'prev'>; better?: 'up' | 'down'; suffix?: string }) {
  if (k.delta == null) return <span className="text-xs text-text-muted">{k.prev == null || k.prev === 0 ? 'no earlier data' : '—'}</span>
  if (k.delta === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-text-muted"><Minus size={11} aria-hidden="true" /> flat {suffix}</span>
  const up = k.delta > 0; const good = better === 'up' ? up : !up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-teal' : 'text-danger'}`}><Icon size={12} aria-hidden="true" />{up ? '+' : ''}{k.delta}{k.unit === 'pts' ? ' pts' : '%'} <span className="font-normal text-text-muted">{suffix}</span></span>
}

export function Stat({ label, value, kpi, better, hint, icon: I, tone, testid }: { label: string; value: ReactNode; kpi?: Kpi; better?: 'up' | 'down'; hint?: string; icon?: LucideIcon; tone?: 'bad' | 'good'; testid?: string }) {
  return (
    <div className={`card-dark p-4 ${tone === 'bad' ? 'border-l-4 border-l-danger' : ''}`} data-testid={testid ?? 'stat'}>
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-text-muted">{label}</p>{I && <I size={15} className={tone === 'bad' ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" />}</div>
      <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value ?? '—'}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">{kpi && <Delta k={kpi} better={better} suffix="vs prior" />}{hint && <span className="text-xs text-text-muted">{hint}</span>}</div>
    </div>
  )
}

/* ------------------------------ panel ------------------------------ */
export function Panel({ title, sub, children, actions, className = '', testid }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode; className?: string; testid?: string }) {
  return (
    <section className={`card-dark min-w-0 p-5 ${className}`} data-testid={testid}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="!text-base">{title}</h2>{sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}</div>{actions}</div>
      {children}
    </section>
  )
}
export const NoData = ({ children = 'Not enough data in this period yet.' }: { children?: ReactNode }) => <p className="rounded-lg bg-surface-2/60 p-4 text-sm text-text-muted">{children}</p>

/* ------------------------------ trend (vertical bars) ------------------------------ */
export interface TrendSeries { key: string; label: string; color: string }
export function Trend<T extends { start: string }>({ data, series, bucket, stacked = false, format = (v) => String(v), label, height = 190, extra }: { data: T[]; series: TrendSeries[]; bucket: 'week' | 'month'; stacked?: boolean; format?: (v: number) => string; label: string; height?: number; extra?: (d: T) => ReactNode }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = height, padL = 40, padB = 22, padT = 8
  const val = (d: T, k: string) => Number((d as Record<string, unknown>)[k] ?? 0)
  const max = Math.max(1, ...data.map((d) => (stacked ? series.reduce((a, s) => a + val(d, s.key), 0) : Math.max(...series.map((s) => val(d, s.key))))))
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p })()
  const step = (W - padL) / Math.max(1, data.length)
  const groupW = Math.min(44, step * 0.7); const bw = stacked ? groupW : Math.max(3, (groupW - (series.length - 1) * 2) / series.length)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice)
  const totals = series.map((s) => data.reduce((a, d) => a + val(d, s.key), 0))
  const every = Math.ceil(data.length / 7)
  const h = hover != null ? data[hover] : null
  return (
    <div className="relative">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted" aria-label="Legend">
        {series.map((s, i) => <li key={s.key} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.label} <b className="tabular-nums text-text">{format(totals[i])}</b></li>)}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, nice / 2, nice].map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeDasharray={t ? '2 4' : undefined} /><text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">{format(t)}</text></g>)}
        {data.map((d, i) => {
          const cx = padL + i * step + step / 2; let acc = 0
          return (
            <g key={d.start}>
              <rect x={padL + i * step} y={padT} width={step} height={H - padT - padB} fill={hover === i ? 'var(--color-surface-2)' : 'transparent'} onMouseEnter={() => setHover(i)} />
              {series.map((s, j) => {
                const v = val(d, s.key); if (v <= 0) return null
                if (stacked) { const y1 = y(acc + v), y0 = y(acc); acc += v; return <rect key={s.key} x={cx - bw / 2} y={y1 + (j ? 1 : 0)} width={bw} height={Math.max(0, y0 - y1 - (j ? 1 : 0))} rx={j === series.length - 1 || series.slice(j + 1).every((n) => val(d, n.key) <= 0) ? 3 : 0} fill={s.color} pointerEvents="none" /> }
                const x = cx - groupW / 2 + j * (bw + 2); return <rect key={s.key} x={x} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx="3" fill={s.color} pointerEvents="none" />
              })}
              {(i % every === 0 || i === data.length - 1) && <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{fmtBucket(d.start, bucket)}</text>}
            </g>
          )
        })}
      </svg>
      {h && hover != null && (
        <div role="status" className="pointer-events-none absolute top-6 z-10 min-w-36 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: `clamp(0px, calc(${((padL + hover * step + step / 2) / W) * 100}% - 72px), calc(100% - 160px))` }}>
          <p className="font-semibold">{bucket === 'month' ? new Date(h.start + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : `Week of ${fmtBucket(h.start, 'week')}`}</p>
          {series.map((s) => <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-text-muted"><i className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.label}: <b className="tabular-nums text-text">{format(val(h, s.key))}</b></p>)}
          {extra?.(h)}
        </div>
      )}
    </div>
  )
}

/* ------------------------------ horizontal bars ------------------------------ */
export interface HRow { label: ReactNode; value: number; display?: ReactNode; note?: ReactNode; tone?: 'focus' | 'context' | 'bad' | 'alt'; marker?: number }
export function HBars({ rows, max, testid, label }: { rows: HRow[]; max?: number; testid?: string; label: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Math.max(r.value, r.marker ?? 0)))
  return (
    <ul className="space-y-3" aria-label={label} data-testid={testid}>
      {rows.map((r, i) => (
        <li key={i} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-text-muted">{r.label}</span><span className="shrink-0 tabular-nums"><b>{r.display ?? r.value}</b>{r.note && <span className="ml-1.5 text-xs text-text-muted">{r.note}</span>}</span></div>
          <div className="relative h-2.5 rounded-full bg-surface-2" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / m) * 100)}%`, background: r.tone === 'bad' ? C.bad : r.tone === 'context' ? C.context : r.tone === 'alt' ? C.alt : C.focus }} />
            {r.marker != null && <span className="absolute -top-1 h-4.5 w-0.5 rounded bg-text" style={{ left: `${Math.min(100, (r.marker / m) * 100)}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------ funnel ------------------------------ */
export function Funnel({ steps }: { steps: { key: string; label: string; n: number }[] }) {
  const top = Math.max(1, steps[0]?.n ?? 1)
  return (
    <ol className="space-y-2" data-testid="funnel">
      {steps.map((s, i) => {
        const conv = i ? (steps[i - 1].n ? Math.round((s.n / steps[i - 1].n) * 100) : 0) : null
        return (
          <li key={s.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm"><span>{s.label}</span><span className="tabular-nums"><b>{s.n}</b>{conv != null && <span className="ml-2 text-xs text-text-muted">{conv}% of previous</span>}</span></div>
            <div className="h-6 rounded-md bg-surface-2"><div className="h-6 rounded-md" style={{ width: `${Math.max(s.n ? 2 : 0, (s.n / top) * 100)}%`, background: i === steps.length - 1 ? C.alt : C.focus, opacity: 1 - i * 0.12 }} /></div>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------ stage durations ------------------------------ */
export function Stages({ rows }: { rows: { key: string; label: string; n: number; medianDays: number | null; p90Days: number | null; platformMedianDays: number | null }[] }) {
  const has = rows.filter((r) => r.medianDays != null)
  if (!has.length) return <NoData>No delivered shipments with a full status history in this period.</NoData>
  const max = Math.max(1, ...has.map((r) => Math.max(r.p90Days ?? 0, r.platformMedianDays ?? 0)))
  const worst = [...has].filter((r) => r.platformMedianDays != null).sort((a, b) => (b.medianDays! - b.platformMedianDays!) - (a.medianDays! - a.platformMedianDays!))[0]
  const anyPlat = has.some((r) => r.platformMedianDays != null)
  return (
    <div data-testid="stages">
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-text-muted"><li className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm" style={{ background: C.focus }} />Your median</li><li className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4" style={{ background: 'var(--color-text-muted)' }} />Slowest 10%</li>{anyPlat && <li className="inline-flex items-center gap-1.5"><i className="h-3 w-0.5 bg-text" />Platform median</li>}</ul>
      <ul className="space-y-3">
        {has.map((r) => {
          const slow = worst?.key === r.key && r.platformMedianDays != null && r.medianDays! - r.platformMedianDays >= 1
          return (
            <li key={r.key} className="grid grid-cols-[minmax(7rem,13rem)_1fr_4.5rem] items-center gap-3 text-sm max-sm:grid-cols-[1fr_4.5rem]">
              <span className="truncate text-text-muted max-sm:col-span-2 max-sm:-mb-2">{r.label}{slow && <span className="ml-1.5 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold text-danger">bottleneck</span>}</span>
              <span className="relative h-4" aria-hidden="true">
                <span className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: 0, width: `${((r.p90Days ?? 0) / max) * 100}%`, background: 'var(--color-border)' }} />
                <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(1.5, (r.medianDays! / max) * 100)}%`, background: slow ? C.bad : C.focus }} />
                {r.p90Days != null && <span className="absolute top-0.5 h-3 w-0.5" style={{ left: `${(r.p90Days / max) * 100}%`, background: 'var(--color-text-muted)' }} />}
                {r.platformMedianDays != null && <span className="absolute -top-1 h-6 w-0.5 bg-text" style={{ left: `${(r.platformMedianDays / max) * 100}%` }} />}
              </span>
              <span className="text-right tabular-nums" title={`p90 ${r.p90Days} d${r.platformMedianDays != null ? ` · platform ${r.platformMedianDays} d` : ''} · ${r.n} shipments`}><b>{r.medianDays}</b> <span className="text-xs text-text-muted">d</span></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------ table ------------------------------ */
export interface Col<T> { key: keyof T & string; label: string; align?: 'right'; format?: (v: T[keyof T], row: T) => ReactNode; csv?: (row: T) => unknown }
export function DataTable<T extends Record<string, any>>({ rows, cols, csvName, testid, initialSort, limit = 12 }: { rows: T[]; cols: Col<T>[]; csvName?: string; testid?: string; initialSort?: keyof T & string; limit?: number }) {
  const [sort, setSort] = useState<{ k: keyof T & string; dir: 1 | -1 } | null>(initialSort ? { k: initialSort, dir: -1 } : null)
  const [all, setAll] = useState(false)
  const sorted = useMemo(() => { if (!sort) return rows; return [...rows].sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir }) }, [rows, sort])
  const shown = all ? sorted : sorted.slice(0, limit)
  if (!rows.length) return <NoData />
  return (
    <div data-testid={testid}>
      <div className="-mx-5 overflow-x-auto px-5 focus-ring" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
        <table className="w-full min-w-[22rem] whitespace-nowrap text-sm">
          <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted">
            {cols.map((c) => !c.label ? <th key={c.key} className="px-2 py-2"><span className="sr-only">Actions</span></th> : <th key={c.key} className={`px-2 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`} aria-sort={sort?.k === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => setSort((s) => ({ k: c.key, dir: s?.k === c.key ? ((s.dir * -1) as 1 | -1) : -1 }))} className="-my-1 min-h-8 uppercase tracking-wider hover:text-text focus-ring">{c.label}{sort?.k === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>)}
          </tr></thead>
          <tbody>{shown.map((r, i) => <tr key={i} className="border-b border-border/60 last:border-0">{cols.map((c) => <td key={c.key} className={`px-2 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.format ? c.format(r[c.key], r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        {rows.length > limit ? <button type="button" onClick={() => setAll(!all)} className="inline-flex min-h-10 items-center font-semibold hover:text-text focus-ring">{all ? 'Show fewer' : `Show all ${rows.length}`}</button> : <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>}
        {csvName && <button type="button" onClick={() => downloadCsv(csvName, sorted.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.csv ? c.csv(r) : r[c.key]]))))} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-semibold hover:bg-surface-2 hover:text-text focus-ring" data-testid="csv"><Download size={12} aria-hidden="true" /> CSV</button>}
      </div>
    </div>
  )
}
