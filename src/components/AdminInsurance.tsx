import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Save, Shield } from 'lucide-react'
import { insuranceApi, policyStatusLabels, type InsuranceProduct, type Policy } from '../lib/insurance'
import { cargoTypes, type CargoType } from '../lib/data'
import { money } from './ui'
import { StatCard, Th, thead, trow } from './board'

/** Admin: the insurance product and every policy / claim on the platform. */
export function AdminInsurance() {
  const [d, setD] = useState<Awaited<ReturnType<typeof insuranceApi.admin>> | null>(null)
  const [prod, setProd] = useState<InsuranceProduct | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [resolving, setResolving] = useState<Policy | null>(null)
  const [rs, setRs] = useState({ outcome: 'paid' as 'paid' | 'declined', amountUsd: '', note: '' })
  const load = () => insuranceApi.admin().then((r) => { setD(r); setProd(r.product) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  if (!d || !prod) return <section className="mt-12"><h2 className="!text-xl">Insurance</h2><p className="mt-2 text-sm text-text-muted">{error || 'Loading…'}</p></section>
  const save = async () => { setBusy('save'); setError(''); try { setProd(await insuranceApi.saveProduct(prod)); setMsg('Product saved.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy('') } }
  const resolve = async () => { if (!resolving) return; setBusy('res'); setError(''); try { await insuranceApi.resolve(resolving.id, { outcome: rs.outcome, amountUsd: rs.outcome === 'paid' ? Number(rs.amountUsd) || 0 : undefined, note: rs.note }); await load(); setMsg('Claim resolved and both sides notified.'); setResolving(null) } catch (e) { setError(e instanceof Error ? e.message : 'Could not resolve.') } finally { setBusy('') } }
  const open = d.policies.filter((p) => p.status === 'claim_open')
  return (
    <section className="mt-6" data-testid="admin-insurance">
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Insured value" value={money(d.totals.insured)} hint="Across live policies" icon={Shield} />
        <StatCard label="Premiums" value={money(d.totals.premiums)} hint="Written to date" icon={Shield} />
        <StatCard label="Ntemtem commission" value={money(d.totals.commission)} hint={`${Math.round(prod.commissionPct * 100)}% of premium`} icon={Shield} />
        <StatCard label="Claims" value={d.totals.claims} hint={open.length ? `${open.length} open` : 'None open'} icon={Shield} warn={open.length > 0} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 card-dark overflow-hidden">
          <div className="overflow-x-auto focus-ring" tabIndex={0} role="region" aria-label="Insurance policies (scrolls sideways)">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className={thead}><Th>Certificate</Th><Th>Shipment</Th><Th>Shipper</Th><Th className="text-right">Insured</Th><Th className="text-right">Premium</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {d.policies.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-text-muted">No policies yet.</td></tr>}
                {d.policies.map((p) => (
                  <tr key={p.id} className={trow(false, p.status === 'cancelled')} data-testid="policy-row">
                    <td className="px-3 py-3 font-mono text-xs">{p.certificateNo}</td>
                    <td className="px-3 py-3"><span className="font-mono text-xs text-gold-deep">{p.shipmentRef}</span><p className="text-xs text-text-muted">{p.customer}</p></td>
                    <td className="px-3 py-3 text-xs">{p.shipperName}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(p.declaredValueUsd)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(p.premiumUsd)}<p className={`text-xs ${p.paymentStatus === 'collected' ? 'text-teal' : 'text-text-muted'}`}>{p.paymentStatus}</p></td>
                    <td className="px-3 py-3 text-xs">{policyStatusLabels[p.status]}{p.claim && <p className="max-w-[220px] truncate text-xs text-text-muted" title={p.claim.description}>{money(p.claim.amountUsd)} — {p.claim.description}</p>}</td>
                    <td className="px-3 py-3 text-right">{p.status === 'claim_open' && <button onClick={() => { setResolving(p); setRs({ outcome: 'paid', amountUsd: String(Math.round(Math.max(0, (p.claim?.amountUsd ?? 0) - p.deductibleUsd))), note: '' }) }} className="btn-gold !min-h-8 !px-2.5 text-xs">Resolve</button>}{p.documentId && <Link to={`/dashboard/documents/${p.documentId}`} className="btn-ghost ml-1 !min-h-8 !px-2.5 text-xs">Cert</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="card-dark p-5" data-testid="insurance-product">
          <div className="flex items-center justify-between"><h3 className="!text-base">Product</h3><button onClick={save} disabled={busy === 'save'} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60"><Save size={12} aria-hidden="true" /> Save</button></div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={prod.enabled} onChange={(e) => setProd({ ...prod, enabled: e.target.checked })} /> Offer insurance at checkout</label>
          <label className="mt-3 block text-xs text-text-muted">Provider / underwriter<input className="input-dark mt-1 !min-h-9 text-sm" value={prod.provider} onChange={(e) => setProd({ ...prod, provider: e.target.value })} /></label>
          <label className="mt-2 block text-xs text-text-muted">Coverage<input className="input-dark mt-1 !min-h-9 text-sm" value={prod.coverage} onChange={(e) => setProd({ ...prod, coverage: e.target.value })} /></label>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Premium % by cargo</p>
          <div className="mt-1 grid grid-cols-2 gap-1.5">{cargoTypes.map((c) => <label key={c.id} className="text-xs text-text-muted">{c.label}<input type="number" step="0.1" min={0} max={50} aria-label={`${c.label} rate`} className="input-dark mt-0.5 !min-h-8 text-sm tabular-nums" value={Math.round(prod.rates[c.id as CargoType] * 1000) / 10} onChange={(e) => setProd({ ...prod, rates: { ...prod.rates, [c.id]: (Number(e.target.value) || 0) / 100 } })} /></label>)}</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-text-muted">
            <label>Min premium ($)<input type="number" min={0} aria-label="Minimum premium" className="input-dark mt-0.5 !min-h-8 text-sm tabular-nums" value={prod.minPremiumUsd} onChange={(e) => setProd({ ...prod, minPremiumUsd: Number(e.target.value) || 0 })} /></label>
            <label>Max insured ($)<input type="number" min={100} aria-label="Maximum insured value" className="input-dark mt-0.5 !min-h-8 text-sm tabular-nums" value={prod.maxValueUsd} onChange={(e) => setProd({ ...prod, maxValueUsd: Number(e.target.value) || 100 })} /></label>
            <label>Deductible %<input type="number" min={0} max={50} step="0.5" aria-label="Deductible percent" className="input-dark mt-0.5 !min-h-8 text-sm tabular-nums" value={Math.round(prod.deductiblePct * 1000) / 10} onChange={(e) => setProd({ ...prod, deductiblePct: (Number(e.target.value) || 0) / 100 })} /></label>
            <label>Commission %<input type="number" min={0} max={100} aria-label="Commission percent" className="input-dark mt-0.5 !min-h-8 text-sm tabular-nums" value={Math.round(prod.commissionPct * 100)} onChange={(e) => setProd({ ...prod, commissionPct: (Number(e.target.value) || 0) / 100 })} /></label>
          </div>
          <label className="mt-2 block text-xs text-text-muted">Terms shown to the customer<textarea rows={5} className="input-dark mt-1 py-2 text-xs" value={prod.terms} onChange={(e) => setProd({ ...prod, terms: e.target.value })} /></label>
        </aside>
      </div>
      {resolving && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setResolving(null)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="res-h" className="card-dark w-full max-w-lg p-6" data-testid="resolve-dialog">
            <h2 id="res-h" className="!text-lg">Resolve claim — {resolving.shipmentRef}</h2>
            <p className="mt-1 text-sm text-text-muted">{money(resolving.claim?.amountUsd ?? 0)} claimed on {money(resolving.declaredValueUsd)} cover (deductible {money(resolving.deductibleUsd)}).</p>
            <p className="mt-2 rounded-lg bg-surface-2/60 p-3 text-xs text-text-muted">“{resolving.claim?.description}” — {resolving.claim?.filedBy}{resolving.claim?.contact ? ` · ${resolving.claim.contact}` : ''}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <label className={`flex cursor-pointer items-center justify-center rounded-lg border p-2.5 ${rs.outcome === 'paid' ? 'border-teal bg-teal/10' : 'border-border'}`}><input type="radio" name="out" className="sr-only" checked={rs.outcome === 'paid'} onChange={() => setRs({ ...rs, outcome: 'paid' })} /> Settle</label>
              <label className={`flex cursor-pointer items-center justify-center rounded-lg border p-2.5 ${rs.outcome === 'declined' ? 'border-danger bg-danger/10' : 'border-border'}`}><input type="radio" name="out" className="sr-only" checked={rs.outcome === 'declined'} onChange={() => setRs({ ...rs, outcome: 'declined' })} /> Decline</label>
            </div>
            {rs.outcome === 'paid' && <input type="number" min={0} aria-label="Settlement amount" className="input-dark mt-2 !min-h-9 text-sm tabular-nums" value={rs.amountUsd} onChange={(e) => setRs({ ...rs, amountUsd: e.target.value })} />}
            <input aria-label="Note" className="input-dark mt-2 !min-h-9 text-sm" placeholder="Note to the customer and shipper" value={rs.note} onChange={(e) => setRs({ ...rs, note: e.target.value })} />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setResolving(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Back</button><button onClick={resolve} disabled={busy === 'res'} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy === 'res' ? 'Saving…' : rs.outcome === 'paid' ? 'Settle claim' : 'Decline claim'}</button></div>
          </div>
        </div>
      )}
    </section>
  )
}
