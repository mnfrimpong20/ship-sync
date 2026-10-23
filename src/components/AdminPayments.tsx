import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, Check, Lock, Save, Wallet } from 'lucide-react'
import { methodLabels, paymentStatusLabels, paymentsApi, usd, type Payment, type PaymentSettings, type Payout } from '../lib/payments'
import { Confirm, StatCard, Th, thead, trow } from './board'

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

/** Admin: take-rate and release rule, Stripe status, every escrow payment, payouts to send. */
export function AdminPayments() {
  const [d, setD] = useState<Awaited<ReturnType<typeof paymentsApi.admin>> | null>(null)
  const [st, setSt] = useState<PaymentSettings | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<Payout | null>(null)
  const [ref, setRef] = useState('')
  const [rejecting, setRejecting] = useState<Payout | null>(null)
  const [note, setNote] = useState('')
  // Money never moves on one click: Release and Refund open a confirmation that says exactly what happens.
  const [ask, setAsk] = useState<{ kind: 'release' | 'refund'; p: Payment } | null>(null); const [why, setWhy] = useState('')
  const load = () => paymentsApi.admin().then((r) => { setD(r); setSt(r.settings) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  if (!d || !st) return <section className="mt-12"><h2 className="!text-xl">Payments</h2><p className="mt-2 text-sm text-text-muted">{error || 'Loading…'}</p></section>
  const act = async (fn: () => Promise<unknown>, m: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setMsg(m) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setPaying(null); setRejecting(null) } }
  const pending = d.payouts.filter((o) => o.status === 'requested')
  const releaseLabel = (p: Payment) => (p.releaseReason?.startsWith('status:') ? 'auto' : p.releaseReason?.startsWith('manual:') ? p.releaseReason.slice(7) : '')
  return (
    <section className="mt-6" data-testid="admin-payments">
      {ask && (ask.kind === 'release'
        ? <Confirm danger={false} title={`Release ${usd(ask.p.amountUsd)} to ${ask.p.shipperName}?`} confirmLabel={`Release ${usd(ask.p.amountUsd - (ask.p.feeUsd ?? 0))}`} busy={busy === ask.p.id} onClose={() => setAsk(null)}
            onConfirm={() => { const x = ask.p; setAsk(null); void act(() => paymentsApi.release(x.id), `${usd(x.amountUsd - (x.feeUsd ?? 0))} released to ${x.shipperName}.`, x.id) }}
            body={<div className="space-y-2" data-testid="confirm-release"><p>{ask.p.shipmentRef} · paid by {ask.p.customer}.</p><p><b className="text-text">{usd(ask.p.amountUsd - (ask.p.feeUsd ?? 0))}</b> goes into {ask.p.shipperName}’s balance ({usd(ask.p.amountUsd)} less the {usd(ask.p.feeUsd ?? 0)} platform fee). They can request a payout straight away.</p><p>Release early only if the goods are really on their way — the customer loses the hold.</p></div>} />
        : <Confirm title={`Refund ${usd(ask.p.amountUsd)} to ${ask.p.customer}?`} confirmLabel="Refund to their card" busy={busy === ask.p.id} disabled={why.trim().length < 5} onClose={() => setAsk(null)}
            onConfirm={() => { if (why.trim().length < 5) return; const x = ask.p; setAsk(null); void act(() => paymentsApi.refund(x.id, why.trim()), `Refunded ${usd(x.amountUsd)} to ${x.customer}.`, x.id) }}
            body={<div className="space-y-2" data-testid="confirm-refund"><p>{ask.p.shipmentRef} · {ask.p.shipperName}. The full {usd(ask.p.amountUsd)} goes back to the customer’s card; the shipper gets nothing for it.</p><label className="block text-sm font-semibold text-text" htmlFor="refund-why">Reason — the customer and shipper see it</label><textarea id="refund-why" rows={3} className="input-dark py-2 text-sm" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Shipment cancelled before pickup" />{why.trim().length < 5 && <p className="text-xs">Write a short reason to continue.</p>}</div>} />)}
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Volume" value={usd(d.totals.volume)} hint={`Platform fees ${usd(d.totals.fees)}`} icon={Wallet} />
        <StatCard label="In escrow" value={usd(d.totals.held)} hint="Awaiting release" icon={Lock} />
        <StatCard label="Owed to shippers" value={usd(d.totals.owed)} hint="Released, not yet requested" icon={Banknote} />
        <StatCard label="Payouts to send" value={pending.length} hint={pending.length ? usd(d.totals.pendingPayouts) : 'Nothing waiting'} icon={Banknote} warn={pending.length > 0} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {d.payments.some((p) => p.cardDispute) && (
            <div className="card-dark border-danger/40 p-5" data-testid="admin-card-disputes">
              <h3 className="!text-base">Card chargebacks</h3>
              <p className="mt-1 text-xs text-text-muted">The customer’s bank is reversing these payments. The money is held — answer each one with evidence in the Stripe dashboard before the deadline.</p>
              <ul className="mt-3 divide-y divide-border/70 text-sm">{d.payments.filter((p) => p.cardDispute).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="card-dispute-row">
                  <span className="min-w-0"><b>{p.shipmentRef ?? p.id}</b> · {p.customer} → {p.shipperName}<span className="block text-xs text-text-muted">{usd(p.cardDispute!.amountUsd)} · {p.cardDispute!.reason || 'no reason given'} · {p.cardDispute!.status.replace(/_/g, ' ')}{p.cardDispute!.evidenceDueBy ? ` · evidence due ${new Date(p.cardDispute!.evidenceDueBy).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span></span>
                  <a href={`https://dashboard.stripe.com/${d.stripe.mode === 'test' ? 'test/' : ''}disputes/${p.cardDispute!.id}`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-8 !px-3 text-xs">Open in Stripe</a>
                </li>
              ))}</ul>
            </div>
          )}
          {pending.length > 0 && (
            <div className="card-dark p-5" data-testid="admin-payouts">
              <h3 className="!text-base">Payouts to send</h3>
              <ul className="mt-3 divide-y divide-border/70 text-sm">
                {pending.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="admin-payout-row">
                    <div className="min-w-0"><p className="font-semibold">{o.shipperName} · <span className="tabular-nums">{usd(o.amountUsd)}</span></p><p className="text-xs text-text-muted">{o.method === 'mobile_money' ? `Mobile money ${o.details.mobileMoney}` : `${o.details.bankName}${o.details.country ? ` (${o.details.country})` : ''} · ${o.details.accountName} · ${o.details.accountNumber}${o.details.routing ? ` · ${o.details.routing}` : ''}`} · requested {fmt(o.requestedAt)} by {o.requestedBy} · {o.payments} payment{o.payments === 1 ? '' : 's'}</p></div>
                    <div className="flex gap-2"><button onClick={() => { setPaying(o); setRef('') }} className="btn-gold !min-h-8 !px-3 text-xs"><Check size={12} aria-hidden="true" /> Mark sent</button><button onClick={() => { setRejecting(o); setNote('') }} className="btn-ghost !min-h-8 !px-3 text-xs text-danger">Reject</button></div>
                    {paying?.id === o.id && <form onSubmit={(e) => { e.preventDefault(); void act(() => paymentsApi.payoutPaid(o.id, { reference: ref, note: '' }), 'Payout marked sent; the shipper has been told.', 'paid') }} className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2/40 p-3"><label className="flex-1 text-xs text-text-muted">Transfer reference<input autoFocus className="input-dark mt-1 !min-h-9 text-sm" placeholder="ACH / wire / MoMo reference" value={ref} onChange={(e) => setRef(e.target.value)} /></label><button type="button" onClick={() => setPaying(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy === 'paid'} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{busy === 'paid' ? 'Saving…' : 'Confirm sent'}</button></form>}
                    {rejecting?.id === o.id && <form onSubmit={(e) => { e.preventDefault(); void act(() => paymentsApi.payoutReject(o.id, note), 'Payout rejected; funds are back in the shipper’s available balance.', 'rej') }} className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2/40 p-3"><label className="flex-1 text-xs text-text-muted">Tell the shipper why<input autoFocus required minLength={3} className="input-dark mt-1 !min-h-9 text-sm" placeholder="e.g. account number doesn’t match the holder name" value={note} onChange={(e) => setNote(e.target.value)} /></label><button type="button" onClick={() => setRejecting(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy === 'rej'} className="inline-flex min-h-9 items-center rounded-lg bg-danger px-3 text-xs font-semibold text-white disabled:opacity-60">{busy === 'rej' ? 'Saving…' : 'Reject'}</button></form>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card-dark overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className={thead}><Th>Paid</Th><Th>Shipment</Th><Th>Shipper</Th><Th className="text-right">Amount</Th><Th className="text-right">Fee</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {d.payments.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-text-muted">No payments yet.</td></tr>}
                  {d.payments.slice(0, 40).map((p) => (
                    <tr key={p.id} className={trow(false, p.status === 'refunded')} data-testid="admin-payment-row">
                      <td className="whitespace-nowrap px-3 py-3 text-xs">{fmt(p.paidAt)}<p className="text-text-muted">{p.provider === 'manual' ? 'direct' : methodLabels[p.method ?? 'card'] ?? p.method}</p></td>
                      <td className="px-3 py-3"><span className="font-mono text-xs">{p.shipmentRef}</span><p className="text-xs text-text-muted">{p.customer}</p></td>
                      <td className="px-3 py-3 text-xs">{p.shipperName}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(p.amountUsd)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-muted">{p.feeUsd ? usd(p.feeUsd) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">{paymentStatusLabels[p.status]}{p.releasedAt && <span className="text-text-muted"> · {fmt(p.releasedAt)} {releaseLabel(p)}</span>}{p.refundReason && <p className="max-w-[200px] truncate text-text-muted" title={p.refundReason}>{p.refundReason}</p>}</td>
                      <td className="px-3 py-3 text-right">{p.status === 'held' && <div className="inline-flex gap-1.5"><button onClick={() => setAsk({ kind: 'release', p })} disabled={busy === p.id} className="btn-ghost !min-h-8 !px-2.5 text-xs disabled:opacity-60">Release</button>{p.provider === 'stripe' && <button onClick={() => { setWhy(''); setAsk({ kind: 'refund', p }) }} disabled={busy === p.id} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger disabled:opacity-60">Refund</button>}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="min-w-0 card-dark p-5 self-start" data-testid="payment-settings">
          <div className="flex items-center justify-between gap-2"><h3 className="!text-base">Settings</h3><button onClick={() => act(() => paymentsApi.saveSettings(st), 'Settings saved.', 'save')} disabled={busy === 'save'} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60"><Save size={13} aria-hidden="true" /> {busy === 'save' ? 'Saving…' : 'Save'}</button></div>
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${d.stripe.mode === 'off' ? 'border-gold/40 bg-gold/10 text-gold-deep' : 'border-teal/40 bg-teal/10 text-teal'}`} data-testid="stripe-status">
            Stripe: {d.stripe.mode === 'off' ? 'not configured — add STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET) as secrets to switch on card payments.' : `${d.stripe.mode} mode${d.stripe.webhook ? ', webhook verified' : ' — no webhook secret; payments confirm when the customer returns to the site'}.`}
          </div>
          <label className="mt-4 flex items-center justify-between gap-3 text-sm"><span>Online payments on</span><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={st.enabled} onChange={(e) => setSt({ ...st, enabled: e.target.checked })} /></label>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Take-rate</span><span className="inline-flex items-center gap-1"><input type="number" min={0} max={50} step={0.5} className="input-dark !min-h-8 !w-20 text-sm tabular-nums" value={Math.round(st.takeRatePct * 1000) / 10} onChange={(e) => setSt({ ...st, takeRatePct: Math.max(0, Math.min(50, Number(e.target.value) || 0)) / 100 })} /> %</span></label>
          <label className="mt-3 block text-sm">Release funds when the shipment is<select className="input-dark mt-1 !min-h-9 w-full text-sm" value={st.releaseOn} onChange={(e) => setSt({ ...st, releaseOn: e.target.value as PaymentSettings['releaseOn'] })}><option value="in_transit">In transit (sailed / flown)</option><option value="delivered">Delivered</option></select></label>
          <label className="mt-3 block text-xs text-text-muted">Note shown to customers<textarea rows={3} className="input-dark mt-1 w-full py-2 text-sm" value={st.customerNote} onChange={(e) => setSt({ ...st, customerNote: e.target.value })} /></label>
          <label className="mt-3 block text-xs text-text-muted">Note shown to shippers<textarea rows={3} className="input-dark mt-1 w-full py-2 text-sm" value={st.payoutNote} onChange={(e) => setSt({ ...st, payoutNote: e.target.value })} /></label>
          <p className="mt-4 text-xs text-text-muted">Receivers pay destination charges by mobile money through Paystack — see Receiver mobile money below. <Link to="/dashboard/payments" className="text-gold-deep hover:underline">Shipper view →</Link></p>
        </div>
      </div>
    </section>
  )
}
