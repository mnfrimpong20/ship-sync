import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, ChevronDown, ExternalLink, FileText, Globe, Inbox, LayoutDashboard, LogOut, Menu, Package, PlusCircle, Radar, Search, ShieldCheck, Ship, UserCog, Users, X } from 'lucide-react'
import { Logo } from './ui'
import { useStore } from '../lib/store'
import { clientsApi } from '../lib/clients'

interface Item { to: string; label: string; icon: typeof Inbox; end?: boolean; badge?: number }

/**
 * The signed-in application: a fixed sidebar with role-specific navigation and a slim top bar, kept visually apart
 * from the marketing site. Marketing pages keep the big header/footer; everything under /dashboard and /admin lives here.
 */
export default function AppShell() {
  const { ready, user, logout, requests, shipments } = useStore()
  const loc = useLocation()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dueReminders, setDueReminders] = useState(0)
  useEffect(() => { setOpen(false); setMenu(false) }, [loc])
  useEffect(() => {
    if (user?.role !== 'shipper') return
    clientsApi.remindersDue().then((r) => setDueReminders(r.filter((x) => x.dueAt && new Date(x.dueAt).getTime() < Date.now() + 86400000).length)).catch(() => {})
  }, [user, loc.pathname])

  if (!ready) return <div className="grid min-h-screen place-items-center bg-bg text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />

  const isShipper = user.role === 'shipper'
  const openLeads = isShipper ? requests.filter((r) => r.status === 'open' && !r.quotes.some((q) => q.shipperId === user.shipperId)).length : requests.reduce((n, r) => n + (r.status === 'open' ? r.quotes.length : 0), 0)
  const active = shipments.filter((s) => s.status !== 'delivered').length

  const items: Item[] = isShipper
    ? [
        { to: '/dashboard/shipper', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/dashboard/shipper?view=leads', label: 'Leads & quotes', icon: Inbox, badge: openLeads },
        { to: '/dashboard/shipper?view=shipments', label: 'Shipments', icon: Ship, badge: active },
        { to: '/dashboard/clients', label: 'Clients', icon: Users, badge: dueReminders },
        { to: '/dashboard/shipper?view=profile', label: 'Company profile', icon: UserCog },
      ]
    : [
        { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/dashboard?tab=requests', label: 'Quote requests', icon: FileText, badge: openLeads },
        { to: '/dashboard?tab=shipments', label: 'Shipments', icon: Package, badge: active },
        { to: '/quote', label: 'New request', icon: PlusCircle },
      ]
  const tools: Item[] = [
    { to: '/live', label: 'Live map', icon: Radar },
    { to: '/track', label: 'Track a shipment', icon: Search },
    ...(user.admin ? [{ to: '/admin', label: 'Verification', icon: ShieldCheck } as Item] : []),
  ]

  const isActive = (it: Item) => {
    const [path, qs] = it.to.split('?')
    if (loc.pathname !== path && !(path !== '/dashboard' && path !== '/dashboard/shipper' && loc.pathname.startsWith(path))) return false
    if (qs) return loc.search.includes(qs)
    if (it.end) return loc.search === '' || (!loc.search.includes('view=') && !loc.search.includes('tab='))
    return true
  }
  const NavItems = ({ list }: { list: Item[] }) => (
    <ul className="space-y-0.5">
      {list.map((it) => {
        const act = isActive(it)
        return (
          <li key={it.to}>
            <NavLink to={it.to} className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-ring ${act ? 'bg-gold/15 font-semibold text-gold' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`} aria-current={act ? 'page' : undefined}>
              <it.icon size={17} aria-hidden="true" /><span className="flex-1">{it.label}</span>
              {it.badge ? <span className={`rounded-full px-1.5 text-[11px] font-bold ${act ? 'bg-gold text-ink' : 'bg-surface-2 text-text'}`}>{it.badge}</span> : null}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5"><Logo /><button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-lg text-text-muted lg:hidden focus-ring" aria-label="Close menu"><X size={18} /></button></div>
      <div className="px-4 pb-3"><p className="truncate text-xs font-semibold uppercase tracking-wider text-text-muted">{isShipper ? user.company ?? 'Shipper' : 'Customer'}</p></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3" aria-label="Application">
        <NavItems list={items} />
        <div><p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">Tools</p><NavItems list={tools} /></div>
      </nav>
      <div className="border-t border-border p-3">
        <Link to="/" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><Globe size={17} aria-hidden="true" /> Ship Sync website <ExternalLink size={12} className="ml-auto" aria-hidden="true" /></Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-bg text-text lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen border-r border-border bg-surface/60 lg:block">{sidebar}</aside>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Close menu" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="absolute inset-y-0 left-0 w-72 border-r border-border bg-bg">{sidebar}</motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-h-screen flex-col">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-bg/85 px-4 backdrop-blur-xl md:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg text-text focus-ring lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
            <span className="lg:hidden"><Logo /></span>
          </div>
          <div className="flex items-center gap-2">
            {isShipper && <Link to="/dashboard/clients" className="relative grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:text-text focus-ring" aria-label={`${dueReminders} follow-ups due`}><Bell size={18} />{dueReminders > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold" />}</Link>}
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 !px-3 text-sm" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gold text-[11px] font-bold text-ink">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                <span className="hidden sm:inline">{user.name.split(' ')[0]}</span><ChevronDown size={14} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-56 overflow-hidden p-1.5">
                    <p className="px-3 py-2 text-xs text-text-muted">{user.email}</p>
                    {isShipper && <Link role="menuitem" to="/dashboard/shipper?view=profile" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><UserCog size={16} aria-hidden="true" /> Company profile</Link>}
                    {user.admin && <Link role="menuitem" to="/admin" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><ShieldCheck size={16} aria-hidden="true" /> Admin</Link>}
                    <button role="menuitem" onClick={() => { logout().finally(() => nav('/')) }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring"><LogOut size={16} aria-hidden="true" /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>
        <main id="main" className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
