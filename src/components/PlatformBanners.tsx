import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Eye, Info, Megaphone, X } from 'lucide-react'
import { platformApi, type Announcement } from '../lib/platform'
import { useStore } from '../lib/store'

/** Top-of-app bands: the read-only "View as" banner for admins, then any live announcements. */
export function PlatformBanners() {
  const { user } = useStore()
  const [items, setItems] = useState<Announcement[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (user) platformApi.announcements().then(setItems).catch(() => setItems([])) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null
  const exit = async () => { setBusy(true); try { await platformApi.exitViewAs() } finally { window.location.assign('/admin?view=support') } }
  const tone = { critical: 'border-danger/40 bg-danger/10 text-danger', warning: 'border-gold/50 bg-gold/15 text-gold-deep', info: 'border-sky/40 bg-sky/10 text-sky' } as const
  const Icon = { critical: AlertTriangle, warning: Megaphone, info: Info } as const
  return (
    <div className="print:hidden">
      {user.readOnly && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger" data-testid="view-as-banner">
          <span className="inline-flex items-center gap-2"><Eye size={15} aria-hidden="true" /><b>Viewing as {user.name}</b> ({user.email}) — read only. Every page you open is logged.</span>
          <button type="button" onClick={exit} disabled={busy} className="rounded-lg border border-danger/50 px-3 py-1 font-semibold hover:bg-danger/10 focus-ring" data-testid="view-as-exit">Exit view</button>
        </div>
      )}
      {items.map((a) => { const I = Icon[a.level]; return (
        <div key={a.id} role={a.level === 'critical' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 border-b px-4 py-2 text-sm ${tone[a.level]}`} data-testid="announcement">
          <p className="min-w-0"><I size={15} className="mr-1.5 inline -mt-0.5" aria-hidden="true" /><b>{a.title}</b>{a.body && <span className="text-text"> — {a.body}</span>}{a.link && (a.link.startsWith('http') ? <a href={a.link} target="_blank" rel="noreferrer" className="ml-2 font-semibold underline">Details</a> : <Link to={a.link} className="ml-2 font-semibold underline">Details</Link>)}</p>
          {!user.readOnly && <button type="button" aria-label="Dismiss announcement" onClick={() => { setItems((x) => x.filter((y) => y.id !== a.id)); void platformApi.dismiss(a.id) }} className="shrink-0 rounded p-1 hover:bg-black/5 focus-ring" data-testid="announcement-dismiss"><X size={14} aria-hidden="true" /></button>}
        </div>
      ) })}
    </div>
  )
}
