import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, ChevronDown, ClipboardList, FileCheck2, Handshake, Minus, Plane, Radar, Scale, Ship, Truck } from 'lucide-react'
import { fadeUp, stagger, viewport } from '../lib/motion'
import { countries, faqs, shippers, testimonials } from '../lib/data'
import { Section, SectionHeader, ShipperCard, Avatar, VerifiedMark, Flag, Mark } from './ui'
import { congestionLabel, useCongestion } from '../lib/useCongestion'
import { useStore } from '../lib/store'

/* ---------- Destinations ---------- */
export function Destinations() {
  const cg = useCongestion()
  const { shippers: live } = useStore()
  const [lane, setLane] = useState<Record<string, { barrelUsd: number | null }>>({})
  useEffect(() => { fetch('/api/lanes/destinations').then((r) => r.json()).then((d: { destinations?: Record<string, { barrelUsd: number | null }> }) => setLane(d.destinations ?? {})).catch(() => {}) }, [])
  const servingCount = (code: string) => live.filter((s) => s.destinations.includes(code)).length
  return (
    <Section id="destinations" light>
      <SectionHeader light eyebrow="Destinations" title="Every major port and airport on the Gulf of Guinea" body="Pick a country to see typical transit times, then request quotes from shippers who run that lane every week." />
      <p className="mb-3 text-center text-xs text-ink-muted md:hidden">Swipe to see all seven countries →</p>
      <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-4 scrollbar-none md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-4">
        {countries.map((c) => (
          <motion.div key={c.code} variants={fadeUp} whileHover={{ y: -4 }} className="card-light flex w-[260px] shrink-0 snap-start flex-col p-5 md:w-auto">
            <Flag code={c.code} size={30} className="rounded-[4px]" />
            <h3 className="mt-3 text-ink">{c.name}</h3>
            <p className="mt-1 text-xs text-ink-muted">{c.ports[0]}{c.ports[1] ? ` · ${c.ports[1]}` : ''}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex items-center justify-between"><dt className="flex items-center gap-1.5 text-ink-muted"><Ship size={14} aria-hidden="true" />Ocean</dt><dd className="font-semibold text-ink">{c.oceanDays} d</dd></div>
              <div className="flex items-center justify-between"><dt className="flex items-center gap-1.5 text-ink-muted"><Plane size={14} aria-hidden="true" />Air</dt><dd className="font-semibold text-ink">{c.airDays} d</dd></div>
            </dl>
            {(() => { const n = servingCount(c.code), price = lane[c.code]?.barrelUsd; return (n > 0 || price) ? (
              <div className="mt-4 flex flex-wrap gap-1.5 text-xs" data-testid={`dest-facts-${c.code}`}>
                {n > 0 && <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink">{n} shipper{n === 1 ? '' : 's'}</span>}
                {price ? <span className="rounded-full bg-gold-soft px-2.5 py-1 font-semibold text-ink" title="Typical quoted price per barrel over the last 6 months">Barrel ≈ ${price}</span> : null}
              </div>) : null })()}
            {(() => { const l = cg?.enabled ? congestionLabel(cg.congestion[c.code]) : null; return l ? <p className={`mt-3 flex items-center gap-1.5 text-xs ${l.level === 'heavy' ? 'text-danger' : l.level === 'busy' ? 'text-gold-deep' : 'text-ink-muted'}`}><span className={`h-1.5 w-1.5 rounded-full ${l.level === 'heavy' ? 'bg-danger' : l.level === 'busy' ? 'bg-gold-deep' : 'bg-teal'}`} aria-hidden="true" />Port now: {l.text}</p> : null })()}
            <Link to={`/quote?destination=${c.code}`} className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-gold-deep hover:underline focus-ring rounded">Get quotes <ArrowRight size={15} aria-hidden="true" /></Link>
          </motion.div>
        ))}
        <motion.div variants={fadeUp} className="flex w-[260px] shrink-0 snap-start flex-col justify-between rounded-[var(--radius-lg)] border border-bg bg-bg p-5 text-text md:w-auto">
          <div>
            <p className="eyebrow">More lanes</p>
            <h3 className="mt-3 text-text">Don’t see your country?</h3>
            <p className="mt-2 text-sm text-text-muted">Shippers on Ntemtem also serve Benin, Guinea, Gambia, Cameroon and Burkina Faso via Lomé and Tema.</p>
          </div>
          <Link to="/quote" className="btn-gold mt-5 !min-h-10 text-sm">Ask for a quote</Link>
        </motion.div>
      </div>
    </Section>
  )
}

/* ---------- How it works ---------- */
const steps = [
  { icon: ClipboardList, title: 'Post your shipment', body: 'Tell us what you’re sending, from where, to which country, and whether you want pickup and door delivery. Takes two minutes, no account required.' },
  { icon: Scale, title: 'Compare real quotes', body: 'Matching shippers reply with itemised quotes, transit times and what’s included. See their verification status, ratings and on-time history side by side.' },
  { icon: Radar, title: 'Pay safely and track', body: 'Accept the quote you like and pay through Ntemtem — the shipper is paid once they confirm. Follow every step to the door, and your family gets WhatsApp updates too.' },
]
export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHeader eyebrow="How it works" title="From your doorstep to theirs in three steps" />
      <ol className="grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.li key={s.title} variants={fadeUp} className="card-dark relative p-7">
            <span className="absolute right-6 top-5 font-heading text-5xl font-extrabold text-gold/70" aria-hidden="true">0{i + 1}</span>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold-deep"><s.icon size={22} aria-hidden="true" /></span>
            <h3 className="mt-5 text-text">{s.title}</h3>
            <p className="mt-2 text-text-muted">{s.body}</p>
          </motion.li>
        ))}
      </ol>
    </Section>
  )
}

