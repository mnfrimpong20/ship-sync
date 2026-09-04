import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Pencil, Plus, Truck, Wrench, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, opsApi, vehicleStatusLabels, vehicleTypeLabels, type Staff, type Vehicle, type VehicleInput, type VehicleStatus, type VehicleType } from '../lib/ops'
import { Empty, Pill } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

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

export default function Fleet() {
  const { ready, user } = useStore()
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [team, setTeam] = useState<Staff[]>([])
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const manage = canManageOps(user?.staffRole)

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    Promise.all([opsApi.vehicles(), opsApi.team()]).then(([v, t]) => { if (live) { setVehicles(v); setTeam(t) } }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the fleet.'))
    return () => { live = false }
  }, [ready, user])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/fleet" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const drivers = team.filter((s) => s.role === 'driver' && s.status !== 'inactive')
  const driverName = (id?: string) => team.find((s) => s.id === id)?.name
  const save = async (v: VehicleInput) => {
    setBusy(true); setError('')
    try {
      if (editing === 'new') { const created = await opsApi.addVehicle(v); setVehicles((x) => [...(x ?? []), created]) }
      else if (editing) { const updated = await opsApi.updateVehicle(editing, v); setVehicles((x) => (x ?? []).map((y) => (y.id === editing ? updated : y))) }
      setEditing(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const quick = async (id: string, status: VehicleStatus) => {
    try { const updated = await opsApi.updateVehicle(id, { status }); setVehicles((x) => (x ?? []).map((y) => (y.id === id ? updated : y))) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') }
  }
  const counts = (s: VehicleStatus) => (vehicles ?? []).filter((v) => v.status === s).length
  const toInput = (v: Vehicle): VehicleInput => ({ name: v.name, type: v.type, plate: v.plate, capacityKg: v.capacityKg ?? null, capacityNote: v.capacityNote, base: v.base, city: v.city, country: v.country, status: v.status, driverId: v.driverId ?? null, notes: v.notes })

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Fleet</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Vehicles</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Vans, trucks and pickups on both sides of the ocean. Assign them to runs from the route planner.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><button onClick={() => { setEditing('new'); setError('') }} className="btn-gold"><Plus size={16} aria-hidden="true" /> Add vehicle</button></motion.div>}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Available</p><Truck size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{counts('available')}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Out on runs</p><Truck size={18} className="text-teal" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{counts('on_run')}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">In maintenance</p><Wrench size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{counts('maintenance')}</p></motion.div>
          </div>

          <AnimatePresence>
            {editing === 'new' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-6">
                <h2 className="mb-4 !text-lg">New vehicle</h2>
                <VehicleForm initial={blank} drivers={drivers} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} />
              </motion.div>
            )}
          </AnimatePresence>
          {!editing && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.ul variants={fadeUp} className="mt-8 grid gap-3 md:grid-cols-2" aria-label="Vehicles">
            {vehicles && vehicles.length === 0 && <li className="md:col-span-2"><Empty title="No vehicles yet" body="Add the vans and trucks you use for pickups and deliveries." /></li>}
            {(vehicles ?? []).map((v) => (
              <li key={v.id} className={`card-dark p-5 ${v.status === 'retired' ? 'opacity-60' : ''}`}>
                {editing === v.id ? (
                  <><h2 className="mb-4 !text-lg">Edit {v.name}</h2><VehicleForm initial={toInput(v)} drivers={drivers} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} /></>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-gold" aria-hidden="true"><Truck size={20} /></span><div><p className="font-semibold">{v.name}</p><p className="text-xs text-text-muted">{vehicleTypeLabels[v.type]}{v.plate ? ` · ${v.plate}` : ''}{v.capacityKg ? ` · ${v.capacityKg.toLocaleString()} kg` : ''}</p></div></div>
                      <Pill tone={statusTone[v.status]}>{vehicleStatusLabels[v.status]}</Pill>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="text-xs text-text-muted">Based at</dt><dd>{v.city || (v.base === 'origin' ? 'Origin side' : 'Destination side')}</dd></div>
                      <div><dt className="text-xs text-text-muted">Usual driver</dt><dd>{driverName(v.driverId) ?? <span className="text-text-muted">Unassigned</span>}</dd></div>
                    </dl>
                    {v.notes && <p className="mt-3 text-sm text-text-muted">{v.notes}</p>}
                    {manage && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => { setEditing(v.id); setError('') }} className="btn-ghost !min-h-9 !px-3 text-sm"><Pencil size={14} aria-hidden="true" /> Edit</button>
                        {v.status === 'available' && <button onClick={() => quick(v.id, 'maintenance')} className="btn-ghost !min-h-9 !px-3 text-sm"><Wrench size={14} aria-hidden="true" /> Mark in maintenance</button>}
                        {v.status === 'maintenance' && <button onClick={() => quick(v.id, 'available')} className="btn-ghost !min-h-9 !px-3 text-sm"><Check size={14} aria-hidden="true" /> Back in service</button>}
                        {v.status !== 'retired' && v.status !== 'on_run' && <button onClick={() => quick(v.id, 'retired')} className="btn-ghost !min-h-9 !px-3 text-sm text-text-muted"><X size={14} aria-hidden="true" /> Retire</button>}
                        {v.status === 'retired' && <button onClick={() => quick(v.id, 'available')} className="btn-ghost !min-h-9 !px-3 text-sm">Reinstate</button>}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </div>
    </div>
  )
}
