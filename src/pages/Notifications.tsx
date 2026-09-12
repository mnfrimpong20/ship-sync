import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { BellRing, CheckCheck, Inbox, Mail, MailCheck, MailX, Send, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { ago, notificationsApi, type Notification, type NotificationsResponse, type NotifyKind, type NotifyPrefs } from '../lib/notifications'
import { kindTone } from '../components/NotificationBell'
import { Chip, Pager, StatCard, usePaged } from '../components/board'
import { fmtDateTime } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

type Filter = 'all' | 'unread' | NotifyKind

export default function Notifications() {
  const { user } = useStore()
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string>('')
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => notificationsApi.list(200).then(setData).catch(() => setData((d) => d ?? { notifications: [], unread: 0, prefs: { email: true, muted: [] }, kinds: [], email: { provider: 'off', to: '' } }))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t) }, [flash])

  const items = data?.notifications ?? []
  const list = useMemo(() => items.filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.readAt : n.kind === filter)), [items, filter])
  const p = usePaged(list, 15, filter)
  const kindsSeen = useMemo(() => Array.from(new Set(items.map((n) => n.kind))), [items])
  const labelOf = (k: NotifyKind) => data?.kinds.find((x) => x.id === k)?.label ?? (k === 'system' ? 'Account' : k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))

  const readAll = async () => { setBusy('all'); try { await notificationsApi.markRead(); await load() } finally { setBusy('') } }
  const readOne = (n: Notification) => { if (n.readAt) return; setData((d) => d && { ...d, unread: Math.max(0, d.unread - 1), notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) }); notificationsApi.markRead([n.id]).catch(() => {}) }
  const remove = async (n: Notification) => { setBusy(n.id); try { await notificationsApi.remove(n.id); setData((d) => d && { ...d, unread: n.readAt ? d.unread : Math.max(0, d.unread - 1), notifications: d.notifications.filter((x) => x.id !== n.id) }) } finally { setBusy('') } }
  const savePrefs = async (patch: Partial<NotifyPrefs>) => {
    if (!data) return
    const next = { ...data.prefs, ...patch }
    setData({ ...data, prefs: next })
    try { await notificationsApi.setPrefs(patch); setFlash({ ok: true, text: 'Preferences saved.' }) } catch (e) { setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }); void load() }
  }
  const sendTest = async () => {
    setBusy('test')
    try { const r = await notificationsApi.sendTest(); setFlash(r.error ? { ok: false, text: `Email failed: ${r.error}` } : { ok: true, text: r.notification.emailStatus === 'sent' ? `Test email sent to ${data?.email.to}.` : 'Test notification created.' }); await load() } catch (e) { setFlash({ ok: false, text: e instanceof Error ? e.message : 'Could not send.' }) } finally { setBusy('') }
  }

  if (!user) return null
  const emailOn = data?.email.provider !== 'off'
  const sent = items.filter((n) => n.emailStatus === 'sent').length

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto max-w-6xl">
      <motion.div variants={fadeUp} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1 className="mt-1">Notifications</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">{user.role === 'customer' ? 'Quotes, booking confirmations and every milestone your shipment passes — here and, if you like, in your inbox.' : 'New leads, accepted quotes, container news from the line, deliveries and overdue invoices — for you and your team.'}</p>
        </div>
        {data && data.unread > 0 && <button onClick={readAll} disabled={busy === 'all'} className="btn-ghost !min-h-10 !px-4 text-sm"><CheckCheck size={16} aria-hidden="true" /> Mark all as read</button>}
      </motion.div>

      <motion.div variants={fadeUp} className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Unread" value={data?.unread ?? '—'} hint={data?.unread ? 'Waiting for you' : 'All caught up'} icon={BellRing} active={filter === 'unread'} onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')} />
        <StatCard label="Last 30 days" value={items.filter((n) => Date.now() - new Date(n.at).getTime() < 30 * 86400000).length} hint="Alerts received" icon={Inbox} active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard label="Email" value={emailOn ? (data?.prefs.email ? 'On' : 'Off') : 'Not set up'} hint={emailOn ? `${sent} sent to ${data?.email.to}` : 'Bell alerts only — see below'} icon={emailOn ? MailCheck : MailX} warn={!emailOn} />
      </motion.div>

      <motion.div variants={fadeUp} className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card-dark overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={items.length}>All</Chip>
            <Chip active={filter === 'unread'} onClick={() => setFilter('unread')} count={data?.unread}>Unread</Chip>
            {kindsSeen.map((k) => <Chip key={k} active={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)} count={items.filter((n) => n.kind === k).length}>{labelOf(k)}</Chip>)}
          </div>
          {list.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Inbox size={28} className="mx-auto text-text-muted" aria-hidden="true" />
              <p className="mt-3 font-semibold">{items.length ? 'Nothing matches this filter.' : 'No notifications yet.'}</p>
              <p className="mt-1 text-sm text-text-muted">{items.length ? 'Try another filter.' : user.role === 'customer' ? 'You’ll hear from us as soon as a shipper quotes your request.' : 'You’ll hear about new leads on your lanes and every accepted quote.'}</p>
            </div>
          ) : (
            <ul>
              {p.rows.map((n) => (
                <li key={n.id} className={`group flex gap-3 border-b border-border/70 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-2/60 ${n.readAt ? '' : 'bg-gold/[0.04]'}`} data-testid="notification-row">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-border' : kindTone[n.kind]}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      {n.link ? <Link to={n.link} onClick={() => readOne(n)} className={`text-sm hover:underline ${n.readAt ? 'text-text-muted' : 'font-semibold text-text'}`}>{n.title}</Link> : <span className={`text-sm ${n.readAt ? 'text-text-muted' : 'font-semibold text-text'}`}>{n.title}</span>}
                      <span className="text-[11px] uppercase tracking-wider text-text-muted/80">{labelOf(n.kind)}</span>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-text-muted">{n.body}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted/80">
                      <span title={fmtDateTime(n.at)}>{ago(n.at)}</span>
                      {n.emailStatus === 'sent' && <span className="inline-flex items-center gap-1"><Mail size={11} aria-hidden="true" /> emailed</span>}
                      {n.emailStatus === 'failed' && <span className="inline-flex items-center gap-1 text-danger"><MailX size={11} aria-hidden="true" /> email failed</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {!n.readAt && <button onClick={() => readOne(n)} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label="Mark as read"><CheckCheck size={14} /></button>}
                    <button onClick={() => void remove(n)} disabled={busy === n.id} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-danger focus-ring" aria-label="Delete notification"><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-3"><Pager p={p} noun="notification" /></div>
        </section>

        <aside className="space-y-4">
          <section className="card-dark p-5">
            <h2 className="!text-base">Preferences</h2>
            <p className="mt-1 text-xs text-text-muted">Everything still shows under the bell. Choose what also goes to email.</p>
            <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
              <span className="text-sm"><span className="block font-medium">Email alerts</span><span className="block text-xs text-text-muted">{emailOn ? `to ${data?.email.to}` : 'No email provider configured yet'}</span></span>
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-gold)]" checked={Boolean(data?.prefs.email)} disabled={!data} onChange={(e) => void savePrefs({ email: e.target.checked })} aria-label="Email alerts" />
            </label>
            <p className="mt-4 text-[11px] uppercase tracking-wider text-text-muted">Notify me about</p>
            <ul className="mt-2 space-y-1.5">
              {(data?.kinds ?? []).map((k) => {
                const on = !data?.prefs.muted.includes(k.id)
                return (
                  <li key={k.id}>
                    <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2/60">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={on} disabled={!data} onChange={(e) => void savePrefs({ muted: e.target.checked ? (data?.prefs.muted ?? []).filter((x) => x !== k.id) : [...(data?.prefs.muted ?? []), k.id] })} />
                      <span className={on ? '' : 'text-text-muted'}>{k.label}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {flash && <p role="status" className={`mt-3 text-xs ${flash.ok ? 'text-teal' : 'text-danger'}`}>{flash.text}</p>}
          </section>
          <section className="card-dark p-5">
            <h2 className="!text-base">Email delivery</h2>
            {emailOn ? (
              <>
                <p className="mt-1 text-xs text-text-muted">Sending via {data?.email.provider === 'log' ? 'the server console (dev mode)' : 'Resend'}. Send yourself a test to check it lands.</p>
                <button onClick={sendTest} disabled={busy === 'test' || !data?.prefs.email} className="btn-ghost mt-3 !min-h-10 !px-4 text-sm"><Send size={15} aria-hidden="true" /> {busy === 'test' ? 'Sending…' : 'Send a test email'}</button>
              </>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-text-muted">Email isn’t connected on this server yet. The bell and this page keep working; to get emails, the administrator adds <code className="rounded bg-surface-2 px-1">RESEND_API_KEY</code> and <code className="rounded bg-surface-2 px-1">EMAIL_FROM</code> to the server settings.</p>
            )}
          </section>
        </aside>
      </motion.div>
    </motion.div>
  )
}
