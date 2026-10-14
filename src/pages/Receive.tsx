import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import QRCode from 'qrcode'
import { AlertTriangle, Check, CircleCheck, MapPin, Package, Plane, Ship } from 'lucide-react'
import { Logo, fmtDate, fmtDateTime } from '../components/ui'
import { recipientApi, type ReceiverPage } from '../lib/recipient'
import { statusOrder } from '../lib/data'
import { fadeUp, stagger } from '../lib/motion'

const STEPS: { key: string; label: string; done: (s: string) => boolean }[] = [
  { key: 'booked', label: 'Booked', done: () => true },
  { key: 'in_transit', label: 'On its way', done: (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('in_transit') },
  { key: 'arrived', label: 'Arrived', done: (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('arrived') },
  { key: 'ready', label: 'Ready', done: (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('ready_for_collection') },
  { key: 'delivered', label: 'Delivered', done: (s) => s === 'delivered' },
]

/** `/r/:token` — the page the receiver in Africa opens from the text message. Phone first, no sign-in. */
export default function Receive() {
  const { token = '' } = useParams()
  const [d, setD] = useState<ReceiverPage | null>(null)
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')
  const [form, setForm] = useState({ name: '', note: '', allGood: true })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | boolean>(null)
  useEffect(() => { recipientApi.page(token).then((r) => { setD(r); setForm((f) => ({ ...f, name: f.name || r.receiver?.name || '' })) }).catch((e) => setError(e instanceof Error ? e.message : 'This link is not valid.')) }, [token])
  useEffect(() => { if (d) QRCode.toDataURL(d.trackUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#0B1B33', light: '#FFFFFF' } }).then(setQr).catch(() => {}) }, [d])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!d) return
    setBusy(true); setError('')
    try { const r = await recipientApi.received(token, form); setDone(r.delivered); const fresh = await recipientApi.page(token); setD(fresh) } catch (err) { setError(err instanceof Error ? err.message : 'Could not send.') } finally { setBusy(false) }
  }
  if (error && !d) return <div className="container-x py-24 text-center"><Logo /><p className="mt-6 text-danger">{error}</p><p className="mt-2 text-sm text-text-muted">Ask the sender for a fresh link, or <Link to="/track" className="text-gold hover:underline">track with the reference</Link>.</p></div>
  if (!d) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  const s = d.shipment
  const delivered = s.status === 'delivered'
  const collect = !delivered && (d.readyForCollection || s.status === 'customs' || s.status === 'arrived')
  return (
    <div className="bg-bg text-text">
      <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-xl px-4 py-8 md:py-12">
        <motion.div variants={fadeUp} className="flex items-center justify-between"><Logo /><span className="font-mono text-xs text-text-muted">{s.ref}</span></motion.div>
        <motion.h1 variants={fadeUp} className="mt-6 !text-[clamp(1.6rem,6vw,2.2rem)]">{d.receiver ? `Hi ${d.receiver.name.split(' ')[0]} — ` : ''}{delivered ? 'your shipment has been delivered.' : collect ? 'your shipment is ready.' : 'a shipment is coming to you.'}</motion.h1>
        <motion.p variants={fadeUp} className="mt-2 text-text-muted">From <strong className="text-text">{s.sender}</strong> in {s.origin}, handled by {d.shipper.name}.{s.description ? ` ${s.description}.` : ''}</motion.p>

        <motion.div variants={fadeUp} className="card-dark mt-6 p-5" data-testid="receiver-status">
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">{s.mode === 'air' ? <Plane size={16} className="text-sky" aria-hidden="true" /> : <Ship size={16} className="text-teal" aria-hidden="true" />} {s.statusLabel}</p>
            {s.eta && !delivered && <p className="text-xs text-text-muted">Expected {fmtDate(s.eta + 'T12:00:00Z')}</p>}
          </div>
          <ol className="mt-4 grid grid-cols-4 gap-1 text-center text-[11px]">
            {STEPS.map((st) => { const on = st.done(s.status); return <li key={st.key} className={on ? 'text-text' : 'text-text-muted'}><span className={`mx-auto mb-1 block h-2 rounded-full ${on ? 'bg-gold' : 'bg-border'}`} />{st.label}</li> })}
          </ol>
          {collect && (
            <div className="mt-4 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm" data-testid="collect-box">
              <p className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" /><span>{d.readyForCollection ? <><strong>Ready for collection</strong> from {d.shipper.name}{s.port ? ` (${s.port})` : ''}. Bring an ID and this reference: <strong className="font-mono">{s.ref}</strong>.</> : <>It has reached {s.port || s.destinationName} and is going through clearance. We’ll text you when it’s ready.</>}</span></p>
            </div>
          )}
          {s.vesselName && !delivered && statusOrder.indexOf(s.status as never) < statusOrder.indexOf('arrived') && <p className="mt-3 text-xs text-text-muted">Sailing on {s.vesselName}. <a href={d.trackUrl} className="text-gold hover:underline">See it on the map</a>.</p>}
          {d.pieces.length > 1 && <p className="mt-3 inline-flex items-center gap-2 text-xs text-text-muted"><Package size={14} aria-hidden="true" /> {d.pieces.length} pieces · {d.pieces.filter((p) => p.status === 'delivered').length} delivered</p>}
        </motion.div>

        {(d.receipt || done !== null) ? (
          <motion.div variants={fadeUp} className={`mt-4 rounded-xl border p-5 ${d.receipt?.allGood !== false ? 'border-teal/40 bg-teal/10' : 'border-danger/40 bg-danger/10'}`} data-testid="receipt-done">
            <p className="flex items-start gap-2 text-sm">{d.receipt?.allGood !== false ? <CircleCheck size={18} className="shrink-0 text-teal" aria-hidden="true" /> : <AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden="true" />}<span>{d.receipt?.allGood !== false ? <><strong>Thank you{d.receipt ? `, ${d.receipt.name.split(' ')[0]}` : ''}.</strong> Receipt confirmed{d.receipt?.at ? ` on ${fmtDateTime(d.receipt.at)}` : ''}. {s.sender} and {d.shipper.name} have been told.</> : <><strong>We’ve flagged a problem.</strong> {d.shipper.name} will follow up with you.</>}</span></p>
          </motion.div>
        ) : (
          <motion.form variants={fadeUp} onSubmit={submit} className="card-dark mt-4 p-5" aria-label="Confirm receipt" data-testid="receipt-form">
            <h2 className="!text-base">Did you receive it?</h2>
            <p className="mt-1 text-xs text-text-muted">{delivered ? 'Tap confirm once the goods are in your hands.' : 'Only confirm once the goods are actually with you — this tells the sender it has arrived.'}</p>
            {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <input aria-label="Your name" required minLength={2} className="input-dark mt-3 !min-h-11 text-base" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border p-2.5 ${form.allGood ? 'border-teal bg-teal/10' : 'border-border'}`}><input type="radio" name="ok" className="sr-only" checked={form.allGood} onChange={() => setForm({ ...form, allGood: true })} /><Check size={14} aria-hidden="true" /> All good</label>
              <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border p-2.5 ${!form.allGood ? 'border-danger bg-danger/10' : 'border-border'}`}><input type="radio" name="ok" className="sr-only" checked={!form.allGood} onChange={() => setForm({ ...form, allGood: false })} /><AlertTriangle size={14} aria-hidden="true" /> Something’s wrong</label>
            </div>
            <input aria-label="Note" className="input-dark mt-2 !min-h-11 text-base" placeholder={form.allGood ? 'Anything to add? (optional)' : 'What’s wrong? (missing piece, damage…)'} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <button disabled={busy} className="btn-gold mt-3 w-full !min-h-12 text-base disabled:opacity-60">{busy ? 'Sending…' : form.allGood ? 'I received it' : 'Report a problem'}</button>
          </motion.form>
        )}

        <motion.div variants={fadeUp} className="card-dark mt-4 flex items-center gap-4 p-5">
          {qr ? <img src={qr} alt={`QR code for ${s.ref}`} className="h-24 w-24 shrink-0 rounded-lg bg-white p-1" /> : <div className="h-24 w-24 shrink-0 rounded-lg bg-surface-2" />}
          <div className="min-w-0 text-sm"><p className="font-semibold">Show this at collection</p><p className="mt-0.5 text-xs text-text-muted">Reference <span className="font-mono text-text">{s.ref}</span>. Staff can scan the code to pull up the shipment.</p><a href={d.trackUrl} className="mt-1 inline-block text-xs text-gold hover:underline">Full tracking page →</a></div>
        </motion.div>

        <motion.details variants={fadeUp} className="card-dark mt-4 p-5">
          <summary className="cursor-pointer text-sm font-semibold">History</summary>
          <ol className="mt-3 space-y-2 text-xs">{[...d.events].reverse().map((e, i) => <li key={i}><span className="font-semibold">{e.label}</span>{e.place ? ` · ${e.place}` : ''}{e.at ? <span className="text-text-muted"> · {fmtDateTime(e.at)}</span> : ''}{e.note ? <span className="block text-text-muted">{e.note}</span> : null}</li>)}</ol>
        </motion.details>
        <p className="mt-6 text-center text-[11px] text-text-muted">Sent by {d.shipper.name} via Ship Sync. Questions about the goods go to the sender.</p>
      </motion.div>
    </div>
  )
}
