import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ArrowLeft, ArrowRight, Boxes, Check, Container as ContainerIcon, ExternalLink, Lock, Pencil, Plus, Radar, Radio, RefreshCw, Ship, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { cargoLabel, countryByCode, statusLabels, type CargoType } from '../lib/data'
import { CONTAINER_STAGES, canLoad, cargoCbm, containersApi, isOpen, sizeCbm, sizeLabels, stageBlurb, stageLabels, type Candidate, type ContainerDetail as Detail, type ContainerInput, type ContainerStatus, type TrackingProvider, eventTitles } from '../lib/containers'
import { Empty, Pill, fmtDate, fmtDateTime } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { ContainerForm, StageStepper, stageTone } from './Containers'

const today = () => new Date().toISOString().slice(0, 10)

function AdvanceModal({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (r: Detail) => void }) {
  const c = d.container
  const next = CONTAINER_STAGES[CONTAINER_STAGES.indexOf(c.status) + 1]
  const [status, setStatus] = useState<ContainerStatus>(next)
  const [at, setAt] = useState(today())
  const [place, setPlace] = useState(status === 'gated_in' || status === 'sailed' ? c.originPort : status === 'arrived' || status === 'customs' ? c.destinationPort : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const later = CONTAINER_STAGES.slice(CONTAINER_STAGES.indexOf(c.status) + 1)
  const needsVessel = status === 'sailed' && !c.vesselName
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { onDone(await containersApi.advance(c.id, { status, at: at ? new Date(at + 'T12:00:00Z').toISOString() : undefined, place, note })) } catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy(false) }
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.form onSubmit={submit} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Move container to next stage" className="card-dark w-full max-w-lg p-6">
        <div className="flex items-start justify-between gap-3"><div><h2 className="!text-lg">Update {c.ref}</h2><p className="mt-1 text-sm text-text-muted">Currently <strong>{stageLabels[c.status]}</strong>. Stages move forward only.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Close"><X size={16} /></button></div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label htmlFor="a-status" className="label-dark">New stage</label><select id="a-status" className="input-dark" value={status} onChange={(e) => setStatus(e.target.value as ContainerStatus)}>{later.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}</select></div>
          <div><label htmlFor="a-at" className="label-dark">Date</label><input id="a-at" type="date" className="input-dark" value={at} onChange={(e) => setAt(e.target.value)} /></div>
          <div><label htmlFor="a-place" className="label-dark">Place</label><input id="a-place" className="input-dark" placeholder="Port, yard, warehouse" value={place} onChange={(e) => setPlace(e.target.value)} /></div>
          <div className="sm:col-span-2"><label htmlFor="a-note" className="label-dark">Note <span className="font-normal text-text-muted">(shown to customers)</span></label><input id="a-note" className="input-dark" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-sm">
          <p className="text-text-muted">{stageBlurb[status]}</p>
          {d.shipments.length > 0 && ['loading', 'gated_in', 'sailed', 'arrived', 'customs'].includes(status) && <p className="mt-1.5 flex items-center gap-1.5 text-teal"><Boxes size={14} aria-hidden="true" /> {d.shipments.length} loaded order{d.shipments.length === 1 ? '' : 's'} will update and each customer sees the event on their tracking page.</p>}
          {needsVessel && <p className="mt-1.5 flex items-center gap-1.5 text-danger"><AlertTriangle size={14} aria-hidden="true" /> Add the vessel name first (Edit details) so tracking can follow the ship.</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy || needsVessel} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><ArrowRight size={15} aria-hidden="true" /> {busy ? 'Updating…' : `Mark ${stageLabels[status].toLowerCase()}`}</button></div>
      </motion.form>
    </motion.div>
  )
}

