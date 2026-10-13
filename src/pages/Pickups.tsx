import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarCheck, CalendarClock, Check, Clock, Plus, Save, Settings2, Trash2, Truck, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { WEEKDAYS, fmtDay, pickupStatusLabels, pickupsApi, type Pickup, type PickupSlot, type PickupWindow } from '../lib/pickups'
import { SlotPicker } from '../components/PickupCard'
import { Empty, Pill } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

type Filter = 'open' | 'requested' | 'confirmed' | 'done' | 'cancelled' | 'all'
const tone: Record<Pickup['status'], 'gold' | 'green' | 'muted' | 'teal'> = { requested: 'gold', confirmed: 'teal', done: 'green', cancelled: 'muted' }
const today = () => new Date().toISOString().slice(0, 10)

function Availability({ onSaved }: { onSaved: (msg: string) => void }) {
  const [lead, setLead] = useState(1)
  const [wins, setWins] = useState<PickupWindow[] | null>(null)
  const [origins, setOrigins] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { pickupsApi.availability().then((a) => { setLead(a.leadDays); setWins(a.windows); setOrigins(a.origins); setCanEdit(a.canEdit) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load availability.')) }, [])
  const upd = (i: number, patch: Partial<PickupWindow>) => setWins((w) => (w ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const save = async () => { if (!wins) return; setBusy(true); setError(''); try { const r = await pickupsApi.saveAvailability(lead, wins); setWins(r.windows); onSaved('Pickup hours saved — customers see them right away.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <div className="card-dark p-5" data-testid="pickup-availability">
      <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 !text-base"><Settings2 size={16} className="text-gold" aria-hidden="true" /> Pickup hours</h2>{canEdit && <button onClick={save} disabled={busy || !wins} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60"><Save size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}</button>}</div>
      <p className="mt-1 text-xs text-text-muted">Customers can only book inside these windows. Leave the area blank for every pickup city you serve.</p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Notice needed</span><span className="inline-flex items-center gap-2"><input type="number" min={0} max={14} disabled={!canEdit} className="input-dark !min-h-8 !w-16 text-sm tabular-nums" value={lead} onChange={(e) => setLead(Math.max(0, Math.min(14, Number(e.target.value) || 0)))} /> day{lead === 1 ? '' : 's'}</span></label>
      <ul className="mt-3 space-y-2">
        {wins === null && <li className="text-sm text-text-muted">Loading…</li>}
        {wins?.map((w, i) => (
          <li key={i} className={`grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[84px_minmax(0,1fr)_10px_minmax(0,1fr)_minmax(0,1.3fr)_48px_auto_auto] ${w.active ? '' : 'opacity-60'}`} data-testid="pickup-window">
            <select aria-label="Weekday" disabled={!canEdit} className="input-dark !min-h-8 !min-w-0 !px-2 text-xs" value={w.weekday} onChange={(e) => upd(i, { weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, k) => <option key={d} value={k}>{d.slice(0, 3)}</option>)}</select>
            <div className="flex items-center gap-1 sm:contents"><input type="time" aria-label="From" disabled={!canEdit} className="input-dark !min-h-8 !min-w-0 !px-1.5 text-xs" value={w.start} onChange={(e) => upd(i, { start: e.target.value })} /><span className="text-xs text-text-muted">–</span><input type="time" aria-label="To" disabled={!canEdit} className="input-dark !min-h-8 !min-w-0 !px-1.5 text-xs" value={w.end} onChange={(e) => upd(i, { end: e.target.value })} /></div>
            <input list="pk-areas" aria-label="Area" disabled={!canEdit} className="input-dark !min-h-8 !min-w-0 !px-2 text-xs col-span-2 sm:col-span-1" placeholder="Any area" value={w.area} onChange={(e) => upd(i, { area: e.target.value })} />
            <input type="number" min={1} max={100} aria-label="Max pickups" title="Max pickups in this window" disabled={!canEdit} className="input-dark !min-h-8 !min-w-0 !px-2 text-xs tabular-nums" value={w.capacity} onChange={(e) => upd(i, { capacity: Math.max(1, Number(e.target.value) || 1) })} />
            <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" disabled={!canEdit} className="h-3.5 w-3.5 accent-[var(--color-gold)]" checked={w.active} onChange={(e) => upd(i, { active: e.target.checked })} /> On</label>
            {canEdit && <button onClick={() => setWins((x) => (x ?? []).filter((_, k) => k !== i))} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:text-danger focus-ring" aria-label="Remove window"><Trash2 size={13} /></button>}
          </li>
        ))}
      </ul>
      <datalist id="pk-areas">{origins.map((o) => <option key={o} value={o.split(',')[0]} />)}</datalist>
      {canEdit && <button onClick={() => setWins((x) => [...(x ?? []), { weekday: 1, start: '09:00', end: '12:00', area: '', capacity: 6, active: true }])} className="btn-ghost mt-3 !min-h-8 !px-3 text-xs"><Plus size={13} aria-hidden="true" /> Add window</button>}
    </div>
  )
}

export default function Pickups() {
  const { ready, user } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof pickupsApi.list>> | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [confirming, setConfirming] = useState<Pickup | null>(null)
  const [runId, setRunId] = useState('')
  const [moving, setMoving] = useState<{ p: Pickup; slots: PickupSlot[]; slot: PickupSlot | null; note: string } | null>(null)
  const [cancelling, setCancelling] = useState<Pickup | null>(null)

  const load = () => pickupsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load pickups.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const all = data?.pickups ?? []
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return all.filter((p) => (filter === 'all' ? true : filter === 'open' ? p.status === 'requested' || p.status === 'confirmed' : p.status === filter) && (!ql || [p.shipmentRef, p.customer, p.address, p.city, p.contactName].join(' ').toLowerCase().includes(ql)))
  }, [all, filter, q])
  const pg = usePaged(list, 12, `${filter}|${q}`)
  const count = (s: Pickup['status']) => all.filter((p) => p.status === s).length

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/pickups" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />

  const act = async (id: string, fn: () => Promise<unknown>, msg: string) => { setBusy(id); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setConfirming(null); setMoving(null); setCancelling(null) } }
  const openMove = async (p: Pickup) => { try { const d = await pickupsApi.forShipment(p.shipmentId); setMoving({ p, slots: d.slots, slot: null, note: '' }) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load slots.') } }
  const todayCount = all.filter((p) => p.status === 'confirmed' && p.date === today()).length
  const runsFor = (date: string) => (data?.runs ?? []).filter((r) => r.date === date)

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Pickups</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{count('requested') ? `${count('requested')} pickup${count('requested') === 1 ? '' : 's'} to confirm` : 'Pickup bookings'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Customers book a collection slot inside your pickup hours. Confirming puts the address on that day’s pickup run; the driver marks it collected from My runs.</motion.p></div>
            <motion.div variants={fadeUp}><Link to="/dashboard/routes?kind=pickup" className="btn-ghost"><Truck size={16} aria-hidden="true" /> Pickup runs</Link></motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="To confirm" value={count('requested')} hint={count('requested') ? 'Customers are waiting' : 'Nothing waiting'} icon={Clock} warn={count('requested') > 0} active={filter === 'requested'} onClick={() => setFilter(filter === 'requested' ? 'open' : 'requested')} />
            <StatCard label="Confirmed" value={count('confirmed')} hint="On a run" icon={CalendarCheck} active={filter === 'confirmed'} onClick={() => setFilter(filter === 'confirmed' ? 'open' : 'confirmed')} />
            <StatCard label="Today" value={todayCount} hint="Collections scheduled today" icon={Truck} />
            <StatCard label="Collected" value={count('done')} hint="Picked up by a driver" icon={Check} active={filter === 'done'} onClick={() => setFilter(filter === 'done' ? 'open' : 'done')} />
          </motion.div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
              <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
                <Chip active={filter === 'open'} onClick={() => setFilter('open')} count={count('requested') + count('confirmed')}>Open</Chip>
                <Chip active={filter === 'done'} onClick={() => setFilter('done')} count={count('done')}>Collected</Chip>
                <Chip active={filter === 'cancelled'} onClick={() => setFilter('cancelled')} count={count('cancelled')}>Cancelled</Chip>
                <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={all.length}>All</Chip>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
                <SearchBox value={q} onChange={setQ} label="Search pickups" placeholder="Search ref, customer, address…" />
              </motion.div>
              <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead><tr className={thead}><Th>When</Th><Th>Shipment</Th><Th>Address</Th><Th>Contact</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
                    <tbody>
                      {data === null && !error && <tr><td colSpan={6} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>}
                      {data && pg.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10"><Empty title={all.length ? 'No pickups match' : 'No pickup bookings yet'} body={all.length ? 'Try another filter.' : 'Once your pickup hours are set, customers with a booked shipment can pick a slot from their dashboard.'} /></td></tr>}
                      {pg.rows.map((p) => (
                        <tr key={p.id} className={trow(false, p.status === 'cancelled')} data-testid="pickup-row">
                          <td className="whitespace-nowrap px-3 py-3"><p className="font-semibold">{fmtDay(p.date)}</p><p className="text-xs text-text-muted">{p.windowLabel}</p></td>
                          <td className="px-3 py-3"><Link to={`/dashboard/shipments?q=${p.shipmentRef}&b=all`} className="font-mono text-xs text-gold hover:underline">{p.shipmentRef}</Link><p className="text-xs text-text-muted">{p.customer}</p></td>
                          <td className="px-3 py-3"><p>{p.address}</p><p className="text-xs text-text-muted">{p.city}{p.notes ? ` · ${p.notes}` : ''}</p></td>
                          <td className="px-3 py-3 text-xs"><p>{p.contactName}</p><p className="text-text-muted">{p.contactPhone}</p></td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={tone[p.status]}>{pickupStatusLabels[p.status]}</Pill>{p.runId && p.status !== 'cancelled' && <Link to={`/dashboard/routes/${p.runId}`} className="ml-2 text-xs text-text-muted hover:text-gold">run →</Link>}{p.note && <p className="mt-1 max-w-[200px] truncate text-[11px] text-text-muted" title={p.note}>“{p.note}”</p>}</td>
                          <td className="px-3 py-3 text-right">
                            {(p.status === 'requested' || p.status === 'confirmed') && (
                              <div className="inline-flex gap-1.5">
                                {p.status === 'requested' && <button onClick={() => { setConfirming(p); setRunId('') }} disabled={busy === p.id} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs disabled:opacity-60"><CalendarCheck size={12} aria-hidden="true" /> Confirm</button>}
                                <button onClick={() => openMove(p)} className="btn-ghost !min-h-8 !px-2.5 text-xs"><CalendarClock size={12} aria-hidden="true" /> Move</button>
                                <button onClick={() => setCancelling(p)} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-danger focus-ring" aria-label="Cancel pickup"><X size={13} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager p={pg} noun="pickup" />
              </motion.div>
            </div>
            <motion.aside variants={fadeUp}><Availability onSaved={setToast} /></motion.aside>
          </div>
        </motion.div>
      </div>

      {confirming && (
        <Confirm danger={false} title={`Confirm pickup for ${confirming.shipmentRef}?`} confirmLabel="Confirm & add to run" busy={busy === confirming.id} onClose={() => setConfirming(null)} onConfirm={() => act(confirming.id, () => pickupsApi.confirm(confirming.id, runId || null), 'Pickup confirmed and added to the run. The customer has been told.')}
          body={<div><p>{fmtDay(confirming.date)}, {confirming.windowLabel} — {confirming.address}{confirming.city ? `, ${confirming.city}` : ''}.</p>{runsFor(confirming.date).length > 0 ? <label className="mt-3 block text-xs"><span className="mb-1 block text-text-muted">Add to run</span><select className="input-dark !min-h-9 text-sm" value={runId} onChange={(e) => setRunId(e.target.value)}><option value="">New run “Pickups {confirming.date}”</option>{runsFor(confirming.date).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.status})</option>)}</select></label> : <p className="mt-2 text-xs">A pickup run for that day will be created; assign a driver from Routes.</p>}</div>} />
      )}
      {moving && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setMoving(null)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="move-h" className="card-dark w-full max-w-lg p-6">
            <h2 id="move-h" className="!text-lg">Move pickup — {moving.p.shipmentRef}</h2>
            <p className="mt-1 text-sm text-text-muted">Currently {fmtDay(moving.p.date)}, {moving.p.windowLabel}. The customer will be notified.</p>
            <div className="mt-4"><SlotPicker slots={moving.slots} value={moving.slot} onChange={(slot) => setMoving({ ...moving, slot })} /></div>
            <input className="input-dark mt-3 !min-h-9 text-sm" placeholder="Reason to show the customer (optional)" value={moving.note} onChange={(e) => setMoving({ ...moving, note: e.target.value })} />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setMoving(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Keep</button><button disabled={!moving.slot || busy === moving.p.id} onClick={() => moving.slot && act(moving.p.id, () => pickupsApi.reschedule(moving.p.id, { date: moving.slot!.date, windowStart: moving.slot!.start, windowEnd: moving.slot!.end, note: moving.note }), 'Pickup moved and the customer notified.')} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">Move pickup</button></div>
          </div>
        </div>
      )}
      {cancelling && <Confirm title={`Cancel pickup for ${cancelling.shipmentRef}?`} body={<p>{fmtDay(cancelling.date)}, {cancelling.windowLabel} at {cancelling.address} will be released{cancelling.runId ? ' and removed from the run' : ''}. The customer will be told and can book again.</p>} confirmLabel="Cancel pickup" busy={busy === cancelling.id} onClose={() => setCancelling(null)} onConfirm={() => act(cancelling.id, () => pickupsApi.cancel(cancelling.id), 'Pickup cancelled.')} />}
    </div>
  )
}
