import { Link } from 'react-router-dom'
import { Logo } from './ui'
import { countries } from '../lib/data'

const cols = [
  { title: 'Ship', links: [['Get a quote', '/quote'], ['Track a shipment', '/track'], ['Live map', '/live'], ['Browse shippers', '/shippers'], ['How it works', '/#how']] },
  { title: 'Shippers', links: [['List your company', '/signup?role=shipper'], ['Pricing', '/#pricing'], ['Shipper dashboard', '/dashboard/shipper'], ['Verification', '/#features']] },
  { title: 'Company', links: [['About', '/#about'], ['FAQ', '/#faq'], ['Contact', 'mailto:hello@shipsync.africa'], ['Careers', '/#about']] },
]

export default function Footer() {
  return (
    <footer className="border-t border-border bg-bg text-text">
      <div className="container-x grid gap-10 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-text-muted">The marketplace for air and ocean freight to West Africa. Verified shippers, transparent quotes, tracked deliveries.</p>
          <p className="mt-4 text-sm text-text-muted">hello@shipsync.africa · +1 (888) 555-0199</p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="md:col-span-2">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text">{c.title}</h3>
            <ul className="space-y-2">
              {c.links.map(([label, to]) => (
                <li key={label}>{to.startsWith('mailto') ? <a href={to} className="text-sm text-text-muted hover:text-gold focus-ring rounded">{label}</a> : <Link to={to} className="text-sm text-text-muted hover:text-gold focus-ring rounded">{label}</Link>}</li>
              ))}
            </ul>
          </div>
        ))}
        <div className="md:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text">Destinations</h3>
          <ul className="space-y-2">
            {countries.map((c) => (
              <li key={c.code}><Link to={`/quote?destination=${c.code}`} className="text-sm text-text-muted hover:text-gold focus-ring rounded">{c.name}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-x flex flex-col gap-2 py-6 text-xs text-text-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Ship Sync, Inc. All rights reserved.</p>
          <p className="flex gap-4"><a href="#" className="hover:text-gold">Privacy</a><a href="#" className="hover:text-gold">Terms</a><a href="#" className="hover:text-gold">Shipper agreement</a></p>
        </div>
      </div>
    </footer>
  )
}
