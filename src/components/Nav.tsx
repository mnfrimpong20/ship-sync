import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react'
import { Anchor, BarChart3, Boxes, Calculator, ChevronDown, Globe2, Landmark, LayoutDashboard, LogOut, Menu, Radar, Route, ShieldCheck, Users, X } from 'lucide-react'
import { Logo } from './ui'
import ThemeSwitcher from './ThemeSwitcher'
import { useStore } from '../lib/store'

/** Top level stays short so it fits a laptop; everything else lives under Services. */
const primary = [
  { to: '/quote', label: 'Ship' },
  { to: '/shippers', label: 'Shippers' },
  { to: '/track', label: 'Track' },
  { to: '/#pricing', label: 'Pricing' },
]
type Service = { to: string; label: string; blurb: string; icon: typeof Boxes }
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
    { to: '/#how', label: 'How it works', blurb: 'Post, compare, book and track', icon: Route },
  ] },
]

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)
  const [svc, setSvc] = useState(false)
  const svcRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const hovering = useRef(false)
  const { user, logout } = useStore()
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSvc(false); setMenu(false) } }
    const onClick = (e: MouseEvent) => { if (svcRef.current && !svcRef.current.contains(e.target as Node)) setSvc(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [svc, menu])
  const hoverOpen = () => { hovering.current = true; if (closeTimer.current) window.clearTimeout(closeTimer.current); setSvc(true) }
  const hoverClose = () => { hovering.current = false; closeTimer.current = window.setTimeout(() => setSvc(false), 160) }
  // A click while the pointer is already hovering keeps it open (touch/keyboard users toggle).
  const toggleSvc = () => setSvc((v) => (hovering.current ? true : !v))

  const dash = user?.role === 'shipper' ? '/dashboard/shipper' : '/dashboard'
  const serviceActive = services.some((g) => g.items.some((i) => !i.to.startsWith('/#') && loc.pathname.startsWith(i.to)))

  return (
    <header className={`sticky top-0 z-50 border-b transition-colors duration-300 ${scrolled || !marketing ? 'border-border bg-bg/90 backdrop-blur-xl' : 'border-border/60 bg-bg'}`}>
      {marketing && <motion.div className="absolute inset-x-0 top-0 h-0.5 origin-left bg-gold" style={{ scaleX: progress }} aria-hidden="true" />}
      <div className="container-fluid flex h-[72px] items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          <NavItem to={primary[0].to} label={primary[0].label} />
          <div ref={svcRef} className="relative" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
            <button onClick={toggleSvc} aria-expanded={svc} aria-haspopup="menu" className={`group relative flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md px-3 text-[15px] font-medium transition-colors focus-ring ${serviceActive || svc ? 'text-gold' : 'text-text-muted hover:text-text'}`} data-testid="nav-services">
              Services <ChevronDown size={14} className={`transition-transform ${svc ? 'rotate-180' : ''}`} aria-hidden="true" />
              <span className={`absolute inset-x-3 bottom-2 h-px origin-left bg-gold transition-transform duration-200 ${serviceActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} aria-hidden="true" />
            </button>
            <AnimatePresence>
              {svc && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute left-1/2 top-full mt-2 w-[46rem] -translate-x-1/2 p-3 shadow-xl" data-testid="services-menu">
                  <div className="grid grid-cols-3 gap-2">
                    {services.map((g) => (
                      <div key={g.title}>
                        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
                        <ul className="space-y-0.5">{g.items.map((i) => <li key={i.to}><ServiceLink item={i} /></li>)}</ul>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {primary.slice(1).map((l) => <NavItem key={l.to} to={l.to} label={l.label} />)}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <ThemeSwitcher compact />
          {user ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 whitespace-nowrap !px-3 text-sm" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-[11px] font-bold text-on-accent">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                {user.name.split(' ')[0]} <ChevronDown size={14} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-52 overflow-hidden p-1.5">
                    <Link role="menuitem" to={dash} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><LayoutDashboard size={16} aria-hidden="true" /> Open workspace</Link>
                    {user.role === 'shipper' && <Link role="menuitem" to="/dashboard/clients" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><Users size={16} aria-hidden="true" /> Clients</Link>}
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
        <button className="grid h-11 w-11 place-items-center rounded-lg text-text focus-ring lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="max-h-[calc(100dvh-72px)] overflow-y-auto border-t border-border bg-bg lg:hidden" aria-label="Mobile" data-testid="mobile-menu">
            <div className="container-fluid flex flex-col py-3">
              <div className="grid grid-cols-2 gap-2 pb-3">
                {primary.map((l) => <Link key={l.to} to={l.to} className="flex min-h-12 items-center justify-center rounded-xl border border-border text-[15px] font-semibold focus-ring">{l.label}</Link>)}
              </div>
              {services.map((g) => (
                <div key={g.title} className="border-t border-border/60 py-2">
                  <p className="pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
                  {g.items.map((i) => <Link key={i.to} to={i.to} className="flex min-h-11 items-center gap-3 text-[15px] font-medium focus-ring"><i.icon size={16} className="text-gold" aria-hidden="true" />{i.label}</Link>)}
                </div>
              ))}
              <div className="flex min-h-12 items-center justify-between border-t border-border/60 text-[15px] font-medium"><span>Colour theme</span><ThemeSwitcher align="right" /></div>
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

function ServiceLink({ item }: { item: Service }) {
  const cls = 'flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 focus-ring'
  const body = <><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold"><item.icon size={15} aria-hidden="true" /></span><span className="min-w-0"><span className="block text-sm font-semibold text-text">{item.label}</span><span className="block text-xs leading-snug text-text-muted">{item.blurb}</span></span></>
  return item.to.startsWith('/#') ? <a href={item.to} role="menuitem" className={cls}>{body}</a> : <Link to={item.to} role="menuitem" className={cls}>{body}</Link>
}

function NavItem({ to, label }: { to: string; label: string }) {
  const loc = useLocation()
  const active = to.startsWith('/#') ? false : loc.pathname.startsWith(to)
  const cls = `group relative flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-[15px] font-medium transition-colors focus-ring ${active ? 'text-gold' : 'text-text-muted hover:text-text'}`
  const underline = <span className={`absolute inset-x-3 bottom-2 h-px origin-left bg-gold transition-transform duration-200 ${active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} aria-hidden="true" />
  return to.startsWith('/#')
    ? <a href={to} className={cls}>{label}{underline}</a>
    : <NavLink to={to} className={cls}>{label}{underline}</NavLink>
}
