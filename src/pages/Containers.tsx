import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Anchor, Boxes, Check, Container as ContainerIcon, Plus, Radio, Search, Ship, Waves, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { countries, countryByCode } from '../lib/data'
import { CONTAINER_STAGES, SIZES, containersApi, isOpen, sizeLabels, stageLabels, type Container, type ContainerInput, type ContainerSize, type ContainerStatus } from '../lib/containers'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

export const blankContainer: ContainerInput = { number: '', size: '40hc', line: '', bookingRef: '', seal: '', vesselName: '', mmsi: '', voyage: '', originPort: '', destination: 'GH', destinationPort: '', cutoffDate: null, etd: null, eta: null, notes: '' }

export const stageTone = (s: ContainerStatus): 'gold' | 'teal' | 'sky' | 'green' | 'muted' =>
  s === 'booked' || s === 'loading' ? 'gold' : s === 'gated_in' || s === 'sailed' ? 'teal' : s === 'arrived' || s === 'customs' ? 'sky' : s === 'devanned' ? 'green' : 'muted'

export function StageStepper({ status, compact = false }: { status: ContainerStatus; compact?: boolean }) {
  const idx = CONTAINER_STAGES.indexOf(status)
  return (
    <ol className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`} aria-label={`Stage ${idx + 1} of ${CONTAINER_STAGES.length}: ${stageLabels[status]}`}>
      {CONTAINER_STAGES.map((s, i) => (
        <li key={s} className="flex-1" title={stageLabels[s]}>
          <span className={`block rounded-full ${compact ? 'h-1' : 'h-1.5'} ${i < idx ? 'bg-teal' : i === idx ? 'bg-gold' : 'bg-border'}`} />
          {!compact && <span className={`mt-1.5 hidden text-[10px] leading-tight lg:block ${i === idx ? 'font-semibold text-text' : 'text-text-muted'}`}>{stageLabels[s].replace(' with line', '').replace(' at port', '')}</span>}
        </li>
      ))}
    </ol>
  )
}

export function ContainerForm({ initial, onSave, onCancel, busy, error, submitLabel = 'Book container' }: { initial: ContainerInput; onSave: (c: ContainerInput) => void; onCancel: () => void; busy: boolean; error: string; submitLabel?: string }) {
  const [f, setF] = useState<ContainerInput>(initial)
  const set = (k: keyof ContainerInput, v: string) => setF({ ...f, [k]: v })
  const date = (k: 'cutoffDate' | 'etd' | 'eta', v: string) => setF({ ...f, [k]: v || null })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f) }} className="grid gap-3 md:grid-cols-3" aria-label="Container details">
      {error && <p role="alert" className="md:col-span-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div><label htmlFor="c-size" className="label-dark">Size</label><select id="c-size" className="input-dark" value={f.size} onChange={(e) => set('size', e.target.value as ContainerSize)}>{SIZES.map((s) => <option key={s} value={s}>{sizeLabels[s]}</option>)}</select></div>
      <div><label htmlFor="c-line" className="label-dark">Shipping line</label><input id="c-line" className="input-dark" required placeholder="Maersk, MSC, CMA CGM…" value={f.line ?? ''} onChange={(e) => set('line', e.target.value)} /></div>
      <div><label htmlFor="c-booking" className="label-dark">Booking ref</label><input id="c-booking" className="input-dark" placeholder="From the line’s booking confirmation" value={f.bookingRef ?? ''} onChange={(e) => set('bookingRef', e.target.value)} /></div>
      <div><label htmlFor="c-number" className="label-dark">Container number</label><input id="c-number" className="input-dark font-mono" placeholder="MSKU 123456-7 (once assigned)" value={f.number ?? ''} onChange={(e) => set('number', e.target.value.toUpperCase())} /></div>
      <div><label htmlFor="c-seal" className="label-dark">Seal</label><input id="c-seal" className="input-dark font-mono" placeholder="Seal number" value={f.seal ?? ''} onChange={(e) => set('seal', e.target.value)} /></div>
      <div><label htmlFor="c-origin" className="label-dark">Origin port</label><input id="c-origin" className="input-dark" required placeholder="Houston, TX" value={f.originPort ?? ''} onChange={(e) => set('originPort', e.target.value)} /></div>
      <div><label htmlFor="c-dest" className="label-dark">Destination country</label><select id="c-dest" className="input-dark" value={f.destination ?? 'GH'} onChange={(e) => set('destination', e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
      <div className="md:col-span-2"><label htmlFor="c-dport" className="label-dark">Destination port</label><input id="c-dport" className="input-dark" placeholder="Tema, Lagos (Apapa), Abidjan…" value={f.destinationPort ?? ''} onChange={(e) => set('destinationPort', e.target.value)} /></div>
      <div><label htmlFor="c-cutoff" className="label-dark">Port cut-off</label><input id="c-cutoff" type="date" className="input-dark" value={f.cutoffDate ?? ''} onChange={(e) => date('cutoffDate', e.target.value)} /></div>
      <div><label htmlFor="c-etd" className="label-dark">ETD</label><input id="c-etd" type="date" className="input-dark" value={f.etd ?? ''} onChange={(e) => date('etd', e.target.value)} /></div>
      <div><label htmlFor="c-eta" className="label-dark">ETA</label><input id="c-eta" type="date" className="input-dark" value={f.eta ?? ''} onChange={(e) => date('eta', e.target.value)} /></div>
      <div><label htmlFor="c-vessel" className="label-dark">Vessel</label><input id="c-vessel" className="input-dark" placeholder="Grande Africa" value={f.vesselName ?? ''} onChange={(e) => set('vesselName', e.target.value)} /></div>
      <div><label htmlFor="c-mmsi" className="label-dark">MMSI <span className="font-normal text-text-muted">(for live tracking)</span></label><input id="c-mmsi" className="input-dark font-mono" inputMode="numeric" placeholder="247189000" value={f.mmsi ?? ''} onChange={(e) => set('mmsi', e.target.value.replace(/\D/g, ''))} /></div>
      <div><label htmlFor="c-voyage" className="label-dark">Voyage</label><input id="c-voyage" className="input-dark" placeholder="GA2634W" value={f.voyage ?? ''} onChange={(e) => set('voyage', e.target.value)} /></div>
      <div className="md:col-span-3"><label htmlFor="c-notes" className="label-dark">Notes</label><textarea id="c-notes" rows={2} className="input-dark py-2" placeholder="Yard location, trucker, special handling…" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={15} aria-hidden="true" /> {busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  )
}

type Tab = 'open' | 'closed' | 'all'

export default function Containers() {
  const { ready, user } = useStore()
  const nav = useNavigate()
  const [list, setList] = useState<Container[] | null>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ready || user?.role !== 'shipper' || user.staffRole === 'driver') return
    let live = true
    containersApi.list().then((c) => live && setList(c)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load containers.'))
    return () => { live = false }
  }, [ready, user])

  const rows = useMemo(() => {
    const all = list ?? []
    const byTab = tab === 'all' ? all : all.filter((c) => (tab === 'open' ? isOpen(c.status) : !isOpen(c.status)))
    const s = q.trim().toLowerCase()
    return s ? byTab.filter((c) => [c.ref, c.number, c.line, c.bookingRef, c.vesselName, c.originPort, c.destinationPort, countryByCode(c.destination)?.name ?? ''].join(' ').toLowerCase().includes(s)) : byTab
  }, [list, tab, q])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/containers" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />

  const all = list ?? []
  const n = (f: (c: Container) => boolean) => all.filter(f).length
  const stats = [
    { label: 'Loading now', value: n((c) => c.status === 'booked' || c.status === 'loading'), hint: 'Booked with the line, taking orders', icon: Boxes },
    { label: 'At the port', value: n((c) => c.status === 'gated_in'), hint: 'Gated in, waiting to sail', icon: Anchor },
    { label: 'On the water', value: n((c) => c.status === 'sailed'), hint: 'Sailed — tracked live by MMSI', icon: Waves },
    { label: 'At destination', value: n((c) => c.status === 'arrived' || c.status === 'customs'), hint: 'Discharged or clearing customs', icon: Ship },
  ]
  const create = async (c: ContainerInput) => {
    setBusy(true); setError('')
    try { const d = await containersApi.create(c); setModal(false); nav(`/dashboard/containers/${d.container.id}`) } catch (e) { setError(e instanceof Error ? e.message : 'Could not book the container.') } finally { setBusy(false) }
  }
  const chip = (t: Tab, label: string, count: number) => <button onClick={() => setTab(t)} aria-pressed={tab === t} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-ring ${tab === t ? 'border-gold bg-gold/10 text-text' : 'border-border text-text-muted hover:text-text'}`}>{label} <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{count}</span></button>

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Consolidation</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Containers</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Book a container with the shipping line, load the customer orders you’ve won into it, and move it through the port, the voyage and customs. Every order inside follows the container automatically.</motion.p></div>
            <motion.div variants={fadeUp}><button onClick={() => { setModal(true); setError('') }} className="btn-gold"><Plus size={16} aria-hidden="true" /> Book a container</button></motion.div>
          </div>

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => <div key={s.label} className="card-dark p-4"><div className="flex items-center justify-between"><p className="text-xs text-text-muted">{s.label}</p><s.icon size={15} className="text-gold-deep" aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{s.value}</p><p className="text-[11px] text-text-muted">{s.hint}</p></div>)}
          </motion.div>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            {chip('open', 'Open', n((c) => isOpen(c.status)))}{chip('closed', 'Closed', n((c) => !isOpen(c.status)))}{chip('all', 'All', all.length)}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <div className="relative min-w-[220px] flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label="Search containers" className="input-dark !min-h-10 !pl-9 text-sm" placeholder="Search ref, number, line, vessel, port…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </motion.div>

          {!modal && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.ul variants={fadeUp} className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Containers">
            {list === null && !error && <li className="md:col-span-2 py-10 text-center text-text-muted">Loading…</li>}
            {list && rows.length === 0 && <li className="md:col-span-2"><Empty title={all.length ? 'No containers match' : 'No containers yet'} body={all.length ? 'Try another tab or search.' : 'Book your first container with the shipping line, then load the ocean orders you have won into it.'} action={<button onClick={() => setModal(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Book a container</button>} /></li>}
            {rows.map((c) => {
              const d = countryByCode(c.destination)
              return (
                <li key={c.id}>
                  <Link to={`/dashboard/containers/${c.id}`} className={`card-dark block p-5 transition-colors hover:border-gold/40 focus-ring ${!isOpen(c.status) ? 'opacity-70' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-gold" aria-hidden="true"><ContainerIcon size={20} /></span><div><p className="font-semibold">{c.ref}{c.number && <span className="ml-2 font-mono text-xs font-normal text-text-muted">{c.number}</span>}</p><p className="text-xs text-text-muted">{sizeLabels[c.size]} · {c.line}{c.bookingRef ? ` · ${c.bookingRef}` : ''}</p></div></div>
                      <div className="flex flex-col items-end gap-1"><Pill tone={stageTone(c.status)}>{stageLabels[c.status]}</Pill>{c.tracking?.status === 'live' && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-teal"><Radio size={10} aria-hidden="true" /> auto-updating</span>}</div>
                    </div>
                    <div className="mt-4"><StageStepper status={c.status} compact /></div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                      <div><dt className="text-xs text-text-muted">Lane</dt><dd className="truncate">{c.originPort || '—'} → {c.destinationPort || d?.name || c.destination}</dd></div>
                      <div><dt className="text-xs text-text-muted">Orders loaded</dt><dd className="tabular-nums">{c.loaded ?? 0}</dd></div>
                      <div><dt className="text-xs text-text-muted">{c.status === 'booked' || c.status === 'loading' ? 'Cut-off' : c.status === 'gated_in' ? 'ETD' : 'ETA'}</dt><dd className="tabular-nums">{(() => { const v = c.status === 'booked' || c.status === 'loading' ? c.cutoffDate : c.status === 'gated_in' ? c.etd : c.eta; return v ? fmtDate(v + 'T12:00:00Z') : '—' })()}</dd></div>
                      <div><dt className="text-xs text-text-muted">Vessel</dt><dd className="truncate">{c.vesselName || <span className="text-text-muted">Not yet</span>}</dd></div>
                    </dl>
                  </Link>
                </li>
              )
            })}
          </motion.ul>
        </motion.div>
      </div>

      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !busy && setModal(false)}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Book a container" className="card-dark max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3"><div><h2 className="!text-lg">Book a container</h2><p className="mt-1 text-sm text-text-muted">Enter the booking you made with the shipping line. You can add the container number, seal and vessel later as the line confirms them.</p></div><button onClick={() => setModal(false)} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Close"><X size={16} /></button></div>
              <div className="mt-5"><ContainerForm initial={blankContainer} onSave={create} onCancel={() => setModal(false)} busy={busy} error={error} /></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
