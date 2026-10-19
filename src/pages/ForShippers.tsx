/** `/for-shippers` — the shipping-company side of Ntemtem. Reads as a story: the problem → how it works → what you get
 *  (with small example screens) → trust → equipment → plans → questions → sign up. Plan prices, the trial length, the
 *  platform fee, the payout milestone and the live numbers all come from the API. Partner charcoal marks the shipper side. */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChartLine, ChevronDown, Lock, MessageCircle, ScanLine, Ship, ShieldCheck, Users, Wallet, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../lib/store'
import { siteApi, type SiteStats } from '../lib/site'
import { suppliesApi } from '../lib/supplies'
import { Mark, money, VerifiedBadge } from '../components/ui'
import { fadeUp, stagger, viewport } from '../lib/motion'

interface PricingData {
  plans: { key: 'starter' | 'pro' | 'enterprise'; label: string; priceUsd: number; blurb: string; team: number | null; perks: string[] }[]
  trialDays: number
  payments: { enabled: boolean; takeRatePct: number; releaseOn: 'in_transit' | 'delivered' }
}

const steps: [string, string][] = [
  ['Get found', 'Set your origins, destinations and cargo. Requests on your lanes come straight to you.'],
  ['Quote', 'Reply by hand, or let your rate cards price it instantly — even at 2am.'],
  ['Get booked & paid', 'The customer accepts and pays upfront. Ntemtem holds the money for you.'],
  ['Load & sail', 'Sticker and scan every piece into a container. Customers follow it live.'],
  ['Hand over', 'Your agent at the port releases to the receiver with their code. You get paid out.'],
]
const before: [string, string][] = [
  ['Leads lost in WhatsApp threads and missed calls', 'Every request on your lanes in one inbox, with the details you need to price it'],
  ['Customers ghost after you quote — or pay half and argue later', 'Customers pay upfront; Ntemtem holds it until the goods are on their way'],
  ['“Where is my barrel?” calls all day', 'Senders and their families get WhatsApp updates at every step'],
  ['Container manifests on paper and spreadsheets', 'Every box stickered, scanned and on the manifest automatically'],
]

type Feature = { id: string; eyebrow: string; title: string; body: string; icon: LucideIcon; items: string[]; visual: 'win' | 'run' | 'paid' | 'grow' }
const features: Feature[] = [
  { id: 'win', eyebrow: 'Win customers', title: 'Requests on your lanes, quoted in seconds.', body: 'Customers post what they’re shipping once and matched shippers get it. Price it yourself, or let your rate card send the quote for you. Your branded page and verified badge help you win it.', icon: Users, items: ['Matched requests', 'Rate cards & instant quotes', 'Branded page', 'Win-back campaigns', 'Reviews from real bookings'], visual: 'win' },
  { id: 'run', eyebrow: 'Run operations', title: 'Every box scanned, every container accounted for.', body: 'Print a sticker for each piece, scan it into the warehouse and onto the container with a phone or scanner. The manifest builds itself, and your agent at the port sees it too.', icon: Ship, items: ['Containers & sailings', 'Warehouse & scanning', 'Pickups, routes & drivers', 'Shared barrels', 'Packing lists & proof of delivery'], visual: 'run' },
  { id: 'paid', eyebrow: 'Get paid', title: 'Paid upfront. Released to you on schedule.', body: 'Customers pay through Ntemtem when they book, so you never chase a deposit. The money is held safely and released to your balance at the agreed milestone, then paid out to your bank or mobile money.', icon: Wallet, items: ['Protected payments', 'Clients & invoices', 'Collections with reminders', 'Costs & profit per container', 'Cargo insurance to offer'], visual: 'paid' },
  { id: 'grow', eyebrow: 'Grow', title: 'Know what the market charges — and where you win.', body: 'See your win rate, how fast you reply, and how your prices compare with what other shippers quote on the same lane. Add your team with the right access for office, warehouse and drivers.', icon: ChartLine, items: ['Analytics', 'Lane intelligence', 'Team roles', 'Webhooks & integrations', 'Sourcing jobs from importers'], visual: 'grow' },
]
const sections: [string, string][] = [['how', 'How it works'], ['win', 'Win'], ['run', 'Run'], ['paid', 'Get paid'], ['grow', 'Grow'], ['equipment', 'Equipment'], ['plans', 'Plans'], ['faq', 'Questions']]

