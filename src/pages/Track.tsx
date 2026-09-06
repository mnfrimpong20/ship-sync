import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Loader2, Plane, Radio, Search, Ship } from 'lucide-react'
import { cargoLabel, countryByCode, statusLabels, statusOrder, type Shipment } from '../lib/data'
import { useStore } from '../lib/store'
import { Avatar, ModeBadge, Pill, fmtDate, fmtDateTime } from '../components/ui'
import type { PositionPayload } from '../components/LiveMap'
import { FlightCard, VesselCard } from '../components/CarrierCards'

const LiveMap = lazy(() => import('../components/LiveMap'))
import { fadeUp, stagger } from '../lib/motion'

export default function Track() {
  const [sp, setSp] = useSearchParams()
  const { track } = useStore()
  const [ref, setRef] = useState(sp.get('ref') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<Shipment | undefined>()
  const samples = ['SS-4F7K2Q', 'SS-9B3MX1', 'SS-2LR8TD']

  useEffect(() => {
    const r = sp.get('ref')
    if (!r) { setCurrent(undefined); return }
    let live = true
    setLoading(true); setError('')
    track(r).then((s) => { if (!live) return; if (s) setCurrent(s); else { setCurrent(undefined); setError('We couldn’t find a shipment with that reference. Check the format (SS-XXXXXX) or try a sample below.') } })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Lookup failed.'))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [sp, track])

  const lookup = (e: React.FormEvent) => {
    e.preventDefault()
    const v = ref.trim().toUpperCase()
    if (!v) { setError('Enter a shipment reference.'); return }
    setSp({ ref: v })
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Track</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">Where is my shipment?</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Enter the Ship Sync reference from your booking confirmation.</motion.p>
          <motion.form variants={fadeUp} onSubmit={lookup} className="mt-6 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <input aria-label="Shipment reference" className="input-dark !min-h-12 !pl-10 uppercase" placeholder="SS-4F7K2Q" value={ref} onChange={(e) => setRef(e.target.value)} aria-invalid={!!error} />
            </div>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold !min-h-12" disabled={loading}>{loading ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Looking up</> : 'Track'}</motion.button>
          </motion.form>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <motion.p variants={fadeUp} className="mt-3 text-xs text-text-muted">Try a sample: {samples.map((r) => <button key={r} onClick={() => { setRef(r); setSp({ ref: r }) }} className="ml-2 font-mono text-gold hover:underline focus-ring rounded">{r}</button>)}</motion.p>
        </motion.div>

        <AnimatePresence mode="wait">
          {current && <motion.div key={current.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mt-10"><ShipmentDetail s={current} /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  )
}

function LivePanel({ s }: { s: Shipment }) {
  const { position } = useStore()
  const [pos, setPos] = useState<PositionPayload | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    const load = () => position(s.ref).then((p) => { if (live) { setPos(p); setLoading(false) } })
    load()
    const t = setInterval(load, 30_000)
    return () => { live = false; clearInterval(t) }
  }, [s.ref, s.status, position])
  if (loading) return <div className="mt-6 grid min-h-[320px] place-items-center rounded-[var(--radius-md)] border border-border bg-surface-2 text-sm text-text-muted"><span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading map…</span></div>
  if (!pos || !pos.route) return null
  const fix = pos.live ?? pos.lastKnown
  const Icon = pos.mode === 'air' ? Plane : Ship
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon size={16} className="text-gold" aria-hidden="true" />
          {pos.carrier.vesselName ?? pos.carrier.flight ?? (pos.mode === 'air' ? 'Flight' : 'Vessel')}
          {pos.carrier.mmsi && <span className="font-mono text-xs font-normal text-text-muted">MMSI {pos.carrier.mmsi}</span>}
        </p>
        {pos.live ? <Pill tone="gold"><Radio size={12} className="mr-1 animate-pulse" aria-hidden="true" /> Live</Pill> : pos.lastKnown ? <Pill tone="muted">Last known</Pill> : pos.phase === 'transit' ? <Pill tone="teal">Estimated</Pill> : null}
      </div>
      <div className="h-[340px] md:h-[400px]">
        <Suspense fallback={<div className="ss-map" />}><LiveMap data={pos} /></Suspense>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {pos.note}{fix ? ` Signal ${fmtDateTime(fix.at)}.` : ''} Positions are public, delayed and approximate — never for navigation or safety decisions.
      </p>
      {pos.detail?.kind === 'vessel' && <VesselCard mmsi={pos.detail.id} v={pos.detail} className="mt-4 !bg-surface-2/60" />}
      {pos.detail?.kind === 'flight' && <FlightCard f={pos.detail} className="mt-4 !bg-surface-2/60" />}
    </div>
  )
}

export function ShipmentDetail({ s, compact = false }: { s: Shipment; compact?: boolean }) {
  const { shipperById } = useStore()
  const shipper = shipperById(s.shipperId) ?? { id: s.shipperId, name: 'Shipper', hq: '', initials: 'SS', hue: '#E3B54A' }
  const dest = countryByCode(s.destination)!
  const idx = statusOrder.indexOf(s.status)
  const pct = (idx / (statusOrder.length - 1)) * 100
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className={compact ? 'lg:col-span-12' : 'lg:col-span-8'}>
        <div className="card-dark p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-sm text-gold">{s.ref}</p>
              <h2 className="mt-1 !text-2xl">{s.origin} → {dest.flag} {dest.name}</h2>
              <p className="mt-1 text-sm text-text-muted">{s.description} · {cargoLabel(s.cargo)}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Pill tone={s.status === 'delivered' ? 'green' : s.status === 'customs' ? 'gold' : 'teal'}>{statusLabels[s.status]}</Pill>
              <p className="text-xs text-text-muted">{s.status === 'delivered' ? 'Delivered' : 'ETA'} {fmtDate(s.eta)}</p>
            </div>
          </div>

          <div className="mt-8">
            <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#2DD4BF,#E3B54A)]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <ol className="mt-3 grid grid-cols-4 gap-1 text-[11px] text-text-muted md:grid-cols-8">
              {statusOrder.map((st, i) => <li key={st} className={`${i <= idx ? 'text-text' : ''} ${i > 3 ? 'hidden md:block' : ''}`}>{statusLabels[st]}</li>)}
            </ol>
          </div>

          <LivePanel s={s} />

          <ol className="mt-8 space-y-0" aria-label="Tracking history">
            {[...s.events].reverse().map((ev, i, arr) => (
              <motion.li key={ev.status + ev.at} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative flex gap-4 pb-6 last:pb-0">
                {i < arr.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
                <span className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full ${i === 0 ? 'bg-gold text-on-accent' : 'bg-surface-2 text-text-muted'}`}><Check size={13} aria-hidden="true" /></span>
                <div>
                  <p className={`text-sm font-semibold ${i === 0 ? 'text-text' : 'text-text-muted'}`}>{statusLabels[ev.status]} <span className="font-normal text-text-muted">· {ev.place}</span></p>
                  <p className="text-xs text-text-muted">{fmtDateTime(ev.at)}</p>
                  {ev.note && <p className="mt-1 text-sm text-text">{ev.note}</p>}
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
      {!compact && (
        <aside className="lg:col-span-4">
          <div className="card-dark p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Handled by</p>
            <div className="mt-3 flex items-center gap-3"><Avatar initials={shipper.initials} hue={shipper.hue} size={44} /><div><p className="font-semibold text-text">{shipper.name}</p><p className="text-xs text-text-muted">{shipper.hq}</p></div></div>
            <div className="mt-3 flex gap-2"><ModeBadge mode={s.mode} /></div>
            <Link to={`/shippers/${shipper.id}`} className="btn-ghost mt-5 w-full !min-h-10 text-sm">View shipper profile</Link>
          </div>
          <div className="card-dark mt-4 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Destination</p>
            <p className="mt-2 text-text">{dest.flag} {dest.name} — {s.mode === 'air' ? dest.airports[0] : dest.ports[0]}</p>
            <p className="mt-2 text-text-muted">{dest.note}</p>
          </div>
        </aside>
      )}
    </div>
  )
}
