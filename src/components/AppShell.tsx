import { BrandLoader } from './BrandLoader'
import { useT } from '../lib/i18n'
import { adoptAccountDisplay } from '../lib/prefs'
import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, LifeBuoy, Anchor, BarChart3, LineChart, Calculator, Megaphone, Plug, CreditCard, History, Factory, Globe2, Smartphone, BellRing, Boxes, CalendarCheck, Receipt, ChevronDown, Tags, Container, ExternalLink, FileText, Globe, Inbox, LayoutDashboard, LogOut, MapPinned, Menu, Package, PlusCircle, Radar, ScanLine, Search, ShieldCheck, Ship, Star, Truck, UserCog, Users, UsersRound, Wallet, Warehouse, X, Printer } from 'lucide-react'
import { Avatar, Logo } from './ui'
import { PlatformBanners } from './PlatformBanners'
import { NotificationBell } from './NotificationBell'
import { QuickSearch } from './QuickSearch'
import { DisplaySettings } from './DisplaySettings'
import { useStore } from '../lib/store'
import { clientsApi } from '../lib/clients'
import { SOURCING_SHIPPER } from '../lib/sourcing'
import { roleAllows, roleHome } from '../lib/ops'
import { scanQueue, startQueueSync, SCAN_QUEUE_EVENT } from '../lib/scan'
import { Type, WifiOff, CloudUpload, CalendarDays, MessageSquare, FolderArchive, Repeat, AlertTriangle, CircleUser, Contact, Home } from 'lucide-react'
import { hubApi } from '../lib/customerHub'
import { refreshSummary, useSummary } from '../lib/account'

interface Item { to: string; label: string; icon: typeof Inbox; end?: boolean; badge?: number | string; group?: string; more?: boolean }

/**
 * The signed-in application: a fixed sidebar with role-specific navigation and a slim top bar, kept visually apart
 * from the marketing site. Marketing pages keep the big header/footer; everything under /dashboard and /admin lives here.
 */
