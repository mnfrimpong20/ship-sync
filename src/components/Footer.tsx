import { Link } from 'react-router-dom'
import { Lock, Mail, MessageCircle, Phone, Radar } from 'lucide-react'
import { Logo, VerifiedMark, Flag } from './ui'
import { countries } from '../lib/data'
import { useSiteConfig } from '../lib/site'

/** Four balanced groups of short links; legal links live only in the bottom bar. */
const cols: { title: string; links: [string, string][] }[] = [
  { title: 'Send', links: [['Get a quote', '/quote'], ['Track a shipment', '/track'], ['Find a shipper', '/shippers'], ['Fill a barrel', '/groupage'], ['Sourcing service', '/sourcing'], ['How it works', '/?s=how']] },
  { title: 'Plan', links: [['Duty estimator', '/duty'], ['Lane prices', '/lanes'], ['Sailing schedule', '/sailings'], ['Customs brokers', '/brokers'], ['Live map', '/live']] },
  { title: 'For shipping companies', links: [['Why Ntemtem', '/for-shippers'], ['List your company', '/signup?role=shipper'], ['Plans & pricing', '/pricing?for=shippers'], ['Getting verified', '/for-shippers?s=verified'], ['Partner sign in', '/login']] },
  { title: 'Company', links: [['About us', '/about'], ['Contact', '/contact'], ['FAQ', '/?s=faq']] },
]
const SOCIAL_LABELS: Record<string, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', youtube: 'YouTube' }

export default function Footer() {
  const cfg = useSiteConfig()
  return (
    <footer className="theme-dark border-t border-border bg-bg text-text">
      <div className="container-fluid border-b border-border py-5">
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-text-muted" aria-label="Trust" data-testid="trust-strip">
          <li className="inline-flex items-center gap-2"><Lock size={14} className="text-gold-deep" aria-hidden="true" /> Payments held in escrow until your goods are on their way</li>
          <li className="inline-flex items-center gap-2"><VerifiedMark size={14} aria-hidden="true" /> Licence &amp; insurance checked on every verified shipper</li>
          <li className="inline-flex items-center gap-2"><Radar size={14} className="text-gold-deep" aria-hidden="true" /> One tracking page from pickup to the door</li>
        </ul>
      </div>
      <div className="container-fluid grid grid-cols-2 gap-x-6 gap-y-10 py-14 sm:gap-x-8 lg:grid-cols-12 lg:gap-y-12 lg:py-16">
        <div className="col-span-2 lg:col-span-4 lg:pr-8">
          <Logo />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-text-muted">Ntemtem — Twi for “quickly-quickly” — connects you with verified air and ocean shippers carrying boxes, barrels, cars and cargo home to West Africa.</p>
          <ul className="mt-5 space-y-2 text-sm text-text-muted">
            {cfg?.email && <li><a href={`mailto:${cfg.email}`} className="inline-flex items-center gap-2 hover:text-gold-deep focus-ring rounded"><Mail size={15} aria-hidden="true" />{cfg.email}</a></li>}
            {cfg?.phone && <li><a href={`tel:${cfg.phone.replace(/[^+\d]/g, '')}`} className="inline-flex items-center gap-2 hover:text-gold-deep focus-ring rounded"><Phone size={15} aria-hidden="true" />{cfg.phone}</a></li>}
            {cfg?.whatsappUrl && <li><a href={cfg.whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-gold-deep focus-ring rounded"><MessageCircle size={15} aria-hidden="true" /> WhatsApp us</a></li>}
            {cfg && !cfg.email && !cfg.phone && !cfg.whatsappUrl && <li><Link to="/contact" className="inline-flex items-center gap-2 hover:text-gold-deep focus-ring rounded"><Mail size={15} aria-hidden="true" /> Contact us</Link></li>}
            {cfg?.address && <li className="text-xs leading-relaxed">{cfg.address}</li>}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/quote" className="btn-gold !min-h-10 !px-5 text-sm">Get a quote</Link>
            <Link to="/for-shippers" className="btn-ghost !min-h-10 !px-5 text-sm">For shipping companies</Link>
          </div>
          {cfg && Object.keys(cfg.social).length > 0 && <ul className="mt-5 flex flex-wrap gap-2 text-xs">{Object.entries(cfg.social).map(([k, url]) => <li key={k}><a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center rounded-full border border-border px-3 text-text-muted hover:border-gold hover:text-gold-deep focus-ring">{SOCIAL_LABELS[k] ?? k}</a></li>)}</ul>}
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title} className="lg:col-span-2">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-deep">{c.title}</p>
            <ul className="space-y-3">
              {c.links.map(([label, to]) => (
                <li key={label}><Link to={to} className="text-[15px] text-text-muted transition-colors hover:text-text focus-ring rounded">{label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container-fluid">
        <div className="flex flex-col gap-4 border-t border-border py-6 lg:flex-row lg:items-center lg:gap-6" data-testid="footer-destinations">
          <p className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-deep">We ship to</p>
          <ul className="flex flex-wrap gap-2">
            {countries.map((c) => (
              <li key={c.code}><Link to={`/quote?destination=${c.code}`} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-3.5 text-sm text-text-muted transition-colors hover:border-gold hover:text-text focus-ring"><span aria-hidden="true"><Flag code={c.code} /></span>{c.name}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-fluid flex flex-col gap-2 py-6 text-xs text-text-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Ntemtem. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2"><Link to="/privacy" className="hover:text-text focus-ring rounded">Privacy policy</Link><Link to="/terms" className="hover:text-text focus-ring rounded">Terms of service</Link><Link to="/shipper-agreement" className="hover:text-text focus-ring rounded">Shipper agreement</Link></nav>
        </div>
      </div>
    </footer>
  )
}
