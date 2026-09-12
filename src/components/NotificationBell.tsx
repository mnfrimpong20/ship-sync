import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, CheckCheck, Settings2 } from 'lucide-react'
import { NOTIFY_EVENT, ago, notificationsApi, type Notification, type NotifyKind } from '../lib/notifications'

const POLL_MS = 45_000

/** Small tinted dot per kind so the list scans quickly. */
export const kindTone: Record<NotifyKind, string> = {
  quote_received: 'bg-gold', booking_confirmed: 'bg-teal', shipment_status: 'bg-sky', quote_accepted: 'bg-teal',
  new_lead: 'bg-gold', container_update: 'bg-sky', invoice_overdue: 'bg-danger', system: 'bg-text-muted',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const nav = useNavigate()
  const loc = useLocation()
  const box = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try { const r = await notificationsApi.list(12); setItems(r.notifications); setUnread(r.unread) } catch { /* signed out or offline — keep what we have */ }
  }, [])
  useEffect(() => {
    void refresh()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_MS)
    const vis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', vis)
    const onChange = () => void refresh()
    window.addEventListener(NOTIFY_EVENT, onChange)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener(NOTIFY_EVENT, onChange) }
  }, [refresh])
  useEffect(() => { setOpen(false) }, [loc.pathname, loc.search])
  useEffect(() => {
    if (!open) return
    void refresh()
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, refresh])

  const openItem = async (n: Notification) => {
    if (!n.readAt) { setItems((l) => l.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))); setUnread((u) => Math.max(0, u - 1)); notificationsApi.markRead([n.id]).catch(() => {}) }
    setOpen(false)
    if (n.link) nav(n.link)
  }
  const readAll = async () => {
    setItems((l) => l.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() }))); setUnread(0)
    notificationsApi.markRead().catch(() => {})
  }

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:text-text focus-ring" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} aria-expanded={open} aria-haspopup="dialog" data-testid="notification-bell">
        <Bell size={18} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[10px] font-bold leading-none text-on-accent" data-testid="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="dialog" aria-label="Notifications" className="card-dark absolute right-0 mt-2 w-[min(92vw,380px)] overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Notifications{unread > 0 && <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">{unread} new</span>}</p>
              <div className="flex items-center gap-1">
                {unread > 0 && <button onClick={readAll} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><CheckCheck size={14} aria-hidden="true" /> Mark all read</button>}
                <Link to="/dashboard/notifications" className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label="Notification settings"><Settings2 size={15} /></Link>
              </div>
            </div>
            <ul className="max-h-[70vh] overflow-y-auto">
              {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-text-muted">You're all caught up.</li>}
              {items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => void openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70 focus-ring ${n.readAt ? '' : 'bg-gold/[0.04]'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-border' : kindTone[n.kind]}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${n.readAt ? 'text-text-muted' : 'font-semibold text-text'}`}>{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-text-muted/80">{ago(n.at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link to="/dashboard/notifications" className="block border-t border-border px-4 py-2.5 text-center text-xs font-semibold text-gold hover:bg-surface-2 focus-ring">See all notifications</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
