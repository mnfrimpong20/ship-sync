import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Check, CreditCard, Sparkles, Users } from 'lucide-react'
import { useStore } from '../lib/store'
import { platformApi, type Billing } from '../lib/platform'
import { fmtDate, money } from '../components/ui'
import { Panel, Stat } from '../components/Charts'

/** Plan & billing: what you’re on, what each plan unlocks, upgrade through Stripe, cancel at period end. */
export default function BillingPage() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const [b, setB] = useState<Billing | null>(null); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState('')
  const load = () => platformApi.billing().then(setB).catch((e) => setErr(e.message))
  useEffect(() => {
    if (user?.role !== 'shipper') return
    const session = sp.get('session')
    if (session) platformApi.confirm(session).then((r) => { setOk(r.active ? 'Thanks — your new plan is active.' : 'Payment is still processing. This page updates when Stripe confirms it.'); setSp({}, { replace: true }) }).catch((e) => setErr(e.message)).finally(load)
    else { if (sp.get('canceled')) setErr('Checkout was cancelled — nothing was charged.'); load() }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?next=/dashboard/billing" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const upgrade = async (plan: 'pro' | 'enterprise') => { setBusy(plan); setErr(''); try { const r = await platformApi.checkout(plan); window.location.href = r.url } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start checkout.'); setBusy('') } }
  const cur = b?.plans.find((p) => p.key === b.plan)
  const isOwner = (user.staffRole ?? 'owner') === 'owner'
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Company</p><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Plan & billing</h1>
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}{ok && <p role="status" className="mt-4 text-sm text-teal" data-testid="billing-ok">{ok}</p>}
      {b && <>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="billing-stats">
          <Stat label="Your plan" value={cur?.label ?? b.plan} icon={Sparkles} hint={b.trial ? `Free trial of Pro${b.trialEndsAt ? ` until ${fmtDate(b.trialEndsAt)}` : ''}` : b.subscription?.cancelAtPeriodEnd ? `Ends ${b.subscription.currentPeriodEnd ? fmtDate(b.subscription.currentPeriodEnd) : 'soon'}` : undefined} testid="plan-stat" />
          <Stat label="Monthly price" value={money(b.subscription?.amountUsd || b.prices[b.billed] || 0)} icon={CreditCard} hint={b.subscription?.currentPeriodEnd ? `renews ${fmtDate(b.subscription.currentPeriodEnd)}` : b.billed === 'starter' ? 'free' : 'billed by Ship Sync'} />
          <Stat label="Team members" value={`${b.usage.team}${b.usage.teamLimit ? ` / ${b.usage.teamLimit}` : ''}`} icon={Users} tone={b.usage.teamLimit != null && b.usage.team >= b.usage.teamLimit ? 'bad' : undefined} />
          <Stat label="Payment" value={b.subscription?.provider === 'stripe' ? 'Card (Stripe)' : b.billed === 'starter' ? '—' : 'Invoice'} hint={b.subscription?.status && b.subscription.status !== 'active' ? b.subscription.status : undefined} />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3" data-testid="plans">
          {b.plans.map((p) => { const mine = p.key === b.billed && !b.trial; return (
            <div key={p.key} className={`card-dark flex flex-col p-5 ${mine ? '!border-gold' : ''}`} data-testid={`plan-${p.key}`}>
              <div className="flex items-baseline justify-between"><h2 className="!text-lg">{p.label}</h2>{mine && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold-deep">Current</span>}</div>
              <p className="mt-1 font-heading text-3xl font-bold">{p.priceUsd ? money(p.priceUsd) : 'Free'}<span className="text-sm font-normal text-text-muted">{p.priceUsd ? ' / month' : ''}</span></p>
              <p className="mt-2 text-sm text-text-muted">{p.blurb}</p>
              <ul className="mt-3 flex-1 space-y-1 text-sm">{p.perks.map((k) => <li key={k} className="flex gap-1.5"><Check size={15} className="mt-0.5 text-teal" aria-hidden="true" />{k}</li>)}<li className="flex gap-1.5"><Check size={15} className="mt-0.5 text-teal" aria-hidden="true" />{p.team ? `Up to ${p.team} team members` : 'Unlimited team'}</li></ul>
              {p.key !== 'starter' && !mine && <button type="button" disabled={!!busy || !isOwner} onClick={() => upgrade(p.key as 'pro' | 'enterprise')} className="btn-gold mt-4 !min-h-10" data-testid={`upgrade-${p.key}`}>{busy === p.key ? 'Opening checkout…' : `Choose ${p.label}`}</button>}
              {mine && p.key !== 'starter' && b.subscription && (b.subscription.cancelAtPeriodEnd
                ? <button type="button" className="btn-ghost mt-4 !min-h-10" onClick={async () => { await platformApi.resume(); load() }} data-testid="resume">Keep {p.label}</button>
                : <button type="button" className="btn-ghost mt-4 !min-h-10 text-danger" disabled={!isOwner} onClick={async () => { if (confirm(`Cancel ${p.label}? You keep it until the end of the period.`)) { const r = await platformApi.cancel(); setOk(`Cancelled — ${p.label} stays on until ${fmtDate(r.endsAt)}.`); load() } }} data-testid="cancel">Cancel plan</button>)}
            </div>
          ) })}
        </div>
        {!b.online && <p className="mt-4 text-sm text-text-muted">Card billing isn’t switched on yet — contact Ship Sync to change your plan.</p>}
        {!isOwner && <p className="mt-2 text-sm text-text-muted">Only the account owner can change the plan.</p>}
        {b.history.length > 0 && <Panel title="History" className="mt-6"><ul className="divide-y divide-border text-sm">{b.history.map((h, i) => <li key={i} className="flex justify-between py-2"><span>{h.kind.replace(/_/g, ' ')} · {h.plan}{h.amountUsd ? ` · ${money(h.amountUsd)}` : ''}</span><span className="text-text-muted">{fmtDate(h.at)}{h.by ? ` · ${h.by}` : ''}</span></li>)}</ul></Panel>}
      </>}
    </div></div>
  )
}
