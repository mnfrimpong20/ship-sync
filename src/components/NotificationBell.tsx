import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, CheckCheck, Settings2 } from 'lucide-react'
import { useT } from '../lib/i18n'
import { NOTIFY_EVENT, ago, notificationsApi, type Notification, type NotifyKind } from '../lib/notifications'

const POLL_MS = 45_000
/** Which shipment (or page) a notification is about, so several updates on one shipment read as one line. */
export function notifGroupKey(n: Notification) {
  try { const u = new URL(n.link || '/', 'https://x'); const id = u.searchParams.get('s') ?? u.searchParams.get('open') ?? u.searchParams.get('ref'); if (id) return 'ship:' + id; return n.link ? 'link:' + u.pathname + u.search : 'id:' + n.id } catch { return 'id:' + n.id }
}

/** Small tinted dot per kind so the list scans quickly. */
export const kindTone: Record<NotifyKind, string> = {
  quote_received: 'bg-gold', booking_confirmed: 'bg-teal', shipment_status: 'bg-sky', document: 'bg-sky', pickup: 'bg-gold', insurance: 'bg-teal', payment: 'bg-gold', groupage: 'bg-sky', customs: 'bg-gold', review: 'bg-teal', dispute: 'bg-danger', sourcing: 'bg-gold', quote_accepted: 'bg-teal',
  new_lead: 'bg-gold', container_update: 'bg-sky', invoice_overdue: 'bg-danger', quote_lost: 'bg-text-muted', request_update: 'bg-sky', system: 'bg-text-muted',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const nav = useNavigate()
  const t = useT()
  // Newest first; later updates on the same shipment fold under the newest one.
  const groups = useMemo(() => { const m = new Map<string, Notification[]>(); for (const n of items) { const k = notifGroupKey(n); m.set(k, [...(m.get(k) ?? []), n]) } return [...m.values()] }, [items])
  const loc = useLocation()
  const box = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try { const r = await notificationsApi.list(30); setItems(r.notifications); setUnread(r.unread) } catch { /* signed out or offline — keep what we have */ }
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

  const openItem = async (n: Notification, group: Notification[] = [n]) => {
    const ids = group.filter((x) => !x.readAt).map((x) => x.id)
    if (ids.length) { setItems((l) => l.map((x) => (ids.includes(x.id) ? { ...x, readAt: new Date().toISOString() } : x))); setUnread((u) => Math.max(0, u - ids.length)); notificationsApi.markRead(ids).catch(() => {}) }
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
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[11px] font-bold leading-none text-on-accent" data-testid="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="dialog" aria-label="Notifications" className="card-dark absolute right-0 mt-2 w-[min(92vw,380px)] overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{t('Notifications')}{unread > 0 && <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold-deep">{unread} new</span>}</p>
              <div className="flex items-center gap-1">
                {unread > 0 && <button onClick={readAll} className="inline-flex min-h-10 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text focus-ring" data-testid="mark-all-read"><CheckCheck size={14} aria-hidden="true" /> {t('Mark all read')}</button>}
                <Link to="/dashboard/notifications" className="grid h-10 w-10 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label="Notification settings"><Settings2 size={15} /></Link>
              </div>
            </div>
            <ul className="max-h-[70vh] overflow-y-auto">
              {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-text-muted">You're all caught up.</li>}
              {groups.map((g) => { const n = g[0]; const fresh = g.filter((x) => !x.readAt).length; return (
                <li key={n.id} data-testid="notif-group">
                  <button onClick={() => void openItem(n, g)} className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70 focus-ring ${fresh ? 'bg-gold/[0.04]' : ''}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${fresh ? kindTone[n.kind] : 'bg-border'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${fresh ? 'font-semibold text-text' : 'text-text-muted'}`}>{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{n.body}</span>}
                      <span className="mt-1 block text-xs text-text-muted">{ago(n.at)}{g.length > 1 && <> · <span className="font-semibold" data-testid="notif-more">+{g.length - 1} earlier update{g.length === 2 ? '' : 's'}</span></>}</span>
                    </span>
                  </button>
                </li>
              ) })}
            </ul>
            <Link to="/dashboard/notifications" className="block border-t border-border px-4 py-2.5 text-center text-xs font-semibold text-gold-deep hover:bg-surface-2 focus-ring">{t('See all')}</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
