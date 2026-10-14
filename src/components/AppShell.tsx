import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Anchor, BarChart3, Factory, Globe2, Smartphone, BellRing, Boxes, CalendarCheck, Receipt, ChevronDown, Tags, Container, ExternalLink, FileText, Globe, Inbox, LayoutDashboard, LogOut, MapPinned, Menu, Package, PlusCircle, Radar, ScanLine, Search, ShieldCheck, Ship, Star, Truck, UserCog, Users, UsersRound, Wallet, Warehouse, X } from 'lucide-react'
import { Logo } from './ui'
import ThemeSwitcher from './ThemeSwitcher'
import { NotificationBell } from './NotificationBell'
import { useStore } from '../lib/store'
import { clientsApi } from '../lib/clients'
import { SOURCING_SHIPPER } from '../lib/sourcing'
import { roleAllows, roleHome } from '../lib/ops'
import { scanQueue, startQueueSync, SCAN_QUEUE_EVENT } from '../lib/scan'
import { WifiOff, CloudUpload } from 'lucide-react'

interface Item { to: string; label: string; icon: typeof Inbox; end?: boolean; badge?: number; group?: string }

/**
 * The signed-in application: a fixed sidebar with role-specific navigation and a slim top bar, kept visually apart
 * from the marketing site. Marketing pages keep the big header/footer; everything under /dashboard and /admin lives here.
 */
