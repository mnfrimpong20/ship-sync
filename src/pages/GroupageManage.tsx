import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Boxes, Check, Lock, Package, Plus, Users, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { groupageApi, groupageStatusLabels, unitsLabel, type Groupage, type GroupageInput, type GroupageKindInfo, type Spot } from '../lib/groupage'
import { countries } from '../lib/data'
import { Empty, Pill, fmtDate, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Confirm, StatCard } from '../components/board'
import { FillBar } from './Groupage'

const day = (d: string | null) => (d ? fmtDate(d + 'T12:00:00Z') : '—')
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const blank = (kinds: GroupageKindInfo[]): GroupageInput => ({ kind: 'barrel', title: '', origin: 'Houston, TX', destination: 'GH', destinationCity: 'Tema', capacity: kinds.find((k) => k.id === 'barrel')?.defaultCapacity ?? 8, pricePerUnitUsd: 45, minUnits: 1, maxUnits: null, includes: ['Ocean freight'], closesAt: plus(14), departsAt: plus(18), transitDays: 35, notes: '' })

function SlotForm({ kinds, initial, onSaved, onCancel }: { kinds: GroupageKindInfo[]; initial: GroupageInput & { id?: string }; onSaved: (g: Groupage) => void; onCancel: () => void }) {
  const [f, setF] = useState<GroupageInput>(initial)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const k = kinds.find((x) => x.id === f.kind)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { onSaved(initial.id ? await groupageApi.update(initial.id, f) : await groupageApi.create(f)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <form onSubmit={submit} className="card-dark grid gap-3 p-5 sm:grid-cols-2" aria-label={initial.id ? 'Edit shared slot' : 'Open a shared slot'} data-testid="slot-form">
      <h2 className="!text-base sm:col-span-2">{initial.id ? 'Edit slot' : 'Open a shared slot'}</h2>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <label className="text-xs text-text-muted">Kind<select className="input-dark mt-1 !min-h-9 text-sm" value={f.kind} disabled={!!initial.id} onChange={(e) => { const nk = kinds.find((x) => x.id === e.target.value); setF({ ...f, kind: e.target.value as GroupageInput['kind'], capacity: nk?.defaultCapacity ?? f.capacity, pricePerUnitUsd: e.target.value === 'barrel' ? 45 : 320 }) }}>{kinds.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>{k && <span className="mt-1 block text-[11px]">{k.hint}</span>}</label>
      <label className="text-xs text-text-muted">Title<input required minLength={3} className="input-dark mt-1 !min-h-9 text-sm" placeholder="e.g. November barrel to Tema" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="text-xs text-text-muted">Origin<input required className="input-dark mt-1 !min-h-9 text-sm" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-text-muted">Destination<select className="input-dark mt-1 !min-h-9 text-sm" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label><label className="text-xs text-text-muted">City / port<input className="input-dark mt-1 !min-h-9 text-sm" value={f.destinationCity} onChange={(e) => setF({ ...f, destinationCity: e.target.value })} /></label></div>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <label className="text-xs text-text-muted">Capacity ({k?.unitPlural})<input type="number" min={2} required className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) || 0 })} /></label>
        <label className="text-xs text-text-muted">Price per {k?.unit} (USD)<input type="number" min={1} step="0.01" required className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.pricePerUnitUsd} onChange={(e) => setF({ ...f, pricePerUnitUsd: Number(e.target.value) || 0 })} /></label>
        <label className="text-xs text-text-muted">Max per person<input type="number" min={1} className="input-dark mt-1 !min-h-9 text-sm tabular-nums" placeholder="no limit" value={f.maxUnits ?? ''} onChange={(e) => setF({ ...f, maxUnits: e.target.value ? Number(e.target.value) : null })} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <label className="text-xs text-text-muted">Bookings close<input type="date" required className="input-dark mt-1 !min-h-9 text-sm" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} /></label>
        <label className="text-xs text-text-muted">Sails<input type="date" required className="input-dark mt-1 !min-h-9 text-sm" value={f.departsAt} onChange={(e) => setF({ ...f, departsAt: e.target.value })} /></label>
        <label className="text-xs text-text-muted">Transit (days)<input type="number" min={1} required className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.transitDays} onChange={(e) => setF({ ...f, transitDays: Number(e.target.value) || 1 })} /></label>
      </div>
      <label className="text-xs text-text-muted sm:col-span-2">What’s included (comma-separated)<input className="input-dark mt-1 !min-h-9 text-sm" value={f.includes.join(', ')} onChange={(e) => setF({ ...f, includes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8) })} /></label>
      <label className="text-xs text-text-muted sm:col-span-2">Notes for customers (drop-off address, what’s allowed…)<textarea rows={2} className="input-dark mt-1 py-2 text-sm" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-9 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy ? 'Saving…' : initial.id ? 'Save changes' : 'Open slot'}</button></div>
    </form>
  )
}

