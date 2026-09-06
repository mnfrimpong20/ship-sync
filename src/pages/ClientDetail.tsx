import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Bell, Check, ChevronRight, Ellipsis, FileText, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Printer, Ship, Star, Trash2, X } from 'lucide-react'
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
function Invoices({ d, busy, run, reload }: Common) {
  const c = d.client
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InvoiceItem[]>([{ description: '', qty: 1, unit: 0 }])
  const [meta, setMeta] = useState({ shipmentId: '', tax: 0, dueAt: plusDays(14), notes: 'Duty and destination charges payable by consignee.', status: 'sent' as 'draft' | 'sent' })
  const [payFor, setPayFor] = useState<string | null>(null)
  const [pay, setPay] = useState({ amount: '', method: 'bank', at: today(), note: '' })
  const subtotal = Math.round(items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.unit) || 0), 0))
  const submit = () => run(async () => {
    await clientsApi.createInvoice(c.id, { shipmentId: meta.shipmentId || undefined, items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description.trim(), qty: Number(i.qty), unit: Math.round(Number(i.unit)) })), tax: Math.round(meta.tax), dueAt: meta.dueAt, notes: meta.notes, status: meta.status })
    await reload(); setOpen(false); setItems([{ description: '', qty: 1, unit: 0 }])
  }, 'Invoice created.')
  const tone = (s: Invoice['status']) => (s === 'paid' ? 'green' : s === 'sent' ? 'gold' : s === 'void' ? 'muted' : 'teal')
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">Issue invoices per shipment, record what's been paid, and print or share the invoice.</p>
        <button onClick={() => setOpen((o) => !o)} className="btn-gold !min-h-10 !px-4 text-sm" aria-expanded={open}><Plus size={15} aria-hidden="true" /> New invoice</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={(e) => { e.preventDefault(); submit() }} className="mt-4 card-dark p-5">
            <div className="grid gap-3 md:grid-cols-3">
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
      <ul className="mt-4 space-y-2">
        {d.invoices.length === 0 && <li className="card-dark p-8 text-center text-sm text-text-muted">No invoices yet.</li>}
        {d.invoices.map((inv) => {
          const sh = d.shipments.find((s) => s.id === inv.shipmentId)
          const overdue = inv.status === 'sent' && inv.dueAt && new Date(inv.dueAt).getTime() < Date.now()
          return (
            <li key={inv.id} className="card-dark p-4">
              <div className="flex flex-wrap items-center gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-gold/15 text-gold"><FileText size={18} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-text">{inv.number}<Pill tone={tone(inv.status)}>{inv.status}</Pill>{overdue && <Pill tone="gold">Overdue</Pill>}</p>
                  <p className="text-xs text-text-muted">Issued {fmtDate(inv.issuedAt)}{inv.dueAt ? ` · due ${fmtDate(inv.dueAt)}` : ''}{sh ? ` · ${sh.ref}` : ''} · {inv.items.length} line{inv.items.length === 1 ? '' : 's'}</p>
                </div>
                <div className="text-right"><p className="font-heading text-xl font-bold">{money(inv.total)}</p><p className={`text-xs ${inv.balance ? 'text-gold' : 'text-text-muted'}`}>{inv.status === 'void' ? 'Void' : inv.balance ? `${money(inv.balance)} outstanding` : 'Paid in full'}</p></div>
                <div className="flex flex-wrap gap-1">
                  <Link to={`/dashboard/invoices/${inv.id}`} className="btn-ghost !min-h-9 !px-3 text-xs"><Printer size={13} aria-hidden="true" /> View / print</Link>
                  {inv.status !== 'void' && inv.balance > 0 && <button onClick={() => { setPayFor(payFor === inv.id ? null : inv.id); setPay({ amount: String(inv.balance), method: 'bank', at: today(), note: '' }) }} className="btn-gold !min-h-9 !px-3 text-xs">Record payment</button>}
                  {inv.status === 'draft' && <button onClick={() => run(async () => { await clientsApi.updateInvoice(inv.id, { status: 'sent' }); await reload() }, 'Marked as sent.')} className="btn-ghost !min-h-9 !px-3 text-xs">Mark sent</button>}
                  {inv.status !== 'void' && <button onClick={() => run(async () => { await clientsApi.updateInvoice(inv.id, { status: 'void' }); await reload() }, 'Invoice voided.')} className="btn-ghost !min-h-9 !px-2 text-xs text-text-muted" title="Void invoice"><Ellipsis size={14} aria-hidden="true" /><span className="sr-only">Void</span></button>}
                </div>
              </div>
              {inv.payments.length > 0 && <ul className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">{inv.payments.map((p) => <li key={p.id} className="rounded-full border border-border px-2 py-0.5">{money(p.amount)} · {paymentMethods.find(([k]) => k === p.method)?.[1] ?? p.method} · {fmtDate(p.at)}{p.note ? ` · ${p.note}` : ''}</li>)}</ul>}
              <AnimatePresence>
                {payFor === inv.id && (
                  <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await clientsApi.addPayment(inv.id, { amount: Math.round(Number(pay.amount)), method: pay.method, at: pay.at, note: pay.note }); await reload(); setPayFor(null) }, 'Payment recorded.') }} className="mt-3 grid gap-2 overflow-hidden border-t border-border pt-3 sm:grid-cols-4">
                    <div><label className="label-dark" htmlFor={`p-amt-${inv.id}`}>Amount (USD)</label><input id={`p-amt-${inv.id}`} type="number" min={1} required className="input-dark !min-h-9 text-sm" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                    <div><label className="label-dark" htmlFor={`p-m-${inv.id}`}>Method</label><select id={`p-m-${inv.id}`} className="input-dark !min-h-9 text-sm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{paymentMethods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                    <div><label className="label-dark" htmlFor={`p-d-${inv.id}`}>Date</label><input id={`p-d-${inv.id}`} type="date" className="input-dark !min-h-9 text-sm" value={pay.at} onChange={(e) => setPay({ ...pay, at: e.target.value })} /></div>
                    <div><label className="label-dark" htmlFor={`p-n-${inv.id}`}>Note</label><input id={`p-n-${inv.id}`} className="input-dark !min-h-9 text-sm" placeholder="Deposit, balance…" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
                    <div className="sm:col-span-4 flex justify-end gap-2"><button type="button" onClick={() => setPayFor(null)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60">Save payment</button></div>
                  </motion.form>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
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
