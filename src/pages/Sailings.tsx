import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Anchor, Calendar, Check, Ship, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { bookingApi, unitLabels, type Booking, type Sailing, type Unit } from '../lib/booking'
import { containersApi, type Container } from '../lib/containers'
import { countries } from '../lib/data'
import { Empty, Pill, fmtDate, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { StatCard } from '../components/board'

const day = (d: string | null) => (d ? fmtDate(d + 'T12:00:00Z') : '—')
const daysTo = (d: string | null) => (d ? Math.round((new Date(d + 'T12:00:00Z').getTime() - Date.now()) / 86400000) : 0)

export function SailingCard({ s, onBook, compact = false }: { s: Sailing; onBook?: (s: Sailing) => void; compact?: boolean }) {
  const units = Object.entries(s.rates) as [Unit, number][]
  const cut = daysTo(s.cutoff)
  return (
    <div className="card-dark flex h-full min-w-0 flex-col p-5" data-testid="sailing-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-semibold">{s.line} <span className="font-normal text-text-muted">· {s.kind === 'roro' ? 'RoRo' : 'Container'}</span></p><p className="truncate text-xs text-text-muted">{s.vesselName} {s.voyage}{s.service ? ` · ${s.service}` : ''}</p></div>
        <span className="shrink-0"><Pill tone={s.spaceLeft === 0 ? 'danger' : cut <= 3 ? 'gold' : 'teal'}>{s.spaceLeft === 0 ? 'Full' : cut <= 0 ? 'Cut-off today' : cut <= 3 ? `Cut-off in ${cut}d` : `${s.spaceLeft} slots`}</Pill></span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"><div><p className="font-semibold">{s.originPort}</p><p className="whitespace-nowrap text-xs text-text-muted">Sails {day(s.etd)}</p></div><Ship size={16} className="text-gold-deep" aria-hidden="true" /><div className="text-right"><p className="font-semibold">{s.destinationPort}</p><p className="whitespace-nowrap text-xs text-text-muted">ETA {day(s.eta)} · {s.transitDays}d</p></div></div>
      {!compact && <dl className="mt-3 grid gap-1 text-xs">{units.map(([u, r]) => <div key={u} className="flex justify-between"><dt className="text-text-muted">{unitLabels[u]}</dt><dd className="font-semibold tabular-nums">{money(r)}</dd></div>)}</dl>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3"><span className="inline-flex items-center gap-1 text-xs text-text-muted"><Calendar size={11} aria-hidden="true" /> Docs by {day(s.cutoff)}</span>{onBook && <button onClick={() => onBook(s)} disabled={s.spaceLeft === 0} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="book-sailing">Book space</button>}</div>
    </div>
  )
}

function BookDialog({ s, containers, vehicles, preset, onClose, onDone }: { s: Sailing; containers: Container[]; vehicles: { id: string; ref: string; description: string }[]; preset: { containerId?: string; shipmentId?: string }; onClose: () => void; onDone: (b: Booking, c: { id: string; ref: string } | null) => void }) {
  const units = (Object.keys(s.rates) as Unit[])
  const [f, setF] = useState<{ unit: Unit; quantity: number; target: string; note: string }>({ unit: units[0], quantity: 1, target: preset.containerId ? `c:${preset.containerId}` : preset.shipmentId ? `s:${preset.shipmentId}` : s.kind === 'container' ? 'new' : vehicles[0] ? `s:${vehicles[0].id}` : '', note: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const total = (s.rates[f.unit] ?? 0) * f.quantity
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await bookingApi.book({ sailingId: s.id, unit: f.unit, quantity: f.quantity, containerId: f.target.startsWith('c:') ? f.target.slice(2) : undefined, shipmentId: f.target.startsWith('s:') ? f.target.slice(2) : undefined, newContainer: f.target === 'new', note: f.note }); onDone(r.booking, r.container) } catch (err) { setError(err instanceof Error ? err.message : 'Could not book.') } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bk-h" className="card-dark w-full max-w-md p-6" data-testid="book-dialog">
        <h2 id="bk-h" className="!text-lg">Book with {s.line}</h2>
        <p className="mt-1 text-sm text-text-muted">{s.vesselName} {s.voyage} · {s.originPort} → {s.destinationPort} · sails {day(s.etd)}</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <label className="mt-4 block text-xs text-text-muted">Slot<select aria-label="Slot" className="input-dark mt-1 !min-h-10 text-sm" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Unit })}>{units.map((u) => <option key={u} value={u}>{unitLabels[u]} — {money(s.rates[u] ?? 0)}</option>)}</select></label>
        {s.kind === 'container' ? (
          <>
            <label className="mt-3 block text-xs text-text-muted">For<select aria-label="For" className="input-dark mt-1 !min-h-10 text-sm" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="new">A new container (created for you)</option>{containers.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.ref} · {c.size} · {c.destinationPort || c.destination}{c.loaded ? ` · ${c.loaded} loaded` : ''}</option>)}<option value="">Just hold the space</option></select></label>
            <label className="mt-3 block text-xs text-text-muted">Quantity<input type="number" min={1} max={50} aria-label="Quantity" className="input-dark mt-1 !min-h-10 !w-24 text-sm tabular-nums" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) })} /></label>
          </>
        ) : (
          <label className="mt-3 block text-xs text-text-muted">Vehicle shipment<select required aria-label="Vehicle shipment" className="input-dark mt-1 !min-h-10 text-sm" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={`s:${v.id}`}>{v.ref} · {v.description}</option>)}</select>{vehicles.length === 0 && <span className="mt-1 block text-xs">No booked vehicle shipments waiting — book one first.</span>}</label>
        )}
        <input aria-label="Note" className="input-dark mt-3 !min-h-10 w-full text-sm" placeholder="Note for the line (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm"><span className="text-text-muted">Ocean freight</span><strong className="tabular-nums" data-testid="book-total">{money(total)}</strong></div>
        <p className="mt-2 text-xs text-text-muted">Confirmation comes back with a booking reference; the vessel, voyage and dates are written onto the container {s.kind === 'roro' ? '/ shipment' : ''} so tracking and consolidation pick them up. Freight is invoiced by the line.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy || (s.kind === 'roro' && !f.target)} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy ? 'Booking…' : 'Confirm booking'}</button></div>
      </form>
    </div>
  )
}

