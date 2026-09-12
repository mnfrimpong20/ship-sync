import { Fragment, useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ArrowLeft, Ban, Bell, Check, ChevronDown, ChevronRight, Ellipsis, FileText, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Printer, RotateCcw, Search, Send, Ship, Star, Trash2, Wallet, X } from 'lucide-react'
import { cargoLabel, cargoTypes, countries, countryByCode, origins, statusLabels, type CargoType, type Mode } from '../lib/data'
import { useStore } from '../lib/store'
import { activityLabel, clientsApi, paymentMethods, type Activity, type ActivityType, type BookingInput, type ClientDetail as Detail, type Consignee, type ConsigneeInput, type Invoice, type InvoiceItem } from '../lib/clients'
import { ClientAvatar, ClientForm, waLink } from './Clients'
import { ModeBadge, Pill, fmtDate, fmtDateTime, money } from '../components/ui'

type Tab = 'overview' | 'shipments' | 'invoices' | 'activity'
const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

export default function ClientDetailPage() {
  const { id = '' } = useParams()
  const { ready, user, advanceShipment } = useStore()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'overview'
  const setTab = (t: Tab) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true })
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = () => clientsApi.get(id).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load this client.'))
  useEffect(() => { if (ready && user?.role === 'shipper') reload() }, [ready, user, id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  if (!user) return <Navigate to={`/login?role=shipper&next=/dashboard/clients/${id}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (error && !d) return <div className="bg-bg text-text"><div className="container-x py-24 text-center"><p className="text-danger">{error}</p><Link to="/dashboard/clients" className="btn-ghost mt-6">Back to clients</Link></div></div>
  if (!d) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading client…</div></div>

  const { client: c } = d
  const owing = d.invoices.filter((i) => i.status !== 'void').reduce((n, i) => n + i.balance, 0)
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); setError(''); try { await fn(); if (ok) setToast(ok) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) } }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-8 md:py-12">
        <Link to="/dashboard/clients" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-gold focus-ring rounded"><ArrowLeft size={14} aria-hidden="true" /> All clients</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <ClientAvatar c={c} size={56} />
            <div>
              <h1 className="!text-[clamp(1.6rem,3vw,2.25rem)] leading-tight">{c.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">{c.company && <span>{c.company}</span>}{c.city && <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{c.city}</span>}{c.source === 'marketplace' ? <Pill tone="teal">Booked via Ship Sync</Pill> : <Pill tone="muted">Own client</Pill>}{c.status === 'archived' && <Pill tone="muted">Archived</Pill>}</p>
              {c.tags.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">{t}</span>)}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.phone && <a href={`tel:${c.phone}`} className="btn-ghost !min-h-10 !px-3 text-sm"><Phone size={15} aria-hidden="true" /> Call</a>}
            {c.whatsapp && <a href={waLink(c.whatsapp)} target="_blank" rel="noreferrer" className="btn-ghost !min-h-10 !px-3 text-sm"><MessageCircle size={15} aria-hidden="true" /> WhatsApp</a>}
            {c.email && <a href={`mailto:${c.email}`} className="btn-ghost !min-h-10 !px-3 text-sm"><Mail size={15} aria-hidden="true" /> Email</a>}
            <button onClick={() => setEditing((e) => !e)} className="btn-gold !min-h-10 !px-3 text-sm" aria-expanded={editing}><Pencil size={15} aria-hidden="true" /> Edit</button>
          </div>
        </div>

        <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-5 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" />{toast}</motion.p>}</AnimatePresence>
        {error && <p role="alert" className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

        <AnimatePresence>
          {editing && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-6">
              <div className="mb-4 flex items-center justify-between"><h2 className="!text-lg">Edit client</h2>
                <button onClick={() => run(async () => { await clientsApi.update(c.id, { status: c.status === 'archived' ? 'active' : 'archived' }); await reload(); setEditing(false) }, c.status === 'archived' ? 'Client restored.' : 'Client archived.')} className="text-xs text-text-muted hover:text-gold focus-ring rounded">{c.status === 'archived' ? 'Restore client' : 'Archive client'}</button></div>
              <ClientForm initial={{ name: c.name, company: c.company, email: c.email, phone: c.phone, whatsapp: c.whatsapp, city: c.city, tags: c.tags, notes: c.notes }} busy={busy} error="" onCancel={() => setEditing(false)} onSave={(f) => run(async () => { await clientsApi.update(c.id, f); await reload(); setEditing(false) }, 'Client updated.')} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="card-dark p-4"><p className="text-xs text-text-muted">Shipments</p><p className="font-heading text-2xl font-bold">{d.shipments.length}</p><p className="text-xs text-text-muted">{d.shipments.filter((s) => s.status !== 'delivered').length} in progress</p></div>
          <div className="card-dark p-4"><p className="text-xs text-text-muted">Invoiced</p><p className="font-heading text-2xl font-bold">{money(d.invoices.filter((i) => i.status !== 'void').reduce((n, i) => n + i.total, 0))}</p><p className="text-xs text-text-muted">{d.invoices.length} invoice{d.invoices.length === 1 ? '' : 's'}</p></div>
          <div className="card-dark p-4"><p className="text-xs text-text-muted">Outstanding</p><p className={`font-heading text-2xl font-bold ${owing ? 'text-gold' : ''}`}>{money(owing)}</p><p className="text-xs text-text-muted">{owing ? 'Awaiting payment' : 'All settled'}</p></div>
          <div className="card-dark p-4"><p className="text-xs text-text-muted">Client since</p><p className="font-heading text-2xl font-bold">{fmtDate(c.createdAt)}</p><p className="text-xs text-text-muted">{c.lastActivityAt ? `Last touch ${fmtDate(c.lastActivityAt)}` : ''}</p></div>
        </div>

        <div className="mt-8 flex gap-1 border-b border-border" role="tablist">
          {([['overview', 'Overview'], ['shipments', `Shipments (${d.shipments.length})`], ['invoices', `Invoices (${d.invoices.length})`], ['activity', `Activity (${d.activities.length})`]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative min-h-11 px-4 text-sm font-medium focus-ring rounded-t ${tab === t ? 'text-gold' : 'text-text-muted hover:text-text'}`}>{label}{tab === t && <motion.span layoutId="ctab" className="absolute inset-x-0 -bottom-px h-0.5 bg-gold" />}</button>
          ))}
        </div>

        {tab === 'overview' && <Overview d={d} busy={busy} run={run} reload={reload} />}
        {tab === 'shipments' && <Shipments d={d} busy={busy} run={run} reload={reload} advance={advanceShipment} />}
        {tab === 'invoices' && <Invoices d={d} busy={busy} run={run} reload={reload} />}
        {tab === 'activity' && <ActivityTab d={d} busy={busy} run={run} reload={reload} />}
      </div>
    </div>
  )
}