export default function AppShell() {
  const { ready, user, logout, requests, shipments } = useStore()
  const loc = useLocation()
  const outlet = useOutlet()
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
  // Staff see only their area: a warehouse clerk who lands on the owner's overview goes to the warehouse, a finance user asking for Fleet goes home.
  if (user.role === 'shipper' && user.staffRole && !user.admin && loc.pathname.startsWith('/dashboard') && !roleAllows(user.staffRole, loc.pathname, user.perms as never)) return <Navigate to={roleHome[user.staffRole]} replace />

  const isShipper = user.role === 'shipper'
  const openLeads = isShipper ? requests.filter((r) => r.status === 'open' && !r.quotes.some((q) => q.shipperId === user.shipperId)).length : requests.reduce((n, r) => n + (r.status === 'open' ? r.quotes.length : 0), 0)
  const active = shipments.filter((s) => s.status !== 'delivered').length

  const staffRole = user.staffRole ?? 'owner'
  const isDriver = isShipper && staffRole === 'driver'
  const canManage = isShipper && (staffRole === 'owner' || staffRole === 'dispatcher')
  const allowed = (it: Item) => !isShipper || user.admin || roleAllows(staffRole, it.to.split('?')[0], user.perms as never) || !it.to.startsWith('/dashboard')
  const sourcingTeam = !!user.admin || (isShipper && user.shipperId === SOURCING_SHIPPER && !isDriver)
  const items: Item[] = isDriver
    ? [
        { to: '/dashboard/runs', label: 'My runs', icon: MapPinned, end: true },
        { to: '/dashboard/team', label: 'Team', icon: UsersRound },
      ]
    : isShipper
    ? [
        { to: '/dashboard/shipper', label: 'Overview', icon: LayoutDashboard, end: true },
        ...(sourcingTeam ? [{ to: '/dashboard/sourcing', label: 'Sourcing board', icon: Globe2, group: 'Sourcing' } as Item, { to: '/dashboard/sourcing/today', label: 'Today (phone)', icon: Smartphone, group: 'Sourcing' } as Item, { to: '/dashboard/suppliers', label: 'Suppliers', icon: Factory, group: 'Sourcing' } as Item] : []),
        { to: '/dashboard/leads', label: 'Requests', icon: Inbox, badge: openLeads, group: 'Sell' },
        { to: '/dashboard/rates', label: 'Rate cards', icon: Tags, group: 'Sell' },
        { to: '/dashboard/lanes', label: 'Lane intelligence', icon: BarChart3, group: 'Sell' },
        { to: '/dashboard/groupage', label: 'Fill a barrel', icon: Boxes, group: 'Sell' },
        ...(canManage ? [{ to: '/dashboard/brand', label: 'Branded page', icon: Globe, group: 'Sell' } as Item] : []),
        { to: '/dashboard/shipments', label: 'Client shipments', icon: Ship, badge: active, group: 'Operate' },
        { to: '/dashboard/containers', label: 'Containers', icon: Container, group: 'Operate' },
        { to: '/dashboard/sailings', label: 'Book a sailing', icon: Anchor, group: 'Operate' },
        { to: '/dashboard/pickups', label: 'Pickups', icon: CalendarCheck, group: 'Operate' },
        { to: '/dashboard/routes', label: 'Routes', icon: MapPinned, group: 'Operate' },
        { to: '/dashboard/warehouse', label: 'Warehouse', icon: Warehouse, group: 'Operate' },
        { to: '/dashboard/clients', label: 'Clients', icon: Users, badge: dueReminders, group: 'Money' },
        { to: '/dashboard/payments', label: 'Payments', icon: Wallet, group: 'Money' },
        { to: '/dashboard/collections', label: 'Collections', icon: Receipt, group: 'Money' },
        { to: '/dashboard/reviews', label: 'Reviews', icon: Star, group: 'Money' },
        ...(canManage ? [{ to: '/dashboard/fleet', label: 'Fleet', icon: Truck, group: 'Company' } as Item] : []),
        { to: '/dashboard/team', label: 'Team', icon: UsersRound, group: 'Company' },
        ...(canManage ? [{ to: '/dashboard/verification', label: 'Verification', icon: ShieldCheck, group: 'Company' } as Item] : []),
        ...(staffRole === 'owner' ? [{ to: '/dashboard/shipper?view=profile', label: 'Company profile', icon: UserCog, group: 'Company' } as Item] : []),
      ]
    : [
        { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/dashboard?tab=requests', label: 'Quote requests', icon: FileText, badge: openLeads },
        { to: '/dashboard?tab=shipments', label: 'Shipments', icon: Package, badge: active },
        { to: '/dashboard?tab=groupage', label: 'Shared barrels', icon: Boxes },
        { to: '/dashboard?tab=sourcing', label: 'China sourcing', icon: Globe2 },
        { to: '/dashboard?tab=invoices', label: 'Invoices', icon: Receipt },
        { to: '/quote', label: 'New request', icon: PlusCircle },
      ]
  const visible = items.filter(allowed)
  const tools: Item[] = [
    { to: '/dashboard/notifications', label: 'Notifications', icon: BellRing },
    ...(isShipper ? [{ to: '/dashboard/scan', label: 'Scan a sticker', icon: ScanLine } as Item] : []),
    ...(isDriver ? [] : [{ to: '/live', label: 'Live map', icon: Radar } as Item]),
    { to: '/track', label: 'Track a shipment', icon: Search },
    ...(user.admin ? [{ to: '/admin', label: 'Business', icon: BarChart3, end: true } as Item, { to: '/admin?view=attention', label: 'Attention', icon: BellRing } as Item, { to: '/admin?view=shippers', label: 'Verification', icon: ShieldCheck } as Item, { to: '/dashboard/sourcing', label: 'Sourcing board', icon: Globe2 } as Item] : []),
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
              {it.badge ? <span className={`rounded-full px-1.5 text-[11px] font-bold ${act ? 'bg-gold text-on-accent' : 'bg-surface-2 text-text'}`}>{it.badge}</span> : null}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5"><Logo /><button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-lg text-text-muted lg:hidden focus-ring" aria-label="Close menu"><X size={18} /></button></div>
      <div className="px-4 pb-3"><p className="truncate text-xs font-semibold uppercase tracking-wider text-text-muted">{isShipper ? user.company ?? 'Shipper' : 'Customer'}</p>{isShipper && user.staffRole && <p className="text-[11px] text-text-muted/70">{user.staffRole.charAt(0).toUpperCase() + user.staffRole.slice(1)}</p>}</div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3" aria-label="Application">
        <NavItems list={visible.filter((i) => !i.group)} />
        {Array.from(new Set(visible.map((i) => i.group).filter(Boolean))).map((g) => <div key={g}><p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">{g}</p><NavItems list={visible.filter((i) => i.group === g)} /></div>)}
        <div><p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">Tools</p><NavItems list={tools} /></div>
      </nav>
      <div className="border-t border-border p-3">
        <Link to="/" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><Globe size={17} aria-hidden="true" /> Ship Sync website <ExternalLink size={12} className="ml-auto" aria-hidden="true" /></Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-bg text-text lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="no-print sticky top-0 hidden h-screen border-r border-border bg-surface/60 lg:block">{sidebar}</aside>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Close menu" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="absolute inset-y-0 left-0 w-72 border-r border-border bg-bg">{sidebar}</motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-xl sm:gap-4 sm:px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg text-text focus-ring lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
            <span className="lg:hidden"><Logo tagline={false} /></span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitcher compact />
            {isShipper && <SyncBadge />}
            <NotificationBell />
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 !px-2 text-sm sm:!px-3" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gold text-[11px] font-bold text-on-accent">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                <span className="hidden sm:inline">{user.name.split(' ')[0]}</span><ChevronDown size={14} className="hidden sm:inline" aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-56 overflow-hidden p-1.5">
                    <p className="px-3 py-2 text-xs text-text-muted">{user.email}</p>
                    {isShipper && staffRole === 'owner' && <Link role="menuitem" to="/dashboard/shipper?view=profile" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><UserCog size={16} aria-hidden="true" /> Company profile</Link>}
                    {user.admin && <Link role="menuitem" to="/admin" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><ShieldCheck size={16} aria-hidden="true" /> Admin</Link>}
                    <button role="menuitem" onClick={() => { logout().finally(() => nav('/')) }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring"><LogOut size={16} aria-hidden="true" /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>
        <main id="main" className="ss-app flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Suspense fallback={<div className="p-10 text-center text-sm text-text-muted" aria-busy="true">Loading…</div>}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

/** Offline / pending-sync indicator for field staff: shows only when there is something to say. */
function SyncBadge() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [queued, setQueued] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    startQueueSync()
    const onQ = () => setQueued(scanQueue.list().length); onQ()
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener(SCAN_QUEUE_EVENT, onQ); window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener(SCAN_QUEUE_EVENT, onQ); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online && queued === 0) return null
  const flush = async () => { setBusy(true); try { await scanQueue.flush() } finally { setBusy(false) } }
  return (
    <button onClick={flush} disabled={!online || busy} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs focus-ring ${online ? 'border-gold/50 bg-gold/10 text-gold-deep' : 'border-border bg-surface-2 text-text-muted'}`} title={online ? 'Tap to sync now' : 'You are offline — scans and stop updates are saved on this phone'} data-testid="sync-badge">
      {online ? <CloudUpload size={13} aria-hidden="true" /> : <WifiOff size={13} aria-hidden="true" />}
      {online ? `${queued} to sync` : queued ? `Offline · ${queued} saved` : 'Offline'}
    </button>
  )
}
