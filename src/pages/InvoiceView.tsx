import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useStore } from '../lib/store'
import { clientsApi, paymentMethods } from '../lib/clients'
import { countryByCode } from '../lib/data'
import { Logo, fmtDate, money } from '../components/ui'

type Data = Awaited<ReturnType<typeof clientsApi.invoice>>

/** Printable invoice — white paper look, so it prints cleanly and can be saved as PDF from the browser. */
export default function InvoiceView() {
  const { id = '' } = useParams()
  const { ready, user } = useStore()
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (ready && user?.role === 'shipper') clientsApi.invoice(id).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.')) }, [ready, user, id])
  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  if (!user) return <Navigate to={`/login?role=shipper&next=/dashboard/invoices/${id}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (error) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-danger">{error}</div></div>
  if (!d) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading invoice…</div></div>
  const { invoice: inv, client: c, shipper, shipment } = d
  const dest = shipment ? countryByCode(shipment.destination) : null
  return (
    <div className="bg-bg text-text">
      <style>{`@media print { header, footer, .no-print { display: none !important } body { background: #fff } .sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important } }`}</style>
      <div className="container-x py-8">
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to={`/dashboard/clients/${c.id}?tab=invoices`} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-gold focus-ring rounded"><ArrowLeft size={14} aria-hidden="true" /> {c.name}</Link>
          <button onClick={() => window.print()} className="btn-gold !min-h-10 !px-4 text-sm"><Printer size={15} aria-hidden="true" /> Print / save as PDF</button>
        </div>
        <article className="sheet mx-auto max-w-3xl rounded-lg bg-white p-8 text-[#1a1f2e] shadow-2xl md:p-12" aria-label={`Invoice ${inv.number}`}>
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
            <div>
              <Logo light={false} />
              <p className="mt-3 text-lg font-bold">{shipper.name}</p>
              <p className="text-sm text-slate-600">{shipper.hq}</p>
              <p className="text-xs text-slate-500">via Ship Sync — shipsync.africa</p>
            </div>
            <div className="text-right">
              <p className="font-heading text-3xl font-bold tracking-tight">INVOICE</p>
              <p className="mt-1 font-mono text-sm">{inv.number}</p>
              <p className="mt-2 text-sm text-slate-600">Issued {fmtDate(inv.issuedAt)}</p>
              {inv.dueAt && <p className="text-sm text-slate-600">Due {fmtDate(inv.dueAt)}</p>}
              <p className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${inv.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : inv.status === 'void' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>{inv.status === 'sent' ? (inv.balance ? 'Due' : 'Paid') : inv.status}</p>
            </div>
          </header>
          <section className="mt-6 grid gap-6 sm:grid-cols-2">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bill to</p><p className="mt-1 font-semibold">{c.name}</p>{c.company && <p className="text-sm">{c.company}</p>}{c.city && <p className="text-sm text-slate-600">{c.city}</p>}{c.email && <p className="text-sm text-slate-600">{c.email}</p>}{c.phone && <p className="text-sm text-slate-600">{c.phone}</p>}</div>
            {shipment && <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Shipment</p><p className="mt-1 font-mono text-sm">{shipment.ref}</p><p className="text-sm">{shipment.origin} → {dest?.name}</p><p className="text-sm text-slate-600">{shipment.description}</p><p className="text-sm text-slate-600">{shipment.mode === 'air' ? 'Air freight' : 'Ocean freight'} · ETA {fmtDate(shipment.eta)}</p></div>}
          </section>
          <table className="mt-8 w-full text-sm">
            <thead><tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wider text-slate-500"><th className="pb-2 font-semibold">Description</th><th className="pb-2 text-right font-semibold">Qty</th><th className="pb-2 text-right font-semibold">Unit</th><th className="pb-2 text-right font-semibold">Amount</th></tr></thead>
            <tbody>{inv.items.map((it, i) => <tr key={i} className="border-b border-slate-100"><td className="py-2.5">{it.description}</td><td className="py-2.5 text-right tabular-nums">{it.qty}</td><td className="py-2.5 text-right tabular-nums">{money(it.unit)}</td><td className="py-2.5 text-right tabular-nums">{money(Math.round(it.qty * it.unit))}</td></tr>)}</tbody>
          </table>
          <div className="mt-4 flex justify-end"><dl className="w-64 text-sm">
            <div className="flex justify-between py-1"><dt className="text-slate-600">Subtotal</dt><dd className="tabular-nums">{money(inv.subtotal)}</dd></div>
            {inv.tax > 0 && <div className="flex justify-between py-1"><dt className="text-slate-600">Tax / fees</dt><dd className="tabular-nums">{money(inv.tax)}</dd></div>}
            <div className="flex justify-between border-t border-slate-300 py-2 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{money(inv.total)}</dd></div>
            {inv.paid > 0 && <div className="flex justify-between py-1"><dt className="text-slate-600">Paid</dt><dd className="tabular-nums">−{money(inv.paid)}</dd></div>}
            {inv.status !== 'void' && <div className="flex justify-between border-t border-slate-300 py-2 font-bold"><dt>Balance due</dt><dd className="tabular-nums">{money(inv.balance)}</dd></div>}
          </dl></div>
          {inv.payments.length > 0 && <p className="mt-4 text-xs text-slate-500">Payments: {inv.payments.map((p) => `${money(p.amount)} by ${paymentMethods.find(([k]) => k === p.method)?.[1] ?? p.method} on ${fmtDate(p.at)}`).join('; ')}.</p>}
          {inv.notes && <p className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{inv.notes}</p>}
          <p className="mt-8 text-center text-xs text-slate-400">Thank you for shipping with {shipper.name}.</p>
        </article>
      </div>
    </div>
  )
}