type Common = { d: Detail; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; reload: () => Promise<void> }

/* ---------------- Overview: contact card, notes, consignees ---------------- */
const blankConsignee: ConsigneeInput = { name: '', phone: '', address: '', city: '', country: 'GH', relationship: '', isDefault: false }
function Overview({ d, busy, run, reload }: Common) {
  const c = d.client
  const [form, setForm] = useState<ConsigneeInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const save = () => form && run(async () => { if (editId) await clientsApi.updateConsignee(editId, form); else await clientsApi.addConsignee(c.id, form); await reload(); setForm(null); setEditId(null) }, editId ? 'Consignee updated.' : 'Consignee added.')
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5 space-y-4">
        <div className="card-dark p-5">
          <h2 className="!text-base">Contact</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[['Phone', c.phone], ['WhatsApp', c.whatsapp], ['Email', c.email], ['City', c.city], ['Company', c.company]].map(([k, v]) => v ? <div key={k} className="flex justify-between gap-3"><dt className="text-text-muted">{k}</dt><dd className="text-right text-text">{v}</dd></div> : null)}
            {!c.phone && !c.email && !c.whatsapp && <p className="text-text-muted">No contact details yet — click Edit to add them.</p>}
          </dl>
        </div>
        <div className="card-dark p-5">
          <h2 className="!text-base">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{c.notes || 'Nothing yet. Payment habits, preferred contact channel, typical cargo…'}</p>
        </div>
      </div>
      <div className="lg:col-span-7">
        <div className="card-dark p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="!text-base">Consignees in West Africa</h2><p className="text-xs text-text-muted">Who receives the goods. Pick one when booking; it goes on the tracking page and invoice.</p></div>
            <button onClick={() => { setForm(blankConsignee); setEditId(null) }} className="btn-ghost !min-h-9 !px-3 text-xs"><Plus size={14} aria-hidden="true" /> Add</button></div>
          <AnimatePresence>
            {form && (
              <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={(e) => { e.preventDefault(); save() }} className="mt-4 grid gap-3 overflow-hidden border-t border-border pt-4 sm:grid-cols-2">
                <div><label className="label-dark" htmlFor="cs-name">Name</label><input id="cs-name" className="input-dark !min-h-10" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="label-dark" htmlFor="cs-phone">Phone</label><input id="cs-phone" className="input-dark !min-h-10" placeholder="+233 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className="label-dark" htmlFor="cs-addr">Address</label><input id="cs-addr" className="input-dark !min-h-10" placeholder="Street, landmark, area" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div><label className="label-dark" htmlFor="cs-city">City</label><input id="cs-city" className="input-dark !min-h-10" placeholder="Accra" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div><label className="label-dark" htmlFor="cs-country">Country</label><select id="cs-country" className="input-dark !min-h-10" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>{countries.map((k) => <option key={k.code} value={k.code}>{k.flag} {k.name}</option>)}</select></div>
                <div><label className="label-dark" htmlFor="cs-rel">Relationship</label><input id="cs-rel" className="input-dark !min-h-10" placeholder="Brother, business partner…" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} /></div>
                <label className="flex items-center gap-2 self-end text-sm text-text-muted"><input type="checkbox" className="accent-gold" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Default consignee</label>
                <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={() => { setForm(null); setEditId(null) }} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{editId ? 'Save' : 'Add consignee'}</button></div>
              </motion.form>
            )}
          </AnimatePresence>
          <ul className="mt-4 divide-y divide-border">
            {d.consignees.length === 0 && !form && <li className="py-6 text-center text-sm text-text-muted">No consignees yet.</li>}
            {d.consignees.map((k: Consignee) => (
              <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="text-sm">
                  <p className="flex items-center gap-2 font-semibold text-text">{k.name}{k.isDefault && <Star size={13} className="fill-gold text-gold" aria-label="Default" />}{k.relationship && <span className="font-normal text-text-muted">· {k.relationship}</span>}</p>
                  <p className="text-text-muted">{[k.address, k.city].filter(Boolean).join(', ')} {countryByCode(k.country)?.flag}</p>
                  {k.phone && <p className="text-text-muted"><Phone size={11} className="mr-1 inline" aria-hidden="true" />{k.phone}</p>}
                </div>
                <div className="flex gap-1">
                  {!k.isDefault && <button onClick={() => run(async () => { await clientsApi.updateConsignee(k.id, { isDefault: true }); await reload() })} className="btn-ghost !min-h-8 !px-2 text-xs" title="Make default"><Star size={13} aria-hidden="true" /></button>}
                  <button onClick={() => { setForm({ name: k.name, phone: k.phone, address: k.address, city: k.city, country: k.country, relationship: k.relationship, isDefault: k.isDefault }); setEditId(k.id) }} className="btn-ghost !min-h-8 !px-2 text-xs" aria-label={`Edit ${k.name}`}><Pencil size={13} aria-hidden="true" /></button>
                  <button onClick={() => run(async () => { await clientsApi.deleteConsignee(k.id); await reload() }, 'Consignee removed.')} className="btn-ghost !min-h-8 !px-2 text-xs text-danger" aria-label={`Remove ${k.name}`}><Trash2 size={13} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Shipments: history + book directly ---------------- */
function Shipments({ d, busy, run, reload, advance }: Common & { advance: (id: string) => Promise<void> }) {
  const c = d.client
  const [open, setOpen] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('book') === '1')
  const def = d.consignees.find((k) => k.isDefault) ?? d.consignees[0]
  const [f, setF] = useState<BookingInput>({ mode: 'ocean', origin: c.city || origins[0], destination: (def?.country ?? 'GH'), cargo: 'barrels', description: '', eta: plusDays(35), consigneeId: def?.id, note: '' })
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">Bookings made here get a Ship Sync reference the client can track publicly — no quote request needed.</p>
        <button onClick={() => setOpen((o) => !o)} className="btn-gold !min-h-10 !px-4 text-sm" aria-expanded={open}><Plus size={15} aria-hidden="true" /> New shipment</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await clientsApi.book(c.id, f); await reload(); setOpen(false) }, 'Shipment booked — the client can track it with the new reference.') }} className="mt-4 card-dark grid gap-3 p-5 md:grid-cols-3">
            <div><span className="label-dark">Mode</span><div className="flex gap-2">{(['ocean', 'air'] as Mode[]).map((m) => <button type="button" key={m} onClick={() => setF({ ...f, mode: m, eta: plusDays(m === 'air' ? 6 : 35) })} aria-pressed={f.mode === m} className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize focus-ring ${f.mode === m ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted'}`}>{m}</button>)}</div></div>
            <div><label className="label-dark" htmlFor="b-origin">Origin</label><input id="b-origin" list="origin-list" className="input-dark !min-h-10" required value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /><datalist id="origin-list">{origins.map((o) => <option key={o} value={o} />)}</datalist></div>
            <div><label className="label-dark" htmlFor="b-dest">Destination</label><select id="b-dest" className="input-dark !min-h-10" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{countries.map((k) => <option key={k.code} value={k.code}>{k.flag} {k.name}</option>)}</select></div>
            <div><label className="label-dark" htmlFor="b-cargo">Cargo</label><select id="b-cargo" className="input-dark !min-h-10" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value as CargoType })}>{cargoTypes.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></div>
            <div><label className="label-dark" htmlFor="b-eta">ETA</label><input id="b-eta" type="date" className="input-dark !min-h-10" required min={today()} value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></div>
            <div><label className="label-dark" htmlFor="b-cons">Consignee</label><select id="b-cons" className="input-dark !min-h-10" value={f.consigneeId ?? ''} onChange={(e) => setF({ ...f, consigneeId: e.target.value || undefined })}><option value="">— none —</option>{d.consignees.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.city}</option>)}</select></div>
            <div className="md:col-span-3"><label className="label-dark" htmlFor="b-desc">Description</label><input id="b-desc" className="input-dark !min-h-10" placeholder="e.g. 2017 Honda Accord + 2 barrels of provisions" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
            <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-4 text-xs disabled:opacity-60">{busy ? 'Booking…' : 'Book shipment'}</button></div>
          </motion.form>
        )}
      </AnimatePresence>
      <ul className="mt-4 space-y-2">
        {d.shipments.length === 0 && <li className="card-dark p-8 text-center text-sm text-text-muted">No shipments for this client yet.</li>}
        {d.shipments.map((s) => {
          const dest = countryByCode(s.destination)
          const cons = d.consignees.find((k) => k.id === s.consigneeId)
          return (
            <li key={s.id} className="card-dark flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2"><Link to={`/track?ref=${s.ref}`} className="font-mono text-xs text-gold hover:underline focus-ring rounded">{s.ref}</Link><ModeBadge mode={s.mode} /><Pill tone={s.status === 'delivered' ? 'green' : 'teal'}>{statusLabels[s.status]}</Pill></p>
                <p className="mt-1 text-sm font-semibold text-text">{s.origin} → {dest?.flag} {dest?.name}</p>
                <p className="text-xs text-text-muted">{s.description} · {cargoLabel(s.cargo)}{cons ? ` · to ${cons.name}, ${cons.city}` : ''} · ETA {fmtDate(s.eta)}</p>
              </div>
              <div className="flex gap-2">
                {s.status !== 'delivered' && <button onClick={() => run(async () => { await advance(s.id); await reload() }, `${s.ref} updated.`)} disabled={busy} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60">Mark next step <ChevronRight size={13} aria-hidden="true" /></button>}
                <Link to={`/track?ref=${s.ref}`} className="btn-ghost !min-h-9 !px-3 text-xs"><Ship size={13} aria-hidden="true" /> Track</Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------------- Invoices & payments ---------------- */
type InvFilter = 'all' | 'outstanding' | 'overdue' | 'paid' | 'draft' | 'void'
const invOverdue = (inv: Invoice) => inv.status === 'sent' && !!inv.dueAt && inv.dueAt < today()
/** One word for where the money stands — the status column shows this, not the raw DB state. */
const invState = (inv: Invoice): { label: string; tone: 'gold' | 'teal' | 'green' | 'muted' | 'danger' | 'sky' } =>
  inv.status === 'void' ? { label: 'Void', tone: 'muted' } : inv.status === 'paid' ? { label: 'Paid', tone: 'green' } : inv.status === 'draft' ? { label: 'Draft', tone: 'sky' } : invOverdue(inv) ? { label: 'Overdue', tone: 'danger' } : inv.paid > 0 ? { label: 'Partly paid', tone: 'teal' } : { label: 'Sent', tone: 'gold' }
const daysFrom = (d: string) => Math.round((new Date(d + 'T12:00:00Z').getTime() - Date.now()) / 86400000)

function VoidModal({ inv, busy, onClose, onConfirm }: { inv: Invoice; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="void-h" className="card-dark w-full max-w-md p-6">
        <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger" aria-hidden="true"><Ban size={18} /></span><div><h2 id="void-h" className="!text-lg">Void {inv.number}?</h2><p className="mt-1 text-sm text-text-muted">The invoice stays on record marked <strong>Void</strong> but stops counting toward what this client owes. It can be restored later from the same menu.</p></div></div>
        {inv.paid > 0 && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"><strong>{money(inv.paid)}</strong> has been recorded as paid on this invoice. Voiding does not refund or move that money — if the customer overpaid, agree a refund or credit with them separately.</p>}
        <div className="mt-4"><label htmlFor="void-reason" className="label-dark">Reason <span className="font-normal text-text-muted">(optional, kept on the invoice)</span></label><input id="void-reason" autoFocus className="input-dark !min-h-10 text-sm" placeholder="Issued in error, replaced by INV-…, cancelled shipment" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost !min-h-10 !px-4 text-sm">Keep invoice</button><button onClick={() => onConfirm(reason)} disabled={busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 focus-ring disabled:opacity-60"><Ban size={14} aria-hidden="true" /> {busy ? 'Voiding…' : 'Void invoice'}</button></div>
      </motion.div>
    </motion.div>
  )
}

function Invoices({ d, busy, run, reload }: Common) {
  const c = d.client
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InvoiceItem[]>([{ description: '', qty: 1, unit: 0 }])
  const [meta, setMeta] = useState({ shipmentId: '', tax: 0, dueAt: plusDays(14), notes: 'Duty and destination charges payable by consignee.', status: 'sent' as 'draft' | 'sent' })
  const [payFor, setPayFor] = useState<string | null>(null)
  const [pay, setPay] = useState({ amount: '', method: 'bank', at: today(), note: '' })
  const [filter, setFilter] = useState<InvFilter>('all')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<Invoice | null>(null)
  useEffect(() => { if (!menu) return; const k = () => setMenu(null); window.addEventListener('click', k); return () => window.removeEventListener('click', k) }, [menu])
  const subtotal = Math.round(items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.unit) || 0), 0))
  const submit = () => run(async () => {
    await clientsApi.createInvoice(c.id, { shipmentId: meta.shipmentId || undefined, items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description.trim(), qty: Number(i.qty), unit: Math.round(Number(i.unit)) })), tax: Math.round(meta.tax), dueAt: meta.dueAt, notes: meta.notes, status: meta.status })
    await reload(); setOpen(false); setItems([{ description: '', qty: 1, unit: 0 }])
  }, 'Invoice created.')

  const live = d.invoices.filter((i) => i.status !== 'void')
  const stats = {
    outstanding: live.reduce((n, i) => n + i.balance, 0), outstandingN: live.filter((i) => i.balance > 0).length,
    overdue: live.filter(invOverdue).reduce((n, i) => n + i.balance, 0), overdueN: live.filter(invOverdue).length,
    paid: live.reduce((n, i) => n + i.paid, 0), paidN: live.filter((i) => i.status === 'paid').length,
    drafts: d.invoices.filter((i) => i.status === 'draft').length, voided: d.invoices.filter((i) => i.status === 'void').length,
  }
  const ql = q.trim().toLowerCase()
  const rows = d.invoices.filter((inv) => {
    const sh = d.shipments.find((s) => s.id === inv.shipmentId)
    const f = filter === 'all' ? true : filter === 'outstanding' ? inv.status !== 'void' && inv.balance > 0 : filter === 'overdue' ? invOverdue(inv) : filter === 'paid' ? inv.status === 'paid' : filter === 'draft' ? inv.status === 'draft' : inv.status === 'void'
    return f && (!ql || [inv.number, sh?.ref ?? '', ...inv.items.map((i) => i.description), inv.notes].join(' ').toLowerCase().includes(ql))
  })
  const chip = (f: InvFilter, label: string, n: number) => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full border px-3 py-1.5 text-xs focus-ring ${filter === f ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{label} <span className="tabular-nums opacity-70">{n}</span></button>
  const setStatus = (inv: Invoice, status: 'sent' | 'draft' | 'void', msg: string, reason?: string) => run(async () => { await clientsApi.updateInvoice(inv.id, { status, reason }); await reload() }, msg)

  return (
    <div className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setFilter('outstanding')} aria-pressed={filter === 'outstanding'} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${filter === 'outstanding' ? '!border-gold' : ''}`}><div className="flex items-center justify-between"><p className="text-xs text-text-muted">Outstanding</p><Wallet size={14} className="text-gold-deep" aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{money(stats.outstanding)}</p><p className="text-[11px] text-text-muted">{stats.outstandingN} invoice{stats.outstandingN === 1 ? '' : 's'} awaiting payment</p></button>
        <button onClick={() => setFilter('overdue')} aria-pressed={filter === 'overdue'} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${filter === 'overdue' ? '!border-gold' : ''} ${stats.overdueN ? 'border-l-4 border-l-danger' : ''}`}><div className="flex items-center justify-between"><p className="text-xs text-text-muted">Overdue</p><AlertTriangle size={14} className={stats.overdueN ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{money(stats.overdue)}</p><p className="text-[11px] text-text-muted">{stats.overdueN ? `${stats.overdueN} past due — worth a reminder` : 'Nothing past due'}</p></button>
        <button onClick={() => setFilter('paid')} aria-pressed={filter === 'paid'} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${filter === 'paid' ? '!border-gold' : ''}`}><div className="flex items-center justify-between"><p className="text-xs text-text-muted">Collected</p><Check size={14} className="text-gold-deep" aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{money(stats.paid)}</p><p className="text-[11px] text-text-muted">{stats.paidN} paid in full</p></button>
        <button onClick={() => setFilter(stats.drafts ? 'draft' : 'void')} aria-pressed={filter === 'draft' || filter === 'void'} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${filter === 'draft' || filter === 'void' ? '!border-gold' : ''}`}><div className="flex items-center justify-between"><p className="text-xs text-text-muted">Drafts & void</p><FileText size={14} className="text-gold-deep" aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{stats.drafts + stats.voided}</p><p className="text-[11px] text-text-muted">{stats.drafts} draft{stats.drafts === 1 ? '' : 's'} · {stats.voided} void</p></button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {chip('all', 'All', d.invoices.length)}{chip('outstanding', 'Outstanding', stats.outstandingN)}{chip('overdue', 'Overdue', stats.overdueN)}{chip('paid', 'Paid', stats.paidN)}{stats.drafts > 0 && chip('draft', 'Drafts', stats.drafts)}{stats.voided > 0 && chip('void', 'Void', stats.voided)}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <div className="relative min-w-[200px] flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label="Search invoices" className="input-dark !min-h-9 !pl-8 text-sm" placeholder="Search number, shipment, line item…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button onClick={() => setOpen((o) => !o)} className="btn-gold !min-h-9 !px-4 text-sm" aria-expanded={open}><Plus size={14} aria-hidden="true" /> New invoice</button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-4 card-dark p-5">
            <h3 className="!text-base">New invoice for {c.name}</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div><label className="label-dark" htmlFor="i-ship">For shipment</label><select id="i-ship" className="input-dark !min-h-10" value={meta.shipmentId} onChange={(e) => setMeta({ ...meta, shipmentId: e.target.value })}><option value="">— not tied to a shipment —</option>{d.shipments.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.description.slice(0, 40)}</option>)}</select></div>
              <div><label className="label-dark" htmlFor="i-due">Due</label><input id="i-due" type="date" className="input-dark !min-h-10" value={meta.dueAt} onChange={(e) => setMeta({ ...meta, dueAt: e.target.value })} /></div>
              <div><label className="label-dark" htmlFor="i-status">Send as</label><select id="i-status" className="input-dark !min-h-10" value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value as 'draft' | 'sent' })}><option value="sent">Sent (final)</option><option value="draft">Draft</option></select></div>
            </div>
            <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-xs text-text-muted"><th className="pb-1 font-medium">Description</th><th className="w-20 pb-1 font-medium">Qty</th><th className="w-32 pb-1 font-medium">Unit (USD)</th><th className="w-28 pb-1 text-right font-medium">Amount</th><th className="w-8" /></tr></thead>
              <tbody>{items.map((it, i) => (
                <tr key={i}><td className="pr-2 py-1"><input aria-label={`Line ${i + 1} description`} className="input-dark !min-h-9 text-sm" placeholder="Ocean freight, Houston → Tema" value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                  <td className="pr-2 py-1"><input aria-label="Quantity" type="number" min={0.01} step="any" className="input-dark !min-h-9 text-sm" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td>
                  <td className="pr-2 py-1"><input aria-label="Unit price" type="number" min={0} className="input-dark !min-h-9 text-sm" value={it.unit} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit: Number(e.target.value) } : x)))} /></td>
                  <td className="py-1 text-right tabular-nums">{money(Math.round((it.qty || 0) * (it.unit || 0)))}</td>
                  <td className="py-1 text-right">{items.length > 1 && <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-text-muted hover:text-danger focus-ring rounded" aria-label="Remove line"><X size={14} aria-hidden="true" /></button>}</td></tr>
              ))}</tbody></table>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <button type="button" onClick={() => setItems([...items, { description: '', qty: 1, unit: 0 }])} className="btn-ghost !min-h-9 !px-3 text-xs"><Plus size={13} aria-hidden="true" /> Add line</button>
              <dl className="min-w-[240px] text-sm"><div className="flex justify-between py-1"><dt className="text-text-muted">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
                <div className="flex items-center justify-between py-1"><dt className="text-text-muted">Tax / fees</dt><dd><input aria-label="Tax" type="number" min={0} className="input-dark !min-h-8 w-28 text-right text-sm" value={meta.tax} onChange={(e) => setMeta({ ...meta, tax: Number(e.target.value) })} /></dd></div>
                <div className="flex justify-between border-t border-border py-2 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(subtotal + (meta.tax || 0))}</dd></div></dl>
            </div>
            <div><label className="label-dark" htmlFor="i-notes">Notes on invoice</label><input id="i-notes" className="input-dark !min-h-10" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></div>
            <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy || !items.some((i) => i.description.trim())} className="btn-gold !min-h-9 !px-4 text-xs disabled:opacity-60">{busy ? 'Saving…' : 'Create invoice'}</button></div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="card-dark mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="w-8 px-3 py-3" /><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Issued</th><th className="px-3 py-3">Due</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Balance</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-text-muted">{d.invoices.length ? 'No invoices match this filter.' : 'No invoices yet — create the first one from a shipment.'}</td></tr>}
              {rows.map((inv) => {
                const sh = d.shipments.find((s) => s.id === inv.shipmentId); const st = invState(inv); const isOpen = expanded === inv.id; const due = inv.dueAt ? daysFrom(inv.dueAt) : null; const voided = inv.status === 'void'
                return (
                  <Fragment key={inv.id}>
                    <tr className={`border-b border-border/70 align-top transition-colors hover:bg-surface-2/60 ${isOpen ? 'bg-surface-2/40' : ''} ${voided ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-3"><button onClick={() => setExpanded(isOpen ? null : inv.id)} className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${inv.number}`}><ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button></td>
                      <td className="px-3 py-3"><Link to={`/dashboard/invoices/${inv.id}`} className={`font-semibold hover:text-gold-deep focus-ring ${voided ? 'line-through' : ''}`}>{inv.number}</Link><p className="text-xs text-text-muted">{sh ? <>{sh.ref} · </> : null}{inv.items.length} line{inv.items.length === 1 ? '' : 's'}{inv.items[0] ? ` · ${inv.items[0].description}` : ''}</p></td>
                      <td className="whitespace-nowrap px-3 py-3"><Pill tone={st.tone}>{st.label}</Pill></td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{fmtDate(inv.issuedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{inv.dueAt ? <><p>{fmtDate(inv.dueAt)}</p>{!voided && inv.status !== 'paid' && due !== null && <p className={`text-[11px] ${due < 0 ? 'font-semibold text-danger' : 'text-text-muted'}`}>{due < 0 ? `${-due}d overdue` : due === 0 ? 'due today' : `in ${due}d`}</p>}</> : <span className="text-text-muted">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{money(inv.total)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-text-muted">{inv.paid ? money(inv.paid) : '—'}</td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${voided ? 'text-text-muted' : inv.balance > 0 ? (invOverdue(inv) ? 'text-danger' : 'text-gold-deep') : 'text-teal'}`}>{voided ? '—' : inv.balance > 0 ? money(inv.balance) : 'Settled'}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="relative inline-flex items-center gap-1.5">
                          {!voided && inv.balance > 0 && <button onClick={() => { setExpanded(inv.id); setPayFor(payFor === inv.id ? null : inv.id); setPay({ amount: String(inv.balance), method: 'bank', at: today(), note: '' }) }} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs">Record payment</button>}
                          <Link to={`/dashboard/invoices/${inv.id}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-label={`View or print ${inv.number}`} title="View / print"><Printer size={13} /></Link>
                          <button onClick={(e) => { e.stopPropagation(); setMenu(menu === inv.id ? null : inv.id) }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-haspopup="menu" aria-expanded={menu === inv.id} aria-label={`More actions for ${inv.number}`}><Ellipsis size={14} /></button>
                          {menu === inv.id && (
                            <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left text-sm shadow-xl">
                              <Link role="menuitem" to={`/dashboard/invoices/${inv.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"><Printer size={14} aria-hidden="true" /> View / print / share</Link>
                              {inv.status === 'draft' && <button role="menuitem" onClick={() => { setMenu(null); setStatus(inv, 'sent', `${inv.number} marked as sent.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Send size={14} aria-hidden="true" /> Mark as sent</button>}
                              {inv.status === 'sent' && inv.paid === 0 && <button role="menuitem" onClick={() => { setMenu(null); setStatus(inv, 'draft', `${inv.number} moved back to draft.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><FileText size={14} aria-hidden="true" /> Move back to draft</button>}
                              {sh && <Link role="menuitem" to={`/dashboard/shipments?q=${sh.ref}&b=all`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"><Ship size={14} aria-hidden="true" /> Open shipment {sh.ref}</Link>}
                              <div className="my-1 border-t border-border" />
                              {voided
                                ? <button role="menuitem" onClick={() => { setMenu(null); setStatus(inv, 'sent', `${inv.number} restored.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><RotateCcw size={14} aria-hidden="true" /> Restore invoice</button>
                                : <button role="menuitem" onClick={() => { setMenu(null); setVoiding(inv) }} className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10"><Ban size={14} aria-hidden="true" /> Void invoice…</button>}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={8} className="px-3 pb-5 pt-2">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                          <div className="rounded-xl border border-border bg-surface p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Line items</p>
                            <table className="w-full text-sm"><tbody>{inv.items.map((it, i) => <tr key={i} className="border-b border-border/60 last:border-0"><td className="py-1.5 pr-2">{it.description}</td><td className="py-1.5 pr-2 text-right tabular-nums text-text-muted">{it.qty} × {money(it.unit)}</td><td className="py-1.5 text-right tabular-nums">{money(Math.round(it.qty * it.unit))}</td></tr>)}</tbody>
                              <tfoot><tr><td colSpan={2} className="pt-2 text-right text-xs text-text-muted">Subtotal</td><td className="pt-2 text-right tabular-nums">{money(inv.subtotal)}</td></tr>{inv.tax > 0 && <tr><td colSpan={2} className="text-right text-xs text-text-muted">Tax / fees</td><td className="text-right tabular-nums">{money(inv.tax)}</td></tr>}<tr><td colSpan={2} className="pt-1 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Total</td><td className="pt-1 text-right font-semibold tabular-nums">{money(inv.total)}</td></tr></tfoot></table>
                            {inv.notes && <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-xs text-text-muted">{inv.notes}</p>}
                          </div>
                          <div className="rounded-xl border border-border bg-surface p-4">
                            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Payments</p><span className="text-xs tabular-nums text-text-muted">{money(inv.paid)} of {money(inv.total)}</span></div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className={`h-full ${inv.balance === 0 ? 'bg-teal' : 'bg-gold'}`} style={{ width: `${inv.total ? Math.min(100, (inv.paid / inv.total) * 100) : 0}%` }} /></div>
                            {inv.payments.length === 0 ? <p className="mt-3 text-xs text-text-muted">No payments recorded yet.</p> : <ul className="mt-3 space-y-1.5 text-xs">{inv.payments.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span className="text-text-muted">{fmtDate(p.at)} · {paymentMethods.find(([k]) => k === p.method)?.[1] ?? p.method}{p.note ? ` · ${p.note}` : ''}</span><span className="font-semibold tabular-nums">{money(p.amount)}</span></li>)}</ul>}
                            {!voided && inv.balance > 0 && payFor !== inv.id && <button onClick={() => { setPayFor(inv.id); setPay({ amount: String(inv.balance), method: 'bank', at: today(), note: '' }) }} className="btn-ghost mt-3 !min-h-9 w-full text-xs"><Plus size={13} aria-hidden="true" /> Record a payment</button>}
                            <AnimatePresence>
                              {payFor === inv.id && (
                                <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await clientsApi.addPayment(inv.id, { amount: Math.round(Number(pay.amount)), method: pay.method, at: pay.at, note: pay.note }); await reload(); setPayFor(null) }, 'Payment recorded.') }} className="mt-3 grid gap-2 overflow-hidden border-t border-border pt-3 sm:grid-cols-2">
                                  <div><label className="label-dark" htmlFor={`p-amt-${inv.id}`}>Amount (USD)</label><input id={`p-amt-${inv.id}`} type="number" min={1} required className="input-dark !min-h-9 text-sm tabular-nums" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                                  <div><label className="label-dark" htmlFor={`p-m-${inv.id}`}>Method</label><select id={`p-m-${inv.id}`} className="input-dark !min-h-9 text-sm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{paymentMethods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                                  <div><label className="label-dark" htmlFor={`p-d-${inv.id}`}>Date</label><input id={`p-d-${inv.id}`} type="date" className="input-dark !min-h-9 text-sm" value={pay.at} onChange={(e) => setPay({ ...pay, at: e.target.value })} /></div>
                                  <div><label className="label-dark" htmlFor={`p-n-${inv.id}`}>Note</label><input id={`p-n-${inv.id}`} className="input-dark !min-h-9 text-sm" placeholder="Deposit, balance…" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
                                  <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setPayFor(null)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60">Save payment</button></div>
                                </motion.form>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-3 text-xs text-text-muted">{rows.length} of {d.invoices.length} invoice{d.invoices.length === 1 ? '' : 's'} · void invoices are kept for the record but excluded from totals</div>
      </div>
      <AnimatePresence>{voiding && <VoidModal inv={voiding} busy={busy} onClose={() => setVoiding(null)} onConfirm={(reason) => { const inv = voiding; setVoiding(null); setStatus(inv, 'void', `${inv.number} voided.`, reason || undefined) }} />}</AnimatePresence>
    </div>
  )
}

/* ---------------- Activity timeline & reminders ---------------- */
function ActivityTab({ d, busy, run, reload }: Common) {
  const c = d.client
  const [type, setType] = useState<Exclude<ActivityType, 'system'>>('note')
  const [body, setBody] = useState('')
  const [due, setDue] = useState(plusDays(3))
  const submit = () => run(async () => { await clientsApi.addActivity(c.id, { type, body, dueAt: type === 'reminder' ? new Date(due + 'T09:00:00').toISOString() : undefined }); await reload(); setBody('') }, type === 'reminder' ? 'Reminder set.' : 'Logged.')
  const icon = (t: ActivityType) => t === 'call' ? <Phone size={14} /> : t === 'email' ? <Mail size={14} /> : t === 'whatsapp' ? <MessageCircle size={14} /> : t === 'reminder' ? <Bell size={14} /> : t === 'system' ? <Ship size={14} /> : <FileText size={14} />
  const open = d.activities.filter((a) => a.type === 'reminder' && !a.done)
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5 space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) submit() }} className="card-dark p-5">
          <h2 className="!text-base">Log something</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">{(['note', 'call', 'email', 'whatsapp', 'meeting', 'reminder'] as const).map((t) => <button type="button" key={t} onClick={() => setType(t)} aria-pressed={type === t} className={`rounded-full border px-3 py-1 text-xs focus-ring ${type === t ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{activityLabel[t]}</button>)}</div>
          <textarea aria-label="Details" rows={3} className="input-dark mt-3 py-2 text-sm" placeholder={type === 'reminder' ? 'What to follow up on…' : 'What happened?'} value={body} onChange={(e) => setBody(e.target.value)} />
          {type === 'reminder' && <div className="mt-2"><label className="label-dark" htmlFor="a-due">Remind me on</label><input id="a-due" type="date" min={today()} className="input-dark !min-h-9 text-sm" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
          <div className="mt-3 flex justify-end"><button disabled={busy || !body.trim()} className="btn-gold !min-h-9 !px-4 text-xs disabled:opacity-60">{type === 'reminder' ? 'Set reminder' : 'Log'}</button></div>
        </form>
        {open.length > 0 && (
          <div className="card-dark p-5">
            <h2 className="!text-base">Open follow-ups</h2>
            <ul className="mt-3 space-y-2">{open.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-gold" aria-label={`Mark done: ${a.body}`} onChange={() => run(async () => { await clientsApi.updateActivity(a.id, { done: true }); await reload() }, 'Done.')} /><span><span className="text-text">{a.body}</span><span className={`block text-xs ${a.dueAt && new Date(a.dueAt).getTime() < Date.now() ? 'text-gold' : 'text-text-muted'}`}>{a.dueAt ? fmtDate(a.dueAt) : ''}{a.dueAt && new Date(a.dueAt).getTime() < Date.now() ? ' · overdue' : ''}</span></span></li>
            ))}</ul>
          </div>
        )}
      </div>
      <div className="lg:col-span-7">
        <ol className="card-dark p-5" aria-label="Timeline">
          {d.activities.length === 0 && <li className="py-6 text-center text-sm text-text-muted">Nothing logged yet.</li>}
          {d.activities.map((a: Activity, i) => (
            <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
              {i < d.activities.length - 1 && <span className="absolute left-[13px] top-7 h-full w-px bg-border" aria-hidden="true" />}
              <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ${a.type === 'system' ? 'bg-surface-2 text-text-muted' : a.type === 'reminder' ? (a.done ? 'bg-surface-2 text-text-muted' : 'bg-gold/20 text-gold') : 'bg-teal/15 text-teal'}`}>{icon(a.type)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted"><span className="font-semibold text-text">{activityLabel[a.type]}</span>{fmtDateTime(a.at)}{a.type === 'reminder' && a.dueAt && <span>· due {fmtDate(a.dueAt)}{a.done ? ' · done' : ''}</span>}
                  {a.type !== 'system' && <button onClick={() => run(async () => { await clientsApi.deleteActivity(a.id); await reload() })} className="ml-auto text-text-muted hover:text-danger focus-ring rounded" aria-label="Delete entry"><Trash2 size={12} aria-hidden="true" /></button>}</p>
                <p className={`mt-0.5 whitespace-pre-wrap text-sm ${a.done ? 'text-text-muted line-through' : 'text-text'}`}>{a.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
