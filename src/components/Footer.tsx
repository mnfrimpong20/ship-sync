import { Link } from 'react-router-dom'
import { BadgeCheck, Lock, MessageCircle, Radar } from 'lucide-react'
import { Logo } from './ui'
import { countries } from '../lib/data'
import { useSiteConfig } from '../lib/site'

const cols = [
  { title: 'Ship', links: [['Get a quote', '/quote'], ['Fill a barrel', '/groupage'], ['Source from China, UK & USA', '/sourcing'], ['Track a shipment', '/track'], ['Duty estimator', '/duty'], ['Customs brokers', '/brokers'], ['Sailing schedule', '/sailings'], ['Lane prices', '/lanes'], ['Live map', '/live']] },
  { title: 'Shippers', links: [['For shipping companies', '/for-shippers'], ['List your company', '/signup?role=shipper'], ['Pricing', '/pricing'], ['How verification works', '/about'], ['Shipper agreement', '/shipper-agreement'], ['Shipper dashboard', '/dashboard/shipper']] },
  { title: 'Company', links: [['About', '/about'], ['Contact', '/contact'], ['FAQ', '/?s=faq'], ['Privacy policy', '/privacy'], ['Terms of service', '/terms']] },
]
const SOCIAL_LABELS: Record<string, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', youtube: 'YouTube' }

export default function Footer() {
  const cfg = useSiteConfig()
  return (
    <footer className="theme-dark border-t border-border bg-bg text-text">
      <div className="container-fluid border-b border-border py-5">
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-text-muted" aria-label="Trust" data-testid="trust-strip">
          <li className="inline-flex items-center gap-2"><Lock size={14} className="text-gold-deep" aria-hidden="true" /> Payments held in escrow until your goods are on their way</li>
          <li className="inline-flex items-center gap-2"><BadgeCheck size={14} className="text-gold-deep" aria-hidden="true" /> Licence &amp; insurance checked on every verified shipper</li>
          <li className="inline-flex items-center gap-2"><Radar size={14} className="text-gold-deep" aria-hidden="true" /> One tracking page from pickup to the door</li>
        </ul>
      </div>
      <div className="container-fluid grid gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-text-muted">The marketplace for air and ocean freight to West Africa. Verified shippers, transparent quotes, tracked deliveries — and our own sourcing team buying in China, the UK and the USA.</p>
          <ul className="mt-4 space-y-1 text-sm text-text-muted">
            {cfg?.email && <li><a href={`mailto:${cfg.email}`} className="hover:text-gold-deep">{cfg.email}</a></li>}
            {cfg?.phone && <li><a href={`tel:${cfg.phone.replace(/[^+\d]/g, '')}`} className="hover:text-gold-deep">{cfg.phone}</a></li>}
            {cfg?.whatsappUrl && <li><a href={cfg.whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-gold-deep"><MessageCircle size={14} aria-hidden="true" /> WhatsApp us</a></li>}
            {cfg && !cfg.email && !cfg.phone && !cfg.whatsappUrl && <li><Link to="/contact" className="hover:text-gold-deep">Contact us</Link></li>}
            {cfg?.address && <li className="text-xs">{cfg.address}</li>}
          </ul>
          {cfg && Object.keys(cfg.social).length > 0 && <ul className="mt-4 flex flex-wrap gap-3 text-xs">{Object.entries(cfg.social).map(([k, url]) => <li key={k}><a href={url} target="_blank" rel="noreferrer" className="rounded-full border border-border px-3 py-1 text-text-muted hover:border-gold hover:text-gold-deep">{SOCIAL_LABELS[k] ?? k}</a></li>)}</ul>}
        </div>
        {cols.map((c) => (
          <div key={c.title} className="md:col-span-2">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text">{c.title}</h3>
            <ul className="space-y-2">
              {c.links.map(([label, to]) => (
                <li key={label}>{to.startsWith('/#') ? <a href={to} className="text-sm text-text-muted hover:text-gold-deep focus-ring rounded">{label}</a> : <Link to={to} className="text-sm text-text-muted hover:text-gold-deep focus-ring rounded">{label}</Link>}</li>
              ))}
            </ul>
          </div>
        ))}
        <div className="md:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text">Destinations</h3>
          <ul className="space-y-2">
            {countries.map((c) => (
              <li key={c.code}><Link to={`/quote?destination=${c.code}`} className="text-sm text-text-muted hover:text-gold-deep focus-ring rounded">{c.name}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-fluid flex flex-col gap-2 py-6 text-xs text-text-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Ntemtem. All rights reserved.</p>
          <p className="flex gap-4"><Link to="/privacy" className="hover:text-gold-deep">Privacy</Link><Link to="/terms" className="hover:text-gold-deep">Terms</Link><Link to="/shipper-agreement" className="hover:text-gold-deep">Shipper agreement</Link><Link to="/contact" className="hover:text-gold-deep">Contact</Link></p>
        </div>
      </div>
    </footer>
  )
}
