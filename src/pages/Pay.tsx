import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, CreditCard, Lock, Printer } from 'lucide-react'
import { collectionsApi, type InvoiceFull } from '../lib/collections'
import { usd, type Payment } from '../lib/payments'
import { Avatar, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

/** `/pay/:token` — a customer (signed in or not) sees the invoice and pays it by card. */
export default function Pay() {
  const { token = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const [d, setD] = useState<{ invoice: InvoiceFull; payment: Payment | null; online: boolean; mode: 'off' | 'test' | 'live' } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const load = () => collectionsApi.pay(token).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.'))
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const paid = sp.get('paid'); if (!paid) return
    const n = new URLSearchParams(sp); n.delete('paid'); setSp(n, { replace: true })
    if (paid === 'cancel') { setToast('Payment cancelled — nothing was charged.'); return }
    setBusy('verify'); collectionsApi.verify(token).then((r) => { setD((x) => (x ? { ...x, invoice: r.invoice, payment: r.payment } : x)); setToast(r.invoice.status === 'paid' ? 'Paid — thank you! A receipt is on its way.' : 'Confirming your payment with the bank…') }).catch((e) => setError(e instanceof Error ? e.message : 'Could not confirm.')).finally(() => setBusy(''))
  }, [sp, token]) // eslint-disable-line react-hooks/exhaustive-deps
  const checkout = async () => { setBusy('pay'); setError(''); try { const r = await collectionsApi.checkout(token); window.location.assign(r.url) } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the payment.'); setBusy('') } }
  if (error && !d) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-danger">{error}</div></div>
  if (!d) return <div className="bg-bg text-text"><BrandLoader label="Loading invoice…" /></div>
  const inv = d.invoice; const paid = inv.status === 'paid'
  return (
    <div className="bg-bg text-text">
      <style>{`@media print { header, footer, .no-print { display: none !important } body { background: #fff } .sheet { box-shadow: none !important } }`}</style>
      <div className="container-x py-8 md:py-12">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-3xl">
          {toast && <motion.p variants={fadeUp} role="status" className="no-print mb-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}
          {error && <p role="alert" className="no-print mb-4 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className={`no-print mb-6 rounded-2xl border p-5 ${paid ? 'border-teal/40 bg-teal/10' : inv.overdue ? 'border-danger/40 bg-danger/10' : 'border-gold/40 bg-gold/10'}`} data-testid="pay-box">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{paid ? 'Paid in full' : inv.overdue ? 'Overdue' : 'Amount due'}</p><p className="mt-1 font-heading text-3xl font-bold tabular-nums" data-testid="pay-amount">{usd(paid ? inv.total : inv.balance)}</p><p className="text-sm text-text-muted">Invoice {inv.number} from {inv.shipper.name}{inv.dueAt && !paid ? ` · due ${fmtDate(inv.dueAt)}` : ''}</p></div>
              {!paid && (d.online ? <div className="text-right"><button onClick={checkout} disabled={!!busy} className="btn-gold disabled:opacity-60" data-testid="pay-invoice"><CreditCard size={16} aria-hidden="true" /> {busy === 'pay' ? 'Opening secure checkout…' : busy === 'verify' ? 'Confirming…' : `Pay ${usd(inv.balance)} by card`}</button><p className="mt-2 inline-flex items-center gap-1 text-xs text-text-muted"><Lock size={11} aria-hidden="true" /> Card, Apple Pay, Google Pay · processed by Stripe{d.mode === 'test' ? ' (test mode)' : ''}</p></div> : <p className="max-w-xs text-sm text-text-muted">Online payment isn’t switched on yet — pay by bank transfer or mobile money and the shipper will mark it received.</p>)}
              {paid && d.payment?.receiptDocumentId && <Link to={`/dashboard/documents/${d.payment.receiptDocumentId}`} className="btn-ghost !min-h-9 !px-3 text-sm">Receipt</Link>}
            </div>
          </motion.div>
          <motion.article variants={fadeUp} className="sheet rounded-lg bg-white p-8 text-[#1a1f2e] shadow-2xl md:p-12" aria-label={`Invoice ${inv.number}`}>
            <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
              <div className="flex items-center gap-3"><Avatar initials={inv.shipper.initials} hue={inv.shipper.hue} size={44} /><div><p className="text-lg font-bold">{inv.shipper.name}</p><p className="text-sm text-slate-600">{inv.shipper.hq}</p><p className="text-xs text-slate-500">via Ntemtem</p></div></div>
              <div className="text-right"><p className="font-heading text-3xl font-bold tracking-tight">INVOICE</p><p className="mt-1 font-mono text-sm">{inv.number}</p><p className="mt-2 text-sm text-slate-600">Issued {fmtDate(inv.issuedAt)}</p>{inv.dueAt && <p className="text-sm text-slate-600">Due {fmtDate(inv.dueAt)}</p>}<p className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${paid ? 'bg-emerald-100 text-emerald-800' : inv.overdue ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{paid ? 'Paid' : inv.overdue ? 'Overdue' : 'Due'}</p></div>
            </header>
            <section className="mt-6 grid gap-6 sm:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bill to</p><p className="mt-1 font-semibold">{inv.clientName}</p>{inv.clientEmail && <p className="text-sm text-slate-600">{inv.clientEmail}</p>}</div>
              {inv.shipmentRef && <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Shipment</p><p className="mt-1 font-mono text-sm">{inv.shipmentRef}</p><Link to={`/track?ref=${inv.shipmentRef}`} className="text-sm text-amber-700 hover:underline">Track it</Link></div>}
            </section>
            <table className="mt-8 w-full text-sm">
              <thead><tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wider text-slate-500"><th className="pb-2 font-semibold">Description</th><th className="pb-2 text-right font-semibold">Qty</th><th className="pb-2 text-right font-semibold">Unit</th><th className="pb-2 text-right font-semibold">Amount</th></tr></thead>
              <tbody>{inv.items.map((it, i) => <tr key={i} className="border-b border-slate-100"><td className="py-2.5">{it.description}</td><td className="py-2.5 text-right tabular-nums">{it.qty}</td><td className="py-2.5 text-right tabular-nums">{usd(it.unit)}</td><td className="py-2.5 text-right tabular-nums">{usd(it.qty * it.unit)}</td></tr>)}</tbody>
            </table>
            <div className="mt-4 flex justify-end"><dl className="w-64 text-sm">
              <div className="flex justify-between py-1"><dt className="text-slate-600">Subtotal</dt><dd className="tabular-nums">{usd(inv.subtotal)}</dd></div>
              {inv.tax > 0 && <div className="flex justify-between py-1"><dt className="text-slate-600">Tax / fees</dt><dd className="tabular-nums">{usd(inv.tax)}</dd></div>}
              <div className="flex justify-between border-t border-slate-300 py-2 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{usd(inv.total)}</dd></div>
              {inv.paid > 0 && <div className="flex justify-between py-1 text-emerald-700"><dt>Paid</dt><dd className="tabular-nums">−{usd(inv.paid)}</dd></div>}
              {!paid && <div className="flex justify-between py-1 font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{usd(inv.balance)}</dd></div>}
            </dl></div>
            {inv.notes && <p className="mt-6 whitespace-pre-line text-sm text-slate-600">{inv.notes}</p>}
            {inv.payments.length > 0 && <div className="mt-6 text-xs text-slate-600"><p className="font-semibold uppercase tracking-wider text-slate-500">Payments</p><ul className="mt-1">{inv.payments.map((p) => <li key={p.id}>{fmtDate(p.at)} · {usd(p.amount)} · {p.method === 'ship_sync' ? 'paid online via Ntemtem' : p.method}{p.note ? ` — ${p.note}` : ''}</li>)}</ul></div>}
          </motion.article>
          <motion.div variants={fadeUp} className="no-print mt-4 flex justify-end"><button onClick={() => window.print()} className="btn-ghost !min-h-9 !px-3 text-sm"><Printer size={14} aria-hidden="true" /> Print / save as PDF</button></motion.div>
        </motion.div>
      </div>
    </div>
  )
}