function LoadPanel({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (r: Detail) => void }) {
  const c = d.container
  const [cands, setCands] = useState<Candidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { containersApi.candidates(c.destination).then((x) => setCands([...x].sort((a, b) => Number(b.sameLane) - Number(a.sameLane)))).catch((e) => setError(e instanceof Error ? e.message : 'Could not load orders.')) }, [c.destination])
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const offLane = (cands ?? []).filter((x) => picked.has(x.id) && !x.sameLane).length
  const used = d.shipments.reduce((a, s) => a + (cargoCbm[s.cargo] ?? 2), 0)
  const adding = (cands ?? []).filter((x) => picked.has(x.id)).reduce((a, s) => a + (cargoCbm[s.cargo] ?? 2), 0)
  const cap = sizeCbm[c.size]
  const submit = async () => {
    setBusy(true); setError('')
    try { onDone(await containersApi.load(c.id, [...picked])) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load orders.') } finally { setBusy(false) }
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card-dark p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="!text-lg">Load orders into {c.ref}</h2><p className="mt-1 text-sm text-text-muted">Ocean orders you’ve won that aren’t in another open container. Orders on the same lane ({countryByCode(c.destination)?.name ?? c.destination}) are listed first.</p></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Close"><X size={16} /></button></div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="w-10 px-3 py-2" /><th className="px-3 py-2">Order</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Cargo</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {cands === null && !error && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-muted">Loading…</td></tr>}
            {cands && cands.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-muted">No ocean orders waiting. Win a quote or book a shipment for a client first.</td></tr>}
            {(cands ?? []).map((s) => {
              const on = picked.has(s.id)
              return (
                <tr key={s.id} className={`cursor-pointer border-b border-border/70 transition-colors hover:bg-surface-2/60 ${on ? 'bg-gold/5' : ''}`} onClick={() => toggle(s.id)}>
                  <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${s.ref}`} checked={on} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-[var(--color-gold)]" /></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gold-deep">{s.ref}</td>
                  <td className="px-3 py-2.5"><span className="font-medium">{s.origin}</span> <span className="text-text-muted">→ {countryByCode(s.destination)?.name ?? s.destination}</span>{!s.sameLane && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-danger/40 px-1.5 text-[10px] text-danger"><AlertTriangle size={10} aria-hidden="true" /> other lane</span>}</td>
                  <td className="max-w-[220px] px-3 py-2.5"><p className="truncate" title={s.description}>{s.description || '—'}</p><p className="text-xs text-text-muted">{cargoLabel(s.cargo as CargoType)} · ~{cargoCbm[s.cargo] ?? 2} cbm</p></td>
                  <td className="px-3 py-2.5">{s.clientName ?? s.customer}</td>
                  <td className="px-3 py-2.5"><Pill tone="muted">{statusLabels[s.status]}</Pill></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex justify-between text-xs text-text-muted"><span>Planned fill</span><span className="tabular-nums">{Math.round(used + adding)} / {cap} cbm{used + adding > cap ? ' — over capacity' : ''}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={Math.min(100, Math.round(((used + adding) / cap) * 100))} aria-valuemin={0} aria-valuemax={100}><div className="flex h-full"><div className="bg-teal" style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /><div className={used + adding > cap ? 'bg-danger' : 'bg-gold'} style={{ width: `${Math.min(100 - Math.min(100, (used / cap) * 100), (adding / cap) * 100)}%` }} /></div></div>
          <p className="mt-1 text-[11px] text-text-muted">Estimated from cargo type — a planning guide, not a manifest.</p>
        </div>
        <div className="flex items-center gap-2">
          {offLane > 0 && <span className="text-xs text-danger">{offLane} order{offLane === 1 ? ' is' : 's are'} bound for another country</span>}
          <button onClick={submit} disabled={busy || picked.size === 0} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Boxes size={15} aria-hidden="true" /> {busy ? 'Loading…' : `Load ${picked.size || ''} order${picked.size === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </motion.div>
  )
}

export default function ContainerDetail() {
  const { id = '' } = useParams()
  const { ready, user, refresh } = useStore()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const [provider, setProvider] = useState<TrackingProvider | null>(null)
  const syncMinutes = 15
  useEffect(() => { if (ready && user?.role === 'shipper') containersApi.provider().then(setProvider).catch(() => setProvider({ enabled: false, id: null, label: null, simulated: false })) }, [ready, user])

  useEffect(() => {
    if (!ready || user?.role !== 'shipper' || user.staffRole === 'driver') return
    let live = true
    containersApi.get(id).then((r) => live && setD(r)).catch((e) => live && setError(e instanceof Error ? e.message : 'Container not found.'))
    return () => { live = false }
  }, [ready, user, id])
  const apply = useCallback((r: Detail, msg?: string) => { setD(r); if (msg) { setFlash(msg); setTimeout(() => setFlash(''), 4000) } refresh().catch(() => {}) }, [refresh])

  const used = useMemo(() => (d?.shipments ?? []).reduce((a, s) => a + (cargoCbm[s.cargo] ?? 2), 0), [d])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?role=shipper&next=/dashboard/containers/${id}`} replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />
  if (error && !d) return <div className="container-x py-16"><Empty title="Container not found" body={error} action={<Link to="/dashboard/containers" className="btn-ghost !min-h-10 !px-4 text-sm"><ArrowLeft size={15} aria-hidden="true" /> All containers</Link>} /></div>
  if (!d) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>

  const c = d.container
  const dest = countryByCode(c.destination)
  const idx = CONTAINER_STAGES.indexOf(c.status)
  const next = CONTAINER_STAGES[idx + 1]
  const cap = sizeCbm[c.size]
  const toInput = (): ContainerInput => ({ number: c.number, size: c.size, line: c.line, bookingRef: c.bookingRef, seal: c.seal, vesselName: c.vesselName, mmsi: c.mmsi, voyage: c.voyage, originPort: c.originPort, destination: c.destination, destinationPort: c.destinationPort, cutoffDate: c.cutoffDate, etd: c.etd, eta: c.eta, notes: c.notes })
  const save = async (v: ContainerInput) => {
    setBusy(true); setError('')
    try { apply(await containersApi.update(c.id, v), 'Details saved.'); setEditing(false) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const carrierMsg = (r: Detail, fallback: string) => (r.changes && r.changes.length ? `${provider?.label ?? 'Carrier'}: ${r.changes.join(' · ')}.` : fallback)
  const connect = async () => { setBusy(true); setError(''); try { const r = await containersApi.connect(c.id); apply(r, carrierMsg(r, 'Connected — waiting for the shipping line to publish the first event.')) } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect.') } finally { setBusy(false) } }
  const syncNow = async () => { setBusy(true); setError(''); try { const r = await containersApi.sync(c.id); apply(r, carrierMsg(r, 'Checked — nothing new from the line.')) } catch (e) { setError(e instanceof Error ? e.message : 'Could not check.') } finally { setBusy(false) } }
  const disconnect = async () => { setBusy(true); setError(''); try { apply(await containersApi.disconnect(c.id), 'Carrier tracking disconnected.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not disconnect.') } finally { setBusy(false) } }
  const unload = async (sid: string, ref: string) => {
    setBusy(true); setError('')
    try { apply(await containersApi.unload(c.id, sid), `${ref} removed from the container.`) } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove.') } finally { setBusy(false) }
  }
  const fact = (label: string, value?: string | null, mono = false) => <div><dt className="text-xs text-text-muted">{label}</dt><dd className={`${mono ? 'font-mono text-sm' : ''} ${value ? '' : 'text-text-muted'}`}>{value || '—'}</dd></div>
  const dateOr = (v: string | null) => (v ? fmtDate(v + 'T12:00:00Z') : null)

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-8 md:py-12">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.div variants={fadeUp}><Link to="/dashboard/containers" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text focus-ring"><ArrowLeft size={14} aria-hidden="true" /> All containers</Link></motion.div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <motion.div variants={fadeUp} className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-gold" aria-hidden="true"><ContainerIcon size={26} /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><h1 className="!text-[clamp(1.5rem,3vw,2.1rem)]">{c.ref}</h1><Pill tone={stageTone(c.status)}>{stageLabels[c.status]}</Pill>{c.tracking.status === 'live' && <span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal"><Radio size={11} aria-hidden="true" /> Auto-updating from {c.line || 'carrier'}</span>}</div>
                <p className="mt-1 text-sm text-text-muted">{sizeLabels[c.size]} · {c.line}{c.number ? ` · ${c.number}` : ''} · {c.originPort || '—'} → {c.destinationPort || dest?.name || c.destination}{c.destinationPort && dest ? `, ${dest.name}` : ''}</p>
              </div>
            </motion.div>
            <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
              {c.mmsi && <Link to={`/live?vessel=${c.mmsi}`} className="btn-ghost !min-h-10 !px-4 text-sm"><Radar size={15} aria-hidden="true" /> Track vessel</Link>}
              <button onClick={() => { setEditing((e) => !e); setError('') }} className="btn-ghost !min-h-10 !px-4 text-sm"><Pencil size={15} aria-hidden="true" /> Edit details</button>
              {canLoad(c.status) ? <button onClick={() => setLoading((l) => !l)} className="btn-ghost !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Load orders</button> : <span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs text-text-muted" title="Orders can only be added or removed before the container sails."><Lock size={13} aria-hidden="true" /> Loading closed{(() => { const e = d.events.find((x) => x.status === 'sailed'); return e ? ` — sailed ${fmtDate(e.at)}` : c.status === 'closed' ? ' — container closed' : '' })()}</span>}
              {next && <button onClick={() => setAdvancing(true)} className="btn-gold !min-h-10 !px-4 text-sm"><ArrowRight size={15} aria-hidden="true" /> Mark {stageLabels[next].toLowerCase()}</button>}
            </motion.div>
          </div>

          <motion.div variants={fadeUp} className="card-dark mt-6 p-5">
            <StageStepper status={c.status} />
            <p className="mt-4 text-sm text-text-muted">{stageBlurb[c.status]}</p>
          </motion.div>

          <AnimatePresence>{flash && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {flash}</motion.p>}</AnimatePresence>
          {error && d && !editing && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

          <AnimatePresence>
            {editing && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card-dark mt-6 p-6">
                <h2 className="mb-1 !text-lg">Edit {c.ref}</h2>
                {idx >= CONTAINER_STAGES.indexOf('sailed') && <p className="mb-4 text-sm text-text-muted">The container has sailed — changing the vessel or MMSI updates every loaded order’s tracking too.</p>}
                <div className={idx >= CONTAINER_STAGES.indexOf('sailed') ? '' : 'mt-3'}><ContainerForm initial={toInput()} onSave={save} onCancel={() => setEditing(false)} busy={busy} error={error} submitLabel="Save details" /></div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>{loading && canLoad(c.status) && <div className="mt-6"><LoadPanel d={d} onClose={() => setLoading(false)} onDone={(r) => { apply(r, `${r.shipments.length - d.shipments.length} order${r.shipments.length - d.shipments.length === 1 ? '' : 's'} loaded${r.cascaded ? ` — ${r.cascaded} updated for customers` : ''}.`); setLoading(false) }} /></div>}</AnimatePresence>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <motion.section variants={fadeUp} className="card-dark overflow-hidden" aria-labelledby="orders-h">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                  <div><h2 id="orders-h" className="!text-lg">Loaded orders <span className="ml-1 text-sm font-normal text-text-muted">{d.shipments.length}</span></h2></div>
                  <div className="min-w-[200px]"><div className="flex justify-between text-[11px] text-text-muted"><span>Planned fill</span><span className="tabular-nums">{Math.round(used)} / {cap} cbm</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"><div className={`h-full ${used > cap ? 'bg-danger' : 'bg-teal'}`} style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div></div>
                </div>
                {d.shipments.length === 0 ? (
                  <div className="p-6"><Empty title="Nothing loaded yet" body={canLoad(c.status) ? 'Add the ocean orders you have won for this lane. Each one moves with the container from here on.' : 'This container moved on without any orders.'} action={canLoad(c.status) ? <button onClick={() => setLoading(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Load orders</button> : undefined} /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Cargo</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">ETA</th><th className="px-4 py-2.5 text-right">Actions</th></tr></thead>
                      <tbody>
                        {d.shipments.map((s) => (
                          <tr key={s.id} className="border-b border-border/70 align-top">
                            <td className="px-4 py-3"><Link to={`/track?ref=${s.ref}`} className="font-mono text-xs text-gold-deep hover:underline focus-ring">{s.ref}</Link><p className="mt-0.5 text-xs text-text-muted">{s.origin} → {countryByCode(s.destination)?.name ?? s.destination}</p></td>
                            <td className="max-w-[240px] px-4 py-3"><p className="truncate" title={s.description}>{s.description || '—'}</p><p className="text-xs text-text-muted">{cargoLabel(s.cargo)} · ~{cargoCbm[s.cargo] ?? 2} cbm</p></td>
                            <td className="px-4 py-3">{s.clientId ? <Link to={`/dashboard/clients/${s.clientId}`} className="hover:text-gold-deep focus-ring">{s.clientName ?? s.customer}</Link> : s.customer}</td>
                            <td className="px-4 py-3"><Pill tone={s.status === 'delivered' ? 'green' : 'teal'}>{statusLabels[s.status]}</Pill></td>
                            <td className="px-4 py-3 tabular-nums">{s.eta ? fmtDate(s.eta + 'T12:00:00Z') : '—'}</td>
                            <td className="px-4 py-3 text-right"><div className="inline-flex gap-1.5">{canLoad(c.status) && <button onClick={() => unload(s.id, s.ref)} disabled={busy} className="btn-ghost !min-h-8 !px-2.5 text-xs disabled:opacity-60">Remove</button>}<Link to={`/track?ref=${s.ref}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-label={`Open tracking page for ${s.ref}`}><ExternalLink size={13} /></Link></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.section>

              <motion.section variants={fadeUp} className="card-dark p-5" aria-labelledby="events-h">
                <h2 id="events-h" className="!text-lg">Timeline</h2>
                <ol className="mt-4 space-y-4">
                  {(() => {
                    // Stage changes are the milestones; carrier notes (details, loaded on vessel…) sit under the stage they happened in.
                    const sorted = [...d.events].sort((a, b) => CONTAINER_STAGES.indexOf(b.status) - CONTAINER_STAGES.indexOf(a.status) || new Date(b.at).getTime() - new Date(a.at).getTime())
                    const stageOf = new Set<string>(); const items = sorted.map((e) => { const first = !stageOf.has(e.status) && (e.code === '' || e.code in { GATE_IN: 1, DEPARTED: 1, ARRIVED: 1, DISCHARGED: 1 }); if (first) stageOf.add(e.status); return { e, milestone: first } })
                    return items.map(({ e, milestone }, i) => (
                      <li key={i} className={`flex gap-3 ${milestone ? '' : 'pl-1'}`}>
                        <span className={`mt-1 grid shrink-0 place-items-center rounded-full ${milestone ? 'h-6 w-6' : 'ml-1 h-4 w-4'} ${i === 0 && milestone ? 'bg-gold text-on-accent' : e.source === 'carrier' ? 'bg-teal/15 text-teal' : 'bg-surface-2 text-text-muted'}`} aria-hidden="true">{milestone ? (i === 0 ? <Ship size={12} /> : <Check size={12} />) : <Radio size={9} />}</span>
                        <div className={milestone ? '' : 'text-sm'}>
                          <p className={milestone ? 'font-medium' : 'font-medium text-text-muted'}>{milestone ? stageLabels[e.status] : eventTitles[e.code] ?? e.code}{e.place ? <span className="font-normal text-text-muted"> · {e.place}</span> : null}{e.source === 'carrier' && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-teal/40 px-1.5 text-[10px] font-medium text-teal"><Radio size={9} aria-hidden="true" /> via carrier</span>}</p>
                          <p className="text-xs text-text-muted">{fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}</p>{e.note && <p className="mt-1 text-sm text-text-muted">{e.note}</p>}
                        </div>
                      </li>
                    ))
                  })()}
                </ol>
              </motion.section>
            </div>

            <motion.aside variants={fadeUp} className="space-y-6">
              <section className="card-dark p-5" aria-labelledby="booking-h">
                <h2 id="booking-h" className="!text-lg">Booking</h2>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{fact('Shipping line', c.line)}{fact('Booking ref', c.bookingRef, true)}{fact('Container no.', c.number, true)}{fact('Seal', c.seal, true)}{fact('Size', sizeLabels[c.size])}{fact('Capacity (est.)', `${cap} cbm`)}</dl>
              </section>
              <section className="card-dark p-5" aria-labelledby="voyage-h">
                <h2 id="voyage-h" className="!text-lg">Voyage</h2>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{fact('Origin port', c.originPort)}{fact('Destination port', c.destinationPort || dest?.name)}{fact('Port cut-off', dateOr(c.cutoffDate))}{fact('ETD', dateOr(c.etd))}{fact('ETA', dateOr(c.eta))}{fact('Vessel', c.vesselName)}{fact('MMSI', c.mmsi, true)}{fact('Voyage', c.voyage, true)}</dl>
                {c.mmsi && <Link to={`/live?vessel=${c.mmsi}`} className="mt-4 inline-flex items-center gap-1 text-sm text-gold-deep hover:underline focus-ring"><Radar size={14} aria-hidden="true" /> Open on the live map</Link>}
                {!c.vesselName && isOpen(c.status) && <p className="mt-3 text-xs text-text-muted">Add the vessel and MMSI once the line confirms — needed before marking it sailed, and it gives every customer live tracking.</p>}
              </section>
              {provider?.enabled && (
                <section className={`card-dark p-5 ${c.tracking.status === 'live' ? 'border-teal/40' : ''}`} aria-labelledby="carrier-h">
                  <div className="flex items-start justify-between gap-2"><h2 id="carrier-h" className="!text-lg">Carrier tracking</h2>{c.tracking.status !== 'off' && <Pill tone={c.tracking.status === 'live' ? 'teal' : c.tracking.status === 'error' ? 'danger' : 'muted'}>{c.tracking.status === 'live' ? 'Live' : c.tracking.status === 'error' ? 'Error' : 'Waiting for the line'}</Pill>}</div>
                  {c.tracking.status === 'off' ? (
                    <>
                      <p className="mt-2 text-sm text-text-muted">Connect this booking to {c.line || 'the shipping line'} and Ship Sync pulls the container number, seal, vessel and voyage as they are assigned, then moves the container through Gated in → Sailed → Arrived on its own — every loaded order and its customer tracking follow.</p>
                      {provider.simulated && <p className="mt-2 text-xs text-text-muted">This server runs the built-in carrier simulator — a real line or aggregator plugs in with one setting.</p>}
                      {!c.bookingRef && !c.number && <p className="mt-2 text-xs text-danger">Add the booking reference (Edit details) first.</p>}
                      {isOpen(c.status) && <button onClick={connect} disabled={busy || (!c.bookingRef && !c.number)} className="btn-gold mt-4 !min-h-10 !px-4 text-sm disabled:opacity-60"><Radio size={15} aria-hidden="true" /> {busy ? 'Connecting…' : `Connect to ${c.line || 'carrier'}`}</button>}
                    </>
                  ) : (
                    <>
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{fact('Source', provider.label)}{fact('Booking', c.bookingRef, true)}{fact('Last checked', c.tracking.syncedAt ? fmtDateTime(c.tracking.syncedAt) : 'Not yet')}{fact('Checks every', `${syncMinutes} min`)}</dl>
                      {c.tracking.status === 'error' && <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{c.tracking.error}</p>}
                      {c.tracking.status === 'pending' && <p className="mt-3 text-xs text-text-muted">The line hasn’t published anything for this booking yet — that’s normal for the first few hours. We keep checking.</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={syncNow} disabled={busy} className="btn-ghost !min-h-9 !px-3 text-sm disabled:opacity-60"><RefreshCw size={14} aria-hidden="true" className={busy ? 'animate-spin' : ''} /> Check now</button>
                        <button onClick={disconnect} disabled={busy} className="btn-ghost !min-h-9 !px-3 text-sm text-text-muted disabled:opacity-60">Disconnect</button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {c.notes && <section className="card-dark p-5" aria-labelledby="notes-h"><h2 id="notes-h" className="!text-lg">Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{c.notes}</p></section>}
            </motion.aside>
          </div>
        </motion.div>
      </div>
      <AnimatePresence>{advancing && next && <AdvanceModal d={d} onClose={() => setAdvancing(false)} onDone={(r) => { apply(r, `${c.ref} is now ${stageLabels[r.container.status].toLowerCase()}${r.cascaded ? ` — ${r.cascaded} order${r.cascaded === 1 ? '' : 's'} updated for customers` : ''}.`); setAdvancing(false) }} />}</AnimatePresence>
    </div>
  )
}
