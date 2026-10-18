/** `/for-shippers` — the shipping-company side of Ntemtem: what the partner workspace does, how it works, and the plans.
 *  Plan prices, the trial length and the payout milestone are live from `/api/pricing`. Partner charcoal marks this as the shipper side. */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, ChartLine, MessageCircle, Ship, ShieldCheck, Users, Wallet } from 'lucide-react'
import { api } from '../lib/store'
import { suppliesApi } from '../lib/supplies'
import { Mark, money, VerifiedBadge } from '../components/ui'
import { fadeUp, stagger, viewport } from '../lib/motion'

interface PricingData {
  plans: { key: 'starter' | 'pro' | 'enterprise'; label: string; priceUsd: number; blurb: string }[]
  trialDays: number
  payments: { enabled: boolean; releaseOn: 'in_transit' | 'delivered' }
}

const steps: [string, string][] = [
  ['Get found', 'Set your origins, destinations and cargo types. Customer requests on your lanes come straight to you.'],
  ['Quote', 'Reply by hand, or let your rate cards price it instantly — even at 2am.'],
  ['Get booked & paid', 'The customer accepts and pays upfront. Ntemtem holds the money safely for you.'],
  ['Load & sail', 'Collect, sticker and scan every piece into a container. Customers follow it live.'],
  ['Hand over', 'Your agent at the port releases to the receiver with their code. You get paid out.'],
]

const pillars: { id: string; title: string; icon: typeof Users; items: [string, string][] }[] = [
  { id: 'win', title: 'Win customers', icon: Users, items: [
    ['Matched requests', 'on your lanes'], ['Rate cards', 'that quote instantly'], ['Branded page', 'on your own domain'], ['Campaigns', 'to bring past clients back'], ['Reviews', 'only from real bookings'],
  ] },
  { id: 'run', title: 'Run operations', icon: Ship, items: [
    ['Containers & sailings', 'loaded and tracked'], ['Warehouse', 'stickers and phone scans'], ['Pickups, routes & fleet', 'for your drivers'], ['Shared barrels', 'you fill and sell by the space'], ['Documents', 'packing lists, invoices, proof of delivery'],
  ] },
  { id: 'paid', title: 'Get paid', icon: Wallet, items: [
    ['Protected payments', 'paid out to you'], ['Clients & invoices', 'in one place'], ['Collections', 'with reminders'], ['Costs & profit', 'per container'], ['Insurance', 'to offer your customers'],
  ] },
  { id: 'grow', title: 'Grow', icon: ChartLine, items: [
    ['Analytics', 'win rate and response time'], ['Lane intelligence', 'what the market charges'], ['Team roles', 'for office, warehouse and drivers'], ['Integrations', 'webhooks for your systems'], ['Sourcing jobs', 'from importers'],
  ] },
]

