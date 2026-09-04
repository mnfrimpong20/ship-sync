import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Loader2, Search } from 'lucide-react'
import { cargoLabel, countryByCode, shipperById, statusLabels, statusOrder, type Shipment } from '../lib/data'
import { useStore } from '../lib/store'
import { Avatar, ModeBadge, Pill, fmtDate, fmtDateTime } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

export default function Track() {
  const [sp, setSp] = useSearchParams()
  const { shipments } = useStore()
  const [ref, setRef] = useState(sp.get('ref') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const current = sp.get('ref') ? shipments.find((s) => s.ref.toLowerCase() === sp.get('ref')!.toLowerCase()) : undefined

  const lookup = (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    setTimeout(() => {
      setLoading(false)
      const found = shipments.find((s) => s.ref.toLowerCase() === ref.trim().toLowerCase())
      if (!found) { setError('We couldn’t find a shipment with that reference. Check the format (SS-XXXXXX) or try a sample below.'); setSp({}); return }
      setSp({ ref: found.ref })
    }, 700)
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
          <motion.p variants={fadeUp} className="mt-3 text-xs text-text-muted">Try a sample: {shipments.slice(0, 3).map((s) => <button key={s.id} onClick={() => { setRef(s.ref); setSp({ ref: s.ref }) }} className="ml-2 font-mono text-gold hover:underline focus-ring rounded">{s.ref}</button>)}</motion.p>
        </motion.div>

        <AnimatePresence mode="wait">
          {current && <motion.div key={current.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mt-10"><ShipmentDetail s={current} /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function ShipmentDetail({ s, compact = false }: { s: Shipment; compact?: boolean }) {
  const shipper = shipperById(s.shipperId)!
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

          <ol className="mt-8 space-y-0" aria-label="Tracking history">
            {[...s.events].reverse().map((ev, i, arr) => (
              <motion.li key={ev.status + ev.at} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative flex gap-4 pb-6 last:pb-0">
                {i < arr.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
                <span className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full ${i === 0 ? 'bg-gold text-ink' : 'bg-surface-2 text-text-muted'}`}><Check size={13} aria-hidden="true" /></span>
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