export default function GroupageManage() {
  const { ready, user } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof groupageApi.manage>> | null>(null)
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [editing, setEditing] = useState<(GroupageInput & { id?: string }) | null>(null)
  const [closing, setClosing] = useState<Groupage | null>(null)
  const [cancelling, setCancelling] = useState<Groupage | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => groupageApi.manage().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/groupage" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />
  const all = data?.groupages ?? []; const live = all.filter((g) => g.status === 'open' || g.status === 'full')
  const act = async (fn: () => Promise<unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setClosing(null); setCancelling(null) } }
  const reservedValue = live.reduce((n, g) => n + g.reserved * g.pricePerUnitUsd, 0)
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Fill a barrel</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{live.length ? `${live.length} shared ${live.length === 1 ? 'slot' : 'slots'} filling` : 'Shared barrels & containers'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Open a barrel or container on a sailing and let customers reserve the space they need. When you close it, every reservation becomes a booked shipment with its own reference, payment link and pickup.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2"><Link to="/groupage" className="btn-ghost">Public page</Link>{data && !editing && <button onClick={() => setEditing(blank(data.kinds))} className="btn-gold" data-testid="new-slot"><Plus size={16} aria-hidden="true" /> Open a slot</button>}</motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Filling" value={live.length} hint={`${live.filter((g) => g.status === 'full').length} full`} icon={Package} />
            <StatCard label="Reserved" value={live.reduce((n, g) => n + g.reserved, 0)} hint="Units across open slots" icon={Boxes} />
            <StatCard label="People" value={live.reduce((n, g) => n + g.participants, 0)} hint="Waiting to be booked" icon={Users} />
            <StatCard label="Reserved value" value={money(reservedValue)} hint="Billed when you close" icon={Lock} />
          </motion.div>
          {editing && data && <motion.div variants={fadeUp} className="mt-6"><SlotForm kinds={data.kinds} initial={editing} onSaved={() => { setEditing(null); void load(); setToast(editing.id ? 'Slot updated.' : 'Slot opened — it’s live on the public page.') }} onCancel={() => setEditing(null)} /></motion.div>}
          <motion.div variants={fadeUp} className="mt-6 space-y-4">
            {data === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
            {data && all.length === 0 && <Empty title="No shared slots yet" body="Open a barrel or a container on your next sailing. Customers with less than a full load find it on the public page and reserve space." />}
            {all.map((g) => (
              <div key={g.id} className={`card-dark p-5 ${g.status === 'cancelled' ? 'opacity-60' : ''}`} data-testid="slot-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><p className="font-semibold">{g.title} <Pill tone={g.status === 'full' ? 'teal' : g.status === 'closed' ? 'green' : g.status === 'cancelled' ? 'muted' : 'gold'}>{groupageStatusLabels[g.status]}</Pill></p><p className="mt-0.5 text-xs text-text-muted">{g.kindLabel} · {g.origin} → {g.destinationCity || g.destinationName} · {money(g.pricePerUnitUsd)} per {g.unit} · closes {day(g.closesAt)} · sails {day(g.departsAt)}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setOpen(open === g.id ? null : g.id)} className="btn-ghost !min-h-8 !px-3 text-xs"><Users size={12} aria-hidden="true" /> {g.participants} {g.participants === 1 ? 'person' : 'people'}</button>
                    {(g.status === 'open' || g.status === 'full') && <>
                      <button onClick={() => setEditing({ id: g.id, kind: g.kind, title: g.title, origin: g.origin, destination: g.destination, destinationCity: g.destinationCity, capacity: g.capacity, pricePerUnitUsd: g.pricePerUnitUsd, minUnits: g.minUnits, maxUnits: g.maxUnits, includes: g.includes, closesAt: g.closesAt ?? plus(7), departsAt: g.departsAt ?? plus(10), transitDays: g.transitDays, notes: g.notes })} className="btn-ghost !min-h-8 !px-3 text-xs">Edit</button>
                      <button onClick={() => setClosing(g)} disabled={g.participants === 0} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="close-slot"><Check size={12} aria-hidden="true" /> Close & book {g.participants ? `(${g.participants})` : ''}</button>
                      <button onClick={() => { setCancelling(g); setReason('') }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-danger focus-ring" aria-label="Cancel slot"><X size={13} /></button>
                    </>}
                  </div>
                </div>
                <div className="mt-3 max-w-xl"><FillBar g={g} /></div>
                {open === g.id && (
                  <ul className="mt-3 divide-y divide-border/70 text-sm" data-testid="spot-list">
                    {g.spots.length === 0 && <li className="py-2 text-text-muted">Nobody has reserved yet. Share the public page.</li>}
                    {g.spots.map((s: Spot) => (
                      <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${s.status === 'cancelled' ? 'opacity-60' : ''}`}>
                        <div className="min-w-0"><p className="font-medium">{s.name} <span className="font-normal text-text-muted">· {unitsLabel(g, s.units)} · {money(s.amountUsd)}{s.pickup ? ' · wants pickup' : ''}</span></p><p className="truncate text-xs text-text-muted">{s.description} · {s.phone}</p></div>
                        <div className="flex items-center gap-2">{s.shipmentRef ? <Link to={`/dashboard/shipments?q=${s.shipmentRef}&b=all`} className="font-mono text-xs text-gold-deep hover:underline">{s.shipmentRef}</Link> : <Pill tone={s.status === 'cancelled' ? 'muted' : 'gold'}>{s.status}</Pill>}{s.status === 'reserved' && <button onClick={() => act(() => groupageApi.cancelSpot(s.id), 'Reservation removed.', s.id)} disabled={busy === s.id} className="text-xs text-text-muted hover:text-danger">Remove</button>}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
      {closing && <Confirm title={`Close “${closing.title}” and book ${closing.participants} ${closing.participants === 1 ? 'person' : 'people'}?`} danger={false} body={<p>Each reservation becomes a booked shipment with its own reference. Customers are notified and asked to pay {money(closing.reserved * closing.pricePerUnitUsd)} in total ({unitsLabel(closing, closing.reserved)}). No more reservations after this.</p>} confirmLabel="Close & book" busy={busy === 'close'} onClose={() => setClosing(null)} onConfirm={() => act(async () => { const r = await groupageApi.close(closing.id); setToast(`${r.shipmentIds.length} shipments booked — find them on the Shipments board.`) }, `${closing.participants} shipments booked — find them on the Shipments board.`, 'close')} />}
      {cancelling && <Confirm title={`Cancel “${cancelling.title}”?`} body={<div><p>{cancelling.participants} {cancelling.participants === 1 ? 'reservation is' : 'reservations are'} released and everyone is told. Nothing has been charged.</p><input aria-label="Reason" className="input-dark mt-3 !min-h-9 w-full text-sm" placeholder="Reason (optional, shown to customers)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>} confirmLabel="Cancel slot" busy={busy === 'cancel'} onClose={() => setCancelling(null)} onConfirm={() => act(() => groupageApi.cancel(cancelling.id, reason), 'Slot cancelled.', 'cancel')} />}
    </div>
  )
}
