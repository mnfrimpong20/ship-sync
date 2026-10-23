import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react'
import { Mail, PackageSearch, LifeBuoy, Anchor, ArrowRight, BarChart3, Boxes, Building2, Calculator, ChartLine, ChevronDown, Globe, Globe2, House, Inbox, Landmark, LayoutDashboard, Link2, LogOut, Menu, Radar, Receipt, Route, ScanLine, Ship, ShieldCheck, Tag, Truck, Users, UsersRound, X, Printer } from 'lucide-react'
import { Logo, VerifiedMark } from './ui'
import { useStore } from '../lib/store'

/** Top level stays short so it fits a laptop; everything else lives under Services. */
const primary = [
  { to: '/quote', label: 'Ship' },
  { to: '/shippers', label: 'Find a shipper' },
  { to: '/track', label: 'Track' },
  { to: '/pricing', label: 'Pricing' },
]
type Service = { to: string; label: string; blurb: string; icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }> }
type Side = 'senders' | 'shippers'
/** For senders — people shipping something home. */
const services: { title: string; items: Service[] }[] = [
  { title: 'Ways to ship', items: [
    { to: '/groupage', label: 'Fill a barrel', blurb: 'Share a barrel or container, pay for the space you use', icon: Boxes },
    { to: '/sourcing', label: 'Sourcing: China, UK, USA', blurb: 'We find, buy, inspect and ship it for you', icon: Globe2 },
    { to: '/sailings', label: 'Sailing schedule', blurb: 'Next departures to West Africa', icon: Anchor },
  ] },
  { title: 'Plan & clear', items: [
    { to: '/lanes', label: 'Lane prices', blurb: 'What it really costs on your lane', icon: BarChart3 },
    { to: '/duty', label: 'Duty estimator', blurb: 'Landed cost at Tema, Lagos and more', icon: Calculator },
    { to: '/brokers', label: 'Customs brokers', blurb: 'Licensed clearing agents at the port', icon: Landmark },
  ] },
  { title: 'Follow along', items: [
    { to: '/live', label: 'Live map', blurb: 'Ships and flights on the Gulf of Guinea', icon: Radar },
    { to: '/?s=how', label: 'How it works', blurb: 'Post, compare, book and track', icon: Route },
  ] },
]
/** For shipping companies — every tool in the partner workspace, each linking to its section of /for-shippers. */
const shipperServices: { title: string; items: Service[] }[] = [
  { title: 'Win customers', items: [
    { to: '/for-shippers?s=win', label: 'Matched quote requests', blurb: 'Leads on your lanes, delivered to you', icon: Inbox },
    { to: '/for-shippers?s=win', label: 'Rate cards & instant quotes', blurb: 'Price once, quote while you sleep', icon: Tag },
    { to: '/for-shippers?s=win', label: 'Your branded page', blurb: 'Your logo, your link, your leads', icon: Globe },
    { to: '/for-shippers?s=verified', label: 'Ntemtem Verified', blurb: 'The badge customers look for', icon: VerifiedMark },
  ] },
  { title: 'Run operations', items: [
    { to: '/for-shippers?s=run', label: 'Containers & sailings', blurb: 'Book space, load orders, track the box', icon: Ship },
    { to: '/for-shippers?s=run', label: 'Warehouse & scanning', blurb: 'Stickers, phone scans, proof of delivery', icon: ScanLine },
    { to: '/for-shippers?s=equipment', label: 'Equipment & supplies', blurb: 'Printers, scanners, labels — buy, rent or free with Pro', icon: Printer },
    { to: '/for-shippers?s=run', label: 'Pickups, routes & drivers', blurb: 'Collection slots and daily runs', icon: Truck },
    { to: '/for-shippers?s=updates', label: 'Destination agent links', blurb: 'Your agent at the port sees the manifest', icon: Link2 },
  ] },
  { title: 'Get paid & grow', items: [
    { to: '/for-shippers?s=paid', label: 'Protected payments', blurb: 'Customers pay upfront, you get paid out', icon: ShieldCheck },
    { to: '/for-shippers?s=paid', label: 'Clients, invoices & collections', blurb: 'Every customer and every payment owed', icon: Receipt },
    { to: '/for-shippers?s=grow', label: 'Analytics & lane intelligence', blurb: 'Win rates, profit and market prices', icon: ChartLine },
    { to: '/for-shippers?s=grow', label: 'Team & integrations', blurb: 'Roles for staff, webhooks for your systems', icon: UsersRound },
  ] },
]

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)
  const [svc, setSvc] = useState(false)
  const { user, logout } = useStore()
  const [side, setSide] = useState<Side>(() => user?.role === 'shipper' ? 'shippers' : 'senders')
  const svcRef = useRef<HTMLDivElement>(null); const svcBtn = useRef<HTMLButtonElement>(null)
  const headerRef = useRef<HTMLElement>(null); const menuBtn = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | null>(null)
  const hovering = useRef(false)
  const loc = useLocation()
  const nav = useNavigate()
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 })
  const marketing = loc.pathname === '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { setOpen(false); setMenu(false); setSvc(false) }, [loc])
  useEffect(() => {
    if (!svc && !menu) return
    // Esc closes and puts keyboard focus back on the button that opened it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (svc) svcBtn.current?.focus(); setSvc(false); setMenu(false) } }
    const onClick = (e: MouseEvent) => { if (svcRef.current && !svcRef.current.contains(e.target as Node)) setSvc(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [svc, menu])
  // Phone menu: the page behind is out of reach (keyboard, screen readers, scrolling) until it closes.
  useEffect(() => {
    if (!open) return
    const behind = [document.getElementById('main'), document.querySelector('footer'), document.querySelector('[data-testid=wa-bubble]')].filter(Boolean) as HTMLElement[]
    behind.forEach((el) => el.setAttribute('inert', '')); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); return }
      if (e.key !== 'Tab' || !headerRef.current) return
      const f = [...headerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter((x) => x.offsetParent)
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { behind.forEach((el) => el.removeAttribute('inert')); document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])
  const hoverOpen = () => { hovering.current = true; if (closeTimer.current) window.clearTimeout(closeTimer.current); setSvc(true) }
  const hoverClose = () => { hovering.current = false; closeTimer.current = window.setTimeout(() => setSvc(false), 160) }
  // A click while the pointer is already hovering keeps it open (touch/keyboard users toggle).
  const toggleSvc = () => setSvc((v) => (hovering.current ? true : !v))

  const dash = user?.role === 'shipper' ? '/dashboard/shipper' : '/dashboard'
  const serviceActive = [...services, ...shipperServices].some((g) => g.items.some((i) => !i.to.startsWith('/#') && i.to !== '/?s=how' && loc.pathname.startsWith(i.to.split('?')[0])))
  const groups = side === 'senders' ? services : shipperServices

  return (
    <header ref={headerRef} className={`sticky top-0 z-50 border-b transition-colors duration-300 ${scrolled || !marketing ? 'border-border bg-bg/90 backdrop-blur-xl' : 'border-border/60 bg-bg'}`}>
      {marketing && <motion.div className="absolute inset-x-0 top-0 h-0.5 origin-left bg-gold" style={{ scaleX: progress }} aria-hidden="true" />}
      <div className="container-fluid flex h-[72px] items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          <NavItem to={primary[0].to} label={primary[0].label} />
          <div ref={svcRef} className="relative" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
            <button ref={svcBtn} onClick={toggleSvc} aria-expanded={svc} aria-haspopup="menu" className={`group relative flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md px-3 text-[15px] font-medium transition-colors focus-ring ${serviceActive || svc ? 'text-gold-deep' : 'text-text-muted hover:text-text'}`} data-testid="nav-services">
              Services <ChevronDown size={14} className={`transition-transform ${svc ? 'rotate-180' : ''}`} aria-hidden="true" />
              <span className={`absolute inset-x-3 bottom-2 h-px origin-left bg-gold transition-transform duration-200 ${serviceActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} aria-hidden="true" />
            </button>
            <AnimatePresence>
              {svc && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} className="card-dark absolute left-1/2 top-full mt-2 w-[52rem] -translate-x-1/2 overflow-hidden shadow-xl" data-testid="services-menu">
                  <div role="tablist" aria-label="Who it's for" className="grid grid-cols-2 border-b border-border">
                    <SideTab active={side === 'senders'} onClick={() => setSide('senders')} icon={House} label="For senders" hint="shipping something home" testId="services-tab-senders" />
                    <SideTab active={side === 'shippers'} onClick={() => setSide('shippers')} icon={Building2} label="For shipping companies" hint="run your business" partner testId="services-tab-shippers" />
                  </div>
                  <div role="menu" className="grid grid-cols-3 gap-2 p-3">
                    {groups.map((g) => (
                      <div key={g.title}>
                        <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
                        <ul className="space-y-0.5">{g.items.map((i) => <li key={i.label}><ServiceLink item={i} partner={side === 'shippers'} /></li>)}</ul>
                      </div>
                    ))}
                  </div>
                  {side === 'senders' && <p className="border-t border-border px-5 py-2.5 text-sm text-text-muted" data-testid="services-brokers">Licensed customs broker? <Link to="/broker-portal/login" className="font-semibold text-gold-deep underline">Broker sign in</Link> · <Link to="/brokers/join" className="font-semibold text-gold-deep underline">Join the network</Link></p>}
                  {side === 'shippers' && (
                    <div className="flex items-center justify-between gap-4 bg-partner px-5 py-3.5 text-[#FBF6EC]">
                      <p className="text-sm"><strong>Run your shipping business on Ntemtem.</strong> <span className="text-[#C9C1B1]">Free Pro trial for new partners.</span></p>
                      <div className="flex shrink-0 gap-2">
                        <Link to="/for-shippers" className="inline-flex min-h-9 items-center rounded-full border border-[#5A544A] px-4 text-sm font-semibold text-[#FBF6EC] hover:border-[#FBF6EC] focus-ring">See all tools</Link>
                        <Link to="/signup?role=shipper" className="inline-flex min-h-9 items-center rounded-full bg-gold px-4 text-sm font-bold text-on-accent hover:bg-[#F5B82E] focus-ring">List your company</Link>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {primary.slice(1).map((l) => <NavItem key={l.to} to={l.to} label={l.label} />)}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {user?.role !== 'shipper' && <Link to="/for-shippers" className="hidden min-h-10 items-center gap-2 whitespace-nowrap rounded-full border border-border px-4 text-sm font-semibold text-text hover:border-text focus-ring xl:inline-flex" data-testid="nav-for-shippers"><span className="h-2 w-2 rounded-[2px] bg-partner" aria-hidden="true" />For shipping companies</Link>}
          <Link to="/help" className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-text-muted hover:text-text focus-ring" data-testid="nav-help"><LifeBuoy size={16} aria-hidden="true" /> Help</Link>
          {user ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 whitespace-nowrap !px-3 text-sm" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-xs font-bold text-on-accent">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                {user.name.split(' ')[0]} <ChevronDown size={14} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-52 overflow-hidden p-1.5">
                    <Link role="menuitem" to={dash} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><LayoutDashboard size={16} aria-hidden="true" /> Open workspace</Link>
                    {user.role === 'shipper' && <Link role="menuitem" to="/dashboard/clients" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><Users size={16} aria-hidden="true" /> Clients</Link>}
                    <Link role="menuitem" to="/support" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><LifeBuoy size={16} aria-hidden="true" /> Help &amp; support</Link>
                    {user.admin && <Link role="menuitem" to="/admin" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><ShieldCheck size={16} aria-hidden="true" /> Admin</Link>}
                    <button role="menuitem" onClick={() => { logout().finally(() => nav('/')) }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring"><LogOut size={16} aria-hidden="true" /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link to="/login" className="btn-ghost !min-h-10 whitespace-nowrap !px-4 text-sm">Sign in</Link>
          )}
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link to="/quote" className="btn-gold !min-h-10 whitespace-nowrap !px-5 text-sm">Get a quote</Link>
          </motion.div>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <Link to="/track" className="grid h-11 w-11 place-items-center rounded-lg text-text focus-ring" aria-label="Track a shipment" data-testid="nav-track-phone"><PackageSearch size={22} aria-hidden="true" /></Link>
          <button ref={menuBtn} className="grid h-11 w-11 place-items-center rounded-lg text-text focus-ring" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-menu">
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="max-h-[calc(100dvh-72px)] overflow-y-auto overscroll-contain border-t border-border bg-bg lg:hidden" aria-label="Menu" id="mobile-menu" data-testid="mobile-menu">
            <div className="container-fluid flex flex-col py-3">
              <div className="grid grid-cols-2 gap-2 pb-3">
                {primary.map((l) => <Link key={l.to} to={l.to} className="flex min-h-12 items-center justify-center rounded-xl border border-border text-[15px] font-semibold focus-ring">{l.label}</Link>)}
              </div>
              <p className="border-t border-border/60 pt-3 text-xs font-bold uppercase tracking-wider text-text">For senders</p>
              {services.map((g) => (
                <div key={g.title} className="py-2">
                  <p className="pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
                  {g.items.map((i) => <Link key={i.label} to={i.to} className="flex min-h-11 items-center gap-3 text-[15px] font-medium focus-ring"><i.icon size={16} className="text-gold-deep" aria-hidden="true" />{i.label}</Link>)}
                </div>
              ))}
              <div className="mt-2 rounded-2xl bg-partner p-4 text-[#FBF6EC]" data-testid="mobile-for-shippers">
                <p className="text-xs font-bold uppercase tracking-wider">For shipping companies</p>
                <p className="mt-1 text-sm text-[#C9C1B1]">Leads, rate cards, containers, warehouse scanning, protected payments and more.</p>
                <div className="mt-3 flex flex-col gap-2">
                  <Link to="/for-shippers" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#5A544A] text-[15px] font-semibold text-[#FBF6EC] focus-ring">See all tools <ArrowRight size={16} aria-hidden="true" /></Link>
                  <Link to="/signup?role=shipper" className="inline-flex min-h-11 items-center justify-center rounded-full bg-gold text-[15px] font-bold text-on-accent focus-ring">List your company</Link>
                </div>
              </div>
              <p className="mt-3 text-sm text-text-muted" data-testid="mobile-brokers">Customs broker? <Link to="/broker-portal/login" className="font-semibold text-gold-deep underline">Broker sign in</Link> · <Link to="/brokers/join" className="font-semibold text-gold-deep underline">Join</Link></p>
              <div className="mt-3 grid grid-cols-2 gap-2" data-testid="mobile-help"><Link to="/help" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border text-[15px] font-semibold focus-ring"><LifeBuoy size={16} aria-hidden="true" /> Help centre</Link><Link to="/contact" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border text-[15px] font-semibold focus-ring"><Mail size={16} aria-hidden="true" /> Contact us</Link></div>
              <div className="mt-3 flex flex-col gap-2 pb-2">
                {user ? (
                  <>
                    <Link to={dash} className="btn-ghost">Open workspace</Link>
                    {user.role === 'shipper' && <Link to="/dashboard/clients" className="btn-ghost">Clients</Link>}
                    {user.admin && <Link to="/admin" className="btn-ghost">Admin</Link>}
                    <button onClick={() => { logout().finally(() => nav('/')) }} className="btn-ghost">Sign out</button>
                  </>
                ) : <Link to="/login" className="btn-ghost">Sign in</Link>}
                <Link to="/quote" className="btn-gold">Get a quote</Link>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}

function SideTab({ active, onClick, icon: Icon, label, hint, partner = false, testId }: { active: boolean; onClick: () => void; icon: typeof Boxes; label: string; hint: string; partner?: boolean; testId: string }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} onMouseEnter={onClick} data-testid={testId}
      className={`flex items-center gap-2.5 border-b-[3px] px-5 py-3.5 text-left text-[15px] focus-ring ${active ? (partner ? 'border-partner bg-surface-2/60 font-bold text-text' : 'border-gold bg-surface-2/60 font-bold text-text') : 'border-transparent font-semibold text-text-muted hover:text-text'}`}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${partner ? 'bg-partner text-gold' : 'bg-gold/20 text-text'}`}><Icon size={15} aria-hidden="true" /></span>
      <span>{label} <span className="font-normal text-text-muted text-[13px]">— {hint}</span></span>
    </button>
  )
}

function ServiceLink({ item, partner = false }: { item: Service; partner?: boolean }) {
  const cls = 'flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 focus-ring'
  const body = <><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${partner ? 'bg-partner/10 text-text' : 'bg-gold/15 text-gold-deep'}`}><item.icon size={15} aria-hidden="true" /></span><span className="min-w-0"><span className="block text-sm font-semibold text-text">{item.label}</span><span className="block text-xs leading-snug text-text-muted">{item.blurb}</span></span></>
  return item.to.startsWith('/#') ? <a href={item.to} role="menuitem" className={cls}>{body}</a> : <Link to={item.to} role="menuitem" className={cls}>{body}</Link>
}

function NavItem({ to, label }: { to: string; label: string }) {
  const loc = useLocation()
  const active = to.startsWith('/#') ? false : loc.pathname.startsWith(to)
  const cls = `group relative flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-[15px] font-medium transition-colors focus-ring ${active ? 'text-gold-deep' : 'text-text-muted hover:text-text'}`
  const underline = <span className={`absolute inset-x-3 bottom-2 h-px origin-left bg-gold transition-transform duration-200 ${active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} aria-hidden="true" />
  return to.startsWith('/#')
    ? <a href={to} className={cls}>{label}{underline}</a>
    : <NavLink to={to} className={cls}>{label}{underline}</NavLink>
}
