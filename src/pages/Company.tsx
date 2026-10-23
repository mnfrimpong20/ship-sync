import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { LifeBuoy, Check, Globe2, Mail, MapPin, MessageCircle, Phone, Search, ShieldCheck, Users } from 'lucide-react'
import { setPageTitle, siteApi, statReady, useSiteConfig, type ContactInput, type SiteStats } from '../lib/site'
import { fadeUp, stagger } from '../lib/motion'
import { Logo } from '../components/ui'
import { HELP } from '../lib/help'
import { useStore } from '../lib/store'

const err = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)

/* ================= About ================= */
export function AboutPage() {
  const [st, setSt] = useState<SiteStats | null>(null); const cfg = useSiteConfig()
  useEffect(() => { siteApi.stats().then(setSt).catch(() => {}) }, [])
  const values: [string, string][] = [
    ['Verified, or not listed', 'Every shipper on Ntemtem has had its business registration, licence and insurance checked before the badge appears. No badge, no bookings.'],
    ['Money held in escrow', 'Customers pay Ntemtem, not the shipper. Funds are released only when goods are on their way — and refunded if they are not.'],
    ['One timeline, no WhatsApp archaeology', 'Pickup, port, sailing, customs and delivery on one page, with photos and documents attached — for the sender and the receiver.'],
    ['Built for how West Africa actually ships', 'Barrels and boxes for families, vehicles for returning residents, containers for traders, and sourcing from China, the UK and the USA for shops that need stock.'],
  ]
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-3xl">
          <motion.p variants={fadeUp} className="eyebrow mb-2">About Ntemtem</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.5vw,3.4rem)]">The marketplace for freight to West Africa.</motion.h1>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-text-muted">Most freight to Ghana, Nigeria and their neighbours is still booked through word of mouth: a cousin's forwarder, a number on a flyer, a WhatsApp group. It works until it doesn't — a barrel that sits at Tema for six weeks, a car with the wrong paperwork, a deposit paid to someone who stops answering. Ntemtem keeps the relationships and adds the guardrails.</motion.p>
          <motion.p variants={fadeUp} className="mt-4 text-text-muted">We are a US company with sourcing teams on the ground in China (Guangzhou, Shenzhen and Yiwu), the UK and the USA. Customers post a shipment once and verified shippers compete for it with itemised quotes; the customer picks, pays into escrow, and follows the shipment to the door. For businesses that need stock, our own China team sources, buys, inspects and ships — one price, one timeline.</motion.p>
        </motion.div>
        {st && <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4" data-testid="about-stats">
          {([[statReady.verifiedShippers(st) ? st.verifiedShippers : null, 'verified shippers'], [st.destinations, 'West African countries'], [statReady.quotes(st) ? st.quotes : null, 'quotes issued'], [statReady.onTime(st) ? `${st.onTimePct}%` : null, 'average on-time']] as [string | number | null, string][]).filter(([v]) => v != null).map(([v, l]) => <motion.div key={String(l)} variants={fadeUp} className="card-dark p-4"><p className="font-heading text-3xl font-bold tabular-nums">{v}</p><p className="text-xs text-text-muted">{l}</p></motion.div>)}
        </motion.div>}
        {(cfg?.legalName || cfg?.address) && <p className="mx-auto mt-8 max-w-3xl rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm" data-testid="about-company"><b>Who runs Ntemtem:</b> {[cfg.legalName, cfg.address].filter(Boolean).join(' · ')}</p>}
        <section className="mx-auto mt-14 max-w-5xl">
          <p className="eyebrow mb-2 text-center">What we stand for</p>
          <div className="grid gap-4 md:grid-cols-2">{values.map(([t, b]) => <div key={t} className="card-dark p-5"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-text-muted">{b}</p></div>)}</div>
        </section>
        <section className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
          {[[Users, 'Customers', 'Families sending barrels home, returning residents shipping a car, churches and schools sending supplies, traders restocking a shop.'], [ShieldCheck, 'Shippers', 'Licensed forwarders and consolidators in the US, UK, Canada and Europe who run regular lanes to West Africa — and want qualified leads instead of Facebook comments.'], [Globe2, 'The China team', 'Ntemtem Sourcing: our own agents who find factories, place orders in Ntemtem’s name, inspect at the line and hand goods to the ocean leg.']].map(([I, t, b]) => { const Icon = I as typeof Users; return <div key={t as string} className="card-dark p-5"><Icon size={20} className="text-gold-deep" aria-hidden="true" /><p className="mt-2 font-semibold">{t as string}</p><p className="mt-1 text-sm text-text-muted">{b as string}</p></div> })}
        </section>
        <section className="mx-auto mt-14 max-w-3xl card-dark p-6 text-center">
          <h2 className="!text-2xl">Want to talk?</h2>
          <p className="mt-2 text-sm text-text-muted">Whether you are shipping one barrel, listing a forwarding company, or want us to source a product line — we answer within a business day.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3"><Link to="/contact" className="btn-gold">Contact us</Link><Link to="/signup?role=shipper" className="btn-ghost">List your company</Link></div>
        </section>
      </div>
    </div>
  )
}

