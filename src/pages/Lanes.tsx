import { BrandLoader } from '../components/BrandLoader'
import { Fragment, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BarChart3, Lightbulb, TrendingDown, TrendingUp } from 'lucide-react'
import { useStore } from '../lib/store'
import { lanesApi, type Benchmark, type MyLane, type TopLane } from '../lib/lanes'
import { cargoTypes, countries, origins } from '../lib/data'
import { Empty, Pill, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { StatCard, Th, thead, trow } from '../components/board'
import { Spark } from '../components/ShipperOverview'

function Range({ b }: { b: Benchmark }) {
  const { p25, median, p75, min, max } = b.price
  if (median == null || min == null || max == null) return <p className="text-sm text-text-muted">Not enough quotes on this lane yet.</p>
  const span = Math.max(1, max - min); const x = (v: number) => `${((v - min) / span) * 100}%`
  return (
    <div data-testid="price-range">
      <div className="relative mt-6 h-2 rounded-full bg-surface-2"><div className="absolute h-2 rounded-full bg-gold/50" style={{ left: x(p25 ?? min), width: `calc(${x(p75 ?? max)} - ${x(p25 ?? min)})` }} /><div className="absolute -top-1 h-4 w-1 rounded bg-gold" style={{ left: x(median) }} /></div>
      <div className="mt-2 flex justify-between text-[11px] text-text-muted"><span>{money(min)}</span><span>p25 {money(p25 ?? min)}</span><span className="font-semibold text-text">median {money(median)}</span><span>p75 {money(p75 ?? max)}</span><span>{money(max)}</span></div>
    </div>
  )
}

export function BenchmarkPanel({ b, title }: { b: Benchmark; title: string }) {
  if (!b.sample.quotes) return (
    <div className="card-dark p-5" data-testid="benchmark">
      <div className="flex items-start justify-between gap-2"><h2 className="!text-base">{title}</h2><span className="text-xs text-text-muted">no quotes yet · 180 days</span></div>
      <p className="mt-3 text-sm text-text-muted">We haven't seen enough quotes on this lane to show a price range yet. Request quotes and the market view fills in as shippers reply{b.demand.series.some((n) => n > 0) ? ` — ${b.demand.series.reduce((n, x) => n + x, 0)} request${b.demand.series.reduce((n, x) => n + x, 0) === 1 ? '' : 's'} in the last 12 weeks` : ''}.</p>
    </div>
  )
  return (
    <div className="card-dark p-5" data-testid="benchmark">
      <div className="flex items-start justify-between gap-2"><h2 className="!text-base">{title}</h2><span className="text-xs text-text-muted">{b.sample.quotes} quotes · {b.sample.shippers} shippers · 180 days</span></div>
      <Range b={b} />
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs text-text-muted">Transit (quoted)</p><p className="text-lg font-bold">{b.transit.quotedMedian != null ? `${b.transit.quotedMedian} days` : '—'}</p><p className="text-[11px] text-text-muted">{b.transit.quotedP25 != null ? `${b.transit.quotedP25}–${b.transit.quotedP75} typical` : ''}{b.transit.actualMedian != null ? ` · actual ${b.transit.actualMedian}d` : ''}</p></div>
        <div><p className="text-xs text-text-muted">Demand (12 weeks)</p><div className="flex items-center gap-2"><Spark values={b.demand.series} /><span className={`inline-flex items-center gap-1 text-sm font-semibold ${b.demand.trendPct >= 0 ? 'text-teal' : 'text-danger'}`}>{b.demand.trendPct >= 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}{b.demand.trendPct > 0 ? '+' : ''}{b.demand.trendPct}%</span></div><p className="text-[11px] text-text-muted">{b.sample.requests} requests · last 4 weeks vs prior 4</p></div>
        <div><p className="text-xs text-text-muted">Win rate by price</p><p className="text-sm"><span className="font-semibold">{b.winRate.belowMedian.winRate ?? '—'}%</span> <span className="text-text-muted">below median</span></p><p className="text-sm"><span className="font-semibold">{b.winRate.aboveMedian.winRate ?? '—'}%</span> <span className="text-text-muted">above median</span></p><p className="text-[11px] text-text-muted">{b.winRate.decided} decided quotes</p></div>
      </div>
    </div>
  )
}

/** `/lanes` — public benchmark explorer. */
export default function LanesPage() {
  const [sp, setSp] = useSearchParams()
  const [f, setF] = useState({ origin: sp.get('origin') ?? 'Houston, TX', destination: sp.get('destination') ?? 'GH', cargo: sp.get('cargo') ?? 'barrels' })
  const [b, setB] = useState<Benchmark | null>(null)
  const [top, setTop] = useState<TopLane[] | null>(null)
  useEffect(() => { lanesApi.top().then(setTop).catch(() => setTop([])) }, [])
  useEffect(() => { setB(null); lanesApi.benchmark(f).then(setB).catch(() => {}); setSp(f, { replace: true }) }, [f]) // eslint-disable-line react-hooks/exhaustive-deps
  const cargo = cargoTypes.find((c) => c.id === f.cargo)?.label ?? f.cargo
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Lane intelligence</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">What does it really cost to ship home?</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Real quotes from real shippers on Ntemtem, anonymised. Check a quote against the market before you accept it.</motion.p>
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 max-w-4xl">
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
            <select aria-label="Origin" className="input-dark !min-h-10 !w-auto text-sm" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })}>{origins.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            <span className="text-text-muted">→</span>
            <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            <select aria-label="Cargo" className="input-dark !min-h-10 !w-auto text-sm" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })}>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </motion.div>
          <motion.div variants={fadeUp} className="mt-6">{b ? <BenchmarkPanel b={b} title={`${f.origin.split(',')[0]} → ${countries.find((c) => c.code === f.destination)?.name} · ${cargo}`} /> : <div className="card-dark p-5 text-sm text-text-muted">Loading…</div>}</motion.div>
          <motion.div variants={fadeUp} className="mt-4 flex flex-wrap gap-2 text-sm"><Link to={`/quote?origin=${encodeURIComponent(f.origin)}&destination=${f.destination}`} className="btn-gold !min-h-10 !px-4">Get quotes on this lane</Link><Link to={`/sailings?destination=${f.destination}`} className="btn-ghost !min-h-10 !px-4">Next sailings</Link><Link to={`/duty?destination=${f.destination}`} className="btn-ghost !min-h-10 !px-4">Duty estimate</Link></motion.div>
          <motion.div variants={fadeUp} className="card-dark mt-10 overflow-hidden">
            <div className="px-5 pt-5"><h2 className="!text-base">Busiest lanes right now</h2><p className="text-xs text-text-muted">Requests in the last 12 weeks across the marketplace.</p></div>
            <div className="overflow-x-auto"><table className="mt-3 w-full min-w-[520px] text-sm"><thead><tr className={thead}><Th>Lane</Th><Th>Cargo</Th><Th className="text-right">Requests</Th><Th className="text-right">Shippers</Th><Th className="text-right">Median</Th></tr></thead><tbody>{top === null && <tr><td colSpan={5} className="px-3 py-6 text-center text-text-muted">Loading…</td></tr>}{top?.map((l, i) => <tr key={i} className={trow()} data-testid="top-lane"><td className="px-3 py-2.5"><button onClick={() => setF({ origin: origins.find((o) => o.startsWith(l.origin)) ?? l.origin, destination: l.destination, cargo: l.cargo })} className="text-left hover:text-gold-deep">{l.origin} → {l.destinationName}</button></td><td className="px-3 py-2.5 text-xs text-text-muted">{l.cargoLabel}</td><td className="px-3 py-2.5 text-right tabular-nums">{l.requests}</td><td className="px-3 py-2.5 text-right tabular-nums">{l.shippers}</td><td className="px-3 py-2.5 text-right tabular-nums">{l.median != null ? money(l.median) : '—'}</td></tr>)}</tbody></table></div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

