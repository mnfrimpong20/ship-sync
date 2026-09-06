import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ChevronDown, Container, ChevronLeft, ChevronRight, Download, ExternalLink, Filter, Package, Plane, Plus, Radar, Search, Ship, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { countries, countryByCode, statusLabels, statusOrder, type Mode, type Shipment, type ShipmentStatus } from '../lib/data'
import { clientsApi, type Client } from '../lib/clients'
import { Empty, ModeBadge, Pill, fmtDate } from '../components/ui'
import { ShipmentDetail } from './Track'
import { fadeUp, stagger } from '../lib/motion'
import { containersApi, type Container as ContainerRec } from '../lib/containers'

type Bucket = 'all' | 'active' | 'pickup' | 'transit' | 'destination' | 'late' | 'untracked' | 'delivered'
type Sort = 'newest' | 'eta' | 'status' | 'ref'
const PAGE = 10
const today = () => new Date().toISOString().slice(0, 10)
const isLate = (s: Shipment) => s.status !== 'delivered' && !!s.eta && s.eta < today()
const untracked = (s: Shipment) => s.status !== 'delivered' && !s.mmsi && !s.flight
const bucketOf = (s: Shipment): Exclude<Bucket, 'all' | 'active' | 'late' | 'untracked'> => s.status === 'delivered' ? 'delivered' : s.status === 'booked' || s.status === 'picked_up' ? 'pickup' : s.status === 'at_origin_port' || s.status === 'in_transit' ? 'transit' : 'destination'
const inBucket = (s: Shipment, b: Bucket) => b === 'all' ? true : b === 'active' ? s.status !== 'delivered' : b === 'late' ? isLate(s) : b === 'untracked' ? untracked(s) : bucketOf(s) === b
const lastEvent = (s: Shipment) => s.events[s.events.length - 1]?.at ?? ''

function Progress({ status }: { status: ShipmentStatus }) {
  const i = statusOrder.indexOf(status)
  return <span className="flex gap-0.5" aria-hidden="true">{statusOrder.map((st, k) => <i key={st} className={`h-1.5 w-2.5 rounded-sm ${k <= i ? (status === 'delivered' ? 'bg-teal' : 'bg-gold') : 'bg-surface-2'}`} />)}</span>
}

