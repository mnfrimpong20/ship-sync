import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, FileText, Shield, ShieldCheck, X } from 'lucide-react'
import { insuranceApi, policyStatusLabels, type InsuranceProductPublic, type Policy } from '../lib/insurance'
import { money } from './ui'
import { Confirm } from './board'

const tone: Record<Policy['status'], string> = { active: 'bg-teal/15 text-teal', cancelled: 'bg-surface-2 text-text-muted', claim_open: 'bg-gold/15 text-gold-deep', claim_paid: 'bg-teal/15 text-teal', claim_declined: 'bg-danger/15 text-danger' }

/** Insure a shipment, see the cover, file a claim. The office marks the premium collected. */
export function InsuranceCard({ shipmentId, cargo }: { shipmentId: string; cargo: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof insuranceApi.forShipment>> | null>(null)
  const [value, setValue] = useState('')
  const [agree, setAgree] = useState(false)
  const [q, setQ] = useState<{ premiumUsd: number; deductibleUsd: number; capped: boolean; valueUsd: number } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [cl, setCl] = useState({ description: '', amountUsd: '', contact: '' })
  const [cancelling, setCancelling] = useState(false)
  const [terms, setTerms] = useState(false)
  const load = () => insuranceApi.forShipment(shipmentId).then((r) => { setD(r); if (!value && r.suggestedValueUsd) setValue(String(r.suggestedValueUsd)) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => {
    const v = Number(value); if (!d?.canBuy || !(v > 0)) { setQ(null); return }
    let live = true; const t = setTimeout(() => insuranceApi.quote(cargo as never, v).then((r) => live && setQ(r.quote)).catch(() => {}), 250)
    return () => { live = false; clearTimeout(t) }
  }, [value, cargo, d?.canBuy])
  if (!d) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">{error || 'Loading insurance…'}</div>
  if (!d.policy && !d.product) return null
  const p = d.policy; const prod: InsuranceProductPublic | null = d.product
  const act = async (fn: () => Promise<unknown>, msg: string, key = 'x') => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setClaiming(false); setCancelling(false) } }
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="insurance-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Shield size={14} className="text-gold" aria-hidden="true" /> Insurance</p>
        {p && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[p.status]}`}>{policyStatusLabels[p.status]}</span>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {p ? (
        <div className="mt-3 text-sm" data-testid="policy">
          <p className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /><span><strong>{money(p.declaredValueUsd)} all-risk cover</strong> · premium {money(p.premiumUsd)}{d.canManage ? <span className={p.paymentStatus === 'collected' ? ' text-teal' : ' text-gold-deep'}> · {p.paymentStatus === 'collected' ? 'collected' : 'to collect'}</span> : ''}<span className="block text-xs text-text-muted">{p.certificateNo} · {p.provider} · deductible {money(p.deductibleUsd)}</span></span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.documentId && <Link to={`/dashboard/documents/${p.documentId}`} className="btn-ghost !min-h-8 !px-2.5 text-xs"><FileText size={12} aria-hidden="true" /> Certificate</Link>}
            {d.canManage && p.paymentStatus === 'due' && p.status !== 'cancelled' && <button onClick={() => act(() => insuranceApi.collected(p.id), 'Premium marked collected.', 'col')} disabled={busy === 'col'} className="btn-gold !min-h-8 !px-2.5 text-xs disabled:opacity-60"><Check size={12} aria-hidden="true" /> Premium collected</button>}
            {p.status === 'active' && <button onClick={() => { setClaiming((c) => !c); setCl({ description: '', amountUsd: String(Math.round(p.declaredValueUsd)), contact: '' }) }} className="btn-ghost !min-h-8 !px-2.5 text-xs"><AlertTriangle size={12} aria-hidden="true" /> File a claim</button>}
            {p.status === 'active' && d.canBuy === false && !d.canManage && null}
            {p.status === 'active' && <button onClick={() => setCancelling(true)} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger"><X size={12} aria-hidden="true" /> Cancel cover</button>}
          </div>
          {claiming && (
            <form onSubmit={(e) => { e.preventDefault(); void act(() => insuranceApi.claim(p.id, { description: cl.description, amountUsd: Number(cl.amountUsd) || 0, contact: cl.contact }), 'Claim filed — the shipper and the claims team have been notified.', 'claim') }} className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3" aria-label="File a claim" data-testid="claim-form">
              <textarea required minLength={10} rows={3} aria-label="What happened" className="input-dark py-2 text-sm" placeholder="What happened? Which pieces, what damage or loss…" value={cl.description} onChange={(e) => setCl({ ...cl, description: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-2"><input type="number" min={1} required aria-label="Amount claimed (USD)" className="input-dark !min-h-9 text-sm tabular-nums" placeholder="Amount claimed (USD)" value={cl.amountUsd} onChange={(e) => setCl({ ...cl, amountUsd: e.target.value })} /><input aria-label="Contact" className="input-dark !min-h-9 text-sm" placeholder="Best phone / WhatsApp" value={cl.contact} onChange={(e) => setCl({ ...cl, contact: e.target.value })} /></div>
              <p className="text-[11px] text-text-muted">Upload photos of the damage to this shipment’s documents. Claims within 14 days of delivery; settlement up to the declared value less the {money(p.deductibleUsd)} deductible.</p>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setClaiming(false)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button disabled={busy === 'claim'} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60">{busy === 'claim' ? 'Filing…' : 'Submit claim'}</button></div>
            </form>
          )}
          {p.claim && (
            <div className={`mt-3 rounded-lg border p-3 text-xs ${p.status === 'claim_open' ? 'border-gold/40 bg-gold/10' : p.status === 'claim_paid' ? 'border-teal/40 bg-teal/10' : 'border-danger/40 bg-danger/10'}`} data-testid="claim-status">
              <p className="font-semibold">{p.status === 'claim_open' ? `Claim under review — ${money(p.claim.amountUsd)}` : p.status === 'claim_paid' ? `Settled: ${money(p.claim.settledUsd ?? 0)}` : 'Claim declined'}</p>
              <p className="mt-1 text-text-muted">“{p.claim.description}” — {p.claim.filedBy}</p>
              {p.claim.note && <p className="mt-1">{p.claim.note}</p>}
            </div>
          )}
        </div>
      ) : d.canBuy && prod ? (
        <div className="mt-3">
          <p className="text-sm text-text-muted">{prod.coverage} cover on the declared value — {(prod.rate * 100).toFixed(1)}% premium, minimum {money(prod.minPremiumUsd)}, up to {money(prod.maxValueUsd)} insured.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-xs text-text-muted">Declared value (USD)<input type="number" min={1} aria-label="Declared value (USD)" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" placeholder="What the goods are worth" value={value} onChange={(e) => setValue(e.target.value)} /></label>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm" data-testid="premium-quote">{q ? <><span className="text-xs text-text-muted">Premium</span><br /><strong className="tabular-nums">{money(q.premiumUsd)}</strong>{q.capped ? <span className="block text-[11px] text-danger">Cover capped at {money(prod.maxValueUsd)}</span> : null}</> : <span className="text-xs text-text-muted">Enter a value</span>}</div>
          </div>
          <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I’ve declared the true value and accept the <button type="button" onClick={() => setTerms((t) => !t)} className="text-gold hover:underline">cover terms</button>. The premium is collected by the shipper with the freight charge.</span></label>
          {terms && <p className="mt-2 rounded-lg border border-border bg-surface-2/40 p-3 text-[11px] leading-relaxed text-text-muted">{prod.terms}</p>}
          <div className="mt-3 flex justify-end"><button onClick={() => act(() => insuranceApi.buy(shipmentId, Number(value)), 'Cover added — your certificate is in the documents.', 'buy')} disabled={!q || !agree || busy === 'buy'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60"><ShieldCheck size={14} aria-hidden="true" /> {busy === 'buy' ? 'Adding…' : `Add cover${q ? ` for ${money(q.premiumUsd)}` : ''}`}</button></div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-muted">Not insured. Cover can only be added before the goods leave the origin.</p>
      )}
      {cancelling && p && <Confirm title="Cancel this cover?" body={<p>{p.certificateNo} will be voided and the certificate removed. {p.paymentStatus === 'collected' ? 'The premium already collected should be refunded by the shipper.' : 'No premium is due.'}</p>} confirmLabel="Cancel cover" busy={busy === 'cancel'} onClose={() => setCancelling(false)} onConfirm={() => act(() => insuranceApi.cancel(p.id), 'Cover cancelled.', 'cancel')} />}
    </div>
  )
}