/* ---------- Family updates (WhatsApp / SMS) ---------- */
const milestones: [string, string][] = [['Sailed', 'It’s on the water, with the expected arrival date'], ['Landed', 'It’s at the port and going through customs'], ['Ready', 'Where to collect it, with a pickup code'], ['Delivered', 'They tap to confirm they have it']]
export function FamilyUpdates() {
  return (
    <section id="updates" className="theme-dark section-y bg-bg text-text" data-testid="family-updates">
      <motion.div className="container-x grid items-center gap-12 lg:grid-cols-12" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
        <div className="lg:col-span-6">
          <motion.p variants={fadeUp} className="eyebrow mb-3">For the family back home</motion.p>
          <motion.h2 variants={fadeUp}>They know before they have to ask.</motion.h2>
          <motion.p variants={fadeUp} className="mt-4 max-w-xl text-lg text-text-muted">Whoever is receiving your package gets a WhatsApp message — or a text — at every step. No app, no account, no calling you to ask where it is.</motion.p>
          <ol className="mt-8 grid gap-3 sm:grid-cols-2">
            {milestones.map(([t, b], i) => (
              <motion.li key={t} variants={fadeUp} className="flex gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${i === 3 ? 'bg-teal text-bg' : 'bg-gold/20 text-gold'}`}>{i + 1}</span>
                <span><strong className="block">{t}</strong><span className="text-sm text-text-muted">{b}</span></span>
              </motion.li>
            ))}
          </ol>
        </div>
        <motion.div variants={fadeUp} className="flex justify-center lg:col-span-6">
          <div className="w-full max-w-[340px] rounded-[2.5rem] border-[10px] border-[#202B48] bg-[#EFE9DE] p-0 shadow-[0_40px_80px_-30px_rgba(0,0,0,.7)]" aria-label="Example message to the receiver">
            <div className="flex items-center gap-3 rounded-t-[1.9rem] bg-white px-4 pb-3 pt-5">
              <Mark size={36} />
              <div className="leading-tight"><p className="text-sm font-bold text-ink">Ntemtem</p><p className="text-[11px] text-ink-muted">Business account</p></div>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-ink-muted">Example</span>
            </div>
            <div className="space-y-2.5 px-3 py-4 text-[13.5px] leading-snug text-ink">
              <div className="max-w-[88%] rounded-[4px_14px_14px_14px] bg-white px-3 py-2 shadow-sm">Akwaaba, Ama! Your package from Kofi is on its way on the MSC Lagos, arriving around 14 Nov. Ref NT-4821. Follow it: ntemtem.com/r/…</div>
              <div className="max-w-[88%] rounded-[4px_14px_14px_14px] bg-white px-3 py-2 shadow-sm">Akwaaba, Ama! Your package NT-4821 has landed at Tema and is going through customs. We’ll message you the moment it’s ready.</div>
              <div className="max-w-[88%] rounded-[4px_14px_14px_14px] bg-white px-3 py-2 shadow-sm"><strong>Good news, Ama</strong> — your package NT-4821 is ready for collection at Gold Coast Freight, Kumasi. Bring your ID and this ref.</div>
              <div className="ml-auto max-w-[60%] rounded-[14px_4px_14px_14px] bg-[#D8EFE2] px-3 py-2 text-right shadow-sm">Medaase! I’ll come tomorrow 🙏🏾</div>
            </div>
            <p className="rounded-b-[1.9rem] bg-white/60 px-4 py-2.5 text-center text-[11px] text-ink-muted">WhatsApp or SMS · sent automatically</p>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

/* ---------- Features bento ---------- */
const features = [
  { icon: VerifiedMark, title: 'Verified shippers, clearly marked', body: 'Business registration, licence, insurance and warehouse checked before a company gets the Ntemtem Verified badge — so you always know who’s been vetted.', span: 'md:col-span-3', accent: true },
  { icon: Scale, title: 'Transparent, itemised quotes', body: 'Freight, pickup, delivery, insurance and destination fees listed separately. No “call for price”.', span: 'md:col-span-3' },
  { icon: Truck, title: 'Door to door, barrel to container', body: 'Pickup across the US, UK, Canada and Europe; delivery to Accra, Kumasi, Lagos, Abuja, Monrovia, Lomé and more. Boxes and barrels, cars by RoRo, or your own 20/40ft container.', span: 'md:col-span-3' },
  { icon: FileCheck2, title: 'Customs guidance', body: 'Destination-specific document checklists (Ghana Customs, Nigeria SONCAP, Liberia Freeport) and a duty estimate before you commit.', span: 'md:col-span-3' },
]
export function Features() {
  return (
    <Section id="features" light>
      <SectionHeader light eyebrow="Why Ntemtem" title="Built for the way West Africa actually ships" body="Most freight to Africa is still booked through word of mouth and WhatsApp. We keep the relationships and add the guardrails." />
      <div className="grid gap-5 md:grid-cols-6">
        {features.map((f) => (
          <motion.div key={f.title} variants={fadeUp} whileHover={{ y: -4 }} className={`${f.accent ? 'bg-bg text-text border-bg' : 'card-light'} rounded-[var(--radius-lg)] border p-7 ${f.span}`}>
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${f.accent ? 'bg-gold text-on-accent' : 'bg-gold/15 text-gold-deep'}`}><f.icon size={21} aria-hidden="true" /></span>
            <h3 className={`mt-5 ${f.accent ? 'text-text' : 'text-ink'}`}>{f.title}</h3>
            <p className={`mt-2 ${f.accent ? 'text-text-muted' : 'text-ink-muted'}`}>{f.body}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}

/* ---------- For shippers ---------- */
export function ForShippers() {
  const perks = ['Qualified leads for the lanes you actually run', 'Verification badge that closes deals', 'Quote from your phone in under a minute', 'Reviews only from real, booked customers', 'Tracking page branded with your company']
  return (
    <Section id="shippers">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <motion.p variants={fadeUp} className="eyebrow mb-3">For shipping companies</motion.p>
          <motion.h2 variants={fadeUp}>Stop chasing leads in Facebook groups.</motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-text-muted">Ntemtem sends you shipment requests that match your origins, destinations and cargo types. Reply with a quote, win the booking, get paid directly by the customer.</motion.p>
          <ul className="mt-6 space-y-3">
            {perks.map((p) => (
              <motion.li key={p} variants={fadeUp} className="flex items-start gap-3 text-text"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep"><Check size={14} aria-hidden="true" /></span>{p}</motion.li>
            ))}
          </ul>
          <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/signup?role=shipper" className="btn-gold w-full sm:w-auto">List your company <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
            <Link to="/for-shippers" className="btn-ghost">See all tools for shippers</Link>
          </motion.div>
        </div>
        <motion.div variants={fadeUp} className="card-dark p-6 md:p-8">
          <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-text-muted">What a partner sees · new requests on their lanes</p><span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Example</span></div>
          <ul className="mt-4 divide-y divide-border">
            {[
              ['4 barrels → Kumasi, Ghana', 'Ocean · pickup requested', ''],
              ['2019 Toyota Highlander → Tema', 'Ocean · title in hand', ''],
              ['3 pallets medical → Lagos', 'Air · urgent', ''],
              ['20ft FCL → Lomé', 'Ocean · commercial', ''],
            ].map(([a, b, c]) => (
              <li key={a} className="flex items-center justify-between gap-4 py-3.5">
                <div><p className="text-[15px] font-medium text-text">{a}</p><p className="text-xs text-text-muted">{b}</p></div>
                <div className="text-right"><p className="text-xs text-text-muted">{c}</p><span className="mt-1 inline-block rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">New</span></div>
              </li>
            ))}
          </ul>
          <Link to="/for-shippers" className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-5 text-sm font-semibold text-gold-deep hover:underline focus-ring rounded" data-testid="home-see-shipper-tools">See everything partners get — containers, warehouse, payouts and more <ArrowRight size={16} aria-hidden="true" /></Link>
        </motion.div>
      </div>
    </Section>
  )
}

/* ---------- Featured shippers ---------- */
export function FeaturedShippers() {
  // Live directory (logos, badges, real ratings); the bundled list is only a fallback while it loads.
  const { shippers: live } = useStore()
  const pool = live.length ? live : shippers
  const featured = [...pool].sort((a, b) => Number(b.plan === 'enterprise') - Number(a.plan === 'enterprise') || Number(b.verified) - Number(a.verified) || b.rating - a.rating || b.reviews - a.reviews).slice(0, 3)
  return (
    <Section id="featured" light>
      <SectionHeader light eyebrow="Shipper directory" title="Companies customers book again" body="Ratings come only from customers who booked through Ntemtem." />
      <div className="grid gap-6 md:grid-cols-3">
        {featured.map((s) => <ShipperCard key={s.id} s={s} light />)}
      </div>
      <motion.div variants={fadeUp} className="mt-10 text-center">
        <Link to="/shippers" className="btn-light">{live.length ? `Browse all ${live.length} shippers` : 'Browse all shippers'} <ArrowRight size={18} aria-hidden="true" /></Link>
      </motion.div>
    </Section>
  )
}

/* ---------- Testimonials ---------- */
export function Testimonials() {
  const hues = ['#F5B82E', '#6CC3DD', '#7DD3FC']
  return (
    <Section id="testimonials">
      <SectionHeader eyebrow="Customer stories" title="Trusted by families and businesses shipping home" />
      <div className="grid gap-6 md:grid-cols-3">
        {testimonials.map((t, i) => (
          <motion.figure key={t.name} variants={fadeUp} className="card-dark flex flex-col p-7">
            <blockquote className="flex-1 text-[17px] leading-relaxed text-text">“{t.quote}”</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <Avatar initials={t.initials} hue={hues[i]} size={44} />
              <div><p className="font-semibold text-text">{t.name}</p><p className="text-xs text-text-muted">{t.role}</p></div>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </Section>
  )
}

/* ---------- Pricing ---------- */
// Kept in line with server/features.ts PLANS; prices are refreshed from /api/pricing.
const plans = [
  { key: 'starter', name: 'Starter', price: 0, per: '/month', tag: 'For new or small forwarders', features: ['Directory listing', 'Customer requests, quotes & messages', 'Shipments, tracking & invoices', 'Up to 3 team members'], missing: ['Branded page', 'Full analytics'] },
  { key: 'pro', name: 'Pro', price: 149, per: '/month', tag: 'Growing forwarders', highlight: true, features: ['Everything in Starter', 'Branded page', 'Full analytics', 'Win-back campaigns', 'Container load planner & accounting export', 'Up to 15 team members'], missing: [] },
  { key: 'enterprise', name: 'Enterprise', price: 499, per: '/month', tag: 'Multi-lane operators', features: ['Everything in Pro', 'Webhooks', 'Unlimited team members', 'Featured placement in the directory'], missing: [] },
]
const senderPerks = ['Unlimited quote requests', 'Compare verified shippers side by side', 'Payment protection until the shipper confirms', 'Live tracking, with WhatsApp updates for family', 'Duty estimator and lane prices']
export function Pricing() {
  const [live, setLive] = useState<Record<string, number>>({})
  const [trialDays, setTrialDays] = useState<number | null>(null)
  useEffect(() => { fetch('/api/pricing').then((r) => r.json()).then((d: { plans?: { key: string; priceUsd: number }[]; trialDays?: number }) => { setLive(Object.fromEntries((d.plans ?? []).map((p) => [p.key, p.priceUsd]))); setTrialDays(d.trialDays ?? null) }).catch(() => {}) }, [])
  const trial = trialDays ? `${trialDays}-day free trial` : 'Free trial'
  return (
    <Section id="pricing" light>
      <SectionHeader light eyebrow="Pricing" title="Free for senders. Always." body="Requesting quotes, comparing shippers, booking and tracking never cost you a cent. Shipping companies pay a simple monthly plan." />

      {/* For senders — the headline offer */}
      <motion.div variants={fadeUp} className="theme-dark relative overflow-hidden rounded-[var(--radius-lg)] bg-bg p-7 text-text md:p-10" data-testid="pricing-senders">
        <div className="grid items-center gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-gold">For senders</p>
            <p className="mt-3 flex items-baseline gap-3"><span className="font-heading text-7xl font-extrabold leading-none text-gold md:text-8xl">$0</span><span className="text-lg font-semibold text-text">free, always</span></p>
            <p className="mt-3 text-sm text-text-muted">No sign-up needed to see prices. You only pay the shipper you choose — never Ntemtem.</p>
          </div>
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:col-span-5">
            {senderPerks.map((f) => <li key={f} className="flex gap-2.5 text-[15px]"><Check size={18} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />{f}</li>)}
          </ul>
          <div className="flex flex-col gap-3 lg:col-span-3">
            <Link to="/quote" className="btn-gold">Get free quotes <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link to="/track" className="btn-ghost">Track a shipment</Link>
          </div>
        </div>
      </motion.div>

      {/* For shipping companies */}
      <motion.div variants={fadeUp} className="mt-16 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-ink"><span className="h-2.5 w-2.5 rounded-[3px] bg-partner" aria-hidden="true" />For shipping companies</p>
          <h3 className="mt-2 !text-[clamp(1.5rem,2.6vw,2rem)] text-ink">Simple plans. Start on Pro, free.</h3>
          <p className="mt-1 text-sm text-ink-muted">A small platform fee applies only when a customer pays you through Ntemtem’s escrow.</p>
        </div>
        <Link to="/for-shippers" className="text-sm font-semibold text-gold-deep hover:underline focus-ring rounded">See everything partners get →</Link>
      </motion.div>
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <motion.div key={p.name} variants={fadeUp} whileHover={{ y: -4 }} className={`relative flex flex-col rounded-[var(--radius-lg)] border p-7 ${p.highlight ? 'border-partner bg-partner text-[#FBF6EC] shadow-[var(--shadow-dark)]' : 'card-light'}`}>
            {p.highlight && <span className="absolute -top-3 left-7 rounded-full bg-gold px-3 py-1 text-xs font-bold text-on-accent">{trial}</span>}
            <h3 className={p.highlight ? 'text-[#FBF6EC]' : 'text-ink'}>{p.name}</h3>
            <p className={`text-sm ${p.highlight ? 'text-[#C9C1B1]' : 'text-ink-muted'}`}>{p.highlight ? 'Growing forwarders' : p.tag}</p>
            <p className="mt-4 flex items-baseline gap-1"><span className={`font-heading text-5xl font-bold ${p.highlight ? 'text-gold' : 'text-ink'}`}>${live[p.key] ?? p.price}</span><span className={p.highlight ? 'text-[#C9C1B1]' : 'text-ink-muted'}>{p.per}</span></p>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {p.features.map((f) => <li key={f} className={`flex gap-2 ${p.highlight ? 'text-[#FBF6EC]' : 'text-ink'}`}><Check size={16} className={`mt-0.5 shrink-0 ${p.highlight ? 'text-gold' : 'text-gold-deep'}`} aria-hidden="true" />{f}</li>)}
              {p.missing.map((f) => <li key={f} className="flex gap-2 text-ink-muted/70"><Minus size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{f}</li>)}
            </ul>
            <Link to="/signup?role=shipper" className={`mt-7 ${p.highlight ? 'btn-gold' : 'btn-light'}`}>{p.price === 0 ? 'Start free' : p.highlight ? `Try ${p.name} free` : `Choose ${p.name}`}</Link>
          </motion.div>
        ))}
      </div>
      <motion.p variants={fadeUp} className="mt-8 text-center text-sm text-ink-muted"><Link to="/pricing?for=shippers" className="font-semibold text-gold-deep hover:underline focus-ring rounded">Compare every plan feature →</Link></motion.p>
    </Section>
  )
}

/* ---------- FAQ ---------- */
export function FAQ() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionHeader align="left" eyebrow="FAQ" title="Questions people ask before their first shipment" />
          <motion.p variants={fadeUp} className="-mt-8 text-text-muted">Still unsure? Search the <Link to="/help" className="text-gold-deep hover:underline">help centre</Link> or <Link to="/contact" className="text-gold-deep hover:underline">contact us</Link> — a real person replies.</motion.p>
        </div>
        <div className="lg:col-span-8">
          {faqs.map((f, i) => (
            <motion.div key={f.q} variants={fadeUp} className="border-b border-border">
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`faq-${i}`} className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[17px] font-semibold text-text hover:text-gold-deep focus-ring rounded">
                {f.q}
                <motion.span animate={{ rotate: open === i ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-text-muted"><ChevronDown size={20} aria-hidden="true" /></motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div id={`faq-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                    <p className="pb-5 text-text-muted">{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/50 p-4" data-testid="faq-more"><p className="text-sm"><strong>More answers</strong> <span className="text-text-muted">— paying, documents, weights, duty and collecting your goods.</span></p><div className="flex gap-2"><Link to="/help" className="btn-ghost !min-h-10 !px-4 text-sm">Help centre</Link><Link to="/contact" className="btn-gold !min-h-10 !px-4 text-sm">Contact us</Link></div></motion.div>
        </div>
      </div>
    </Section>
  )
}

/* ---------- Final CTA ---------- */
export function FinalCTA() {
  return (
    <section className="bg-bg pb-20 md:pb-28">
      <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: '-100px' }} variants={stagger} className="container-x">
        <motion.div variants={fadeUp} className="theme-dark relative overflow-hidden rounded-[var(--radius-lg)] bg-bg px-6 py-14 text-text shadow-[var(--shadow-dark)] md:px-14 md:py-20">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-gold/20 blur-3xl" />
            <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-teal/10 blur-3xl" />
          </div>
          <Handshake className="absolute -right-6 -top-6 h-48 w-48 text-gold/15" aria-hidden="true" />
          <div className="relative grid items-center gap-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <p className="eyebrow mb-3">Get started</p>
              <h2>Ready to ship to West Africa?</h2>
              <p className="mt-3 max-w-xl text-lg text-text-muted">Post your shipment now and have verified quotes in your inbox by tomorrow. Shipping companies: <Link to="/for-shippers" className="font-semibold text-gold-deep hover:underline">see what Ntemtem does for you</Link>.</p>
            </div>
            <div className="flex flex-col gap-3 md:col-span-4 md:items-end">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/quote" className="btn-gold w-full md:w-auto">Get free quotes <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
              <Link to="/signup?role=shipper" className="btn-ghost w-full md:w-auto">List your company</Link>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