/* ================= Contact ================= */
export function ContactPage() {
  const cfg = useSiteConfig()
  const { user } = useStore()
  const [sp] = useSearchParams()
  const linkTopic = sp.get('topic') as ContactInput['topic'] | null
  const [f, setF] = useState<ContactInput>({ name: '', email: '', phone: '', company: '', topic: linkTopic && ['quote', 'tracking', 'shipper', 'sourcing', 'partnership', 'other'].includes(linkTopic) ? linkTopic : 'quote', message: '', website: '' })
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await siteApi.contact(f); setDone(true) } catch (er) { setError(err(er, 'Could not send — email us directly.')) } finally { setBusy(false) } }
  const topics: [ContactInput['topic'], string][] = [['quote', 'Getting a quote'], ['tracking', 'A shipment I’m tracking'], ['shipper', 'Listing my shipping company'], ['sourcing', 'Sourcing from China, the UK or the USA'], ['partnership', 'Partnership / press'], ['other', 'Something else']]
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <div className="mx-auto max-w-5xl grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div>
            <p className="eyebrow mb-2">Contact</p><h1 className="!text-3xl md:!text-4xl">How can we help?</h1>
            <p className="mt-2 text-text-muted">Tell us what you are shipping or what you need, and the right person — US office, UK team or China team — replies within one business day.</p>
            {!done && (() => { const slugs = ({ quote: ['get-a-quote', 'paying', 'declaration'], tracking: ['track', 'collect', 'damage'], shipper: ['shipper-join', 'shipper-supplies', 'shipper-weigh'], sourcing: [], partnership: ['shipper-join'], other: ['damage', 'paying', 'receiver-pay'] } as Record<string, string[]>)[f.topic] ?? []; const arts = slugs.map((x) => HELP.find((a) => a.slug === x)).filter(Boolean) as typeof HELP; return arts.length ? (
              <div className="mt-6 rounded-2xl border border-border bg-surface/50 p-4" data-testid="contact-answers"><p className="text-sm font-semibold">Quick answers</p><ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{arts.map((a) => <li key={a.slug}><Link to={`/help/${a.slug}`} className="group flex items-start gap-2 text-sm"><LifeBuoy size={14} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span><span className="font-medium group-hover:underline">{a.title}</span><span className="block text-xs text-text-muted">{a.summary}</span></span></Link></li>)}</ul><p className="mt-2 text-xs text-text-muted">Not it? Send us a message below{cfg?.whatsappUrl ? <> or <a href={cfg.whatsappUrl} target="_blank" rel="noreferrer" className="text-gold-deep hover:underline">chat on WhatsApp</a></> : ''} — {user ? <>or <Link to="/support?new=1" className="text-gold-deep hover:underline">open a support ticket</Link> to follow it in your account</> : 'we reply by email'}.</p></div>
            ) : null })()}
            {done ? <div className="card-dark mt-6 p-6" data-testid="contact-done"><p className="inline-flex items-center gap-2 font-semibold text-teal"><Check size={16} aria-hidden="true" /> Message sent</p><p className="mt-2 text-sm text-text-muted">Thanks {f.name.split(' ')[0]} — we will reply to {f.email}. If it is about a live shipment, the tracking page is the fastest place to see what is happening right now.</p><div className="mt-4 flex gap-2"><Link to="/track" className="btn-ghost !min-h-9 text-sm">Track a shipment</Link><Link to="/quote" className="btn-gold !min-h-9 text-sm">Get a quote</Link></div></div> : (
              <form onSubmit={submit} className="card-dark mt-6 grid gap-4 p-6" data-testid="contact-form">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm"><span className="font-semibold">Your name</span><input required className="input-dark" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="c-name" /></label>
                  <label className="grid gap-1 text-sm"><span className="font-semibold">Email</span><input required type="email" className="input-dark" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="c-email" /></label>
                  <label className="grid gap-1 text-sm"><span className="font-semibold">Phone / WhatsApp (optional)</span><input className="input-dark" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm"><span className="font-semibold">Company (optional)</span><input className="input-dark" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
                </div>
                <label className="grid gap-1 text-sm"><span className="font-semibold">What is it about?</span><select className="input-dark" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value as ContactInput['topic'] })}>{topics.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="grid gap-1 text-sm"><span className="font-semibold">Message</span><textarea required minLength={10} rows={5} className="input-dark" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} data-testid="c-message" /></label>
                <input type="text" tabIndex={-1} autoComplete="off" className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} aria-hidden="true" />
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <div className="flex items-center justify-between gap-3"><p className="text-xs text-text-muted">We only use your details to reply. See our <Link to="/privacy" className="text-gold-deep hover:underline">privacy policy</Link>.</p><button disabled={busy} className="btn-gold disabled:opacity-60" data-testid="c-send">{busy ? 'Sending…' : 'Send message'}</button></div>
              </form>
            )}
          </div>
          <aside className="space-y-4">
            <div className="card-dark p-5 text-sm" data-testid="contact-details">
              <p className="eyebrow mb-2">Reach us directly</p>
              {cfg?.whatsappUrl && <a href={cfg.whatsappUrl} target="_blank" rel="noreferrer" className="btn-gold mb-3 w-full !min-h-10 text-sm"><MessageCircle size={15} aria-hidden="true" /> Chat on WhatsApp</a>}
              <ul className="space-y-2 text-text-muted">
                {cfg?.email && <li className="flex items-center gap-2"><Mail size={14} className="text-gold-deep" aria-hidden="true" /><a href={`mailto:${cfg.email}`} className="hover:text-gold-deep">{cfg.email}</a></li>}
                {cfg?.phone && <li className="flex items-center gap-2"><Phone size={14} className="text-gold-deep" aria-hidden="true" /><a href={`tel:${cfg.phone.replace(/[^+\d]/g, '')}`} className="hover:text-gold-deep">{cfg.phone}</a></li>}
                {cfg?.legalName && <li className="text-text-muted">Ntemtem is operated by <b className="text-text">{cfg.legalName}</b>.</li>}
                {cfg?.address && <li className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 text-gold-deep" aria-hidden="true" /><span>{cfg.address}</span></li>}
                {cfg && !cfg.email && !cfg.phone && !cfg.whatsappUrl && <li>Use the form — it goes straight to the team.</li>}
              </ul>
              {cfg?.hoursNote && <p className="mt-3 text-xs text-text-muted">{cfg.hoursNote}</p>}
            </div>
            <div className="card-dark p-5 text-sm"><p className="eyebrow mb-2">Faster than a message</p><ul className="space-y-2"><li><Link to="/track" className="inline-flex items-center gap-2 hover:text-gold-deep"><Search size={14} className="text-gold-deep" aria-hidden="true" /> Track a shipment by reference</Link></li><li><Link to="/quote" className="inline-flex items-center gap-2 hover:text-gold-deep"><Check size={14} className="text-gold-deep" aria-hidden="true" /> Get quotes in minutes</Link></li><li><Link to="/help" className="inline-flex items-center gap-2 hover:text-gold-deep"><LifeBuoy size={14} className="text-gold-deep" aria-hidden="true" /> Search the help centre</Link></li></ul></div>
          </aside>
        </div>
      </div>
    </div>
  )
}

