import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, CreditCard, FileText, Lock, RotateCcw, Wallet } from 'lucide-react'
import { NOTIFY_EVENT } from '../lib/notifications'
import { methodLabels, paymentStatusLabels, paymentsApi, usd, type Payment } from '../lib/payments'
import { Confirm } from './board'

const tone: Record<Payment['status'], string> = { pending: 'bg-gold/15 text-gold-deep', held: 'bg-teal/15 text-teal', released: 'bg-teal/15 text-teal', paid_out: 'bg-teal/15 text-teal', refunded: 'bg-danger/15 text-danger', cancelled: 'bg-surface-2 text-text-muted', direct: 'bg-teal/15 text-teal' }
const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

/** Pay for a shipment (customer) / see and record payments (office). Funds sit in escrow until the release milestone. */
export function PaymentCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof paymentsApi.forShipment>> | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [recording, setRecording] = useState(false)
  const [rec, setRec] = useState({ amountUsd: '', method: 'bank', note: '' })
  const [refunding, setRefunding] = useState(false)
  const [reason, setReason] = useState('')
  const [params, setParams] = useSearchParams()
  const load = () => paymentsApi.forShipment(shipmentId).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  // Back from Stripe Checkout: confirm with the server (covers the case where the webhook hasn't landed yet).
  useEffect(() => {
    const paid = params.get('paid'); if (!paid || params.get('s') !== shipmentId) return
    const next = new URLSearchParams(params); next.delete('paid'); setParams(next, { replace: true })
    if (paid === 'cancel') { setToast('Payment cancelled — nothing was charged.'); return }
    setBusy('verify')
    paymentsApi.verify(paid).then((p) => { if (['held', 'direct'].includes(p.status)) setToast('Payment received — your receipt is in the documents.'); else setToast('We’re confirming your payment with the bank; this card will update shortly.'); window.dispatchEvent(new Event(NOTIFY_EVENT)); return load() }).catch((e) => setError(e instanceof Error ? e.message : 'Could not confirm the payment.')).finally(() => setBusy(''))
  }, [params, shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">{error || 'Loading payment…'}</div>
  const p = d.payment; const paid = p && ['held', 'released', 'paid_out', 'direct'].includes(p.status)
  if (!p && !d.due && !d.canManage) return null
  const act = async (fn: () => Promise<unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg); window.dispatchEvent(new Event(NOTIFY_EVENT)) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setRecording(false); setRefunding(false) } }
  const checkout = async () => { setBusy('pay'); setError(''); try { const r = await paymentsApi.checkout(shipmentId); window.location.assign(r.url) } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the payment.'); setBusy('') } }
  const milestone = d.config.releaseOn === 'delivered' ? 'delivered' : 'on its way'
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="payment-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Wallet size={14} className="text-gold" aria-hidden="true" /> Payment</p>
        {p && p.status !== 'cancelled' && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[p.status]}`} data-testid="payment-status">{paymentStatusLabels[p.status]}</span>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {p && (paid || p.status === 'refunded') ? (
        <div className="mt-3 text-sm" data-testid="payment-paid">
          <p><strong className="tabular-nums">{usd(p.amountUsd)}</strong> {p.status === 'refunded' ? 'refunded' : 'paid'} {p.paidAt ? `on ${fmt(p.paidAt)}` : ''}{p.method ? ` · ${methodLabels[p.method] ?? p.method}` : ''}{p.provider === 'manual' && p.recordedBy ? ` · recorded by ${p.recordedBy}` : ''}</p>
          <ul className="mt-1 text-xs text-text-muted">{p.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span className="min-w-0 truncate">{i.description}</span><span className="tabular-nums">{usd(i.amountUsd)}</span></li>)}</ul>
          {p.status === 'held' && <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-text-muted"><Lock size={12} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /> Held by Ship Sync. Released to the shipper once the shipment is {milestone}.</p>}
          {(p.status === 'released' || p.status === 'paid_out') && <p className="mt-2 text-xs text-text-muted">Released to the shipper {fmt(p.releasedAt)}.{d.canManage ? ` Your share after the platform fee: ${usd(p.netUsd)}.` : ''}</p>}
          {p.status === 'refunded' && <p className="mt-2 text-xs text-text-muted">{p.refundReason}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {p.receiptDocumentId && p.status !== 'refunded' && <Link to={`/dashboard/documents/${p.receiptDocumentId}`} className="btn-ghost !min-h-8 !px-2.5 text-xs"><FileText size={12} aria-hidden="true" /> Receipt</Link>}
            {d.canManage && <Link to="/dashboard/payments" className="btn-ghost !min-h-8 !px-2.5 text-xs">Balance & payouts</Link>}
            {d.canManage && p.status === 'held' && p.provider === 'stripe' && <button onClick={() => setRefunding(true)} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger"><RotateCcw size={12} aria-hidden="true" /> Refund</button>}
          </div>
        </div>
      ) : d.due ? (
        <div className="mt-3" data-testid="payment-due">
          <ul className="text-sm">{d.due.items.map((i, k) => <li key={k} className="flex justify-between gap-3 py-0.5"><span className="min-w-0 text-text-muted">{i.description}</span><span className="tabular-nums">{usd(i.amountUsd)}</span></li>)}</ul>
          <p className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>Total due</span><span className="tabular-nums" data-testid="payment-total">{usd(d.due.amountUsd)}</span></p>
          {d.canPay ? (
            <>
              <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-text-muted"><Lock size={12} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /> {d.config.customerNote}</p>
              <div className="mt-3 flex justify-end"><button onClick={checkout} disabled={busy === 'pay' || busy === 'verify'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60" data-testid="pay-now"><CreditCard size={14} aria-hidden="true" /> {busy === 'pay' ? 'Opening secure checkout…' : busy === 'verify' ? 'Confirming…' : `Pay ${usd(d.due.amountUsd)} securely`}</button></div>
              {d.config.mode === 'test' && <p className="mt-2 text-right text-[11px] text-text-muted">Test mode — use card 4242 4242 4242 4242.</p>}
            </>
          ) : d.canManage ? (
            <>
              <p className="mt-2 text-xs text-text-muted">{d.config.online ? 'The customer can pay online from their dashboard; the money is held in escrow and released to you once the shipment is ' + milestone + '.' : 'Online payments are not switched on yet.'} If they pay you directly, record it here.</p>
              {!recording && <div className="mt-2 flex justify-end"><button onClick={() => { setRecording(true); setRec({ amountUsd: String(d.due?.amountUsd ?? ''), method: 'bank', note: '' }) }} className="btn-ghost !min-h-8 !px-3 text-xs" data-testid="record-payment">Record a payment</button></div>}
              {recording && (
                <form onSubmit={(e) => { e.preventDefault(); void act(() => paymentsApi.record(shipmentId, { amountUsd: Number(rec.amountUsd) || undefined, method: rec.method, note: rec.note }), 'Payment recorded.', 'rec') }} className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end" aria-label="Record a payment">
                  <label className="text-xs text-text-muted">Amount (USD)<input type="number" min={1} step="0.01" required className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={rec.amountUsd} onChange={(e) => setRec({ ...rec, amountUsd: e.target.value })} /></label>
                  <label className="text-xs text-text-muted">Method<select className="input-dark mt-1 !min-h-9 text-sm" value={rec.method} onChange={(e) => setRec({ ...rec, method: e.target.value })}>{['bank', 'cash', 'mobile_money', 'card', 'other'].map((m) => <option key={m} value={m}>{methodLabels[m]}</option>)}</select></label>
                  <label className="text-xs text-text-muted">Note<input className="input-dark mt-1 !min-h-9 text-sm" placeholder="Reference, who paid…" value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} /></label>
                  <div className="flex gap-2"><button type="button" onClick={() => setRecording(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy === 'rec'} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{busy === 'rec' ? 'Saving…' : 'Save'}</button></div>
                </form>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-text-muted">{d.config.online ? 'Payment opens once the shipper confirms the booking.' : 'Online payment isn’t available yet — settle directly with the shipper, who will record it here.'}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-muted">No charge on this shipment yet.</p>
      )}
      {refunding && p && <Confirm title="Refund this payment?" body={<div><p>{usd(p.amountUsd)} goes back to {p.customer ?? 'the customer'}’s card and the funds leave escrow.</p><input autoFocus aria-label="Reason" className="input-dark mt-3 !min-h-9 w-full text-sm" placeholder="Reason (shown to the customer)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>} confirmLabel="Refund" busy={busy === 'ref'} onClose={() => setRefunding(false)} onConfirm={() => act(() => paymentsApi.refund(p.id, reason || 'Refunded by the shipper'), 'Refund issued.', 'ref')} />}
    </div>
  )
}
