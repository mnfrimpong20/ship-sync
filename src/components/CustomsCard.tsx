import { useEffect, useState } from 'react'
import { BadgeCheck, Check, Copy, Landmark, Phone, X } from 'lucide-react'
import { brokersApi, jobStepLabels, JOB_STEPS, type Broker, type JobStep, type StepInput } from '../lib/brokers'
import { Avatar, money } from './ui'
import { Confirm } from './board'

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Pick a broker at the destination port and watch the clearance progress; the office can move it on for the broker. */
export function CustomsCard({ shipmentId, destination }: { shipmentId: string; destination: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof brokersApi.forShipment>> | null>(null)
  const [picking, setPicking] = useState<Broker | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [stepping, setStepping] = useState<StepInput | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const load = () => brokersApi.forShipment(shipmentId).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  if (!d) return null
  if (!d.supported && !d.job) return null
  const act = async (fn: () => Promise<unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setPicking(null); setStepping(null); setCancelling(false) } }
  const j = d.job; const port = destination.toUpperCase() === 'NG' ? 'Lagos' : 'Tema'
  const idx = j ? JOB_STEPS.indexOf(j.status as JobStep) : -1
  const next: JobStep | null = j && idx >= 0 && idx < JOB_STEPS.length - 1 ? JOB_STEPS[idx + 1] : null
  const copyLink = async () => { if (!j) return; try { const l = await brokersApi.link(j.id); await navigator.clipboard.writeText(l); setToast('Broker link copied — send it on WhatsApp.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not copy.') } }
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="customs-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Landmark size={14} className="text-gold-deep" aria-hidden="true" /> Customs clearance at {port}</p>
        {j && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${j.status === 'done' ? 'bg-teal/15 text-teal' : j.status === 'cancelled' || j.status === 'declined' ? 'bg-danger/15 text-danger' : 'bg-gold/15 text-gold-deep'}`} data-testid="job-status">{jobStepLabels[j.status]}</span>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {j ? (
        <div className="mt-3 text-sm" data-testid="customs-job">
          <div className="flex items-center gap-3"><Avatar initials={j.broker.initials} hue={j.broker.hue} size={36} /><div className="min-w-0"><p className="font-semibold">{j.broker.name}{j.broker.verified && <BadgeCheck size={14} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="truncate text-xs text-text-muted">{j.broker.company || 'Independent agent'} · fee {money(j.feeUsd)}{j.broker.whatsapp || j.broker.phone ? <> · <a href={`tel:${j.broker.whatsapp || j.broker.phone}`} className="text-gold-deep hover:underline"><Phone size={11} className="inline" aria-hidden="true" /> {j.broker.whatsapp || j.broker.phone}</a></> : null}</p></div></div>
          <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="Clearance progress">{JOB_STEPS.map((s, i) => <li key={s} title={jobStepLabels[s]} className={`h-1.5 rounded-full ${i <= idx ? 'bg-gold' : 'bg-surface-2'}`} />)}</ol>
          {j.dutyLocal != null && <p className="mt-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs"><strong>Customs assessed {j.dutyCurrency} {j.dutyLocal.toLocaleString()}</strong>{j.reference ? ` · ${j.reference}` : ''} — this is the official figure, shown on the Duty card too.</p>}
          <ul className="mt-2 space-y-1 text-xs text-text-muted">{(showAll ? j.timeline : j.timeline.slice(-3)).map((t, k) => <li key={k}><span className="text-text">{jobStepLabels[t.status as JobStep] ?? t.status}</span> · {fmt(t.at)} · {t.by}{t.note ? ` — ${t.note}` : ''}</li>)}{j.timeline.length > 3 && !showAll && <li><button onClick={() => setShowAll(true)} className="text-gold-deep hover:underline">Show all {j.timeline.length}</button></li>}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.canManage && next && <button onClick={() => setStepping({ status: next, note: '', dutyCurrency: j.dutyCurrency ?? (destination === 'NG' ? 'NGN' : 'GHS') })} className="btn-gold !min-h-8 !px-2.5 text-xs" data-testid="job-next">{jobStepLabels[next]} →</button>}
            {d.canManage && <button onClick={copyLink} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Copy size={12} aria-hidden="true" /> Broker link</button>}
            {!['done', 'cancelled', 'declined'].includes(j.status) && <button onClick={() => setCancelling(true)} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger"><X size={12} aria-hidden="true" /> Cancel</button>}
          </div>
          {stepping && (
            <form onSubmit={(e) => { e.preventDefault(); void act(() => brokersApi.step(j.id, stepping), 'Updated — both sides notified.', 'step') }} className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3" aria-label="Update clearance">
              <p className="text-xs font-semibold">{jobStepLabels[stepping.status]}</p>
              {stepping.status === 'assessed' && <div className="grid grid-cols-[1fr_auto_1fr] gap-2"><input type="number" min={0} required aria-label="Duty assessed" className="input-dark !min-h-9 text-sm tabular-nums" placeholder="Amount" value={stepping.dutyLocal ?? ''} onChange={(e) => setStepping({ ...stepping, dutyLocal: e.target.value ? Number(e.target.value) : undefined })} /><select aria-label="Currency" className="input-dark !min-h-9 text-sm" value={stepping.dutyCurrency} onChange={(e) => setStepping({ ...stepping, dutyCurrency: e.target.value })}><option>GHS</option><option>NGN</option><option>USD</option></select><input aria-label="ICUMS reference" className="input-dark !min-h-9 text-sm" placeholder="ICUMS / NCS ref" value={stepping.reference ?? ''} onChange={(e) => setStepping({ ...stepping, reference: e.target.value })} /></div>}
              <input aria-label="Note" className="input-dark !min-h-9 text-sm" placeholder="Note for the customer (optional)" value={stepping.note ?? ''} onChange={(e) => setStepping({ ...stepping, note: e.target.value })} />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setStepping(null)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button disabled={busy === 'step'} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60">{busy === 'step' ? 'Saving…' : 'Save'}</button></div>
            </form>
          )}
        </div>
      ) : d.canBook ? (
        <div className="mt-3">
          <p className="text-sm text-text-muted">Book a licensed clearing agent at {port}. Fees are per shipment for your cargo type; duty is paid separately to customs (the broker tells you the assessed figure).</p>
          <ul className="mt-3 space-y-2" data-testid="broker-options">
            {d.brokers.slice(0, 4).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                <div className="flex min-w-0 items-center gap-2"><Avatar initials={b.initials} hue={b.hue} size={32} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{b.name}{b.verified && <BadgeCheck size={13} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="truncate text-xs text-text-muted">{b.ports.join(', ')} · ★ {b.rating.toFixed(1)} ({b.reviews}) · replies in ~{b.responseHours}h{b.dutyAdvance ? ' · advances duty' : ''}</p></div></div>
                <div className="flex shrink-0 items-center gap-2"><span className="text-sm font-semibold tabular-nums">{money(b.feeUsd ?? 0)}</span><button onClick={() => { setPicking(b); setNote('') }} className="btn-gold !min-h-8 !px-2.5 text-xs" data-testid="pick-broker">Book</button></div>
              </li>
            ))}
            {d.brokers.length === 0 && <li className="text-sm text-text-muted">No brokers listed for this port yet.</li>}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-muted">No broker booked yet. {d.canManage ? '' : 'The shipper can book one, or you can from your dashboard.'}</p>
      )}
      {picking && <Confirm title={`Book ${picking.name} for this shipment?`} danger={false} body={<div><p>{picking.company || 'Independent agent'} · {picking.ports.join(', ')} · clearance fee <strong>{money(picking.feeUsd ?? 0)}</strong> (paid to the broker{picking.dutyAdvance ? '; they can advance the duty' : ''}). They get the shipment details and documents and update this card as it clears.</p><input aria-label="Note for the broker" className="input-dark mt-3 !min-h-9 w-full text-sm" placeholder="Anything the broker should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} /></div>} confirmLabel="Book broker" busy={busy === 'book'} onClose={() => setPicking(null)} onConfirm={() => act(() => brokersApi.book(shipmentId, picking.id, note), `${picking.name} booked — they've been sent the job.`, 'book')} />}
      {cancelling && j && <Confirm title="Cancel this clearance job?" body={<p>{j.broker.name} will be told. You can book another broker afterwards.</p>} confirmLabel="Cancel job" busy={busy === 'cancel'} onClose={() => setCancelling(false)} onConfirm={() => act(() => brokersApi.step(j.id, { status: 'cancelled', note: 'Cancelled from the shipment page' }), 'Job cancelled.', 'cancel')} />}
    </div>
  )
}
