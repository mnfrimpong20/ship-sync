import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, ShieldCheck, Truck } from 'lucide-react'
import type { Run } from '../../lib/ops'
import { driverApi, type DriverPos, type RunMessage } from '../../lib/driverApi'
import { fmtDateTime } from '../ui'

/** The run's driver position for the office (refreshed every 30 s while the run is in progress). */
export function useRunTruck(run: Run | null, enabled: boolean) {
  const [pos, setPos] = useState<DriverPos | null>(null)
  const live = enabled && run?.status === 'in_progress'
  useEffect(() => {
    if (!live || !run) { setPos(null); return }
    const get = () => driverApi.positions().then((r) => setPos(r.drivers.find((d) => d.runId === run.id) ?? null)).catch(() => {})
    void get(); const x = setInterval(() => { if (document.visibilityState === 'visible') void get() }, 30000); return () => clearInterval(x)
  }, [live, run?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return pos
}

const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

/** Office side of a run: where the driver is, their vehicle check, and the message thread. */
export function RunOffice({ run, pos }: { run: Run; pos: DriverPos | null }) {
  const [list, setList] = useState<RunMessage[]>([]); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const box = useRef<HTMLUListElement>(null)
  const load = () => driverApi.messages(run.id).then((r) => setList(r.messages)).catch(() => {})
  useEffect(() => { void load(); if (run.status !== 'in_progress') return; const x = setInterval(load, 20000); return () => clearInterval(x) }, [run.id, run.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [list.length])
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); setErr(''); try { await driverApi.send(run.id, { body: body.trim() }); setBody(''); await load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  const label = (id: string | null) => (id ? run.stops.find((s) => s.id === id)?.label : null)
  if (!run.driverId) return null
  return (
    <section className="card-dark p-5" aria-labelledby="ro-h" data-testid="run-office">
      <h2 id="ro-h" className="flex items-center gap-2 !text-base"><Truck size={16} aria-hidden="true" /> {run.driverName ?? 'Driver'}</h2>
      <p className="mt-1 text-sm text-text-muted" data-testid="ro-pos">{run.status !== 'in_progress' ? (run.status === 'planned' ? 'Not started yet.' : 'Run finished.') : pos ? `Seen ${ago(pos.at)} · ${pos.pending} stops left · shown on the map` : 'No live location — the app may be closed or location is off.'}</p>
      {run.vehicleCheck && <p className={`mt-1 flex items-center gap-1.5 text-sm ${run.vehicleCheck.issues.length || !run.vehicleCheck.safe ? 'text-danger' : 'text-teal'}`}><ShieldCheck size={14} aria-hidden="true" /> Vehicle check {fmtDateTime(run.vehicleCheck.at)}{run.vehicleCheck.issues.length ? ` — ${run.vehicleCheck.issues.join(', ')}` : ' — all OK'}{run.vehicleCheck.odometer ? ` · ${run.vehicleCheck.odometer.toLocaleString()} on the clock` : ''}</p>}
      <h3 className="mt-4 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare size={14} aria-hidden="true" /> Messages</h3>
      {list.length ? <ul ref={box} className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">{list.map((m) => <li key={m.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${m.side === 'office' ? 'ml-auto bg-gold/15' : 'bg-surface-2'}`} data-testid="ro-msg"><p className="text-xs text-text-muted">{m.from} · {fmtDateTime(m.at)}{label(m.stopId) ? ` · ${label(m.stopId)}` : ''}</p>{m.body && <p>{m.body}</p>}{m.audio && <audio controls src={m.audio} className="mt-1 h-9 w-full" aria-label={`Voice note from ${m.from}`} />}</li>)}</ul> : <p className="mt-1 text-sm text-text-muted">No messages on this run.</p>}
      <form onSubmit={send} className="mt-3 flex gap-2"><label htmlFor="ro-body" className="sr-only">Message the driver</label><input id="ro-body" className="input-dark flex-1" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the driver (they get a notification)" data-testid="ro-body" /><button disabled={busy || !body.trim()} className="btn-gold !min-h-11 !px-3 disabled:opacity-60" aria-label="Send"><Send size={16} aria-hidden="true" /></button></form>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </section>
  )
}