export default function Sailings() {
  const { ready, user, shipments } = useStore()
  const [sp] = useSearchParams()
  const [data, setData] = useState<Awaited<ReturnType<typeof bookingApi.sailings>> | null>(null)
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [containers, setContainers] = useState<Container[]>([])
  const [dest, setDest] = useState(sp.get('destination') ?? '')
  const [kind, setKind] = useState(sp.get('kind') ?? '')
  const [booking, setBooking] = useState<Sailing | null>(null)
  const [port, setPort] = useState(''); const [soon, setSoon] = useState(false); const [shown, setShown] = useState(10)
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const preset = useMemo(() => ({ containerId: sp.get('container') ?? undefined, shipmentId: sp.get('shipment') ?? undefined }), [sp])
  const load = () => Promise.all([bookingApi.sailings({ destination: dest, kind }).then(setData), bookingApi.list().then(setBookings), containersApi.list().then((c) => setContainers(c.filter((x) => x.status === 'booked' || x.status === 'loading')))]).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user, dest, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (preset.containerId && data && !booking) { const c = containers.find((x) => x.id === preset.containerId); if (c && !kind) setKind('container'); if (c && !dest) setDest(c.destination) } }, [preset, data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/sailings" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />
  const vehicles = shipments.filter((s) => s.cargo === 'vehicle' && ['booked', 'picked_up', 'at_origin_port'].includes(s.status)).map((s) => ({ id: s.id, ref: s.ref, description: s.description }))
  const all = data?.sailings ?? []
  const ports = Array.from(new Set(all.map((x) => x.originPort))).sort()
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const list = all.filter((x) => (!port || x.originPort === port) && (!soon || (!!x.cutoff && x.cutoff.slice(0, 10) <= weekOut)))
  const live = (bookings ?? []).filter((b) => b.status === 'confirmed')
  const cancel = async (b: Booking) => { setBusy(b.id); try { await bookingApi.cancel(b.id); await load(); setToast('Booking cancelled; the slot is released.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel.') } finally { setBusy('') } }
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Carrier booking</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Book space on a sailing</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Live schedules for the US / UK → West Africa lanes with rates, cut-offs and space. Book a container slot (or a RoRo slot for a vehicle) and the confirmation lands on your container with the vessel, voyage and dates filled in.</motion.p></div>
            <motion.div variants={fadeUp}><Link to="/dashboard/containers" className="btn-ghost">Containers</Link></motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatCard label="Open sailings" value={all.length} hint="Next 9 weeks" icon={Ship} />
            <StatCard label="Confirmed bookings" value={live.length} hint={live.length ? `${live.reduce((n, b) => n + b.quantity, 0)} slots` : 'None yet'} icon={Anchor} />
            <StatCard label="Next cut-off" value={list[0]?.cutoff ? day(list[0].cutoff) : '—'} hint={list[0] ? `${list[0].line} · ${list[0].vesselName}` : ''} icon={Calendar} />
          </motion.div>
          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => setDest(e.target.value)}><option value="">Any destination</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            <select aria-label="Leaving from" className="input-dark !min-h-10 !w-auto text-sm" value={port} onChange={(e) => { setPort(e.target.value); setShown(10) }} data-testid="sailing-port"><option value="">Any origin port</option>{ports.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <button type="button" onClick={() => { setSoon((v) => !v); setShown(10) }} aria-pressed={soon} className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm focus-ring ${soon ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border text-text-muted hover:text-text'}`} data-testid="sailing-soon">Cut-off this week</button>
            <select aria-label="Kind" className="input-dark !min-h-10 !w-auto text-sm" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Containers & RoRo</option><option value="container">Container services</option><option value="roro">RoRo (vehicles)</option></select>
            {data && <span className="text-xs text-text-muted">Schedule: {data.provider === 'builtin' ? 'built-in (indicative)' : data.provider}</span>}
          </motion.div>
          <motion.div variants={fadeUp} className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data === null && !error && <BrandLoader full={false} />}
            {data && list.length === 0 && <div className="md:col-span-3"><Empty title="No open sailings on this lane" body="Try another destination, or ask Ntemtem to add a line." /></div>}
            {list.slice(0, shown).map((s) => <SailingCard key={s.id} s={s} onBook={setBooking} />)}
          </motion.div>
          {list.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted"><span data-testid="sailing-count">Showing {Math.min(shown, list.length)} of {list.length} sailing{list.length === 1 ? '' : 's'}</span>{list.length > shown && <button onClick={() => setShown((n) => n + 10)} className="btn-ghost !min-h-11 !px-4 text-sm" data-testid="sailing-more">Show {Math.min(10, list.length - shown)} more</button>}</div>}
          <motion.div variants={fadeUp} className="card-dark mt-8 overflow-hidden" data-testid="bookings">
            <div className="flex items-center justify-between px-5 pt-5"><h2 className="!text-base">Your bookings</h2></div>
            <ul className="mt-3 divide-y divide-border/70 text-sm">
              {bookings && bookings.length === 0 && <li className="px-5 py-4 text-text-muted">No bookings yet.</li>}
              {bookings?.map((b) => (
                <li key={b.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${b.status === 'cancelled' || b.status === 'rejected' ? 'dimmed' : ''}`} data-testid="booking-row">
                  <div className="min-w-0"><p className="font-semibold">{b.bookingRef || '—'} <span className="font-normal text-text-muted">· {b.sailing?.line} · {b.sailing?.vesselName} {b.sailing?.voyage}</span></p><p className="text-xs text-text-muted">{b.quantity} × {b.unitLabel} · {money(b.totalUsd)} · sails {day(b.sailing?.etd ?? null)} · docs by {day(b.sailing?.cutoff ?? null)}{b.containerRef ? <> · <Link to={`/dashboard/containers/${b.containerId}`} className="text-gold-deep hover:underline">{b.containerRef}</Link></> : ''}{b.shipmentRef ? <> · <Link to={`/dashboard/shipments?q=${b.shipmentRef}&b=all`} className="text-gold-deep hover:underline">{b.shipmentRef}</Link></> : ''}</p>{b.carrierNote && <p className="text-xs text-text-muted">{b.carrierNote}</p>}</div>
                  <div className="flex items-center gap-2"><Pill tone={b.status === 'confirmed' ? 'green' : b.status === 'rejected' ? 'danger' : 'muted'}>{b.status}</Pill>{b.status === 'confirmed' && <button onClick={() => cancel(b)} disabled={busy === b.id} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-danger focus-ring" aria-label="Cancel booking"><X size={13} /></button>}</div>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </div>
      {booking && <BookDialog s={booking} containers={containers.filter((c) => c.destination === booking.destination)} vehicles={vehicles} preset={preset} onClose={() => setBooking(null)} onDone={(b, c) => { setBooking(null); void load(); setToast(b.status === 'confirmed' ? `Confirmed — ${b.bookingRef}${c ? ` on container ${c.ref}` : ''}.` : `The line rejected it: ${b.carrierNote}`) }} />}
    </div>
  )
}

/** `/sailings` — public schedule for customers planning when to ship. */
export function PublicSailings() {
  const [sp] = useSearchParams()
  const [dest, setDest] = useState(sp.get('destination') ?? 'GH')
  const [data, setData] = useState<Sailing[] | null>(null)
  useEffect(() => { bookingApi.sailings({ destination: dest }).then((r) => setData(r.sailings)).catch(() => setData([])) }, [dest])
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Sailing schedule</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">Next sailings to West Africa</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Container services and RoRo car carriers from the US and UK. Shippers on Ntemtem book space on these directly, so your goods are on the next departure.</motion.p>
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 max-w-5xl">
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2"><select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => setDest(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select><Link to="/quote" className="btn-gold !min-h-10 !px-4 text-sm">Get a quote</Link></motion.div>
          <motion.div variants={fadeUp} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data === null && <BrandLoader full={false} />}{data && data.length === 0 && <div className="md:col-span-3"><Empty title="No sailings listed" body="Check back soon." /></div>}{data?.slice(0, 12).map((s) => <SailingCard key={s.id} s={s} compact />)}</motion.div>
        </motion.div>
      </div>
    </div>
  )
}
