import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, Bell, Check, ChevronRight, Mail, MessageCircle, Phone, Plus, Search, Users, Wallet, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { clientsApi, type Activity, type Client, type ClientInput } from '../lib/clients'
import { Empty, Pill, fmtDate, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const hueFor = (id: string) => `hsl(${[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 55%)`
export const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, '')}`

export function ClientAvatar({ c, size = 40 }: { c: Pick<Client, 'id' | 'name'>; size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-full font-heading font-bold text-ink" style={{ width: size, height: size, background: hueFor(c.id), fontSize: size * 0.38 }} aria-hidden="true">{initialsOf(c.name)}</span>
}

const blank: ClientInput = { name: '', company: '', email: '', phone: '', whatsapp: '', city: '', tags: [], notes: '' }

export function ClientForm({ initial = blank, onSave, onCancel, busy, error }: { initial?: ClientInput; onSave: (c: ClientInput) => void; onCancel: () => void; busy: boolean; error: string }) {
  const [f, setF] = useState<ClientInput>(initial)
  const [tag, setTag] = useState('')
  const addTag = () => { const t = tag.trim().toLowerCase(); if (t && !f.tags.includes(t) && f.tags.length < 12) setF({ ...f, tags: [...f.tags, t] }); setTag('') }
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f) }} className="grid gap-3 md:grid-cols-2" aria-label="Client details">
      {error && <p role="alert" className="md:col-span-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div><label htmlFor="c-name" className="label-dark">Name</label><input id="c-name" className="input-dark" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label htmlFor="c-company" className="label-dark">Company (optional)</label><input id="c-company" className="input-dark" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
      <div><label htmlFor="c-email" className="label-dark">Email</label><input id="c-email" type="email" className="input-dark" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor="c-phone" className="label-dark">Phone</label><input id="c-phone" className="input-dark" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div><label htmlFor="c-wa" className="label-dark">WhatsApp</label><input id="c-wa" className="input-dark" placeholder="+1 …" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></div>
      <div><label htmlFor="c-city" className="label-dark">City</label><input id="c-city" className="input-dark" placeholder="Houston, TX" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
      <div className="md:col-span-2"><label htmlFor="c-tag" className="label-dark">Tags</label>
        <div className="flex flex-wrap items-center gap-2">
          {f.tags.map((t) => <button type="button" key={t} onClick={() => setF({ ...f, tags: f.tags.filter((x) => x !== t) })} className="rounded-full border border-gold bg-gold/15 px-2.5 py-1 text-xs text-gold focus-ring" aria-label={`Remove tag ${t}`}>{t} <X size={11} className="inline" aria-hidden="true" /></button>)}
          <input id="c-tag" className="input-dark !min-h-9 max-w-[180px] text-sm" placeholder="repeat, vehicles…" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }} onBlur={addTag} />
        </div>
      </div>
      <div className="md:col-span-2"><label htmlFor="c-notes" className="label-dark">Notes</label><textarea id="c-notes" rows={3} className="input-dark py-2" placeholder="How they like to be contacted, payment habits, typical cargo…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={15} aria-hidden="true" /> {busy ? 'Saving…' : 'Save client'}</button></div>
    </form>
  )
}

export default function Clients() {
  const { ready, user } = useStore()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [clients, setClients] = useState<Client[] | null>(null)
  const [reminders, setReminders] = useState<Activity[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived' | 'marketplace' | 'manual' | 'owing'>(() => (['active', 'archived', 'marketplace', 'manual', 'owing'].includes(sp.get('filter') ?? '') ? (sp.get('filter') as 'owing') : 'active'))
  const [adding, setAdding] = useState(sp.get('new') === '1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ready || !user || user.role !== 'shipper') return
    let live = true
    Promise.all([clientsApi.list(), clientsApi.remindersDue()]).then(([c, r]) => { if (live) { setClients(c); setReminders(r) } }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load clients.'))
    return () => { live = false }
  }, [ready, user])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (clients ?? []).filter((c) => {
      if (filter === 'active' && c.status !== 'active') return false
      if (filter === 'archived' && c.status !== 'archived') return false
      if (filter === 'marketplace' && c.source !== 'marketplace') return false
      if (filter === 'manual' && c.source !== 'manual') return false
      if (filter === 'owing' && (c.invoiced ?? 0) - (c.paid ?? 0) <= 0) return false
      if (!s) return true
      return [c.name, c.company, c.email, c.phone, c.city, ...c.tags].join(' ').toLowerCase().includes(s)
    })
  }, [clients, q, filter])

  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/clients" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const active = (clients ?? []).filter((c) => c.status === 'active')
  const outstanding = (clients ?? []).reduce((n, c) => n + Math.max(0, (c.invoiced ?? 0) - (c.paid ?? 0)), 0)
  const overdue = reminders.filter((r) => r.dueAt && new Date(r.dueAt).getTime() < Date.now())

  const save = async (c: ClientInput) => {
    setBusy(true); setError('')
    try { const created = await clientsApi.create(c); nav(`/dashboard/clients/${created.id}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Clients</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{user.company ?? 'Your'} clients</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Everyone you ship for — marketplace customers and your own book of business — with consignees, bookings, invoices and follow-ups in one place.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2"><button onClick={() => setAdding(true)} className="btn-gold"><Plus size={16} aria-hidden="true" /> Add client</button></motion.div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Active clients</p><Users size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{active.length}</p><p className="mt-1 text-xs text-text-muted">{active.filter((c) => c.source === 'marketplace').length} via Ship Sync · {active.filter((c) => c.source === 'manual').length} your own</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Shipments in progress</p><ChevronRight size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{active.reduce((n, c) => n + (c.activeShipments ?? 0), 0)}</p><p className="mt-1 text-xs text-text-muted">Across all clients</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Outstanding balance</p><Wallet size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{money(outstanding)}</p><p className="mt-1 text-xs text-text-muted">Invoiced but not yet paid</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Follow-ups due</p><Bell size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{reminders.length}</p><p className="mt-1 text-xs text-text-muted">{overdue.length ? <span className="text-gold">{overdue.length} overdue</span> : 'None overdue'}</p></motion.div>
          </div>

          {reminders.length > 0 && (
            <motion.div variants={fadeUp} className="mt-6 card-dark p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Next follow-ups</p>
              <ul className="divide-y divide-border">
                {reminders.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2"><Bell size={14} className={r.dueAt && new Date(r.dueAt).getTime() < Date.now() ? 'text-gold' : 'text-text-muted'} aria-hidden="true" /><Link to={`/dashboard/clients/${r.clientId}?tab=activity`} className="font-medium text-text hover:text-gold focus-ring rounded">{r.clientName}</Link><span className="text-text-muted">— {r.body}</span></span>
                    <span className={`text-xs ${r.dueAt && new Date(r.dueAt).getTime() < Date.now() ? 'text-gold' : 'text-text-muted'}`}>{r.dueAt ? fmtDate(r.dueAt) : ''}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          <AnimatePresence>
            {adding && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-6">
                <h2 className="!text-lg">New client</h2>
                <p className="mb-4 mt-1 text-sm text-text-muted">For customers who come to you directly. Customers who book through Ship Sync are added automatically.</p>
                <ClientForm onSave={save} onCancel={() => { setAdding(false); setError('') }} busy={busy} error={error} />
              </motion.div>
            )}
          </AnimatePresence>
          {!adding && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label="Search clients" className="input-dark !min-h-10 !pl-9 text-sm" placeholder="Search name, company, phone, tag…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {([['active', 'Active'], ['marketplace', 'Via Ship Sync'], ['manual', 'Own clients'], ['owing', 'Owing'], ['archived', 'Archived']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${filter === k ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{label}</button>
            ))}
          </motion.div>

          <motion.ul variants={fadeUp} className="mt-4 space-y-2" aria-label="Clients">
            {clients && list.length === 0 && <li><Empty title={clients.length ? 'No clients match' : 'No clients yet'} body={clients.length ? 'Try another search or filter.' : 'Add your first client, or they’ll appear here automatically when a customer books you through Ship Sync.'} action={!clients.length ? <button onClick={() => setAdding(true)} className="btn-gold">Add client</button> : undefined} /></li>}
            {list.map((c) => {
              const owing = Math.max(0, (c.invoiced ?? 0) - (c.paid ?? 0))
              const remindDue = c.nextReminderAt ? new Date(c.nextReminderAt).getTime() < Date.now() : false
              return (
                <li key={c.id}>
                  <Link to={`/dashboard/clients/${c.id}`} className="card-dark flex flex-wrap items-center gap-4 p-4 transition-colors hover:bg-surface-2/60 focus-ring">
                    <ClientAvatar c={c} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-text">{c.name}{c.company && <span className="font-normal text-text-muted">· {c.company}</span>}{c.source === 'marketplace' ? <Pill tone="teal">Ship Sync</Pill> : <Pill tone="muted">Own client</Pill>}{c.status === 'archived' && <Pill tone="muted">Archived</Pill>}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-text-muted">{c.city && <span>{c.city}</span>}{c.phone && <span className="inline-flex items-center gap-1"><Phone size={11} aria-hidden="true" />{c.phone}</span>}{c.email && <span className="inline-flex items-center gap-1"><Mail size={11} aria-hidden="true" />{c.email}</span>}{c.whatsapp && <span className="inline-flex items-center gap-1"><MessageCircle size={11} aria-hidden="true" />WhatsApp</span>}</p>
                      {c.tags.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">{t}</span>)}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-right text-xs text-text-muted sm:min-w-[300px]">
                      <div><p className="font-heading text-lg font-bold text-text">{c.shipmentCount ?? 0}</p><p>shipments{c.activeShipments ? ` · ${c.activeShipments} active` : ''}</p></div>
                      <div><p className={`font-heading text-lg font-bold ${owing ? 'text-gold' : 'text-text'}`}>{money(owing)}</p><p>owing</p></div>
                      <div><p className={`font-heading text-lg font-bold ${remindDue ? 'text-gold' : 'text-text'}`}>{c.nextReminderAt ? fmtDate(c.nextReminderAt) : '—'}</p><p className="inline-flex items-center gap-1 justify-end">{remindDue && <AlertCircle size={11} className="text-gold" aria-hidden="true" />}follow-up</p></div>
                    </div>
                    <ChevronRight size={18} className="text-text-muted" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </motion.ul>
        </motion.div>
      </div>
    </div>
  )
}