/* ================= Legal ================= */
const UPDATED = '18 October 2026'
type Section = [string, string[]]
const LEGAL: Record<'privacy' | 'terms' | 'shipper-agreement', { title: string; intro: string; sections: Section[] }> = {
  privacy: {
    title: 'Privacy policy', intro: 'This policy explains what Ntemtem ("we") collects when you use ntemtem.com and the Ntemtem application, why, and the choices you have. It is written in plain English on purpose.',
    sections: [
      ['What we collect', ['Account details you give us: name, email, phone, company, and for shippers the business documents needed for verification (registration, licence, insurance).', 'Shipment details: what you are sending, where from and to, consignee name and phone so the receiver can be notified, and documents you upload (invoices, packing lists, titles).', 'Payment details are handled by Stripe. Ntemtem never sees or stores full card numbers; we keep the payment reference, amount and status.', 'Usage data: pages visited, device and browser type, approximate location from your IP address, and the actions you take in the app, so we can keep it working and improve it.']],
      ['How we use it', ['To run the marketplace: match your request with shippers, issue quotes, book, track and deliver shipments, hold and release escrow payments, and resolve disputes.', 'To contact you about your shipments by email, SMS or WhatsApp — these are service messages, not marketing. Marketing emails are optional and you can opt out at any time.', 'To verify shippers and keep the marketplace safe, including fraud prevention.', 'To meet legal obligations such as customs declarations, sanctions screening and tax records.']],
      ['Who we share it with', ['The shipper you book with sees the shipment details they need to move your goods, including the consignee. They do not see your payment details.', 'Customs brokers you or your shipper appoint see the documents needed to clear the goods.', 'Service providers who process data for us: Stripe (payments), Resend (email), SMS/WhatsApp providers, carrier tracking providers, and our hosting provider. They may only use the data to provide the service to us.', 'Authorities when the law requires it, for example customs or a court order.', 'We do not sell personal data.']],
      ['Where it lives and how long', ['Data is stored in the United States. Our sourcing teams in China, the UK and the USA access sourcing-request data from those countries to do their job.', 'We keep shipment and payment records for seven years for tax and customs purposes; account data until you delete your account; contact-form messages for two years.']],
      ['Your choices', ['You can see and update your account details in the app and export your shipment history. Email privacy@ntemtem.com to request a copy of your data or to delete your account; we will act within 30 days unless the law requires us to keep records.', 'You can opt out of marketing emails with the link in any email. Service messages about live shipments cannot be switched off while the shipment is in progress.', 'We use a small number of cookies and local-storage keys to keep you signed in and remember preferences such as your colour theme. We do not use advertising trackers.']],
      ['Children', ['Ntemtem is for adults. We do not knowingly collect data from anyone under 18.']],
      ['Changes and contact', ['We will post changes here with a new "last updated" date and, for material changes, tell you by email. Questions: privacy@ntemtem.com.']],
    ],
  },
  terms: {
    title: 'Terms of service', intro: 'These terms govern your use of Ntemtem as a customer. Shippers are also bound by the Shipper Agreement. By creating an account or requesting a quote you agree to these terms.',
    sections: [
      ['What Ntemtem is', ['Ntemtem is a marketplace. Independent, verified shipping companies ("shippers") quote on and carry your goods. Except for Ntemtem Sourcing orders (see below), Ntemtem is not the carrier, forwarder or customs agent and does not take possession of your goods.', 'Verification means we have checked a shipper\'s registration, licence and insurance at the time of listing. It is not a guarantee of performance; ratings and on-time records are there to help you choose.']],
      ['Quotes and bookings', ['A quote is an offer from the shipper. Accepting it creates a contract of carriage between you and that shipper on the terms shown in the quote (what is included, transit time, insurance). Ntemtem records that contract and holds the payment.', 'You are responsible for describing your goods accurately and for not shipping prohibited or restricted items. Misdeclared goods can be refused, delayed, seized or incur penalties, which are your responsibility.']],
      ['Payments and escrow', ['When you pay online, Ntemtem holds the money and releases it to the shipper when your goods are on their way (or delivered, depending on the shipper\'s settings), less the platform fee shown at checkout. If the shipper fails to collect or ship your goods, you are refunded.', 'Disputes: open one from the shipment page before funds are released. Ntemtem will review the evidence from both sides and may refund in full or in part, or release funds to the shipper. That decision is final for the escrowed amount; it does not limit your legal rights against the shipper.', 'Duty, taxes and port charges at destination are not included unless the quote says so. Our duty estimator is an estimate; the customs authority\'s assessment is what you pay.']],
      ['Packing supplies', ['Some shippers sell packing supplies such as barrels, boxes, locks and tape. If you add them to a booking, you are buying them from that shipper at the price shown. The shipper brings them before pickup, and they are paid for together with your shipment through Ntemtem escrow.', 'If supplies you paid for are not delivered, or are not as described, open a dispute from the shipment page and they will be refunded through escrow.']],
      ['Ntemtem Sourcing', ['For sourcing requests, Ntemtem Sourcing buys the goods from the factory in its own name and sells them to you at the landed price you accepted. Title passes to you when the goods are handed to the carrier. The deposit is non-refundable once the factory order is placed, except where the goods fail inspection and cannot be remedied.', 'Reference prices imported from third-party listings are informational only.']],
      ['Cancellations', ['You can cancel a request at no charge before accepting a quote. After acceptance, the shipper\'s cancellation terms in the quote apply; any refund is processed through escrow.']],
      ['Liability', ['Ntemtem\'s liability to you for anything arising from the platform is limited to the fees you paid Ntemtem for the shipment in question. Loss or damage to goods in transit is the shipper\'s responsibility under its contract of carriage and insurance; buying cargo insurance at checkout is strongly recommended.', 'Nothing in these terms limits liability that cannot be limited by law.']],
      ['Accounts, acceptable use and changes', ['Keep your login private; you are responsible for activity on your account. Do not use Ntemtem for anything unlawful, to ship prohibited goods, or to contact shippers off-platform to avoid fees.', 'We may update these terms; continued use after the "last updated" date means you accept the new terms. These terms are governed by the laws of the State of Texas, USA. Questions: legal@ntemtem.com.']],
    ],
  },
  'shipper-agreement': {
    title: 'Shipper agreement', intro: 'This agreement applies to shipping companies that list on Ntemtem. It sits alongside the Terms of service and explains what we expect from you, what you get, and how money moves.',
    sections: [
      ['Listing and verification', ['You confirm that your company is lawfully registered and licensed to provide the freight services you list, that the insurance you upload is current, and that you will tell us within 7 days if any of this changes.', 'You may list only lanes you actually operate. Ntemtem may audit, suspend or remove listings that are inaccurate or receive repeated complaints.']],
      ['Quotes and bookings', ['Your quote is binding for the validity period you set. It must itemise what is included (pickup, delivery, insurance, destination charges) and state the expected transit time. The customer\'s contract of carriage is with you.', 'Update shipment status promptly and truthfully; customers and consignees are notified from your updates. Proof of delivery (signature or photo) must be captured in the app.']],
      ['Fees and payouts', ['Plans are billed monthly as shown on the Pricing page. Where a customer pays through Ntemtem escrow, a platform fee (currently 8%, shown in your Payments settings) is deducted when funds are released to your balance. Payouts are made to the bank or mobile-money details you provide, within 2 business days of a request.', 'Payments made directly to you outside the platform are your responsibility; please record them in the app so the customer\'s timeline stays accurate.']],
      ['Packing supplies you sell', ['You may list packing supplies (barrels, boxes, locks, tape and similar) with your own prices. You are the seller: the items must be as described, fit for shipping, and delivered to the customer before the agreed pickup.', 'Supplies a customer adds to a booking are paid through escrow with the freight, and the platform fee applies to them in the same way.']],
      ['Equipment from Ntemtem', ['Ntemtem sells and rents label printers, scanners, labels and kits. For purchases, Ntemtem is the seller; ownership passes to you on delivery, and manufacturer warranties pass to you where they apply.', 'Rentals are billed monthly until the equipment is returned to Ntemtem. We repair or swap equipment that fails in normal use at no charge. Equipment that is lost, or damaged beyond normal wear, is charged at the purchase price shown in the store.', 'A kit included with your plan is on loan to you for as long as you stay on that plan. If you move to a plan that does not include it, return it within 30 days, or keep it by renting or buying it. Ntemtem sends a prepaid return label for every return.']],
      ['Customer contact and data', ['Customer and consignee details are provided to fulfil the booking only. You may not add them to marketing lists or share them with third parties beyond your agents and carriers.', 'Do not solicit customers to transact off-platform to avoid fees. Repeated off-platform solicitation ends this agreement.']],
      ['Disputes and refunds', ['Where a customer opens a dispute, respond within 3 business days with your evidence. Ntemtem may refund escrowed funds in full or in part based on the evidence; you may also be charged back where funds were already released and the goods were not shipped.']],
      ['Term and termination', ['Either party may end this agreement with 30 days\' notice; bookings already accepted must be completed. Ntemtem may suspend immediately for fraud, misdeclaration, safety concerns or breach of this agreement.', 'This agreement is governed by the laws of the State of Texas, USA. Questions: partners@ntemtem.com.']],
    ],
  },
}
export function LegalPage({ kind }: { kind: keyof typeof LEGAL }) {
  const doc = LEGAL[kind]
  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-3xl py-10 md:py-16" data-testid="legal">
        <p className="eyebrow mb-2">Legal</p><h1 className="!text-3xl md:!text-4xl">{doc.title}</h1><p className="mt-2 text-xs text-text-muted">Last updated {UPDATED}</p>
        <p className="mt-4 text-text-muted">{doc.intro}</p>
        <nav aria-label="Legal pages" className="mt-4 flex flex-wrap gap-2 text-xs">{(Object.keys(LEGAL) as (keyof typeof LEGAL)[]).map((k) => <Link key={k} to={`/${k}`} className={`rounded-full border px-3 py-1 ${k === kind ? 'border-gold text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{LEGAL[k].title}</Link>)}</nav>
        <div className="mt-8 space-y-8">{doc.sections.map(([h, ps], i) => <section key={h}><h2 className="!text-xl">{i + 1}. {h}</h2><div className="mt-2 space-y-2 text-[15px] leading-relaxed text-text-muted">{ps.map((p, k) => <p key={k}>{p}</p>)}</div></section>)}</div>
        <p className="mt-10 border-t border-border pt-4 text-xs text-text-muted">This document is a plain-English statement of how Ntemtem works. It is not a substitute for legal advice; if anything here is unclear, ask us before you book.</p>
      </div>
    </div>
  )
}

/* ================= 404 ================= */
export function NotFound() {
  const nav = useNavigate(); const { '*': rest } = useParams(); const [ref, setRef] = useState('')
  const looksLikeRef = /^(SS|NT)-[A-Z0-9]{6}$/i.test((rest ?? '').replace(/^track\/?/, ''))
  useEffect(() => { setPageTitle('Page not found') }, [])
  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-xl py-20 text-center" data-testid="not-found">
        <Logo />
        <p className="eyebrow mt-8">404</p><h1 className="!text-3xl">We can’t find that page.</h1>
        <p className="mt-2 text-text-muted">{looksLikeRef ? 'That looks like a shipment reference — try tracking it below.' : 'The link may be old or mistyped. If you were sent a tracking link, paste the reference here.'}</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) nav(`/track?ref=${encodeURIComponent(ref.trim().toUpperCase())}`) }}><input className="input-dark flex-1" placeholder="NT-XXXXXX" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Shipment reference" /><button className="btn-gold">Track</button></form>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm"><Link to="/" className="btn-ghost !min-h-9 text-sm">Home</Link><Link to="/quote" className="btn-ghost !min-h-9 text-sm">Get a quote</Link><Link to="/shippers" className="btn-ghost !min-h-9 text-sm">Find a shipper</Link><Link to="/contact" className="btn-ghost !min-h-9 text-sm">Contact us</Link></div>
      </div>
    </div>
  )
}
