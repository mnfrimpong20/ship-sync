import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react'
import { ChevronDown, LayoutDashboard, LogOut, Menu, X, ShieldCheck, Users } from 'lucide-react'
import { Logo } from './ui'
import { useStore } from '../lib/store'

const links = [
  { to: '/quote', label: 'Ship' },
  { to: '/shippers', label: 'Shippers' },
  { to: '/track', label: 'Track' },
  { to: '/live', label: 'Live map' },
  { to: '/#how', label: 'How it works' },
  { to: '/#pricing', label: 'Pricing' },
]

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)
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
  useEffect(() => { setOpen(false); setMenu(false) }, [loc])

  const dash = user?.role === 'shipper' ? '/dashboard/shipper' : '/dashboard'

  return (
    <header className={`sticky top-0 z-50 transition-colors duration-300 ${scrolled || !marketing ? 'border-b border-border bg-bg/85 backdrop-blur-xl' : 'bg-transparent'}`}>
      {marketing && <motion.div className="absolute inset-x-0 top-0 h-0.5 origin-left bg-gold" style={{ scaleX: progress }} aria-hidden="true" />}
      <div className="container-x flex h-[72px] items-center justify-between gap-6">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {links.map((l) => (
            <NavItem key={l.to} to={l.to} label={l.label} />
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 !px-4 text-sm" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-[11px] font-bold text-ink">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                {user.name.split(' ')[0]} <ChevronDown size={14} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-52 overflow-hidden p-1.5">
                    <Link role="menuitem" to={dash} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><LayoutDashboard size={16} aria-hidden="true" /> Dashboard</Link>
                    {user.role === 'shipper' && <Link role="menuitem" to="/dashboard/clients" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><Users size={16} aria-hidden="true" /> Clients</Link>}
                    {user.admin && <Link role="menuitem" to="/admin" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><ShieldCheck size={16} aria-hidden="true" /> Admin</Link>}
                    <button role="menuitem" onClick={() => { logout().finally(() => nav('/')) }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring"><LogOut size={16} aria-hidden="true" /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link to="/login" className="btn-ghost !min-h-10 !px-4 text-sm">Sign in</Link>
          )}
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link to="/quote" className="btn-gold !min-h-10 !px-5 text-sm">Get a quote</Link>
          </motion.div>
        </div>
        <button className="grid h-11 w-11 place-items-center rounded-lg text-text focus-ring lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="border-t border-border bg-bg lg:hidden" aria-label="Mobile">
            <div className="container-x flex flex-col py-3">
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="flex min-h-12 items-center border-b border-border/60 text-[15px] font-medium focus-ring">{l.label}</Link>
              ))}
              <div className="mt-4 flex flex-col gap-2 pb-2">
                {user ? (
                  <>
                    <Link to={dash} className="btn-ghost">Dashboard</Link>
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

function NavItem({ to, label }: { to: string; label: string }) {
  const loc = useLocation()
  const active = to.startsWith('/#') ? false : loc.pathname.startsWith(to)
  const cls = `group relative flex min-h-11 items-center px-3.5 text-[15px] font-medium transition-colors focus-ring rounded-md ${active ? 'text-gold' : 'text-text-muted hover:text-text'}`
  const underline = <span className={`absolute inset-x-3.5 bottom-2 h-px origin-left bg-gold transition-transform duration-200 ${active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} aria-hidden="true" />
  return to.startsWith('/#')
    ? <a href={to} className={cls}>{label}{underline}</a>
    : <NavLink to={to} className={cls}>{label}{underline}</NavLink>
}
