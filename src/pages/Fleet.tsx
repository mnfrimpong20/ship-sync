import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, Check, Ellipsis, Pencil, Plus, Truck, Wrench } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, opsApi, vehicleStatusLabels, vehicleTypeLabels, type Staff, type Vehicle, type VehicleInput, type VehicleStatus, type VehicleType } from '../lib/ops'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Expander, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

const blank: VehicleInput = { name: '', type: 'van', plate: '', capacityKg: null, capacityNote: '', base: 'origin', city: '', country: '', status: 'available', driverId: null, notes: '' }
const statusTone: Record<VehicleStatus, 'green' | 'gold' | 'sky' | 'muted'> = { available: 'green', on_run: 'gold', maintenance: 'sky', retired: 'muted' }

function VehicleForm({ initial, drivers, onSave, onCancel, busy, error }: { initial: VehicleInput; drivers: Staff[]; onSave: (v: VehicleInput) => void; onCancel: () => void; busy: boolean; error: string }) {
  const [f, setF] = useState<VehicleInput>(initial)
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f) }} className="grid gap-3 md:grid-cols-2" aria-label="Vehicle details">
      {error && <p role="alert" className="md:col-span-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div><label htmlFor="v-name" className="label-dark">Name</label><input id="v-name" className="input-dark" required minLength={2} placeholder="Box truck 1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label htmlFor="v-plate" className="label-dark">Plate</label><input id="v-plate" className="input-dark" placeholder="TX 4KR-882" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></div>
      <div><label htmlFor="v-type" className="label-dark">Type</label><select id="v-type" className="input-dark" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as VehicleType })}>{(Object.keys(vehicleTypeLabels) as VehicleType[]).map((t) => <option key={t} value={t}>{vehicleTypeLabels[t]}</option>)}</select></div>
      <div><label htmlFor="v-cap" className="label-dark">Capacity (kg)</label><input id="v-cap" type="number" min={0} className="input-dark" value={f.capacityKg ?? ''} onChange={(e) => setF({ ...f, capacityKg: e.target.value === '' ? null : Number(e.target.value) })} /></div>
      <div><label htmlFor="v-base" className="label-dark">Based at</label><select id="v-base" className="input-dark" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value as VehicleInput['base'] })}><option value="origin">Origin side (US / Europe)</option><option value="destination">Destination side (West Africa)</option></select></div>
      <div><label htmlFor="v-city" className="label-dark">City</label><input id="v-city" className="input-dark" placeholder="Houston, TX" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
      <div><label htmlFor="v-driver" className="label-dark">Usual driver</label><select id="v-driver" className="input-dark" value={f.driverId ?? ''} onChange={(e) => setF({ ...f, driverId: e.target.value || null })}><option value="">— Unassigned —</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
      <div><label htmlFor="v-status" className="label-dark">Status</label><select id="v-status" className="input-dark" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as VehicleStatus })}>{(Object.keys(vehicleStatusLabels) as VehicleStatus[]).map((s) => <option key={s} value={s}>{vehicleStatusLabels[s]}</option>)}</select></div>
      <div className="md:col-span-2"><label htmlFor="v-notes" className="label-dark">Notes</label><textarea id="v-notes" rows={2} className="input-dark py-2" placeholder="Liftgate, service due, insurance renewal…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={15} aria-hidden="true" /> {busy ? 'Saving…' : 'Save vehicle'}</button></div>
    </form>
  )
}

type Filter = 'all' | VehicleStatus
type Sort = 'name' | 'status' | 'type' | 'capacity'
const PAGE = 10