const Eyebrow = ({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) => <p className={`mb-3 text-xs font-bold uppercase tracking-[0.12em] ${dark ? 'text-gold' : 'text-gold-deep'}`}>{children}</p>

export default function ForShippersPage() {
  const [sp] = useSearchParams(); const s = sp.get('s')
  const [d, setD] = useState<PricingData | null>(null)
  useEffect(() => { api<PricingData>('/pricing').then(setD).catch(() => setD(null)) }, [])
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof suppliesApi.catalog>>>([])
  useEffect(() => { suppliesApi.catalog().then(setCatalog).catch(() => setCatalog([])) }, [])
  // /for-shippers?s=run jumps to a section (hash links can't be used with the hash router).
  useEffect(() => { if (!s) return; const t = setTimeout(() => document.getElementById(s)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); return () => clearTimeout(t) }, [s])
  const trial = d?.trialDays ? `${d.trialDays}-day free Pro trial` : 'Free Pro trial'
  const payout = d?.payments.releaseOn === 'in_transit' ? 'once the shipment is on its way' : 'once it’s delivered'

  return (
    <div className="bg-bg text-text" data-testid="for-shippers-page">
      {/* Hero — partner charcoal */}
      <section className="bg-partner text-[#FBF6EC]">
        <div className="container-x grid items-center gap-12 py-16 md:py-20 lg:grid-cols-12">
          <motion.div className="lg:col-span-7" initial="hidden" animate="show" variants={stagger}>
            <motion.div variants={fadeUp} className="mb-6 flex items-center gap-3">
              <Mark size={44} partner />
              <span className="flex flex-col leading-none"><span className="font-heading text-2xl font-extrabold tracking-[-0.02em]">ntemtem</span><span className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Partner</span></span>
            </motion.div>
            <motion.h1 variants={fadeUp} className="max-w-3xl">Run your shipping business on <span className="text-gold">Ntemtem.</span></motion.h1>
            <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lg text-[#D8D1C3] md:text-xl">Customers find you, compare your quote and pay upfront. You load the container, scan every box, and your agent at the port hands it over — all in one place, built for barrels, cars and containers to West Africa.</motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup?role=shipper" className="btn-gold">List your company — {trial} <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link to="/pricing?for=shippers" className="btn inline-flex border border-[#5A544A] text-[#FBF6EC] hover:border-[#FBF6EC]">See plans</Link>
            </motion.div>
            <motion.ul variants={fadeUp} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#C9C1B1]">
              <li>No setup fee</li><li>Customers never pay Ntemtem</li><li>Your clients stay yours</li>
            </motion.ul>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="rounded-[var(--radius-lg)] bg-bg p-6 text-text shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)] lg:col-span-5" aria-label="Example of the partner workspace">
            <div className="flex items-center justify-between"><p className="font-heading text-xl font-bold">New on your lanes</p><span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Example</span></div>
            <ul className="mt-4 space-y-3">
              {[['4 barrels → Kumasi', 'Ocean · pickup in Dallas', 'Quote', 'bg-ink text-bg'], ['Toyota Highlander → Tema', 'Ocean · RoRo · title in hand', 'Auto-quoted', 'bg-teal/10 text-teal'], ['Your next container', 'Loading · cut-off Friday', '72% full', 'bg-gold/20 text-text']].map(([a, b, c, cls]) => (
                <li key={a} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
                  <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{a}</p><p className="text-xs text-text-muted">{b}</p></div>
                  <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${cls}`}>{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-teal/10 px-4 py-3 text-sm"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /> Customers pay upfront; the money is released to you {payout}.</p>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="section-y">
        <motion.div className="container-x" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
          <motion.div variants={fadeUp} className="mb-10 max-w-2xl"><Eyebrow>How it works for shippers</Eyebrow><h2>From a lead to a handover, without the WhatsApp chaos.</h2></motion.div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map(([t, b], i) => (
              <motion.li key={t} variants={fadeUp} className="card-light flex flex-col gap-2 p-5">
                <span className="font-heading text-3xl font-extrabold text-gold-deep">{i + 1}</span>
                <h3 className="!text-lg">{t}</h3>
                <p className="text-sm leading-relaxed text-text-muted">{b}</p>
              </motion.li>
            ))}
          </ol>
        </motion.div>
      </section>

      {/* Everything in the workspace */}
      <section className="pb-20 md:pb-28">
        <motion.div className="container-x" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
          <motion.div variants={fadeUp} className="mb-10 max-w-2xl"><Eyebrow>Everything in your partner workspace</Eyebrow><h2>One workspace for the whole business.</h2></motion.div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map((p) => (
              <motion.div key={p.id} id={p.id} variants={fadeUp} className="card-light scroll-mt-24 p-6" data-testid={`pillar-${p.id}`}>
                <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-gold/20 text-text"><p.icon size={20} aria-hidden="true" /></span>
                <h3 className="mt-4 !text-2xl">{p.title}</h3>
                <ul className="mt-4 space-y-2.5 text-[15px] leading-snug">
                  {p.items.map(([a, b]) => <li key={a}><strong className="font-semibold">{a}</strong> <span className="text-text-muted">{b}</span></li>)}
                </ul>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Two selling points */}
      <section className="pb-20 md:pb-28">
        <div className="container-x grid gap-5 lg:grid-cols-5">
          <div id="updates" className="theme-dark scroll-mt-24 rounded-[var(--radius-lg)] bg-bg p-8 text-text md:p-10 lg:col-span-3">
            <Eyebrow dark>Fewer phone calls</Eyebrow>
            <h2 className="!text-[clamp(1.6rem,2.6vw,2.25rem)]">The family back home gets updates — not you.</h2>
            <p className="mt-4 text-text-muted">Receivers get a WhatsApp or SMS at every milestone: sailed, landed, ready for collection. Your destination agent gets a no-login link with the manifest and hands over with the receiver’s code.</p>
            <p className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-teal"><MessageCircle size={16} aria-hidden="true" /> WhatsApp and SMS included on every plan</p>
          </div>
          <div id="verified" className="card-light scroll-mt-24 p-8 md:p-10 lg:col-span-2">
            <VerifiedBadge large />
            <h2 className="mt-5 !text-[clamp(1.5rem,2.4vw,2rem)]">Get verified, rank higher.</h2>
            <p className="mt-3 text-text-muted">Upload your business registration and insurance; we check them and your track record. Verified partners show the badge on every quote and rank higher in matching.</p>
          </div>
        </div>
      </section>

      {/* Equipment — buy, rent or free with a plan (live from the catalogue) */}
      <section id="equipment" className="scroll-mt-24 pb-20 md:pb-28" data-testid="fs-equipment">
        <div className="container-x grid items-start gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow>Equipment & supplies</Eyebrow>
            <h2 className="!text-[clamp(1.6rem,2.6vw,2.25rem)]">Printers, scanners and labels — ready to work.</h2>
            <p className="mt-4 text-text-muted">Everything we sell prints Ntemtem stickers and scans them straight into your warehouse and containers. No setup, no drivers to hunt for.</p>
            <ul className="mt-6 space-y-3 text-[15px]">
              <li className="flex gap-3"><b className="w-24 shrink-0">Buy it</b><span className="text-text-muted">Pay once, it’s yours. Free shipping over $150.</span></li>
              <li className="flex gap-3"><b className="w-24 shrink-0">Rent it</b><span className="text-text-muted">A small monthly fee. Swaps and repairs on us; send it back any time.</span></li>
              <li className="flex gap-3"><b className="w-24 shrink-0">Free with Pro</b><span className="text-text-muted">A starter kit on loan for as long as you’re on Pro. Enterprise gets the warehouse kit.</span></li>
            </ul>
            <p className="mt-6 text-sm text-text-muted">Sell packing supplies too — list your barrels, boxes and locks, and senders add them when they book.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-7">
            {catalog.slice(0, 3).map((p) => (
              <div key={p.id} className="card-light flex flex-col p-5">
                {p.includedWith.length > 0 && <span className="mb-2 self-start rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">Free with {p.includedWith.map((x) => x[0].toUpperCase() + x.slice(1)).join(' / ')}</span>}
                <h3 className="!text-base">{p.name}</h3>
                <ul className="mt-2 flex-1 space-y-1 text-sm text-text-muted">{p.specs.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
                <p className="mt-4 font-heading text-2xl font-extrabold">{money(p.priceUsd)}</p>
                {p.rentUsd != null && <p className="text-sm text-text-muted">or {money(p.rentUsd)}/month to rent</p>}
              </div>
            ))}
            {!catalog.length && [0, 1, 2].map((i) => <div key={i} className="card-light h-48 animate-pulse" aria-hidden="true" />)}
          </div>
        </div>
      </section>

      {/* Plans — live prices */}
      <section id="plans" className="pb-20 md:pb-28">
        <div className="container-x">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><h2>Plans for every size</h2><Link to="/pricing?for=shippers" className="text-sm font-semibold text-gold-deep hover:underline focus-ring rounded">Compare every feature →</Link></div>
          <div className="grid gap-5 md:grid-cols-3" data-testid="shipper-plans">
            {(d?.plans ?? []).map((p) => {
              const pro = p.key === 'pro'
              return (
                <div key={p.key} className={`flex flex-col gap-2 rounded-[var(--radius-lg)] p-7 ${pro ? 'bg-partner text-[#FBF6EC]' : 'card-light'}`}>
                  {pro && <span className="self-start rounded-full bg-gold px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-on-accent">{d?.trialDays ? `${d.trialDays} days free` : 'Free trial'}</span>}
                  <h3 className="!text-2xl">{p.label}</h3>
                  <p className={`text-[15px] ${pro ? 'text-[#D8D1C3]' : 'text-text-muted'}`}>{p.blurb}</p>
                  <p className="mt-auto pt-3 font-heading text-3xl font-extrabold">{p.key === 'enterprise' && !p.priceUsd ? 'Talk to us' : <>{money(p.priceUsd)}<span className={`font-sans text-[15px] font-normal ${pro ? 'text-[#C9C1B1]' : 'text-text-muted'}`}> / month</span></>}</p>
                </div>
              )
            })}
            {!d && [0, 1, 2].map((i) => <div key={i} className="card-light h-48 animate-pulse" aria-hidden="true" />)}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <div className="ss-weave" role="presentation" />
      <section className="bg-partner text-[#FBF6EC]">
        <div className="container-x flex flex-col items-start justify-between gap-6 py-16 md:flex-row md:items-center">
          <div><h2>Ready to become an Ntemtem partner?</h2><p className="mt-2 text-lg text-[#D8D1C3]">Set up your lanes in minutes. Start on Pro, free.</p></div>
          <Link to="/signup?role=shipper" className="btn-gold shrink-0">List your company <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      </section>
    </div>
  )
}