/** `/dashboard/lanes` — the shipper's lanes vs the market. */
export function ShipperLanes() {
  const { ready, user } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof lanesApi.mine>> | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(0)
  useEffect(() => { if (ready && user?.role === 'shipper') lanesApi.mine().then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.')) }, [ready, user])
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/lanes" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />
  const tips = d?.lanes.filter((l) => l.tip) ?? []
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Lane intelligence</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">You vs the market</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Every lane you've quoted in the last six months, against what the whole marketplace quotes and wins — plus busy lanes you don't serve yet.</motion.p></div>
            <motion.div variants={fadeUp}><Link to="/lanes" className="btn-ghost">Public benchmarks</Link></motion.div>
          </div>
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-3">
            <StatCard label="Lanes quoted" value={d?.lanes.length ?? 0} hint="Last 180 days" icon={BarChart3} />
            <StatCard label="Pricing tips" value={tips.length} hint={tips.length ? 'Worth a look' : 'Nothing to flag'} icon={Lightbulb} warn={tips.length > 0} />
            <StatCard label="Opportunities" value={d?.opportunities.length ?? 0} hint="Busy lanes you don't serve" icon={TrendingUp} />
          </motion.div>
          {tips.length > 0 && <motion.ul variants={fadeUp} className="mt-6 space-y-2" data-testid="tips">{tips.map((l, i) => <li key={i} className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm"><Lightbulb size={15} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span><strong>{l.origin} → {l.destinationName} · {l.cargoLabel}:</strong> {l.tip}</span></li>)}</motion.ul>}
          <motion.div variants={fadeUp} className="card-dark mt-6 overflow-hidden" data-testid="my-lanes">
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead><tr className={thead}><Th>Lane</Th><Th className="text-right">Quotes</Th><Th className="text-right">Your win rate</Th><Th className="text-right">Market</Th><Th className="text-right">Your median</Th><Th className="text-right">Market median</Th><Th className="text-right">vs market</Th><Th className="text-right">Reply</Th></tr></thead>
              <tbody>
                {d === null && !error && <tr><td colSpan={8} className="px-3 py-8 text-center text-text-muted">Loading…</td></tr>}
                {d && d.lanes.length === 0 && <tr><td colSpan={8} className="px-3 py-8"><Empty title="No quotes in the last six months" body="Quote a few leads and your lanes show up here against the market." /></td></tr>}
                {d?.lanes.map((l: MyLane, i) => (
                  <Fragment key={l.origin + l.destination + l.cargo + i}>
                    <tr className={trow(open === i)} onClick={() => setOpen(open === i ? null : i)} style={{ cursor: 'pointer' }} data-testid="lane-row">
                      <td className="px-3 py-3"><p className="font-semibold">{l.origin} → {l.destinationName}</p><p className="text-xs text-text-muted">{l.cargoLabel}</p></td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.quotes}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.myWinRate != null ? `${l.myWinRate}%` : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-muted">{l.market.winRate.overall != null ? `${l.market.winRate.overall}%` : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.myMedian != null ? money(l.myMedian) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-muted">{l.market.price.median != null ? money(l.market.price.median) : '—'}</td>
                      <td className="px-3 py-3 text-right">{l.vsMarketPct == null ? '—' : <Pill tone={Math.abs(l.vsMarketPct) <= 10 ? 'teal' : l.vsMarketPct > 0 ? 'gold' : 'sky'}>{l.vsMarketPct > 0 ? '+' : ''}{l.vsMarketPct}%</Pill>}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-muted">{l.responseHours != null ? `${l.responseHours}h` : '—'}</td>
                    </tr>
                    {open === i && <tr key={`${i}-x`}><td colSpan={8} className="bg-surface-2/40 px-3 py-4"><BenchmarkPanel b={l.market} title={`Market: ${l.origin} → ${l.destinationName} · ${l.cargoLabel}`} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table></div>
          </motion.div>
          {d && d.opportunities.length > 0 && (
            <motion.div variants={fadeUp} className="card-dark mt-6 p-5" data-testid="opportunities">
              <h2 className="!text-base">Busy lanes you don't serve</h2>
              <p className="text-xs text-text-muted">Requests in the last 12 weeks on lanes outside your listed origins, destinations or cargo. Add them to your profile and rate cards to start receiving these leads.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">{d.opportunities.map((o, i) => <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"><span>{o.origin} → {o.destinationName} <span className="text-text-muted">· {o.cargoLabel}</span></span><span className="text-xs text-text-muted">{o.requests} req · {o.shippers} shippers{o.median != null ? ` · ~${money(o.median)}` : ''}</span></li>)}</ul>
              <Link to="/dashboard/shipper?view=profile" className="btn-ghost mt-3 !min-h-9 !px-3 text-xs">Update lanes in your profile</Link>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
