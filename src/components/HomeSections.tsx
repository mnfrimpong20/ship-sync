import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, BadgeCheck, Car, Check, ChevronDown, ClipboardList, Container, FileCheck2, Handshake, MapPinned, Minus, Plane, Radar, Scale, Ship, Truck, Users } from 'lucide-react'
import { fadeUp, stagger } from '../lib/motion'
import { countries, faqs, shippers, testimonials } from '../lib/data'
import { Section, SectionHeader, ShipperCard, Avatar } from './ui'
import { congestionLabel, useCongestion } from '../lib/useCongestion'

/* ---------- Destinations ---------- */
export function Destinations() {
  const cg = useCongestion()
  return (
    <Section id="destinations" light>
      <SectionHeader light eyebrow="Destinations" title="Every major port and airport on the Gulf of Guinea" body="Pick a country to see typical transit times, then request quotes from shippers who run that lane every week." />
      <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-4 scrollbar-none md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-4">
        {countries.map((c) => (
          <motion.div key={c.code} variants={fadeUp} whileHover={{ y: -4 }} className="card-light flex w-[260px] shrink-0 snap-start flex-col p-5 md:w-auto">
            <span className="text-3xl" aria-hidden="true">{c.flag}</span>
            <h3 className="mt-3 text-ink">{c.name}</h3>
            <p className="mt-1 text-xs text-ink-muted">{c.ports[0]}{c.ports[1] ? ` · ${c.ports[1]}` : ''}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex items-center justify-between"><dt className="flex items-center gap-1.5 text-ink-muted"><Ship size={14} aria-hidden="true" />Ocean</dt><dd className="font-semibold text-ink">{c.oceanDays} d</dd></div>
              <div className="flex items-center justify-between"><dt className="flex items-center gap-1.5 text-ink-muted"><Plane size={14} aria-hidden="true" />Air</dt><dd className="font-semibold text-ink">{c.airDays} d</dd></div>
            </dl>
            {(() => { const l = cg?.enabled ? congestionLabel(cg.congestion[c.code]) : null; return l ? <p className={`mt-3 flex items-center gap-1.5 text-xs ${l.level === 'heavy' ? 'text-danger' : l.level === 'busy' ? 'text-gold-deep' : 'text-ink-muted'}`}><span className={`h-1.5 w-1.5 rounded-full ${l.level === 'heavy' ? 'bg-danger' : l.level === 'busy' ? 'bg-gold-deep' : 'bg-teal'}`} aria-hidden="true" />Port now: {l.text}</p> : null })()}
            <Link to={`/quote?destination=${c.code}`} className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-gold-deep hover:underline focus-ring rounded">Get quotes <ArrowRight size={15} aria-hidden="true" /></Link>
          </motion.div>
        ))}
        <motion.div variants={fadeUp} className="flex w-[260px] shrink-0 snap-start flex-col justify-between rounded-[var(--radius-lg)] border border-bg bg-bg p-5 text-text md:w-auto">
          <div>
            <p className="eyebrow">More lanes</p>
            <h3 className="mt-3 text-text">Don’t see your country?</h3>
            <p className="mt-2 text-sm text-text-muted">Shippers on Ship Sync also serve Benin, Guinea, Gambia, Cameroon and Burkina Faso via Lomé and Tema.</p>
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
  { icon: Radar, title: 'Book and track', body: 'Accept the quote you like. Your shipment gets a Ship Sync reference and a live timeline from pickup to delivery at the door in Accra, Lagos or Monrovia.' },
]
export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHeader eyebrow="How it works" title="From your doorstep to theirs in three steps" />
      <ol className="grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.li key={s.title} variants={fadeUp} className="card-dark relative p-7">
            <span className="absolute right-6 top-5 font-heading text-5xl font-bold text-gold/15" aria-hidden="true">0{i + 1}</span>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold"><s.icon size={22} aria-hidden="true" /></span>
            <h3 className="mt-5 text-text">{s.title}</h3>
            <p className="mt-2 text-text-muted">{s.body}</p>
          </motion.li>
        ))}
      </ol>
    </Section>
  )
}