function TrackingForm({ s, onDone }: { s: Shipment; onDone: (msg: string) => void }) {
  const { setTransit } = useStore()
  const [tf, setTf] = useState({ vesselName: s.vesselName ?? '', mmsi: s.mmsi ?? '', flight: s.flight ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await setTransit(s.id, s.mode === 'air' ? { flight: tf.flight } : { vesselName: tf.vesselName, mmsi: tf.mmsi }); onDone('Tracking details saved — customers now see the live position.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="grid gap-2">
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {s.mode === 'air'
        ? <div><label htmlFor={`fl-${s.id}`} className="label-dark">Flight callsign (ICAO)</label><input id={`fl-${s.id}`} className="input-dark !min-h-10 uppercase" placeholder="e.g. CLX775" value={tf.flight} onChange={(e) => setTf({ ...tf, flight: e.target.value })} required /></div>
        : <div className="grid gap-2 sm:grid-cols-2"><div><label htmlFor={`vn-${s.id}`} className="label-dark">Vessel name</label><input id={`vn-${s.id}`} className="input-dark !min-h-10" placeholder="e.g. MSC Alessia" value={tf.vesselName} onChange={(e) => setTf({ ...tf, vesselName: e.target.value })} /></div><div><label htmlFor={`mm-${s.id}`} className="label-dark">MMSI (9 digits)</label><input id={`mm-${s.id}`} className="input-dark !min-h-10 font-mono" placeholder="e.g. 636019825" inputMode="numeric" value={tf.mmsi} onChange={(e) => setTf({ ...tf, mmsi: e.target.value.replace(/\D/g, '').slice(0, 9) })} /></div></div>}
      <p className="text-[11px] text-text-muted">{s.mode === 'air' ? 'The ICAO callsign is on the airway bill (British Airways 75 = BAW75).' : 'The MMSI is on the bill of lading or any vessel-tracking site; it switches the customer’s tracking page to the live AIS position.'}</p>
      <div className="flex justify-end"><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{busy ? 'Saving…' : 'Save tracking'}</button></div>
    </form>
  )
}

function NewShipmentModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [clients, setClients] = useState<Client[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { clientsApi.list().then(setClients).catch(() => setClients([])) }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const list = (clients ?? []).filter((c) => c.status === 'active' && (!q || `${c.name} ${c.company} ${c.city}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New shipment" className="card-dark w-full max-w-lg p-6">
        <div className="flex items-start justify-between gap-3"><div><h2 className="!text-lg">New shipment</h2><p className="mt-1 text-sm text-text-muted">Pick the client it’s for — the booking form opens on their page with the consignee pre-filled.</p></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Close"><X size={16} /></button></div>
        <div className="relative mt-4"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input autoFocus aria-label="Search clients" className="input-dark !min-h-10 !pl-9 text-sm" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {clients === null && <li className="px-3 py-3 text-sm text-text-muted">Loading…</li>}
          {clients && list.length === 0 && <li className="px-3 py-3 text-sm text-text-muted">No clients match.</li>}
          {list.map((c) => <li key={c.id}><button onClick={() => nav(`/dashboard/clients/${c.id}?tab=shipments&book=1`)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface-2 focus-ring"><span><span className="block font-medium">{c.name}</span><span className="block text-xs text-text-muted">{[c.company, c.city].filter(Boolean).join(' · ') || c.email}</span></span><ChevronRight size={15} className="text-text-muted" aria-hidden="true" /></button></li>)}
        </ul>
        <p className="mt-3 text-xs text-text-muted">Not a client yet? <Link to="/dashboard/clients?new=1" className="text-gold-deep hover:underline">Add them first →</Link></p>
      </motion.div>
    </motion.div>
  )
}

export default function Shipments() {
  const { ready, user, shipments, advanceShipment } = useStore()
  const [sp, setSp] = useSearchParams()
  const bucket = (sp.get('b') as Bucket | null) ?? 'active'
  const q = sp.get('q') ?? ''; const mode = (sp.get('mode') as Mode | null) ?? ''; const dest = sp.get('destination') ?? ''; const sort = (sp.get('sort') as Sort | null) ?? 'newest'; const page = Math.max(1, Number(sp.get('page') ?? 1))
  const set = (patch: Record<string, string | undefined>, keepPage = false) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) } if (!keepPage) n.delete('page'); setSp(n, { replace: true }) }
  const [typed, setTyped] = useState(q)
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) set({ q: typed }) }, 300); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null)
  const [tracking, setTracking] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [containers, setContainers] = useState<ContainerRec[]>([])
  useEffect(() => { if (ready && user?.role === 'shipper' && user.staffRole !== 'driver') containersApi.list().then(setContainers).catch(() => {}) }, [ready, user])
  const containerOf = (s: Shipment) => (s.containerId ? containers.find((c) => c.id === s.containerId) : undefined)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  const mine = useMemo(() => shipments.filter((s) => s.shipperId === user?.shipperId), [shipments, user])
  const counts = useMemo(() => ({ active: mine.filter((s) => s.status !== 'delivered').length, pickup: mine.filter((s) => bucketOf(s) === 'pickup').length, transit: mine.filter((s) => bucketOf(s) === 'transit').length, destination: mine.filter((s) => bucketOf(s) === 'destination').length, late: mine.filter(isLate).length, untracked: mine.filter(untracked).length, delivered: mine.filter((s) => s.status === 'delivered').length }), [mine])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const rows = mine.filter((s) => inBucket(s, bucket) && (!mode || s.mode === mode) && (!dest || s.destination === dest) && (!ql || [s.ref, s.customer, s.description, s.origin, s.vesselName ?? '', s.flight ?? '', countryByCode(s.destination)?.name ?? ''].join(' ').toLowerCase().includes(ql)))
    rows.sort((a, b) => sort === 'eta' ? (a.eta ?? '').localeCompare(b.eta ?? '') : sort === 'status' ? statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || (b.eta ?? '').localeCompare(a.eta ?? '') : sort === 'ref' ? a.ref.localeCompare(b.ref) : lastEvent(b).localeCompare(lastEvent(a)))
    return rows
  }, [mine, bucket, mode, dest, q, sort])
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); const cur = Math.min(page, pages)
  const rows = list.slice((cur - 1) * PAGE, cur * PAGE)

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/shipments" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const advance = async (s: Shipment) => { setBusy(true); setError(''); try { await advanceShipment(s.id); setToast(`${s.ref} moved to “${statusLabels[statusOrder[Math.min(statusOrder.length - 1, statusOrder.indexOf(s.status) + 1)]]}”.`) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy(false) } }
  const exportCsv = () => {
    const head = ['Ref', 'Status', 'Mode', 'Origin', 'Destination', 'Cargo', 'Description', 'Customer', 'ETA', 'Vessel/Flight', 'MMSI']
    const lines = list.map((s) => [s.ref, statusLabels[s.status], s.mode, s.origin, countryByCode(s.destination)?.name ?? s.destination, s.cargo, s.description, s.customer, s.eta ?? '', s.flight ?? s.vesselName ?? '', s.mmsi ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `shipments-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const chip = (b: Bucket, label: string, n: number, tone = '') => <button key={b} onClick={() => set({ b: b === 'active' ? undefined : b })} aria-pressed={bucket === b} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${bucket === b ? 'border-gold bg-gold/15 text-gold-deep font-semibold' : 'border-border text-text-muted hover:text-text'} ${tone}`}>{label} <span className="tabular-nums opacity-70">{n}</span></button>

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Shipments</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{counts.active} active shipment{counts.active === 1 ? '' : 's'}</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Every booking on one board. Status updates go straight to the customer’s tracking page.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2"><button onClick={exportCsv} className="btn-ghost !min-h-10 !px-4 text-sm"><Download size={15} aria-hidden="true" /> Export CSV</button><button onClick={() => setModal(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> New shipment</button></motion.div>
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-text">{toast}</motion.p>}</AnimatePresence>
          {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {([['pickup', 'Awaiting pickup', Package, counts.pickup, 'Booked or collected, not yet at port'], ['transit', 'On the water / in the air', Ship, counts.transit, 'At origin port or sailing'], ['destination', 'At destination', Radar, counts.destination, 'Arrived, customs or out for delivery'], ['late', 'Past ETA', AlertTriangle, counts.late, 'Update the ETA or the status'], ['untracked', 'No live tracking', Plane, counts.untracked, 'Add vessel MMSI or flight']] as const).map(([b, l, I, n, h]) => (
              <button key={b} onClick={() => set({ b })} aria-pressed={bucket === b} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${bucket === b ? '!border-gold' : ''} ${b === 'late' && n > 0 ? 'border-l-4 border-l-danger' : ''}`}>
                <div className="flex items-center justify-between"><p className="text-xs text-text-muted">{l}</p><I size={15} className={b === 'late' && n > 0 ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /></div>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{n}</p><p className="text-[11px] text-text-muted">{h}</p>
              </button>
            ))}
          </motion.div>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            {chip('active', 'Active', counts.active)}{chip('delivered', 'Delivered', counts.delivered)}{chip('all', 'All', mine.length)}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <div className="relative min-w-[220px] flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label="Search shipments" className="input-dark !min-h-10 !pl-9 text-sm" placeholder="Search ref, customer, cargo, vessel…" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
            <select aria-label="Mode" className="input-dark !min-h-10 !w-auto text-sm" value={mode} onChange={(e) => set({ mode: e.target.value })}><option value="">Air & ocean</option><option value="ocean">Ocean</option><option value="air">Air</option></select>
            <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => set({ destination: e.target.value })}><option value="">All destinations</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            <select aria-label="Sort" className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => set({ sort: e.target.value === 'newest' ? undefined : e.target.value }, true)}><option value="newest">Latest activity</option><option value="eta">ETA soonest</option><option value="status">By stage</option><option value="ref">Reference</option></select>
            {(q || mode || dest || (bucket !== 'active')) && <button onClick={() => { setTyped(''); setSp(new URLSearchParams(), { replace: true }) }} className="btn-ghost !min-h-10 !px-3 text-sm"><Filter size={14} aria-hidden="true" /> Reset</button>}
          </motion.div>

          <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="w-8 px-3 py-3" /><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Route</th><th className="px-3 py-3">Cargo</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Stage</th><th className="px-3 py-3">ETA</th><th className="px-3 py-3">Tracking</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10"><Empty title={mine.length ? 'No shipments match' : 'No shipments yet'} body={mine.length ? 'Try another filter or search.' : 'Accepted quotes become shipments here, or book one directly for a client.'} action={<button onClick={() => setModal(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> New shipment</button>} /></td></tr>}
                  {rows.map((s) => {
                    const d = countryByCode(s.destination); const late = isLate(s); const isOpen = open === s.id
                    return (
                      <Fragment key={s.id}>
                        <tr className={`border-b border-border/70 align-top transition-colors hover:bg-surface-2/60 ${isOpen ? 'bg-surface-2/40' : ''}`}>
                          <td className="px-3 py-3"><button onClick={() => setOpen(isOpen ? null : s.id)} className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${s.ref}`}><ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button></td>
                          <td className="px-3 py-3"><Link to={`/track?ref=${s.ref}`} className="font-mono text-xs text-gold-deep hover:underline focus-ring">{s.ref}</Link><div className="mt-1"><ModeBadge mode={s.mode} /></div></td>
                          <td className="whitespace-nowrap px-3 py-3"><p className="font-semibold">{s.origin}</p><p className="text-xs text-text-muted">→ {d?.name ?? s.destination}</p></td>
                          <td className="max-w-[260px] px-3 py-3"><p className="truncate" title={s.description}>{s.description || '—'}</p><p className="text-xs capitalize text-text-muted">{s.cargo.replace('container', 'container ')}</p></td>
                          <td className="px-3 py-3">{s.clientId ? <Link to={`/dashboard/clients/${s.clientId}`} className="hover:text-gold-deep focus-ring">{s.customer}</Link> : s.customer}</td>
                          <td className="px-3 py-3"><Pill tone={s.status === 'delivered' ? 'green' : late ? 'danger' : 'teal'}>{statusLabels[s.status]}</Pill><div className="mt-1.5"><Progress status={s.status} /></div></td>
                          <td className="px-3 py-3 tabular-nums">{s.eta ? <span className={late ? 'font-semibold text-danger' : ''}>{fmtDate(s.eta + 'T12:00:00Z')}{late && <span className="block text-[11px] font-normal">past ETA</span>}</span> : '—'}</td>
                          <td className="px-3 py-3 text-xs">{(() => { const c = containerOf(s); return <>{c && <Link to={`/dashboard/containers/${c.id}`} className="mb-1 inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold-deep hover:border-gold focus-ring"><Container size={11} aria-hidden="true" /> {c.ref}</Link>}{c && <br />}{s.flight || s.vesselName ? <span className="inline-flex items-center gap-1">{s.mode === 'air' ? <Plane size={13} className="text-sky" aria-hidden="true" /> : <Ship size={13} className="text-teal" aria-hidden="true" />}{s.flight ?? s.vesselName}{s.mmsi ? <span className="text-text-muted"> · {s.mmsi}</span> : ''}</span> : c ? <span className="text-text-muted">Follows container</span> : s.status !== 'delivered' ? <button onClick={() => { setOpen(s.id); setTracking(s.id) }} className="text-gold-deep hover:underline focus-ring">Add tracking</button> : <span className="text-text-muted">—</span>}</> })()}</td>
                          <td className="px-3 py-3 text-right"><div className="inline-flex gap-1.5">{s.status !== 'delivered' && <button onClick={() => advance(s)} disabled={busy} className="btn-ghost !min-h-8 whitespace-nowrap !px-2.5 text-xs disabled:opacity-60">Next step <ChevronRight size={13} aria-hidden="true" /></button>}<Link to={`/track?ref=${s.ref}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-label={`Open tracking page for ${s.ref}`} title="Tracking page"><ExternalLink size={13} /></Link></div></td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={8} className="px-3 pb-5 pt-2">
                            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                              <div className="rounded-xl border border-border bg-surface p-4"><ShipmentDetail s={s} compact /></div>
                              <div className="space-y-4">
                                {s.status !== 'delivered' && <div className="rounded-xl border border-border bg-surface p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Live tracking</p>{tracking === s.id ? <TrackingForm s={s} onDone={(m) => { setTracking(null); setToast(m) }} /> : <button onClick={() => setTracking(s.id)} className="btn-ghost !min-h-9 w-full text-xs">{s.flight || s.vesselName ? 'Edit tracking details' : `Add ${s.mode === 'air' ? 'flight' : 'vessel & MMSI'}`}</button>}</div>}
                                <div className="rounded-xl border border-border bg-surface p-4 text-xs text-text-muted"><p className="mb-1 font-semibold uppercase tracking-wider">Links</p><ul className="space-y-1"><li><Link to={`/track?ref=${s.ref}`} className="text-gold-deep hover:underline">Customer tracking page ↗</Link></li>{s.clientId && <li><Link to={`/dashboard/clients/${s.clientId}?tab=shipments`} className="text-gold-deep hover:underline">Client record — {s.customer}</Link></li>}{s.clientId && <li><Link to={`/dashboard/clients/${s.clientId}?tab=invoices`} className="text-gold-deep hover:underline">Invoices for this client</Link></li>}{(s.mmsi || s.flight) && <li><Link to={s.mmsi ? `/live?vessel=${s.mmsi}` : `/live?flight=${s.flight}`} className="text-gold-deep hover:underline">Show on live map</Link></li>}</ul></div>
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-text-muted">
              <span>{list.length === 0 ? 'No results' : `Showing ${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, list.length)} of ${list.length}`}</span>
              {pages > 1 && <nav className="flex items-center gap-1" aria-label="Pagination"><button onClick={() => set({ page: String(cur - 1) }, true)} disabled={cur <= 1} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Previous page"><ChevronLeft size={14} /></button>{Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1).map((n, i, arr) => <span key={n} className="contents">{i > 0 && arr[i - 1] !== n - 1 && <span className="px-1">…</span>}<button onClick={() => set({ page: String(n) }, true)} aria-current={n === cur ? 'page' : undefined} className={`h-8 min-w-8 rounded-md border px-2 focus-ring ${n === cur ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border'}`}>{n}</button></span>)}<button onClick={() => set({ page: String(cur + 1) }, true)} disabled={cur >= pages} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Next page"><ChevronRight size={14} /></button></nav>}
            </div>
          </motion.div>
        </motion.div>
      </div>
      <AnimatePresence>{modal && <NewShipmentModal onClose={() => setModal(false)} />}</AnimatePresence>
    </div>
  )
}
