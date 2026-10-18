import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, Check, MapPin, Truck, X } from 'lucide-react'
import { fmtDay, pickupStatusLabels, pickupsApi, type Pickup, type PickupSlot } from '../lib/pickups'
import { useStore } from '../lib/store'
import { Pill } from './ui'
import { Confirm } from './board'

const tone: Record<Pickup['status'], 'gold' | 'green' | 'muted' | 'teal'> = { requested: 'gold', confirmed: 'teal', done: 'green', cancelled: 'muted' }

/** Pick a day, then a window on that day. */
export function SlotPicker({ slots, value, onChange }: { slots: PickupSlot[]; value: PickupSlot | null; onChange: (s: PickupSlot) => void }) {
  const days = useMemo(() => Array.from(new Set(slots.map((s) => s.date))), [slots])
  const [day, setDay] = useState<string>(value?.date ?? days[0] ?? '')
  useEffect(() => { if (!days.includes(day)) setDay(days[0] ?? '') }, [days, day])
  if (!slots.length) return <p className="text-sm text-text-muted">No pickup slots are open in the next two weeks.</p>
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Pickup day">
        {days.map((d) => { const open = slots.some((s) => s.date === d && s.left > 0); return <button key={d} type="button" role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs focus-ring ${day === d ? 'border-gold bg-gold/10 text-text' : 'border-border text-text-muted hover:border-gold/60'} ${open ? '' : 'opacity-50'}`}><span className="block font-semibold">{slots.find((s) => s.date === d)?.weekday}</span><span className="block">{new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></button> })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Pickup window">
        {slots.filter((s) => s.date === day).map((s) => { const sel = value?.date === s.date && value?.start === s.start; return <button key={s.start} type="button" role="radio" aria-checked={sel} disabled={s.left <= 0} onClick={() => onChange(s)} className={`rounded-lg border px-3 py-1.5 text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${sel ? 'border-gold bg-gold text-on-accent' : 'border-border hover:border-gold/60'}`}>{s.label}{s.left <= 0 ? ' · full' : s.left <= 2 ? ` · ${s.left} left` : ''}</button> })}
      </div>
    </div>
  )
}

/** Book, see, move or cancel the collection for one shipment. Works for the customer and the office. */
export function PickupCard({ shipmentId, shipmentRef, origin, status }: { shipmentId: string; shipmentRef: string; origin: string; status: string }) {
  const { user } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof pickupsApi.forShipment>> | null>(null)
  const [slot, setSlot] = useState<PickupSlot | null>(null)
  const [form, setForm] = useState({ address: '', city: origin, contactName: user?.name ?? '', contactPhone: '', notes: '' })
  const [mode, setMode] = useState<'view' | 'book' | 'move'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState('')
  const load = () => pickupsApi.forShipment(shipmentId).then((d) => { setData(d); setMode(d.pickup ? 'view' : 'book') }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load pickup details.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  if (status !== 'booked' && !data?.pickup) return null
  if (!data) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">Loading pickup…</div>
  if (!data.offersPickup && !data.pickup) return null
  const p = data.pickup
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setError(''); try { await fn(); await load(); setToast(msg); setSlot(null) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false); setCancelling(false) } }
  const book = (e: React.FormEvent) => { e.preventDefault(); if (!slot) { setError('Choose a day and time first.'); return } void act(() => pickupsApi.book(shipmentId, { date: slot.date, windowStart: slot.start, windowEnd: slot.end, ...form }), data.canManage ? 'Pickup booked and added to a run.' : 'Pickup requested — the shipper will confirm shortly.') }
  const move = () => { if (!slot || !p) return; void act(() => pickupsApi.reschedule(p.id, { date: slot.date, windowStart: slot.start, windowEnd: slot.end }), 'Pickup moved.') }
  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="pickup-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Truck size={14} className="text-gold-deep" aria-hidden="true" /> Pickup</p>
        {p && <Pill tone={tone[p.status]}>{pickupStatusLabels[p.status]}</Pill>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {p && mode === 'view' && (
        <div className="mt-3 text-sm">
          <p className="flex items-start gap-2"><CalendarCheck size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span><strong>{fmtDay(p.date)}</strong>, {p.windowLabel}</span></p>
          <p className="mt-1.5 flex items-start gap-2 text-text-muted"><MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{p.address}{p.city ? `, ${p.city}` : ''} · {p.contactName} · {p.contactPhone}</span></p>
          {p.notes && <p className="mt-1.5 text-xs text-text-muted">“{p.notes}”</p>}
          {p.status === 'requested' && <p className="mt-2 text-xs text-text-muted">{data.canManage ? 'Confirm it from the Pickups page to put it on a run.' : 'Waiting for the shipper to confirm. You’ll get a notification.'}</p>}
          {p.status === 'confirmed' && !data.canManage && <p className="mt-2 text-xs text-text-muted">Have everything packed and labelled. The driver will call the contact number on arrival.</p>}
          {p.status === 'done' && <p className="mt-2 text-xs text-text-muted">Collected — thank you.</p>}
          {data.canManage && p.runId && <Link to={`/dashboard/routes/${p.runId}`} className="mt-2 inline-block text-xs text-gold-deep hover:underline">Open the run</Link>}
          {p.status !== 'done' && p.status !== 'cancelled' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => { setMode('move'); setSlot(null) }} className="btn-ghost !min-h-8 !px-3 text-xs"><CalendarClock size={13} aria-hidden="true" /> Change time</button>
              <button onClick={() => setCancelling(true)} className="btn-ghost !min-h-8 !px-3 text-xs text-danger"><X size={13} aria-hidden="true" /> Cancel pickup</button>
            </div>
          )}
        </div>
      )}

      {p && mode === 'move' && (
        <div className="mt-3">
          <p className="mb-2 text-sm">Pick a new time for {shipmentRef}.</p>
          <SlotPicker slots={data.slots} value={slot} onChange={setSlot} />
          <div className="mt-3 flex justify-end gap-2"><button onClick={() => setMode('view')} className="btn-ghost !min-h-9 !px-3 text-xs">Keep current</button><button onClick={move} disabled={!slot || busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{busy ? 'Saving…' : 'Move pickup'}</button></div>
        </div>
      )}

      {!p && mode === 'book' && (
        <form onSubmit={book} className="mt-3" aria-label="Book a pickup">
          <p className="mb-2 text-sm text-text-muted">{data.canManage ? 'Schedule the collection — it goes straight onto a pickup run.' : `Choose when ${data.slots.length ? 'we' : 'the shipper'} should collect your pieces${data.leadDays ? ` (at least ${data.leadDays} day${data.leadDays === 1 ? '' : 's'}’ notice)` : ''}.`}</p>
          <SlotPicker slots={data.slots} value={slot} onChange={setSlot} />
          {data.slots.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input aria-label="Pickup address" required minLength={5} className="input-dark !min-h-9 text-sm sm:col-span-2" placeholder="Street address for collection" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <input aria-label="City" className="input-dark !min-h-9 text-sm" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              <input aria-label="Contact name" required minLength={2} className="input-dark !min-h-9 text-sm" placeholder="Who will be there" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <input aria-label="Contact phone" required minLength={7} className="input-dark !min-h-9 text-sm" placeholder="Phone the driver can call" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              <input aria-label="Notes" className="input-dark !min-h-9 text-sm" placeholder="Gate code, floor, parking… (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <div className="sm:col-span-2 flex justify-end"><button disabled={busy || !slot} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60"><CalendarCheck size={14} aria-hidden="true" /> {busy ? 'Booking…' : data.canManage ? 'Book pickup' : 'Request pickup'}</button></div>
            </div>
          )}
        </form>
      )}
      {cancelling && p && <Confirm title="Cancel this pickup?" body={<p>{fmtDay(p.date)}, {p.windowLabel} at {p.address} will be released{p.runId ? ' and removed from the run' : ''}. You can book another slot afterwards.</p>} confirmLabel="Cancel pickup" busy={busy} onClose={() => setCancelling(false)} onConfirm={() => act(() => pickupsApi.cancel(p.id), 'Pickup cancelled.')} />}
    </div>
  )
}