const Eyebrow = ({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) => <p className={`mb-3 text-xs font-bold uppercase tracking-[0.12em] ${dark ? 'text-gold' : 'text-gold-deep'}`}>{children}</p>
const ExampleTag = () => <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Example</span>
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/* ------------------------------------------------------------------ small example screens */
function Visual({ kind, payout, fee }: { kind: Feature['visual']; payout: string; fee: number }) {
  const shell = 'card-light p-5 shadow-[0_24px_50px_-30px_rgba(20,33,61,.45)]'
  if (kind === 'win') return (
    <div className={shell} aria-label="Example of a matched request">
      <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">New request on your lane</p><ExampleTag /></div>
      <p className="mt-3 font-heading text-xl font-bold">6 barrels → Accra</p>
      <p className="text-sm text-text-muted">Ocean · pickup in Houston, TX · ready in 5 days</p>
      <div className="mt-4 rounded-[var(--radius-md)] bg-teal/10 p-3 text-sm"><p className="flex items-center gap-2 font-semibold text-teal"><Check size={15} aria-hidden="true" /> Your rate card quoted $1,140</p><p className="mt-0.5 text-text-muted">Sent automatically, 2 seconds after the request came in</p></div>
      <div className="mt-3 flex items-center justify-between rounded-[var(--radius-md)] border border-border px-3 py-2.5 text-sm"><span>4 shippers quoted</span><span className="font-semibold">Yours: 2nd lowest</span></div>
    </div>
  )
  if (kind === 'run') return (
    <div className={shell} aria-label="Example of a container being loaded">
      <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">40ft to Tema · cut-off Friday</p><ExampleTag /></div>
      <div className="mt-3 flex items-end justify-between"><p className="font-heading text-xl font-bold">72% full</p><p className="text-sm text-text-muted">38 of 52 pieces loaded</p></div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full w-[72%] rounded-full bg-gold" /></div>
      <ul className="mt-4 space-y-2 text-sm">
        {[['NT-4821 · piece 3 of 4', 'Loaded', true], ['NT-4821 · piece 4 of 4', 'Loaded', true], ['NT-5107 · Toyota Camry', 'Scan next', false]].map(([a, b, ok]) => (
          <li key={String(a)} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2"><span className="flex items-center gap-2"><ScanLine size={15} className="text-text-muted" aria-hidden="true" />{a}</span><span className={`text-xs font-semibold ${ok ? 'text-teal' : 'text-gold-deep'}`}>{b}</span></li>
        ))}
      </ul>
    </div>
  )
  if (kind === 'paid') {
    const amt = 1240, net = Math.round(amt * (1 - fee))
    return (
      <div className={shell} aria-label="Example of a protected payment">
        <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">Booking NT-4821</p><ExampleTag /></div>
        <ol className="mt-4 space-y-0">
          {[['Customer pays', money(amt), 'At booking, by card', true], ['Held by Ntemtem', money(amt), 'Safe — not with you, not with them', true], ['Released to your balance', money(net), `${payout}${fee ? `, after the ${Math.round(fee * 100)}% platform fee` : ''}`, true], ['Paid out', money(net), 'To your bank or mobile money', false]].map(([t, v, s, done], i, all) => (
            <li key={String(t)} className="relative flex gap-3 pb-4 last:pb-0">
              {i < all.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-border" aria-hidden="true" />}
              <span className={`relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? 'bg-teal text-white' : 'border border-border bg-bg text-text-muted'}`}>{i === 1 ? <Lock size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}</span>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3"><span><b className="text-sm">{t}</b><span className="block text-xs text-text-muted">{s}</span></span><span className="font-semibold tabular-nums">{v}</span></div>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return (
    <div className={shell} aria-label="Example of lane intelligence">
      <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-text-muted">Barrels · Houston → Ghana · 90 days</p><ExampleTag /></div>
      <div className="mt-4 space-y-3 text-sm">
        {[['Market low', 150, 'bg-surface-2'], ['Market typical', 180, 'bg-surface-2'], ['Your price', 190, 'bg-gold'], ['Market high', 230, 'bg-surface-2']].map(([l, v, c]) => (
          <div key={String(l)} className="grid grid-cols-[110px_1fr_48px] items-center gap-3"><span className="text-text-muted">{l}</span><span className="h-3 overflow-hidden rounded-full bg-surface-2/40"><span className={`block h-full rounded-full ${c}`} style={{ width: `${(Number(v) / 240) * 100}%` }} /></span><span className="text-right font-semibold tabular-nums">${v}</span></div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-center"><div><p className="font-heading text-2xl font-bold">38%</p><p className="text-xs text-text-muted">of quotes won</p></div><div><p className="font-heading text-2xl font-bold">3 h</p><p className="text-xs text-text-muted">typical reply time</p></div></div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */
export default function ForShippersPage() {
  const [sp] = useSearchParams(); const s = sp.get('s')
  const [d, setD] = useState<PricingData | null>(null)
  const [stats, setStats] = useState<SiteStats | null>(null)
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof suppliesApi.catalog>>>([])
  const [active, setActive] = useState('')
  useEffect(() => { api<PricingData>('/pricing').then(setD).catch(() => setD(null)); siteApi.stats().then(setStats).catch(() => {}); suppliesApi.catalog().then(setCatalog).catch(() => setCatalog([])) }, [])
  // /for-shippers?s=run jumps to a section (hash links can't be used with the hash router).
  useEffect(() => { if (!s) return; const t = setTimeout(() => go(s), 300); return () => clearTimeout(t) }, [s])
  // Highlight the section in view in the sticky bar.
  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver((es) => { const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (vis) setActive(vis.target.id) }, { rootMargin: '-140px 0px -55% 0px' })
    els.forEach((e) => io.observe(e)); return () => io.disconnect()
  }, [d])
  useEffect(() => { if (!active) return; const el = document.querySelector<HTMLElement>(`[data-sec="${active}"]`); const bar = el?.parentElement?.parentElement; if (el && bar) bar.scrollTo({ left: el.offsetLeft - bar.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' }) }, [active])
  const trial = d?.trialDays ? `${d.trialDays}-day free Pro trial` : 'Free Pro trial'
  const payout = d?.payments.releaseOn === 'in_transit' ? 'Once the shipment is on its way' : 'Once it’s delivered'
  const fee = d?.payments.takeRatePct ?? 0
  const feeTxt = fee ? `${Math.round(fee * 1000) / 10}%` : ''
  const faqs: [string, string][] = [
    ['What does it cost?', `Starter is free. Pro is ${d ? money(d.plans.find((p) => p.key === 'pro')?.priceUsd ?? 0) : '—'} a month${d?.trialDays ? `, and you get the first ${d.trialDays} days free` : ''}. There’s no setup fee.${feeTxt ? ` When a customer pays through Ntemtem, a ${feeTxt} platform fee comes off before the money reaches your balance.` : ''}`],
    ['Do my customers pay Ntemtem anything?', 'No. Getting quotes is free for senders, and they pay the price you quote. Ntemtem never adds a fee on their side.'],
    ['When do I get my money?', `The customer pays when they book. Ntemtem holds it and releases it to your balance ${payout.toLowerCase()}. You then request a payout to your bank or mobile money.`],
    ['Can I bring my existing clients?', 'Yes — your clients stay yours. Add them, send invoices, and record payments they make to you directly. Customers who find you through Ntemtem are yours to keep, too.'],
    ['What do I need to get verified?', 'Your business registration, operating licence, insurance and warehouse details. We check them along with your track record. Verified shippers show the badge on every quote and rank higher in matching.'],
    ['Do I need special equipment?', 'No — stickers print straight from the browser and your team can scan them with a phone. If you want a label printer and scanner, you can buy or rent them from us, and Pro includes a starter kit on loan.'],
  ]

  return (
    <div className="bg-bg text-text" data-testid="for-shippers-page">
      {/* 1 · Hero — partner charcoal */}
      <section className="bg-partner text-[#FBF6EC]">
        <div className="container-x grid items-center gap-12 pb-12 pt-16 md:pt-20 lg:grid-cols-12">
          <motion.div className="lg:col-span-7" initial="hidden" animate="show" variants={stagger}>
            <motion.div variants={fadeUp} className="mb-6 flex items-center gap-3">
              <Mark size={44} partner />
              <span className="flex flex-col leading-none"><span className="font-heading text-2xl font-extrabold tracking-[-0.02em]">ntemtem</span><span className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Partner</span></span>
            </motion.div>
            <motion.h1 variants={fadeUp} className="max-w-3xl">Run your shipping business on <span className="text-gold">Ntemtem.</span></motion.h1>
            <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lg text-[#D8D1C3] md:text-xl">Customers find you, compare your quote and pay upfront. You load the container, scan every box, and your agent at the port hands it over — all in one place, built for barrels, cars and containers to West Africa.</motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup?role=shipper" className="btn-gold">List your company — {trial} <ArrowRight size={18} aria-hidden="true" /></Link>
              <button type="button" onClick={() => go('how')} className="btn inline-flex border border-[#5A544A] text-[#FBF6EC] hover:border-[#FBF6EC]">See how it works</button>
            </motion.div>
            <motion.ul variants={fadeUp} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#C9C1B1]">
              {['No setup fee', 'Customers never pay Ntemtem', 'Your clients stay yours'].map((t) => <li key={t} className="flex items-center gap-1.5"><Check size={14} className="text-gold" aria-hidden="true" />{t}</li>)}
            </motion.ul>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="rounded-[var(--radius-lg)] bg-bg p-6 text-text shadow-[0_30px_60px_-30px_rgba(0,0,0,.6)] lg:col-span-5" aria-label="Example of the partner workspace">
            <div className="flex items-center justify-between"><p className="font-heading text-xl font-bold">New on your lanes</p><ExampleTag /></div>
            <ul className="mt-4 space-y-3">
              {[['4 barrels → Kumasi', 'Ocean · pickup in Dallas', 'Quote', 'bg-ink text-bg'], ['Toyota Highlander → Tema', 'Ocean · RoRo · title in hand', 'Auto-quoted', 'bg-teal/10 text-teal'], ['Your next container', 'Loading · cut-off Friday', '72% full', 'bg-gold/20 text-text']].map(([a, b, c, cls]) => (
                <li key={a} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
                  <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{a}</p><p className="text-xs text-text-muted">{b}</p></div>
                  <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${cls}`}>{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-teal/10 px-4 py-3 text-sm"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /> Customers pay upfront; the money is released to you {payout.toLowerCase()}.</p>
          </motion.div>
        </div>
        {/* Live numbers — real, from the database */}
        <div className="container-x">
          <dl className="grid grid-cols-2 gap-6 border-t border-white/10 py-8 md:grid-cols-4" data-testid="fs-stats">
            {[[stats?.shipments, 'Shipments booked on Ntemtem'], [stats?.quotes, 'Quotes sent by shippers'], [stats?.verifiedShippers, 'Verified shippers'], [stats?.destinations, 'West African countries served']].map(([v, l]) => (
              <div key={String(l)}><dt className="text-sm text-[#C9C1B1]">{l}</dt><dd className="mt-1 font-heading text-3xl font-extrabold text-[#FBF6EC]">{v == null ? '—' : Number(v).toLocaleString()}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {/* Sticky section bar */}
      <nav aria-label="On this page" className="sticky top-[72px] z-40 border-b border-border bg-bg/95 backdrop-blur" data-testid="fs-subnav">
        <div className="container-x flex items-center gap-3">
          <ul className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
            {sections.map(([id, label]) => (
              <li key={id} data-sec={id}><button type="button" onClick={() => go(id)} aria-current={active === id ? 'true' : undefined} className={`min-h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-medium focus-ring ${active === id ? 'bg-partner text-[#FBF6EC]' : 'text-text-muted hover:text-text'}`}>{label}</button></li>
            ))}
          </ul>
          <Link to="/signup?role=shipper" className="btn-gold hidden !min-h-9 shrink-0 !px-4 text-sm md:inline-flex">List your company</Link>
        </div>
      </nav>

      {/* 2 · The problem → the fix */}
      <section className="section-y">
        <motion.div className="container-x" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
          <motion.div variants={fadeUp} className="mb-10 max-w-2xl"><Eyebrow>Why shippers switch</Eyebrow><h2>Less chasing. More shipping.</h2></motion.div>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border" data-testid="fs-before-after">
            <div className="hidden grid-cols-2 bg-surface-2/60 text-xs font-bold uppercase tracking-wider text-text-muted md:grid"><p className="px-6 py-3">Without Ntemtem</p><p className="border-l border-border px-6 py-3">With Ntemtem</p></div>
            {before.map(([a, b]) => (
              <motion.div key={a} variants={fadeUp} className="grid border-t border-border first:border-t-0 md:grid-cols-2 md:first:border-t">
                <p className="flex items-start gap-3 px-6 py-4 text-text-muted"><X size={17} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />{a}</p>
                <p className="flex items-start gap-3 border-t border-dashed border-border bg-surface px-6 py-4 font-medium md:border-l md:border-t-0 md:border-solid"><Check size={17} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />{b}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* 3 · How it works — connected steps */}
      <section id="how" className="scroll-mt-32 bg-surface-2/40 section-y">
        <motion.div className="container-x" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
          <motion.div variants={fadeUp} className="mb-12 max-w-2xl"><Eyebrow>How it works</Eyebrow><h2>From a lead to a handover, in five steps.</h2></motion.div>
          <ol className="relative grid gap-8 lg:grid-cols-5 lg:gap-6">
            <span className="absolute left-5 right-5 top-5 hidden h-0.5 bg-gold/40 lg:block" aria-hidden="true" />
            {steps.map(([t, b], i) => (
              <motion.li key={t} variants={fadeUp} className="relative flex gap-4 lg:flex-col lg:gap-3">
                <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-partner font-heading text-lg font-extrabold text-gold">{i + 1}</span>
                <div><h3 className="!text-lg">{t}</h3><p className="mt-1 text-sm leading-relaxed text-text-muted">{b}</p></div>
              </motion.li>
            ))}
          </ol>
        </motion.div>
      </section>

      {/* 4 · What you get — alternating rows with example screens */}
      <section className="section-y" aria-label="What you get">
        <div className="container-x space-y-20 md:space-y-28">
          {features.map((f, i) => (
            <motion.div key={f.id} id={f.id} className="grid scroll-mt-32 items-center gap-10 lg:grid-cols-2 lg:gap-16" initial="hidden" whileInView="show" viewport={viewport} variants={stagger} data-testid={`pillar-${f.id}`}>
              <motion.div variants={fadeUp} className={i % 2 ? 'lg:order-2' : ''}>
                <span className="mb-4 grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-gold/20"><f.icon size={20} aria-hidden="true" /></span>
                <Eyebrow>{f.eyebrow}</Eyebrow>
                <h2 className="!text-[clamp(1.6rem,2.8vw,2.4rem)]">{f.title}</h2>
                <p className="mt-4 max-w-xl text-lg text-text-muted">{f.body}</p>
                <ul className="mt-6 flex flex-wrap gap-2">{f.items.map((x) => <li key={x} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm">{x}</li>)}</ul>
              </motion.div>
              <motion.div variants={fadeUp} className={`mx-auto w-full max-w-md ${i % 2 ? 'lg:order-1' : ''}`}><Visual kind={f.visual} payout={payout} fee={fee} /></motion.div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 5 · Trust — family updates and verification */}
      <section className="pb-20 md:pb-28">
        <div className="container-x grid gap-5 lg:grid-cols-5">
          <div id="updates" className="theme-dark scroll-mt-32 rounded-[var(--radius-lg)] bg-bg p-8 text-text md:p-10 lg:col-span-3">
            <Eyebrow dark>Fewer phone calls</Eyebrow>
            <h2 className="!text-[clamp(1.6rem,2.6vw,2.25rem)]">The family back home gets updates — not you.</h2>
            <p className="mt-4 text-text-muted">Receivers get a WhatsApp or SMS at every milestone: sailed, landed, ready for collection. Your destination agent gets a no-login link with the manifest and hands over with the receiver’s code.</p>
            <p className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-teal"><MessageCircle size={16} aria-hidden="true" /> WhatsApp and SMS included on every plan</p>
          </div>
          <div id="verified" className="card-light scroll-mt-32 p-8 md:p-10 lg:col-span-2">
            <VerifiedBadge large />
            <h2 className="mt-5 !text-[clamp(1.5rem,2.4vw,2rem)]">Get verified, rank higher.</h2>
            <p className="mt-3 text-text-muted">Upload your business registration and insurance; we check them and your track record. Verified partners show the badge on every quote and rank higher in matching.</p>
          </div>
        </div>
      </section>

      {/* 6 · Equipment — buy, rent or free with a plan (live from the catalogue) */}
      <section id="equipment" className="scroll-mt-32 bg-surface-2/40 section-y" data-testid="fs-equipment">
        <div className="container-x grid items-start gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow>Equipment & supplies</Eyebrow>
            <h2 className="!text-[clamp(1.6rem,2.6vw,2.25rem)]">Printers, scanners and labels — ready to work.</h2>
            <p className="mt-4 text-text-muted">Everything we sell prints Ntemtem stickers and scans them straight into your warehouse and containers. No setup, no drivers to hunt for.</p>
            <ul className="mt-6 space-y-3 text-[15px]">
              <li className="flex gap-3"><b className="w-28 shrink-0">Buy it</b><span className="text-text-muted">Pay once, it’s yours. Free shipping over $150.</span></li>
              <li className="flex gap-3"><b className="w-28 shrink-0">Rent it</b><span className="text-text-muted">A small monthly fee. Swaps and repairs on us; send it back any time.</span></li>
              <li className="flex gap-3"><b className="w-28 shrink-0">Free with Pro</b><span className="text-text-muted">A starter kit on loan for as long as you’re on Pro. Enterprise gets the warehouse kit.</span></li>
            </ul>
            <p className="mt-6 text-sm text-text-muted">Sell packing supplies too — list your barrels, boxes and locks, and senders add them when they book.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-7">
            {catalog.slice(0, 3).map((p) => (
              <div key={p.id} className="card-light flex flex-col p-5">
                {p.includedWith.length > 0 && <span className="mb-2 self-start rounded-full bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal">Free with {p.includedWith.map((x) => x[0].toUpperCase() + x.slice(1)).join(' / ')}</span>}
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

      {/* 7 · Plans — live prices, what's included, a button each, and the fee in plain words */}
      <section id="plans" className="scroll-mt-32 section-y">
        <div className="container-x">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><Eyebrow>Plans</Eyebrow><h2>Start free. Grow when you’re ready.</h2></div><Link to="/pricing?for=shippers" className="text-sm font-semibold text-gold-deep hover:underline focus-ring rounded">Compare every feature →</Link></div>
          <div className="grid gap-5 md:grid-cols-3" data-testid="shipper-plans">
            {(d?.plans ?? []).map((p) => {
              const pro = p.key === 'pro'
              return (
                <div key={p.key} className={`flex flex-col rounded-[var(--radius-lg)] p-7 ${pro ? 'bg-partner text-[#FBF6EC] md:-my-3 md:py-10' : 'card-light'}`}>
                  {pro && <span className="mb-3 self-start rounded-full bg-gold px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-on-accent">{d?.trialDays ? `${d.trialDays} days free` : 'Free trial'}</span>}
                  <h3 className="!text-2xl">{p.label}</h3>
                  <p className="mt-2 font-heading text-3xl font-extrabold">{p.key === 'enterprise' && !p.priceUsd ? 'Talk to us' : !p.priceUsd ? 'Free' : <>{money(p.priceUsd)}<span className={`font-sans text-[15px] font-normal ${pro ? 'text-[#C9C1B1]' : 'text-text-muted'}`}> / month</span></>}</p>
                  <p className={`mt-2 text-[15px] ${pro ? 'text-[#D8D1C3]' : 'text-text-muted'}`}>{p.blurb}</p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                    {(p.key === 'starter' ? ['Protected payments', 'WhatsApp updates for receivers'] : p.perks).map((k) => <li key={k} className="flex gap-2"><Check size={15} className={`mt-0.5 shrink-0 ${pro ? 'text-gold' : 'text-teal'}`} aria-hidden="true" />{k}</li>)}
                    <li className="flex gap-2"><Check size={15} className={`mt-0.5 shrink-0 ${pro ? 'text-gold' : 'text-teal'}`} aria-hidden="true" />{p.team ? `Up to ${p.team} team members` : 'Unlimited team'}</li>
                    {p.key !== 'starter' && <li className="flex gap-2"><Check size={15} className={`mt-0.5 shrink-0 ${pro ? 'text-gold' : 'text-teal'}`} aria-hidden="true" />{p.key === 'pro' ? 'Starter equipment kit on loan' : 'Warehouse equipment kit on loan'}</li>}
                  </ul>
                  <Link to={p.key === 'enterprise' ? '/contact?topic=shipper' : '/signup?role=shipper'} className={`mt-6 ${pro ? 'btn-gold' : 'btn-ghost'} w-full`} data-testid={`fs-plan-${p.key}`}>{p.key === 'starter' ? 'Start free' : p.key === 'pro' ? `Try Pro free${d?.trialDays ? ` for ${d.trialDays} days` : ''}` : 'Talk to us'}</Link>
                </div>
              )
            })}
            {!d && [0, 1, 2].map((i) => <div key={i} className="card-light h-64 animate-pulse" aria-hidden="true" />)}
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm text-text-muted" data-testid="fs-fee"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /> {feeTxt ? `On payments customers make through Ntemtem, a ${feeTxt} platform fee comes off before the money reaches your balance. ` : ''}No setup fee, no contract — cancel any time. Customers never pay Ntemtem.</p>
        </div>
      </section>

      {/* 8 · Questions shippers ask */}
      <section id="faq" className="scroll-mt-32 bg-surface-2/40 section-y">
        <div className="container-x grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4"><Eyebrow>Questions</Eyebrow><h2>What shippers ask us.</h2><p className="mt-3 text-text-muted">Something else? <Link to="/contact?topic=shipper" className="font-semibold text-gold-deep hover:underline">Talk to our partner team</Link>.</p></div>
          <div className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface lg:col-span-8" data-testid="fs-faq">
            {faqs.map(([q, a]) => (
              <details key={q} className="group px-6 py-1 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold focus-ring rounded">{q}<ChevronDown size={18} className="shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
                <p className="pb-5 text-text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 9 · Final CTA */}
      <section className="bg-partner text-[#FBF6EC]">
        <div className="container-x flex flex-col items-start justify-between gap-6 py-16 md:flex-row md:items-center">
          <div><h2>Ready to become an Ntemtem partner?</h2><p className="mt-2 text-lg text-[#D8D1C3]">Set up your lanes in minutes. {d?.trialDays ? `Start on Pro, free for ${d.trialDays} days.` : 'Start on Pro, free.'}</p></div>
          <Link to="/signup?role=shipper" className="btn-gold shrink-0">List your company <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      </section>

    </div>
  )
}