export default function Fleet() {
  const { ready, user } = useStore()
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [team, setTeam] = useState<Staff[]>([])
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [type, setType] = useState<VehicleType | ''>('')
  const [base, setBase] = useState<'' | 'origin' | 'destination'>('')
  const [sort, setSort] = useState<Sort>('name')
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [retiring, setRetiring] = useState<Vehicle | null>(null)
  const manage = canManageOps(user?.staffRole)
  useEffect(() => { if (!menu) return; const k = () => setMenu(null); window.addEventListener('click', k); return () => window.removeEventListener('click', k) }, [menu])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    Promise.all([opsApi.vehicles(), opsApi.team()]).then(([v, t]) => { if (live) { setVehicles(v); setTeam(t) } }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the fleet.'))
    return () => { live = false }
  }, [ready, user])

  const all = vehicles ?? []
  const driverName = (id?: string) => team.find((s) => s.id === id)?.name
  const counts = (s: VehicleStatus) => all.filter((v) => v.status === s).length
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const rows = all.filter((v) => (filter === 'all' ? v.status !== 'retired' : v.status === filter) && (!type || v.type === type) && (!base || v.base === base) && (!ql || [v.name, v.plate, v.city, v.notes, vehicleTypeLabels[v.type], driverName(v.driverId) ?? ''].join(' ').toLowerCase().includes(ql)))
    const order: VehicleStatus[] = ['on_run', 'available', 'maintenance', 'retired']
    rows.sort((a, b) => sort === 'status' ? order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name) : sort === 'type' ? vehicleTypeLabels[a.type].localeCompare(vehicleTypeLabels[b.type]) || a.name.localeCompare(b.name) : sort === 'capacity' ? (b.capacityKg ?? 0) - (a.capacityKg ?? 0) : a.name.localeCompare(b.name))
    return rows
  }, [all, filter, type, base, q, sort, team]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = usePaged(list, PAGE, `${filter}|${type}|${base}|${q}|${sort}`)

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/fleet" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const drivers = team.filter((s) => s.role === 'driver' && s.status !== 'inactive')
  const save = async (v: VehicleInput) => {
    setBusy(true); setError('')
    try {
      if (editing === 'new') { const created = await opsApi.addVehicle(v); setVehicles((x) => [...(x ?? []), created]); setToast(`${created.name} added to the fleet.`) }
      else if (editing) { const updated = await opsApi.updateVehicle(editing, v); setVehicles((x) => (x ?? []).map((y) => (y.id === editing ? updated : y))); setToast(`${updated.name} saved.`) }
      setEditing(null); setOpen(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const quick = async (v: Vehicle, status: VehicleStatus, msg: string) => {
    setBusy(true); setError('')
    try { const updated = await opsApi.updateVehicle(v.id, { status }); setVehicles((x) => (x ?? []).map((y) => (y.id === v.id ? updated : y))); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy(false); setRetiring(null) }
  }
  const toInput = (v: Vehicle): VehicleInput => ({ name: v.name, type: v.type, plate: v.plate, capacityKg: v.capacityKg ?? null, capacityNote: v.capacityNote, base: v.base, city: v.city, country: v.country, status: v.status, driverId: v.driverId ?? null, notes: v.notes })
  const capacity = all.filter((v) => v.status !== 'retired').reduce((n, v) => n + (v.capacityKg ?? 0), 0)

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Fleet</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{all.filter((v) => v.status !== 'retired').length} vehicle{all.filter((v) => v.status !== 'retired').length === 1 ? '' : 's'} in service</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Vans, trucks and pickups on both sides of the ocean. Assign them to runs from the route planner; a vehicle on a run shows as busy automatically.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><button onClick={() => { setEditing('new'); setError('') }} className="btn-gold"><Plus size={16} aria-hidden="true" /> Add vehicle</button></motion.div>}
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}</AnimatePresence>

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Available" value={counts('available')} hint="Ready to be put on a run" icon={Truck} active={filter === 'available'} onClick={() => setFilter(filter === 'available' ? 'all' : 'available')} />
            <StatCard label="Out on runs" value={counts('on_run')} hint="Busy until the run is done" icon={Truck} active={filter === 'on_run'} onClick={() => setFilter(filter === 'on_run' ? 'all' : 'on_run')} />
            <StatCard label="In maintenance" value={counts('maintenance')} hint={counts('maintenance') ? 'Off the road for now' : 'All vehicles roadworthy'} icon={Wrench} warn={counts('maintenance') > 0} active={filter === 'maintenance'} onClick={() => setFilter(filter === 'maintenance' ? 'all' : 'maintenance')} />
            <StatCard label="Total capacity" value={capacity ? `${(capacity / 1000).toFixed(1)} t` : '—'} hint="Rated payload across vehicles in service" icon={Archive} />
          </motion.div>

          <AnimatePresence>
            {editing === 'new' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-6">
                <h2 className="mb-4 !text-lg">New vehicle</h2>
                <VehicleForm initial={blank} drivers={drivers} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} />
              </motion.div>
            )}
          </AnimatePresence>
          {!editing && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={all.filter((v) => v.status !== 'retired').length}>In service</Chip>
            <Chip active={filter === 'retired'} onClick={() => setFilter('retired')} count={counts('retired')}>Retired</Chip>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <SearchBox value={q} onChange={setQ} label="Search vehicles" placeholder="Search name, plate, city, driver…" />
            <select aria-label="Type" className="input-dark !min-h-10 !w-auto text-sm" value={type} onChange={(e) => setType(e.target.value as VehicleType | '')}><option value="">All types</option>{(Object.keys(vehicleTypeLabels) as VehicleType[]).map((t) => <option key={t} value={t}>{vehicleTypeLabels[t]}</option>)}</select>
            <select aria-label="Base" className="input-dark !min-h-10 !w-auto text-sm" value={base} onChange={(e) => setBase(e.target.value as typeof base)}><option value="">Both sides</option><option value="origin">Origin side</option><option value="destination">Destination side</option></select>
            <select aria-label="Sort" className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="name">Name</option><option value="status">Status</option><option value="type">Type</option><option value="capacity">Capacity</option></select>
          </motion.div>

          <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className={thead}><Th className="w-8" /><Th>Vehicle</Th><Th>Type</Th><Th>Based at</Th><Th className="text-right">Capacity</Th><Th>Usual driver</Th><Th>Status</Th>{manage && <Th className="text-right">Actions</Th>}</tr></thead>
                <tbody>
                  {vehicles === null && !error && <tr><td colSpan={8} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>}
                  {vehicles && p.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10"><Empty title={all.length ? 'No vehicles match' : 'No vehicles yet'} body={all.length ? 'Try another filter or search.' : 'Add the vans and trucks you use for pickups and deliveries.'} action={manage && !all.length ? <button onClick={() => setEditing('new')} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Add vehicle</button> : undefined} /></td></tr>}
                  {p.rows.map((v) => {
                    const isOpen = open === v.id || editing === v.id
                    return (
                      <Fragment key={v.id}>
                        <tr className={trow(isOpen, v.status === 'retired')}>
                          <td className="px-3 py-3"><Expander open={isOpen} onClick={() => { setOpen(isOpen ? null : v.id); if (editing === v.id) setEditing(null) }} label={`details for ${v.name}`} /></td>
                          <td className="px-3 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-gold" aria-hidden="true"><Truck size={16} /></span><div><p className="font-semibold">{v.name}</p><p className="font-mono text-xs text-text-muted">{v.plate || 'No plate'}</p></div></div></td>
                          <td className="whitespace-nowrap px-3 py-3">{vehicleTypeLabels[v.type]}</td>
                          <td className="px-3 py-3"><p>{v.city || (v.base === 'origin' ? 'Origin side' : 'Destination side')}</p><p className="text-[11px] text-text-muted">{v.base === 'origin' ? 'US / Europe' : 'West Africa'}</p></td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{v.capacityKg ? `${v.capacityKg.toLocaleString()} kg` : <span className="text-text-muted">—</span>}{v.capacityNote && <p className="text-[11px] text-text-muted">{v.capacityNote}</p>}</td>
                          <td className="px-3 py-3">{driverName(v.driverId) ?? <span className="text-text-muted">Unassigned</span>}</td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={statusTone[v.status]}>{vehicleStatusLabels[v.status]}</Pill></td>
                          {manage && (
                            <td className="px-3 py-3 text-right">
                              <div className="relative inline-flex items-center gap-1.5">
                                <button onClick={() => { setEditing(editing === v.id ? null : v.id); setOpen(v.id); setError('') }} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Pencil size={12} aria-hidden="true" /> Edit</button>
                                <button onClick={(e) => { e.stopPropagation(); setMenu(menu === v.id ? null : v.id) }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-haspopup="menu" aria-expanded={menu === v.id} aria-label={`More actions for ${v.name}`}><Ellipsis size={14} /></button>
                                {menu === v.id && (
                                  <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left text-sm shadow-xl">
                                    {v.status === 'available' && <button role="menuitem" onClick={() => { setMenu(null); quick(v, 'maintenance', `${v.name} marked in maintenance.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Wrench size={14} aria-hidden="true" /> Mark in maintenance</button>}
                                    {v.status === 'maintenance' && <button role="menuitem" onClick={() => { setMenu(null); quick(v, 'available', `${v.name} is back in service.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Check size={14} aria-hidden="true" /> Back in service</button>}
                                    {v.status === 'on_run' && <button role="menuitem" onClick={() => { setMenu(null); quick(v, 'available', `${v.name} marked available.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Check size={14} aria-hidden="true" /> Mark available (run over)</button>}
                                    {v.status === 'retired' ? <button role="menuitem" onClick={() => { setMenu(null); quick(v, 'available', `${v.name} reinstated.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Truck size={14} aria-hidden="true" /> Reinstate</button>
                                      : v.status !== 'on_run' && <><div className="my-1 border-t border-border" /><button role="menuitem" onClick={() => { setMenu(null); setRetiring(v) }} className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10"><Archive size={14} aria-hidden="true" /> Retire vehicle…</button></>}
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={7} className="px-3 pb-5 pt-2">
                            {editing === v.id ? (
                              <div className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 !text-base">Edit {v.name}</h2><VehicleForm initial={toInput(v)} drivers={drivers} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} /></div>
                            ) : (
                              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                                <div className="rounded-xl border border-border bg-surface p-4 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Notes</p><p className="text-text-muted">{v.notes || 'No notes — service dates, insurance renewals and quirks go here.'}</p></div>
                                <div className="rounded-xl border border-border bg-surface p-4 text-xs"><p className="mb-2 font-semibold uppercase tracking-wider text-text-muted">Details</p><dl className="grid grid-cols-2 gap-2"><div><dt className="text-text-muted">Plate</dt><dd className="font-mono">{v.plate || '—'}</dd></div><div><dt className="text-text-muted">Country</dt><dd>{v.country || '—'}</dd></div><div><dt className="text-text-muted">Added</dt><dd>{fmtDate(v.createdAt)}</dd></div><div><dt className="text-text-muted">Driver</dt><dd>{driverName(v.driverId) ?? 'Unassigned'}</dd></div></dl></div>
                              </div>
                            )}
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager p={p} noun="vehicle" note={filter === 'all' ? 'retired vehicles are under the Retired tab' : undefined} />
          </motion.div>
        </motion.div>
      </div>
      {retiring && <Confirm title={`Retire ${retiring.name}?`} body={<p>It leaves the pick-lists in the route planner and drops out of the fleet count. Its history stays, and you can reinstate it from the Retired tab.</p>} confirmLabel="Retire vehicle" busy={busy} onClose={() => setRetiring(null)} onConfirm={() => quick(retiring, 'retired', `${retiring.name} retired.`)} />}
    </div>
  )
}