/* ---------- Features bento ---------- */
const features = [
  { icon: BadgeCheck, title: 'Verified shippers only', body: 'Business registration, forwarder licence, insurance certificate and warehouse address checked before the badge appears.', span: 'md:col-span-4', accent: true },
  { icon: Scale, title: 'Transparent, itemised quotes', body: 'Freight, pickup, delivery, insurance and destination fees listed separately. No “call for price”.', span: 'md:col-span-2' },
  { icon: Truck, title: 'Door-to-door', body: 'Pickup in 40+ US, UK, Canadian and EU cities. Delivery to Accra, Kumasi, Lagos, Abuja, Monrovia, Lomé and more.', span: 'md:col-span-2' },
  { icon: Car, title: 'Vehicles & containers', body: 'RoRo and containerised vehicle shipping with title handling and duty estimates before you commit.', span: 'md:col-span-2' },
  { icon: MapPinned, title: 'Live tracking', body: 'One reference number, one timeline — from pickup through port, sailing, customs and delivery.', span: 'md:col-span-2' },
  { icon: FileCheck2, title: 'Customs guidance', body: 'Destination-specific document checklists (Ghana Customs, Nigeria SONCAP, Liberia Freeport) attached to every booking.', span: 'md:col-span-3' },
  { icon: Container, title: 'Barrels to full containers', body: 'Groupage barrels and boxes, pallets, LCL, or your own 20/40ft FCL — the same platform for a family and a business.', span: 'md:col-span-3' },
]
export function Features() {
  return (
    <Section id="features" light>
      <SectionHeader light eyebrow="Why Ship Sync" title="Built for the way West Africa actually ships" body="Most freight to Africa is still booked through word of mouth and WhatsApp. We keep the relationships and add the guardrails." />
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
          <motion.p variants={fadeUp} className="mt-4 text-lg text-text-muted">Ship Sync sends you shipment requests that match your origins, destinations and cargo types. Reply with a quote, win the booking, get paid directly by the customer.</motion.p>
          <ul className="mt-6 space-y-3">
            {perks.map((p) => (
              <motion.li key={p} variants={fadeUp} className="flex items-start gap-3 text-text"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"><Check size={14} aria-hidden="true" /></span>{p}</motion.li>
            ))}
          </ul>
          <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/signup?role=shipper" className="btn-gold w-full sm:w-auto">List your company <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
            <a href="#pricing" className="btn-ghost">See shipper pricing</a>
          </motion.div>
        </div>
        <motion.div variants={fadeUp} className="card-dark p-6 md:p-8">
          <p className="text-sm font-medium text-text-muted">Live lead feed · Newark, NJ warehouse</p>
          <ul className="mt-4 divide-y divide-border">
            {[
              ['4 barrels → Kumasi, Ghana', 'Ocean · pickup requested', '12 min ago'],
              ['2019 Toyota Highlander → Tema', 'Ocean · title in hand', '41 min ago'],
              ['3 pallets medical → Lagos', 'Air · urgent', '2 h ago'],
              ['20ft FCL → Lomé', 'Ocean · commercial', '5 h ago'],
            ].map(([a, b, c]) => (
              <li key={a} className="flex items-center justify-between gap-4 py-3.5">
                <div><p className="text-[15px] font-medium text-text">{a}</p><p className="text-xs text-text-muted">{b}</p></div>
                <div className="text-right"><p className="text-xs text-text-muted">{c}</p><span className="mt-1 inline-block rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">New</span></div>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-5 text-center">
            {[['38', 'Bookings / mo'], ['4.8', 'Rating'], ['2h', 'Avg. response']].map(([v, l]) => (
              <div key={l}><p className="font-heading text-2xl font-bold text-gold">{v}</p><p className="text-xs text-text-muted">{l}</p></div>
            ))}
          </div>
        </motion.div>
      </div>
    </Section>
  )
}

/* ---------- Featured shippers ---------- */
export function FeaturedShippers() {
  const featured = shippers.filter((s) => ['gold-coast-freight', 'atlantic-bridge', 'sahel-air-cargo'].includes(s.id))
  return (
    <Section id="featured" light>
      <SectionHeader light eyebrow="Shipper directory" title="Companies customers book again" body="Ratings come only from customers who booked through Ship Sync." />
      <div className="grid gap-6 md:grid-cols-3">
        {featured.map((s) => <ShipperCard key={s.id} s={s} light />)}
      </div>
      <motion.div variants={fadeUp} className="mt-10 text-center">
        <Link to="/shippers" className="btn-light">Browse all {shippers.length * 15}+ shippers <ArrowRight size={18} aria-hidden="true" /></Link>
      </motion.div>
    </Section>
  )
}

/* ---------- Testimonials ---------- */
export function Testimonials() {
  const hues = ['#E3B54A', '#2DD4BF', '#7DD3FC']
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
const plans = [
  { name: 'Starter', price: 0, per: '/month', tag: 'For new or small forwarders', features: ['Directory listing', 'Up to 15 quote responses / month', 'Basic verification badge', 'Email lead alerts'], missing: ['Priority placement', 'Branded tracking page'] },
  { name: 'Pro', price: 149, per: '/month', tag: 'Most popular', highlight: true, features: ['Everything in Starter', 'Unlimited quote responses', 'Priority placement in matches', 'Branded tracking page', 'Analytics dashboard', 'WhatsApp & SMS lead alerts'], missing: [] },
  { name: 'Enterprise', price: 499, per: '/month', tag: 'Multi-lane operators', features: ['Everything in Pro', 'Multiple warehouses & teams', 'API & TMS integration', 'Dedicated account manager', 'Featured on destination pages'], missing: [] },
]
export function Pricing() {
  return (
    <Section id="pricing" light>
      <SectionHeader light eyebrow="Pricing" title="Free for customers. Simple plans for shippers." body="Customers never pay Ship Sync. Shippers pay a flat monthly fee — no commission on your bookings." />
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <motion.div key={p.name} variants={fadeUp} whileHover={{ y: -4 }} className={`relative flex flex-col rounded-[var(--radius-lg)] border p-7 ${p.highlight ? 'border-gold bg-bg text-text shadow-[var(--shadow-dark)]' : 'card-light'}`}>
            {p.highlight && <span className="absolute -top-3 left-7 rounded-full bg-gold px-3 py-1 text-xs font-bold text-on-accent">{p.tag}</span>}
            <h3 className={p.highlight ? 'text-text' : 'text-ink'}>{p.name}</h3>
            {!p.highlight && <p className="text-sm text-ink-muted">{p.tag}</p>}
            <p className="mt-4 flex items-baseline gap-1"><span className={`font-heading text-5xl font-bold ${p.highlight ? 'text-gold' : 'text-ink'}`}>${p.price}</span><span className={p.highlight ? 'text-text-muted' : 'text-ink-muted'}>{p.per}</span></p>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {p.features.map((f) => <li key={f} className={`flex gap-2 ${p.highlight ? 'text-text' : 'text-ink'}`}><Check size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />{f}</li>)}
              {p.missing.map((f) => <li key={f} className="flex gap-2 text-ink-muted/70"><Minus size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{f}</li>)}
            </ul>
            <Link to="/signup?role=shipper" className={`mt-7 ${p.highlight ? 'btn-gold' : 'btn-light'}`}>{p.price === 0 ? 'Start free' : `Choose ${p.name}`}</Link>
          </motion.div>
        ))}
      </div>
      <motion.p variants={fadeUp} className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-ink-muted"><Users size={16} aria-hidden="true" /> Customers: requesting quotes, booking and tracking is always free.</motion.p>
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
          <motion.p variants={fadeUp} className="-mt-8 text-text-muted">Still unsure? Email <a href="mailto:hello@shipsync.africa" className="text-gold hover:underline">hello@shipsync.africa</a> — a real person replies.</motion.p>
        </div>
        <div className="lg:col-span-8">
          {faqs.map((f, i) => (
            <motion.div key={f.q} variants={fadeUp} className="border-b border-border">
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`faq-${i}`} className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[17px] font-semibold text-text hover:text-gold focus-ring rounded">
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
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-[var(--radius-lg)] bg-[linear-gradient(120deg,#E3B54A,#B8891F_60%,#8A6516)] px-6 py-14 text-ink md:px-14 md:py-20">
          <Handshake className="absolute -right-6 -top-6 h-48 w-48 text-ink/10" aria-hidden="true" />
          <div className="relative grid items-center gap-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <h2 className="text-ink">Ready to ship to West Africa?</h2>
              <p className="mt-3 max-w-xl text-lg text-ink/80">Post your shipment now and have verified quotes in your inbox by tomorrow. Shippers: join 120+ companies already winning bookings.</p>
            </div>
            <div className="flex flex-col gap-3 md:col-span-4 md:items-end">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/quote" className="btn w-full bg-ink text-text hover:bg-surface-2 md:w-auto">Get free quotes <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
              <Link to="/signup?role=shipper" className="btn w-full border border-ink/30 text-ink hover:bg-ink/10 md:w-auto">List your company</Link>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
