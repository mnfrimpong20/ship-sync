/** Public pricing: free for customers, plans for shippers, and what the optional extras cost. All numbers are live from the platform settings. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, ChevronDown, Globe2, Landmark, Minus, PackageCheck, Ship, ShieldCheck, Sparkles, Users, Wallet } from 'lucide-react'
import { api } from '../lib/store'
import { brokersApi, type Broker } from '../lib/brokers'
import { cargoTypes, type CargoType } from '../lib/data'
import { FeaturedMark, money, VerifiedMark } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

interface PricingData {
  plans: { key: 'starter' | 'pro' | 'enterprise'; label: string; priceUsd: number; team: number | null; blurb: string; perks: string[] }[]
  trialDays: number
  payments: { enabled: boolean; takeRatePct: number; releaseOn: 'in_transit' | 'delivered' }
  insurance: { enabled: boolean; rates: Record<CargoType, number>; minPremiumUsd: number; maxValueUsd: number; deductiblePct: number }
  sourcing: { enabled: boolean; servicePct: number; minFeeUsd: number; findFeeUsd: number; inspectionUsd: number; handlingUsd: number; depositPct: number }
}
type Audience = 'customers' | 'shippers' | 'extras'
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`
const CORE = ['Listing in the shipper directory', 'Customer requests on your lanes, with quotes and messages', 'Shipments, tracking pages and stickers', 'Invoices, online payments and payouts', 'Pickups, warehouse and containers']
const ALL_PERKS = ['Branded page', 'Full analytics', 'Win-back campaigns', 'Container load planner', 'Accounting export', 'Webhooks']

export default function PricingPage() {
  const [sp, setSp] = useSearchParams()
  const tab = (['customers', 'shippers', 'extras'].includes(sp.get('for') ?? '') ? sp.get('for') : 'customers') as Audience
  const setTab = (t: Audience) => setSp(t === 'customers' ? {} : { for: t }, { replace: true })
  const [d, setD] = useState<PricingData | null>(null); const [error, setError] = useState(''); const [brokers, setBrokers] = useState<Broker[]>([])
  useEffect(() => { api<PricingData>('/pricing').then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load prices.')); brokersApi.list().then(setBrokers).catch(() => {}) }, [])
  const brokerFrom = useMemo(() => Object.fromEntries(cargoTypes.map((c) => { const v = brokers.map((b) => b.fees[c.id]).filter((x): x is number => x != null); return [c.id, v.length ? Math.min(...v) : null] })) as Record<CargoType, number | null>, [brokers])

  return (
    <div className="bg-bg text-text" data-testid="pricing-page">
      <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(227,181,74,.14),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(45,212,191,.10),transparent_50%)]">
        <div className="container-x py-12 text-center md:py-16">
          <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-3xl">
            <motion.p variants={fadeUp} className="eyebrow mb-2">Pricing</motion.p>
            <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.2vw,3.25rem)]">Free for customers. <span className="text-gold-deep">Simple plans for shippers.</span></motion.h1>
            <motion.p variants={fadeUp} className="mt-3 text-text-muted md:text-lg">Customers never pay Ntemtem to request quotes, book or track. Shippers pick a monthly plan; a small platform fee applies only when a customer pays them online through Ntemtem.</motion.p>
          </motion.div>
          <div role="tablist" aria-label="Pricing for" className="mx-auto mt-8 inline-flex rounded-xl border border-border bg-surface p-1">
            {([['customers', 'For customers', Users], ['shippers', 'For shippers', Ship], ['extras', 'Extras & services', Sparkles]] as const).map(([k, l, I]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-medium focus-ring ${tab === k ? 'bg-gold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid={`ptab-${k}`}><I size={15} aria-hidden="true" /> {l}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="container-x py-10 md:py-14">
        {error && <p role="alert" className="mb-6 text-center text-sm text-danger">{error}</p>}
        {!d && !error && <div className="grid gap-6 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-2xl border border-border bg-surface/60" />)}</div>}

        {d && tab === 'customers' && (
          <motion.div initial="hidden" animate="show" variants={stagger} className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="pricing-customers">
            <motion.div variants={fadeUp} className="rounded-2xl border border-gold/50 bg-surface p-7 shadow-[0_0_0_1px_rgba(227,181,74,.15),0_20px_50px_-30px_rgba(227,181,74,.35)]">
              <p className="eyebrow mb-1">Customers</p>
              <p className="flex items-baseline gap-2"><span className="font-heading text-6xl font-bold text-gold-deep">$0</span><span className="text-text-muted">always</span></p>
              <p className="mt-2 text-text-muted">You pay the shipper’s price for the freight — nothing extra to Ntemtem.</p>
              <ul className="mt-6 grid gap-2.5 text-sm sm:grid-cols-2">{['Post a request, get several quotes', 'Compare price, transit time and reviews', 'Book and pay safely — money held until your goods ship', 'Live tracking, with a link for family', 'Packing lists, documents and receipts in one place', 'Messages with your shipper', 'Duty estimates for Ghana and Nigeria', 'Report a problem — we mediate'].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />{t}</li>)}</ul>
              <div className="mt-7 flex flex-wrap gap-3"><Link to="/quote" className="btn-gold">Get free quotes</Link><Link to="/shippers" className="btn-ghost">Browse shippers</Link></div>
            </motion.div>
            <motion.div variants={fadeUp} className="card-dark p-7">
              <p className="eyebrow mb-3">What you might pay for</p>
              <dl className="space-y-4 text-sm">
                <div><dt className="font-semibold">The freight</dt><dd className="text-text-muted">Set by the shipper you choose. Firm quotes are what you pay; estimates are confirmed before booking.</dd></div>
                <div><dt className="font-semibold">Cargo insurance (optional)</dt><dd className="text-text-muted">From {pct(Math.min(...Object.values(d.insurance.rates)))} of the declared value, minimum {money(d.insurance.minPremiumUsd)}. <button className="text-gold-deep hover:underline" onClick={() => setTab('extras')}>See rates</button></dd></div>
                <div><dt className="font-semibold">Customs duty</dt><dd className="text-text-muted">Charged by customs at the destination, not by Ntemtem. <Link to="/duty" className="text-gold-deep hover:underline">Estimate yours</Link>.</dd></div>
                <div><dt className="font-semibold">A clearing agent (optional)</dt><dd className="text-text-muted">{brokerFrom.barrels != null ? `From ${money(brokerFrom.barrels)} for barrels` : 'A fixed fee per shipment'}, paid to the broker. <Link to="/brokers" className="text-gold-deep hover:underline">Compare brokers</Link>.</dd></div>
              </dl>
            </motion.div>
          </motion.div>
        )}

        {d && tab === 'shippers' && (
          <div data-testid="pricing-shippers">
            <motion.div initial="hidden" animate="show" variants={stagger} className="grid gap-6 lg:grid-cols-3">
              {d.plans.map((p) => { const hi = p.key === 'pro'; return (
                <motion.div key={p.key} variants={fadeUp} whileHover={{ y: -4 }} className={`relative flex flex-col rounded-2xl border bg-surface p-7 ${hi ? 'border-gold shadow-[0_0_0_1px_rgba(227,181,74,.2),0_24px_60px_-30px_rgba(227,181,74,.45)]' : 'border-border'}`} data-testid={`plan-${p.key}`}>
                  {hi && <span className="absolute -top-3 left-7 rounded-full bg-gold px-3 py-1 text-xs font-bold text-on-accent">Most popular</span>}
                  <h2 className="flex items-center gap-2 !text-xl">{p.key === 'enterprise' && <FeaturedMark size={20} aria-hidden="true" />}{p.label}</h2>
                  <p className="mt-1 min-h-10 text-sm text-text-muted">{p.blurb}</p>
                  <p className="mt-4 flex items-baseline gap-1"><span className={`font-heading text-5xl font-bold ${hi ? 'text-gold-deep' : ''}`}>{money(p.priceUsd)}</span><span className="text-text-muted">/month</span></p>
                  <p className="mt-1 text-xs text-text-muted">{p.team == null ? 'Unlimited team members' : `Up to ${p.team} team members`}</p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                    {CORE.map((f) => <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />{f}</li>)}
                    {ALL_PERKS.map((f) => p.perks.includes(f) ? <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />{f}</li> : <li key={f} className="flex gap-2 text-text-muted/60"><Minus size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{f}</li>)}
                    {p.key === 'enterprise' && <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />Featured placement in the directory</li>}
                  </ul>
                  <Link to="/signup?role=shipper" className={`mt-7 ${hi ? 'btn-gold' : 'btn-ghost'}`}>{p.priceUsd === 0 ? 'Start free' : `Start with ${p.label}`}</Link>
                </motion.div>) })}
            </motion.div>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="card-dark p-5 text-sm"><Sparkles size={18} className="text-gold-deep" aria-hidden="true" /><p className="mt-2 font-semibold">{d.trialDays} days of Pro, free</p><p className="mt-1 text-text-muted">Every new shipping company starts on a Pro trial. Keep Pro, move up, or drop to Starter — no card needed to start.</p></div>
              <div className="card-dark p-5 text-sm" data-testid="take-rate"><Wallet size={18} className="text-gold-deep" aria-hidden="true" /><p className="mt-2 font-semibold">{pct(d.payments.takeRatePct)} platform fee on online payments</p><p className="mt-1 text-text-muted">Only when a customer pays you through Ntemtem. Money is held safely and released to you {d.payments.releaseOn === 'delivered' ? 'once the goods are delivered' : 'once the goods are on their way'}. Cash and bank payments you record yourself are free.</p></div>
              <div className="card-dark p-5 text-sm"><VerifiedMark size={20} aria-hidden="true" /><p className="mt-2 font-semibold">Verification is free</p><p className="mt-1 text-text-muted">We check your licence and insurance once. Verified shippers get the badge on every quote and profile.</p></div>
            </div>
          </div>
        )}

        {d && tab === 'extras' && (
          <motion.div initial="hidden" animate="show" variants={stagger} className="grid gap-6 lg:grid-cols-2" data-testid="pricing-extras">
            <motion.section variants={fadeUp} className="card-dark p-6" data-testid="insurance-rates">
              <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-gold-deep" aria-hidden="true" /> Cargo insurance</p>
              <p className="mt-1 text-sm text-text-muted">All-risk, door to door. A share of the declared value, minimum {money(d.insurance.minPremiumUsd)}, cover up to {money(d.insurance.maxValueUsd)} per shipment, {pct(d.insurance.deductiblePct)} excess on claims.</p>
              <table className="mt-4 w-full text-sm"><tbody>{cargoTypes.map((c) => <tr key={c.id} className="border-t border-border/60"><td className="py-2">{c.label}</td><td className="py-2 text-right font-semibold tabular-nums">{pct(d.insurance.rates[c.id])}</td><td className="py-2 pl-3 text-right text-xs text-text-muted tabular-nums">{money(Math.max(d.insurance.minPremiumUsd, 1000 * d.insurance.rates[c.id]))} on $1,000</td></tr>)}</tbody></table>
            </motion.section>
            <motion.section variants={fadeUp} className="card-dark p-6" data-testid="broker-fees">
              <p className="flex items-center gap-2 font-semibold"><Landmark size={18} className="text-gold-deep" aria-hidden="true" /> Customs clearing agents</p>
              <p className="mt-1 text-sm text-text-muted">A fixed fee per shipment, set by each licensed broker and paid to them. Duty and port charges are on top, at cost.</p>
              <table className="mt-4 w-full text-sm"><tbody>{cargoTypes.map((c) => <tr key={c.id} className="border-t border-border/60"><td className="py-2">{c.label}</td><td className="py-2 text-right font-semibold tabular-nums">{brokerFrom[c.id] != null ? `from ${money(brokerFrom[c.id]!)}` : '—'}</td></tr>)}</tbody></table>
              <Link to="/brokers" className="btn-ghost mt-4 !min-h-9 text-sm">Compare brokers</Link>
            </motion.section>
            <motion.section variants={fadeUp} className="card-dark p-6">
              <p className="flex items-center gap-2 font-semibold"><Globe2 size={18} className="text-gold-deep" aria-hidden="true" /> Sourcing — China, UK and USA</p>
              <ul className="mt-3 space-y-2 text-sm"><li className="flex justify-between gap-3"><span className="text-text-muted">We buy, inspect and ship</span><span className="font-semibold">{pct(d.sourcing.servicePct)} of the goods, min {money(d.sourcing.minFeeUsd)}</span></li><li className="flex justify-between gap-3"><span className="text-text-muted">Supplier search only</span><span className="font-semibold">{money(d.sourcing.findFeeUsd)} flat</span></li><li className="flex justify-between gap-3"><span className="text-text-muted">Quality inspection</span><span className="font-semibold">{money(d.sourcing.inspectionUsd)} per order</span></li><li className="flex justify-between gap-3"><span className="text-text-muted">Warehouse & export</span><span className="font-semibold">{money(d.sourcing.handlingUsd)} per order</span></li></ul>
              <p className="mt-3 text-xs text-text-muted">Deposit of {pct(d.sourcing.depositPct)} of the goods plus fees; the balance after you approve the inspection.</p>
              <Link to="/sourcing" className="btn-ghost mt-4 !min-h-9 text-sm">How sourcing works</Link>
            </motion.section>
            <motion.section variants={fadeUp} className="card-dark p-6">
              <p className="flex items-center gap-2 font-semibold"><PackageCheck size={18} className="text-gold-deep" aria-hidden="true" /> Shared barrels & containers</p>
              <p className="mt-2 text-sm text-text-muted">Buy part of a barrel or a few cubic metres in a container a shipper is already sending. The shipper sets the price per space — you see it before you join, with no Ntemtem fee on top.</p>
              <Link to="/groupage" className="btn-ghost mt-4 !min-h-9 text-sm">See open spaces</Link>
            </motion.section>
          </motion.div>
        )}

        <Faq />
      </div>
    </div>
  )
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null)
  const qs: [string, string][] = [
    ['Do customers ever pay Ntemtem?', 'No. Requesting quotes, booking, paying and tracking are free. You pay the shipper for the freight, and optional extras like insurance or a clearing agent if you choose them.'],
    ['How does the platform fee work for shippers?', 'It is a percentage of payments a customer makes to you through Ntemtem’s online checkout. It is deducted from the amount released to your balance. Payments you collect yourself and record as cash or bank transfer carry no fee.'],
    ['Can I change or cancel my plan?', 'Yes, any time from Plan & billing in your dashboard. Upgrades start straight away; if you drop to Starter, paid features switch off at the end of the period.'],
    ['Is my money safe when I pay online?', 'Online payments are held by Ntemtem and only released to the shipper when your goods are on their way (or delivered). If something goes wrong you can open a dispute and we hold the money while we sort it out.'],
  ]
  return (
    <section className="mx-auto mt-14 max-w-3xl" aria-label="Pricing questions">
      <h2 className="text-center !text-2xl">Questions about pricing</h2>
      <div className="mt-6">{qs.map(([q, a], i) => (
        <div key={q} className="border-b border-border">
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left font-semibold hover:text-gold-deep focus-ring">{q}<ChevronDown size={18} className={`shrink-0 text-text-muted transition-transform ${open === i ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
          {open === i && <p className="pb-4 text-sm text-text-muted">{a}</p>}
        </div>))}</div>
      <p className="mt-6 text-center text-sm text-text-muted">Something else? <Link to="/contact" className="text-gold-deep hover:underline">Ask us</Link> — a real person replies.</p>
    </section>
  )
}