export default function AppShell() {
  const { ready, user, logout, requests, shipments, shipperById } = useStore()
  const loc = useLocation()
  const outlet = useOutlet()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dueReminders, setDueReminders] = useState(0)
  const t = useT()
  const [displayOpen, setDisplayOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem('ss-nav-more') === '1' } catch { return false } })
  const toggleMore = () => setMoreOpen((v) => { try { localStorage.setItem('ss-nav-more', v ? '0' : '1') } catch { /* private mode */ } return !v })
  useEffect(() => { if (user?.display) adoptAccountDisplay(user.display) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(false); setMenu(false) }, [loc])
  const summary = useSummary(user?.role === 'customer')
  useEffect(() => { if (user?.role === 'customer') refreshSummary() }, [user, loc.pathname, loc.search])
  useEffect(() => {
    if (user?.role !== 'shipper') return
    clientsApi.remindersDue().then((r) => setDueReminders(r.filter((x) => x.dueAt && new Date(x.dueAt).getTime() < Date.now() + 86400000).length)).catch(() => {})
  }, [user, loc.pathname])

  if (!ready) return <BrandLoader label="Loading your account…" />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Staff see only their area: a warehouse clerk who lands on the owner's overview goes to the warehouse, a finance user asking for Fleet goes home.
  if (user.role === 'shipper' && user.staffRole && !user.admin && loc.pathname.startsWith('/dashboard') && !roleAllows(user.staffRole, loc.pathname, user.perms as never)) return <Navigate to={roleHome[user.staffRole]} replace />

  const isShipper = user.role === 'shipper'
  const company = isShipper && user.shipperId ? shipperById(user.shipperId) : undefined
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
        { to: '/dashboard/analytics', label: 'Analytics', icon: LineChart },
        ...(canManage ? [{ to: '/dashboard/autopilot', label: 'Autopilot', icon: Bot } as Item] : []),
        ...(sourcingTeam ? [{ to: '/dashboard/sourcing', label: 'Sourcing board', icon: Globe2, group: 'Sourcing' } as Item, { to: '/dashboard/sourcing/today', label: 'Today (phone)', icon: Smartphone, group: 'Sourcing' } as Item, { to: '/dashboard/suppliers', label: 'Suppliers', icon: Factory, group: 'Sourcing' } as Item] : []),
        { to: '/dashboard/leads', label: 'Requests', icon: Inbox, badge: openLeads, group: 'Sell' },
        { to: '/dashboard/rates', label: 'Rate cards', icon: Tags, group: 'Sell' },
        { to: '/dashboard/lanes', label: 'Lane intelligence', icon: BarChart3, group: 'Sell', more: true },
        { to: '/dashboard/groupage', label: 'Fill a barrel', icon: Boxes, group: 'Sell' },
        ...(['owner', 'dispatcher', 'agent'].includes(staffRole) ? [{ to: '/dashboard/campaigns', label: 'Campaigns', icon: Megaphone, group: 'Sell', more: true } as Item] : []),
        ...(canManage ? [{ to: '/dashboard/brand', label: 'Branded page', icon: Globe, group: 'Sell', more: true } as Item] : []),
        { to: '/dashboard/shipments', label: 'Client shipments', icon: Ship, badge: active, group: 'Operate' },
        { to: '/dashboard/containers', label: 'Containers', icon: Container, group: 'Operate' },
        { to: '/dashboard/sailings', label: 'Book a sailing', icon: Anchor, group: 'Operate' },
        { to: '/dashboard/pickups', label: 'Pickups', icon: CalendarCheck, group: 'Operate' },
        { to: '/dashboard/routes', label: 'Routes', icon: MapPinned, group: 'Operate' },
        { to: '/dashboard/warehouse', label: 'Warehouse', icon: Warehouse, group: 'Operate' },
        ...(staffRole !== 'driver' ? [{ to: '/dashboard/supplies', label: 'Equipment & supplies', icon: Printer, group: 'Operate' } as Item] : []),
        { to: '/dashboard/clients', label: 'Clients', icon: Users, badge: dueReminders, group: 'Money' },
        { to: '/dashboard/payments', label: 'Payments', icon: Wallet, group: 'Money' },
        { to: '/dashboard/collections', label: 'Collections', icon: Receipt, group: 'Money' },
        ...(['owner', 'dispatcher', 'finance'].includes(staffRole) ? [{ to: '/dashboard/costs', label: 'Costs & profit', icon: Calculator, group: 'Money' } as Item] : []),
        { to: '/dashboard/reviews', label: 'Reviews', icon: Star, group: 'Money' },
        ...(canManage ? [{ to: '/dashboard/fleet', label: 'Fleet', icon: Truck, group: 'Company', more: true } as Item] : []),
        { to: '/dashboard/team', label: 'Team', icon: UsersRound, group: 'Company' },
        ...(canManage ? [{ to: '/dashboard/integrations', label: 'Integrations', icon: Plug, group: 'Company', more: true } as Item, { to: '/dashboard/activity', label: 'Activity log', icon: History, group: 'Company', more: true } as Item] : []),
        ...(['owner', 'finance'].includes(staffRole) ? [{ to: '/dashboard/billing', label: 'Plan & billing', icon: CreditCard, group: 'Company', more: true } as Item] : []),
        ...(canManage ? [{ to: '/dashboard/verification', label: 'Verification', icon: ShieldCheck, group: 'Company', more: true } as Item] : []),
        ...(staffRole === 'owner' ? [{ to: '/dashboard/shipper?view=profile', label: 'Company profile', icon: UserCog, group: 'Company' } as Item] : []),
      ]
    : [
        { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/quote', label: 'New request', icon: PlusCircle },
        { to: '/dashboard?tab=requests', label: 'Quote requests', icon: FileText, badge: summary?.quotesWaiting || openLeads, group: 'Shipping' },
        { to: '/dashboard?tab=shipments', label: t('Shipments'), icon: Package, badge: summary?.activeShipments ?? active, group: 'Shipping' },
        { to: '/dashboard?tab=groupage', label: 'Shared barrels', icon: Boxes, group: 'Shipping', more: true },
        { to: '/dashboard?tab=sourcing', label: 'Sourcing', icon: Globe2, group: 'Shipping', more: true },
        { to: '/dashboard?tab=money', label: 'Money', icon: Wallet, badge: summary?.owe ? `$${Math.round(summary.owe).toLocaleString()}` : undefined, group: 'Money' },
        { to: '/dashboard?tab=invoices', label: 'Invoices', icon: Receipt, group: 'Money' },
        { to: '/dashboard?tab=week', label: 'This week', icon: CalendarDays, group: 'Organise' },
        { to: '/dashboard?tab=inbox', label: t('Messages'), icon: MessageSquare, badge: summary?.unread, group: 'Organise' },
        { to: '/dashboard?tab=documents', label: 'Documents', icon: FolderArchive, group: 'Organise' },
        { to: '/dashboard?tab=plans', label: 'Saved & repeat', icon: Repeat, group: 'Organise', more: true },
        { to: '/dashboard?tab=recipients', label: 'Recipients', icon: Contact, group: 'Organise' },
        { to: '/dashboard?tab=issues', label: 'Problems', icon: AlertTriangle, group: 'Help & account' },
        { to: '/dashboard?tab=account', label: 'Account', icon: CircleUser, group: 'Help & account' },
      ]
  const visible = items.filter(allowed)
  const tools: Item[] = [
    ...(isShipper ? [{ to: '/dashboard/notifications', label: 'Notifications', icon: BellRing } as Item] : []),
    ...(isShipper ? [{ to: '/dashboard/scan', label: 'Scan a sticker', icon: ScanLine } as Item] : []),
    ...(isDriver ? [] : [{ to: '/live', label: 'Live map', icon: Radar, more: !isShipper } as Item]),
    { to: '/track', label: 'Track a shipment', icon: Search },
    ...(isShipper ? [] : [{ to: '/', label: 'Ntemtem website', icon: Globe, more: true } as Item]),
    ...(user.admin ? [{ to: '/admin', label: 'Business', icon: BarChart3, end: true } as Item, { to: '/admin?view=attention', label: 'Attention', icon: BellRing } as Item, { to: '/admin?view=shippers', label: 'Verification', icon: ShieldCheck } as Item, { to: '/dashboard/sourcing', label: 'Sourcing board', icon: Globe2 } as Item] : []),
  ]

  const isActive = (it: Item) => {
    const [path, qs] = it.to.split('?')
    if (path === '/') return loc.pathname === '/'
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
            <NavLink to={it.to} className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-ring ${act ? 'bg-gold/15 font-semibold text-gold-deep' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`} aria-current={act ? 'page' : undefined}>
              <it.icon size={17} aria-hidden="true" /><span className="flex-1">{t(it.label)}</span>
              {it.badge ? <span className={`rounded-full px-1.5 text-xs font-bold ${act ? 'bg-gold text-on-accent' : 'bg-surface-2 text-text'}`}>{it.badge}</span> : null}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5"><Logo partner={isShipper} /><button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-lg text-text-muted lg:hidden focus-ring" aria-label="Close menu"><X size={18} /></button></div>
      <div className="flex items-center gap-2.5 px-4 pb-3">
        {isShipper && company && <Avatar initials={company.initials} hue={company.hue} logo={company.logo} size={32} />}
        <div className="min-w-0"><p className="truncate text-xs font-semibold uppercase tracking-wider text-text-muted">{isShipper ? user.company ?? 'Shipper' : t('Customer')}</p>{isShipper && user.staffRole && <p className="text-xs text-text-muted">{user.staffRole.charAt(0).toUpperCase() + user.staffRole.slice(1)}</p>}</div>
      </div>
      <nav className={`flex-1 overflow-y-auto px-3 ${isShipper ? 'space-y-5' : 'space-y-3.5'}`} aria-label="Application">
        <NavItems list={visible.filter((i) => !i.group && !i.more)} />
        {Array.from(new Set(visible.filter((i) => !i.more).map((i) => i.group).filter(Boolean))).map((g) => <div key={g}><p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t(g!)}</p><NavItems list={visible.filter((i) => i.group === g && !i.more)} /></div>)}
        {tools.some((i) => !i.more) && <div><p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('Tools')}</p><NavItems list={tools.filter((i) => !i.more)} /></div>}
        {[...visible, ...tools].some((i) => i.more) && (() => { const rest = [...visible, ...tools].filter((i) => i.more); const open2 = moreOpen || rest.some(isActive); return (
          <div data-testid="nav-more"><button type="button" onClick={() => toggleMore()} aria-expanded={open2} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><ChevronDown size={17} className={`transition-transform ${open2 ? 'rotate-180' : ''}`} aria-hidden="true" /><span className="flex-1 text-left">{open2 ? t('Less') : t('More')}</span></button>{open2 && <NavItems list={rest} />}</div>) })()}
      </nav>
 {isShipper && <div className="border-t border-border p-3">
        <Link to="/" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><Globe size={17} aria-hidden="true" /> Ntemtem website <ExternalLink size={12} className="ml-auto" aria-hidden="true" /></Link>
      </div>}
    </div>
  )

  return (
    <div className={`min-h-screen bg-bg text-text lg:grid lg:grid-cols-[256px_minmax(0,1fr)] ${isShipper ? 'ss-partner' : ''}`}>
      <a href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView() }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:font-semibold focus:text-on-accent" data-testid="skip-link">{t('Skip to content')}</a>
      <aside aria-label="Portal menu" className="ss-sidebar no-print sticky top-0 hidden h-screen border-r border-border bg-surface/60 lg:block">{sidebar}</aside>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Close menu" />
            <motion.aside aria-label="Portal menu" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="ss-sidebar absolute inset-y-0 left-0 w-72 border-r border-border bg-bg">{sidebar}</motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-xl sm:gap-4 sm:px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg text-text focus-ring lg:hidden" aria-label={t('Open menu')}><Menu size={20} /></button>
            <span className="lg:hidden"><Logo tagline={false} partner={isShipper} /></span>
          </div>
          <div className="flex items-center gap-2">
            {isShipper && <SyncBadge />}
            <QuickSearch isShipper={isShipper} pages={[...visible, ...tools].filter((i) => !i.to.startsWith('/admin') && i.to !== '/').map((i) => ({ to: i.to, label: t(i.label), group: i.group ? t(i.group) : undefined }))} />
            <NotificationBell />
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="btn-ghost !min-h-10 !px-2 text-sm sm:!px-3" aria-expanded={menu} aria-haspopup="menu">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gold text-xs font-bold text-on-accent">{user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
                <span className="hidden sm:inline">{user.name.split(' ')[0]}</span><ChevronDown size={14} className="hidden sm:inline" aria-hidden="true" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="menu" className="card-dark absolute right-0 mt-2 w-56 overflow-hidden p-1.5">
                    <p className="px-3 py-2 text-xs text-text-muted">{user.email}</p>
                    {isShipper && staffRole === 'owner' && <Link role="menuitem" to="/dashboard/shipper?view=profile" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><UserCog size={16} aria-hidden="true" /> Company profile</Link>}
                    <button role="menuitem" onClick={() => { setMenu(false); setDisplayOpen(true) }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring" data-testid="menu-display"><Type size={16} aria-hidden="true" /> {t('Display & language')}</button>
                    <Link role="menuitem" to="/support" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><LifeBuoy size={16} aria-hidden="true" /> {t('Help & support')}</Link>
                    {user.admin && <Link role="menuitem" to="/admin" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 focus-ring"><ShieldCheck size={16} aria-hidden="true" /> Admin</Link>}
                    <button role="menuitem" onClick={() => { logout().finally(() => nav('/')) }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-ring"><LogOut size={16} aria-hidden="true" /> Sign out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>
        <AnimatePresence>{displayOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onMouseDown={() => setDisplayOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label={t('Display & language')} className="relative w-full max-w-md" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setDisplayOpen(false) }} data-testid="display-dialog">
              <DisplaySettings />
              <button autoFocus onClick={() => setDisplayOpen(false)} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label={t('Close')}><X size={18} /></button>
            </div>
          </motion.div>
        )}</AnimatePresence>
        <PlatformBanners />
        {user?.actingBy && <div data-testid="acting-banner" role="status" className="flex flex-wrap items-center justify-center gap-3 border-b border-gold/40 bg-gold/10 px-4 py-2 text-sm"><span>You’re using <b>{user.name}</b>’s account as {user.actingBy.name}.</span><button data-testid="acting-exit" onClick={() => { hubApi.switchTo(null).finally(() => { window.location.hash = '#/dashboard'; window.location.reload() }) }} className="rounded-md border border-gold/50 px-2.5 py-1 text-xs font-semibold text-gold-deep hover:bg-gold/10 focus-ring">Switch back to my account</button></div>}
        <main id="main" tabIndex={-1} className={`ss-app flex-1 outline-none ${isShipper ? '' : 'pb-20 lg:pb-0'}`}>
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Suspense fallback={<BrandLoader partner={isShipper} />}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
        {!isShipper && <BottomBar unread={summary?.unread ?? 0} owe={summary?.owe ?? 0} onMenu={() => setOpen(true)} />}
      </div>
    </div>
  )
}

/** Phone-only tab bar for customers: the four places people go most, plus the full menu. */
function BottomBar({ unread, owe, onMenu }: { unread: number; owe: number; onMenu: () => void }) {
  const loc = useLocation(); const tab = new URLSearchParams(loc.search).get('tab'); const t = useT()
  const short = owe >= 1000 ? `$${(owe / 1000).toFixed(owe >= 10000 ? 0 : 1)}k` : `$${Math.round(owe)}`
  const items: { to: string; label: string; icon: typeof Home; on: boolean; badge?: string | number }[] = [
    { to: '/dashboard', label: t('Home'), icon: Home, on: loc.pathname === '/dashboard' && !tab },
    { to: '/dashboard?tab=shipments', label: t('Shipments'), icon: Package, on: tab === 'shipments' },
    { to: '/dashboard?tab=inbox', label: t('Messages'), icon: MessageSquare, on: tab === 'inbox', badge: unread || undefined },
    { to: '/dashboard?tab=money', label: t('Pay'), icon: Wallet, on: tab === 'money' || tab === 'invoices', badge: owe > 0 ? short : undefined },
  ]
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Quick menu" data-testid="bottom-bar">
      {items.map((it) => (
        <Link key={it.to} to={it.to} aria-current={it.on ? 'page' : undefined} className={`relative flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 text-xs focus-ring ${it.on ? 'font-semibold text-gold-deep' : 'text-text-muted'}`} data-testid={`bb-${it.label.toLowerCase()}`}>
          <it.icon size={20} aria-hidden="true" />{it.label}
          {it.badge ? <span className="absolute left-[calc(50%+4px)] top-1.5 min-w-4 rounded-full bg-gold px-1 text-center text-[11px] font-bold leading-4 text-on-accent">{it.badge}</span> : null}
        </Link>
      ))}
      <button type="button" onClick={onMenu} className="flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 text-xs text-text-muted focus-ring" data-testid="bb-menu" aria-label={t('Open menu')}><Menu size={20} aria-hidden="true" />{t('More')}</button>
    </nav>
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
