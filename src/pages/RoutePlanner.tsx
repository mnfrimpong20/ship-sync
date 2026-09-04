import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Crosshair, Flag, Locate, MapPin, Package, Phone, Play, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, opsApi, runStatusLabels, type Candidate, type Run, type RunKind, type RunStart, type Staff, type StopInput, type Vehicle } from '../lib/ops'
import RunMap, { type MapStop } from '../components/RunMap'
import { Pill, fmtDateTime } from '../components/ui'
import { statusLabels } from '../lib/data'
import { runTone } from './Routes'

type Draft = StopInput & { id: string; geoState?: 'pending' | 'ok' | 'miss' }
const uid = () => Math.random().toString(36).slice(2, 10)
const today = () => new Date().toISOString().slice(0, 10)

/** Geocode a search box's text and report the hit. */
function GeoSearch({ label, placeholder, onHit, busyLabel = 'Finding…', id }: { id: string; label: string; placeholder: string; onHit: (hit: { lat: number; lon: number; label: string }, q: string) => void; busyLabel?: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const go = async () => {
    if (q.trim().length < 3) return
    setBusy(true); setMsg('')
    try { const hit = await opsApi.geocode(q); if (hit) { onHit(hit, q); setQ(''); setMsg(`Found: ${hit.label}`) } else setMsg('No match — try adding the city or country, or drop a pin on the map.') }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Lookup failed.') } finally { setBusy(false) }
  }
  return (
    <div>
      <label htmlFor={id} className="label-dark">{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input id={id} className="input-dark !pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }} /></div>
        <button type="button" onClick={go} disabled={busy || q.trim().length < 3} className="btn-ghost !min-h-11 !px-4 text-sm disabled:opacity-50">{busy ? busyLabel : 'Find'}</button>
      </div>
      {msg && <p className="mt-1 text-xs text-text-muted" aria-live="polite">{msg}</p>}
    </div>
  )
}

export default function RoutePlanner() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const { ready, user } = useStore()
  const nav = useNavigate()
  const manage = canManageOps(user?.staffRole)
  const [team, setTeam] = useState<Staff[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [cands, setCands] = useState<Candidate[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [pickMode, setPickMode] = useState<'start' | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ id: string; status: 'done' | 'skipped'; text: string } | null>(null)
  // draft (new run)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<RunKind>('pickup')
  const [date, setDate] = useState(today())
  const [driverId, setDriverId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [start, setStart] = useState<RunStart | null>(null)
  const [notes, setNotes] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [custom, setCustom] = useState({ label: '', address: '', contact: '', phone: '' })

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    Promise.all([opsApi.team(), opsApi.vehicles(), isNew ? Promise.resolve(null) : (user.staffRole === 'driver' ? opsApi.myRuns() : opsApi.runs()).then((rs) => rs.find((r) => r.id === id) ?? null)])
      .then(([t, v, r]) => { if (!live) return; setTeam(t); setVehicles(v); if (!isNew) { if (!r) setError('Run not found.'); setRun(r) } })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load.'))
    return () => { live = false }
  }, [ready, user, id, isNew])
  const runKind = isNew ? kind : run?.kind
  useEffect(() => {
    if (!ready || user?.role !== 'shipper' || !runKind || !manage) return
    if (!isNew && run && run.status !== 'planned') return
    let live = true
    opsApi.candidates(runKind).then((c) => live && setCands(c)).catch(() => {})
    return () => { live = false }
  }, [ready, user, runKind, isNew, run, manage])

  // Geocode draft stops that came from shipments in the background (one at a time — Nominatim etiquette).
  useEffect(() => {
    const next = drafts.find((d) => d.geoState === 'pending')
    if (!next) return
    let live = true
    opsApi.geocode(next.address ?? '').then((hit) => { if (!live) return; setDrafts((ds) => ds.map((d) => (d.id === next.id ? { ...d, lat: hit?.lat, lon: hit?.lon, geoState: hit ? 'ok' : 'miss' } : d))) }).catch(() => live && setDrafts((ds) => ds.map((d) => (d.id === next.id ? { ...d, geoState: 'miss' } : d))))
    return () => { live = false }
  }, [drafts])

  const drivers = useMemo(() => team.filter((s) => s.role === 'driver' && s.status === 'active'), [team])
  const fleet = useMemo(() => vehicles.filter((v) => v.status !== 'retired'), [vehicles])

  const addCandidate = (c: Candidate) => { if (drafts.some((d) => d.shipmentId === c.shipmentId)) return; setDrafts((ds) => [...ds, { id: uid(), shipmentId: c.shipmentId, label: c.label, address: c.address, contact: c.contact, phone: c.phone, geoState: c.address ? 'pending' : 'miss' }]) }
  const addCustom = () => { if (!custom.label.trim()) return; setDrafts((ds) => [...ds, { id: uid(), ...custom, geoState: custom.address ? 'pending' : 'miss' }]); setCustom({ label: '', address: '', contact: '', phone: '' }) }

  const onMove = useCallback(async (mid: string | 'start', lat: number, lon: number) => {
    if (mid === 'start') { setStart((s) => ({ label: s?.label ?? 'Start', lat, lon })); if (run) { try { setRun(await opsApi.updateRun(run.id, { start: { label: run.start?.label ?? 'Start', lat, lon } })) } catch (e) { setError(e instanceof Error ? e.message : 'Could not move the start.') } } return }
    if (isNew) setDrafts((ds) => ds.map((d) => (d.id === mid ? { ...d, lat, lon, geoState: 'ok' } : d)))
    else if (run) { try { setRun(await opsApi.updateStop(run.id, mid, { lat, lon })) } catch (e) { setError(e instanceof Error ? e.message : 'Could not move the stop.') } }
  }, [isNew, run])
  const onClickMap = useCallback(async (lat: number, lon: number) => {
    if (pickMode !== 'start') return
    setPickMode(null)
    const s = { label: start?.label || run?.start?.label || 'Start', lat, lon }
    setStart(s)
    if (run) { try { setRun(await opsApi.updateRun(run.id, { start: s })) } catch (e) { setError(e instanceof Error ? e.message : 'Could not set the start.') } }
  }, [pickMode, start, run])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?role=shipper&next=/dashboard/routes/${id ?? 'new'}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (isNew && !manage) return <Navigate to="/dashboard/routes" replace />

  const create = async () => {
    setBusy(true); setError('')
    try {
      const created = await opsApi.createRun({ name: name.trim() || `${kind === 'pickup' ? 'Pickups' : 'Deliveries'} ${date}`, kind, date, driverId: driverId || null, vehicleId: vehicleId || null, start, notes, stops: drafts.map(({ id: _i, geoState: _g, ...s }) => s) })
      nav(`/dashboard/routes/${created.id}`, { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the run.') } finally { setBusy(false) }
  }
  const act = async (fn: () => Promise<Run>) => { setBusy(true); setError(''); try { setRun(await fn()) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) } }
  const move = (list: MapStop[], sid: string, dir: -1 | 1) => { const i = list.findIndex((s) => s.id === sid); const j = i + dir; if (i < 0 || j < 0 || j >= list.length) return null; const copy = [...list]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy }

  const mapStops: MapStop[] = isNew ? drafts.map((d, i) => ({ id: d.id, seq: i, label: d.label, lat: d.lat, lon: d.lon })) : (run?.stops ?? []).map((s) => ({ id: s.id, seq: s.seq, label: s.label, lat: s.lat, lon: s.lon, status: s.status }))
  const mapStart = isNew ? start : run?.start ?? null
  const editable = isNew || (manage && run?.status === 'planned')
  const canWorkStops = !isNew && run && (manage || (user.staffRole === 'driver' && run.driverId === team.find((s) => s.userId === user.id)?.id)) && run.status === 'in_progress'
  const noGeo = mapStops.filter((s) => s.lat == null).length

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Link to={user.staffRole === 'driver' ? '/dashboard/runs' : '/dashboard/routes'} className="mb-2 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text focus-ring"><ArrowLeft size={14} aria-hidden="true" /> {user.staffRole === 'driver' ? 'My runs' : 'All runs'}</Link>
        <h1 className="flex flex-wrap items-center gap-3 !text-[clamp(1.5rem,3vw,2.2rem)]">{isNew ? 'Plan a run' : run?.name ?? '…'}{run && <Pill tone={runTone[run.status]}>{runStatusLabels[run.status]}</Pill>}</h1>
        {run && <p className="mt-1 text-sm text-text-muted">{run.kind === 'pickup' ? 'Pickup run' : 'Delivery run'} · {run.date} · {run.driverName ?? 'No driver yet'}{run.vehicleName ? ` · ${run.vehicleName}` : ''}{run.distanceKm ? ` · ~${run.distanceKm} km` : ''}</p>}
      </div>
      {run && manage && (
        <div className="flex flex-wrap gap-2">
          {run.status === 'planned' && <button disabled={busy} onClick={() => act(() => opsApi.optimise(run.id))} className="btn-ghost !min-h-10 !px-4 text-sm"><Sparkles size={15} aria-hidden="true" /> Optimise order</button>}
          {run.status === 'planned' && <button disabled={busy || !run.stops.length} onClick={() => act(() => opsApi.updateRun(run.id, { status: 'in_progress' }))} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Play size={15} aria-hidden="true" /> Start run</button>}
          {run.status === 'in_progress' && <button disabled={busy} onClick={() => act(() => opsApi.updateRun(run.id, { status: 'done' }))} className="btn-gold !min-h-10 !px-4 text-sm"><Flag size={15} aria-hidden="true" /> Finish run</button>}
          {(run.status === 'planned' || run.status === 'in_progress') && <button disabled={busy} onClick={() => act(() => opsApi.updateRun(run.id, { status: 'cancelled' }))} className="btn-ghost !min-h-10 !px-4 text-sm text-danger"><X size={15} aria-hidden="true" /> Cancel</button>}
        </div>
      )}
      {run && !manage && user.staffRole === 'driver' && (
        <div className="flex gap-2">
          {run.status === 'planned' && <button disabled={busy} onClick={() => act(() => opsApi.updateRun(run.id, { status: 'in_progress' }))} className="btn-gold !min-h-10 !px-4 text-sm"><Play size={15} aria-hidden="true" /> Start run</button>}
          {run.status === 'in_progress' && <button disabled={busy} onClick={() => act(() => opsApi.updateRun(run.id, { status: 'done' }))} className="btn-gold !min-h-10 !px-4 text-sm"><Flag size={15} aria-hidden="true" /> Finish run</button>}
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-8 md:py-10">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {header}
          {error && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            {/* ---- left: details + stops ---- */}
            <div className="space-y-6">
              {isNew && (
                <section className="card-dark p-5" aria-label="Run details">
                  <h2 className="!text-base">1 · Details</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="r-name" className="label-dark">Run name</label><input id="r-name" className="input-dark" placeholder="Tuesday Houston pickups" value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div><span className="label-dark">Type</span><div className="flex gap-2" role="radiogroup" aria-label="Run type">{(['pickup', 'delivery'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setDrafts([]) }} className={`flex-1 rounded-lg border px-3 py-2.5 text-sm focus-ring ${kind === k ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted'}`}>{k === 'pickup' ? 'Pickups' : 'Deliveries'}</button>)}</div></div>
                    <div><label htmlFor="r-date" className="label-dark">Date</label><input id="r-date" type="date" className="input-dark" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                    <div><label htmlFor="r-driver" className="label-dark">Driver</label><select id="r-driver" className="input-dark" value={driverId} onChange={(e) => { setDriverId(e.target.value); const v = vehicles.find((x) => x.driverId === e.target.value && x.status === 'available'); if (v && !vehicleId) setVehicleId(v.id) }}><option value="">— Assign later —</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.city ? ` (${d.city})` : ''}</option>)}</select></div>
                    <div><label htmlFor="r-vehicle" className="label-dark">Vehicle</label><select id="r-vehicle" className="input-dark" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">— None —</option>{fleet.map((v) => <option key={v.id} value={v.id} disabled={v.status !== 'available'}>{v.name}{v.plate ? ` · ${v.plate}` : ''}{v.status !== 'available' ? ` (${v.status.replace('_', ' ')})` : ''}</option>)}</select></div>
                    <div className="sm:col-span-2">
                      <GeoSearch id="r-start" label="Start point (yard, warehouse, port)" placeholder="e.g. 4501 Navigation Blvd, Houston" onHit={(h, q) => setStart({ label: q, lat: h.lat, lon: h.lon })} />
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        {start ? <span className="inline-flex items-center gap-1 text-teal"><Locate size={12} aria-hidden="true" /> {start.label} · {start.lat.toFixed(4)}, {start.lon.toFixed(4)}</span> : <span>No start yet — stops will be ordered from the first stop.</span>}
                        <button type="button" onClick={() => setPickMode(pickMode ? null : 'start')} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 focus-ring ${pickMode ? 'border-gold text-gold' : 'border-border hover:text-text'}`}><Crosshair size={12} aria-hidden="true" /> {pickMode ? 'Click the map…' : 'Drop pin on map'}</button>
                        {start && <button type="button" onClick={() => setStart(null)} className="hover:text-text focus-ring">Clear</button>}
                      </div>
                    </div>
                    <div className="sm:col-span-2"><label htmlFor="r-notes" className="label-dark">Notes for the driver</label><textarea id="r-notes" rows={2} className="input-dark py-2" placeholder="Gate code, who to call, loading order…" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                  </div>
                </section>
              )}

              {!isNew && run && manage && run.status === 'planned' && (
                <section className="card-dark p-5" aria-label="Assignment">
                  <h2 className="!text-base">Assignment</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div><label htmlFor="e-date" className="label-dark">Date</label><input id="e-date" type="date" className="input-dark" value={run.date} onChange={(e) => act(() => opsApi.updateRun(run.id, { date: e.target.value }))} /></div>
                    <div><label htmlFor="e-driver" className="label-dark">Driver</label><select id="e-driver" className="input-dark" value={run.driverId ?? ''} onChange={(e) => act(() => opsApi.updateRun(run.id, { driverId: e.target.value || null }))}><option value="">— Assign later —</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                    <div><label htmlFor="e-vehicle" className="label-dark">Vehicle</label><select id="e-vehicle" className="input-dark" value={run.vehicleId ?? ''} onChange={(e) => act(() => opsApi.updateRun(run.id, { vehicleId: e.target.value || null }))}><option value="">— None —</option>{fleet.map((v) => <option key={v.id} value={v.id} disabled={v.status !== 'available' && v.id !== run.vehicleId}>{v.name}{v.plate ? ` · ${v.plate}` : ''}</option>)}</select></div>
                    <div className="sm:col-span-3">
                      <GeoSearch id="e-start" label="Start point" placeholder="Search an address…" onHit={(h, q) => act(() => opsApi.updateRun(run.id, { start: { label: q, lat: h.lat, lon: h.lon } }))} />
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        {run.start ? <span className="inline-flex items-center gap-1 text-teal"><Locate size={12} aria-hidden="true" /> {run.start.label || 'Start'} · {run.start.lat.toFixed(4)}, {run.start.lon.toFixed(4)}</span> : <span>No start point.</span>}
                        <button type="button" onClick={() => setPickMode(pickMode ? null : 'start')} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 focus-ring ${pickMode ? 'border-gold text-gold' : 'border-border hover:text-text'}`}><Crosshair size={12} aria-hidden="true" /> {pickMode ? 'Click the map…' : 'Drop pin on map'}</button>
                      </div>
                    </div>
                  </div>
                  {run.notes && <p className="mt-3 text-sm text-text-muted">{run.notes}</p>}
                </section>
              )}
              {!isNew && run && (!manage || run.status !== 'planned') && run.notes && <section className="card-dark p-5"><h2 className="!text-base">Notes</h2><p className="mt-2 text-sm text-text-muted">{run.notes}</p></section>}

              {/* stops */}
              <section className="card-dark p-5" aria-label="Stops">
                <div className="flex items-center justify-between"><h2 className="!text-base">{isNew ? '2 · Stops' : 'Stops'} <span className="text-sm font-normal text-text-muted">({mapStops.length})</span></h2>{noGeo > 0 && <span className="text-xs text-gold">{noGeo} without a map position</span>}</div>
                <ol className="mt-3 space-y-2" aria-label="Stop list">
                  {mapStops.length === 0 && <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-text-muted">No stops yet — add shipments below{manage ? ' or a custom address' : ''}.</li>}
                  {[...mapStops].sort((a, b) => a.seq - b.seq).map((s, i, arr) => {
                    const full = isNew ? drafts.find((d) => d.id === s.id) : run?.stops.find((x) => x.id === s.id)
                    const rs = !isNew ? run?.stops.find((x) => x.id === s.id) : undefined
                    return (
                      <li key={s.id} className={`rounded-xl border px-3 py-2.5 ${focus === s.id ? 'border-gold/60' : 'border-border'} ${s.status === 'done' ? 'opacity-70' : ''}`}>
                        <div className="flex items-start gap-3">
                          <button type="button" onClick={() => setFocus(s.id)} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold focus-ring ${s.status === 'done' ? 'bg-green/20 text-green' : s.status === 'skipped' ? 'bg-surface-2 text-text-muted' : 'bg-gold text-ink'}`} aria-label={`Show stop ${i + 1} on the map`}>{s.status === 'done' ? <Check size={13} /> : i + 1}</button>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{s.label}{rs?.shipmentRef && <Link to={`/track?ref=${rs.shipmentRef}`} className="font-mono text-xs font-normal text-gold hover:underline">{rs.shipmentRef}</Link>}{rs?.shipmentStatus && <span className="text-xs font-normal text-text-muted">{statusLabels[rs.shipmentStatus]}</span>}</p>
                            <p className="text-xs text-text-muted">{full?.address || <span className="italic">No address</span>}{s.lat == null ? <span className="ml-2 text-gold">{(full as Draft | undefined)?.geoState === 'pending' ? '· locating…' : '· not on map — drag a pin or edit the address'}</span> : ''}</p>
                            {(full?.contact || full?.phone) && <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-text-muted">{full.contact && <span>{full.contact}</span>}{full.phone && <a href={`tel:${full.phone}`} className="inline-flex items-center gap-1 hover:text-text"><Phone size={11} aria-hidden="true" /> {full.phone}</a>}</p>}
                            {rs?.note && <p className="mt-1 text-xs text-text">“{rs.note}”</p>}
                            {rs?.doneAt && <p className="text-[11px] text-text-muted">{s.status === 'done' ? 'Done' : 'Skipped'} {fmtDateTime(rs.doneAt)}</p>}
                          </div>
                          {editable && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => { const next = move(arr, s.id, -1); if (!next) return; if (isNew) setDrafts((ds) => next.map((n) => ds.find((d) => d.id === n.id)!)); else if (run) act(async () => { let r = run; for (const [k, n] of next.entries()) if (n.seq !== k) r = await opsApi.updateStop(run.id, n.id, { seq: k }); return r }) }} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30 focus-ring"><ArrowUp size={14} /></button>
                              <button type="button" aria-label="Move down" disabled={i === arr.length - 1} onClick={() => { const next = move(arr, s.id, 1); if (!next) return; if (isNew) setDrafts((ds) => next.map((n) => ds.find((d) => d.id === n.id)!)); else if (run) act(async () => { let r = run; for (const [k, n] of next.entries()) if (n.seq !== k) r = await opsApi.updateStop(run.id, n.id, { seq: k }); return r }) }} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30 focus-ring"><ArrowDown size={14} /></button>
                              <button type="button" aria-label="Remove stop" onClick={() => { if (isNew) setDrafts((ds) => ds.filter((d) => d.id !== s.id)); else if (run) act(() => opsApi.deleteStop(run.id, s.id)) }} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-danger/15 hover:text-danger focus-ring"><Trash2 size={14} /></button>
                            </div>
                          )}
                          {canWorkStops && s.status === 'pending' && run && (
                            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                              <button type="button" disabled={busy} onClick={() => setNoteDraft({ id: s.id, status: 'done', text: '' })} className="btn-gold !min-h-9 !px-3 text-xs"><Check size={13} aria-hidden="true" /> Done</button>
                              <button type="button" disabled={busy} onClick={() => setNoteDraft({ id: s.id, status: 'skipped', text: '' })} className="btn-ghost !min-h-9 !px-3 text-xs">Skip</button>
                            </div>
                          )}
                        </div>
                        {noteDraft?.id === s.id && run && (
                          <form onSubmit={(e) => { e.preventDefault(); const d = noteDraft; setNoteDraft(null); act(() => opsApi.updateStop(run.id, d.id, { status: d.status, note: d.text.trim() || undefined })) }} className="mt-2 flex gap-2">
                            <input autoFocus aria-label={noteDraft.status === 'done' ? 'Note for this stop' : 'Reason for skipping'} className="input-dark !min-h-9 flex-1 text-sm" placeholder={noteDraft.status === 'done' ? (run.kind === 'pickup' ? 'e.g. 2 pallets collected (optional)' : 'e.g. received by Yaw (optional)') : 'Why was it skipped? (optional)'} value={noteDraft.text} onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })} />
                            <button className="btn-gold !min-h-9 !px-3 text-xs">{noteDraft.status === 'done' ? 'Mark done' : 'Skip stop'}</button>
                            <button type="button" onClick={() => setNoteDraft(null)} className="btn-ghost !min-h-9 !px-2 text-xs" aria-label="Cancel"><X size={13} /></button>
                          </form>
                        )}
                        {editable && s.lat == null && full && (
                          <div className="mt-2"><GeoSearch id={`geo-${s.id}`} label="Find on map" placeholder={full.address || 'Address, city, country'} onHit={(h) => { if (isNew) setDrafts((ds) => ds.map((d) => (d.id === s.id ? { ...d, lat: h.lat, lon: h.lon, geoState: 'ok' } : d))); else if (run) act(() => opsApi.updateStop(run.id, s.id, { lat: h.lat, lon: h.lon })) }} /></div>
                        )}
                      </li>
                    )
                  })}
                </ol>

                {editable && (
                  <div className="mt-5 space-y-4">
                    <div>
                      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Package size={13} aria-hidden="true" /> Shipments ready for {runKind === 'pickup' ? 'pickup' : 'delivery'}</p>
                      {cands.filter((c) => !mapStops.some((s) => (isNew ? drafts.find((d) => d.id === s.id)?.shipmentId : run?.stops.find((x) => x.id === s.id)?.shipmentId) === c.shipmentId)).length === 0
                        ? <p className="text-sm text-text-muted">Nothing waiting. {runKind === 'pickup' ? 'Booked shipments show up here until they’re collected.' : 'Shipments that have arrived and cleared customs show up here.'}</p>
                        : <ul className="space-y-1.5">
                          {cands.filter((c) => !mapStops.some((s) => (isNew ? drafts.find((d) => d.id === s.id)?.shipmentId : run?.stops.find((x) => x.id === s.id)?.shipmentId) === c.shipmentId)).map((c) => (
                            <li key={c.shipmentId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                              <div className="min-w-0 flex-1"><p className="truncate text-sm"><span className="font-mono text-xs text-gold">{c.ref}</span> · {c.label}</p><p className="truncate text-xs text-text-muted">{c.description}{c.address ? ` — ${c.address}` : ''}</p></div>
                              <button type="button" onClick={() => { if (isNew) addCandidate(c); else if (run) act(async () => { const hit = c.address ? await opsApi.geocode(c.address).catch(() => null) : null; return opsApi.addStop(run.id, { shipmentId: c.shipmentId, label: c.label, address: c.address, contact: c.contact, phone: c.phone, lat: hit?.lat, lon: hit?.lon }) }) }} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Plus size={13} aria-hidden="true" /> Add</button>
                            </li>
                          ))}
                        </ul>}
                    </div>
                    <div>
                      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><MapPin size={13} aria-hidden="true" /> Custom stop</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input aria-label="Stop name" className="input-dark !min-h-10 text-sm" placeholder="Name (e.g. Kofi's dealer)" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
                        <input aria-label="Address" className="input-dark !min-h-10 text-sm" placeholder="Address, city" value={custom.address} onChange={(e) => setCustom({ ...custom, address: e.target.value })} />
                        <input aria-label="Contact" className="input-dark !min-h-10 text-sm" placeholder="Contact (optional)" value={custom.contact} onChange={(e) => setCustom({ ...custom, contact: e.target.value })} />
                        <div className="flex gap-2"><input aria-label="Phone" className="input-dark !min-h-10 flex-1 text-sm" placeholder="Phone (optional)" value={custom.phone} onChange={(e) => setCustom({ ...custom, phone: e.target.value })} />
                          <button type="button" disabled={!custom.label.trim()} onClick={() => { if (isNew) addCustom(); else if (run) { const c = custom; setCustom({ label: '', address: '', contact: '', phone: '' }); act(async () => { const hit = c.address ? await opsApi.geocode(c.address).catch(() => null) : null; return opsApi.addStop(run.id, { ...c, lat: hit?.lat, lon: hit?.lon }) }) } }} className="btn-ghost !min-h-10 !px-3 text-sm disabled:opacity-50"><Plus size={14} aria-hidden="true" /> Add</button></div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {isNew && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {drafts.some((d) => d.geoState === 'pending') && <span className="text-xs text-text-muted">Locating addresses…</span>}
                  <button disabled={busy || drafts.length === 0} onClick={create} className="btn-gold disabled:opacity-60"><Sparkles size={16} aria-hidden="true" /> {busy ? 'Creating…' : 'Create run & optimise order'}</button>
                </div>
              )}
            </div>

            {/* ---- right: map ---- */}
            <div className="lg:sticky lg:top-20 lg:self-start">
              <RunMap start={mapStart} stops={mapStops} draggable={!!editable} onMove={onMove} onClickMap={onClickMap} focusId={focus} className={`h-[420px] lg:h-[calc(100vh-7rem)] ${pickMode ? 'cursor-crosshair ring-2 ring-gold' : ''}`} />
              <p className="mt-2 text-xs text-text-muted">{editable ? 'Drag any pin to correct its position. ' : ''}Numbers show the driving order; the dashed line joins stops as the crow flies.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
