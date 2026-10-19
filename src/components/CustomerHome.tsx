import { AddressLookup } from './AddressLookup'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, Bell, Check, Globe2, Info, MapPin, MessageCircle, Package, Pencil, Phone, Plane, Plus, Receipt, Ship, Star, Trash2, UserRound } from 'lucide-react'
import { customerApi, type AttentionItem, type Consignee, type ConsigneeInput, type NextArrival } from '../lib/customer'
import { countries, countryByCode, flowFor, statusLabels, type ShipmentStatus } from '../lib/data'
import { Pill, fmtDate, fmtDateTime, Flag } from './ui'

const sevCls = { critical: 'border-l-danger', warning: 'border-l-gold', info: 'border-l-sky' } as const
const sevIcon = { critical: AlertTriangle, warning: Bell, info: Info } as const
const kindIcon = { quote: Receipt, duty: Globe2, recipient: UserRound, invoice: Receipt, sourcing: Package, review: Star } as const

/** "Needs you" — the things only the customer can do, pulled out of the tabs. */
export function NeedsYou({ items }: { items: AttentionItem[] }) {
  if (!items.length) return null
  return (
    <section className="mt-8" aria-labelledby="needs-h" data-testid="needs-you">
      <h2 id="needs-h" className="mb-3 !text-lg">Needs you <span className="text-sm font-normal text-text-muted">· {items.length}</span></h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.slice(0, 6).map((a, i) => { const Sev = sevIcon[a.severity]; const K = kindIcon[a.kind]; return (
          <li key={i}>
            <Link to={a.to} className={`card-dark flex h-full gap-3 border-l-4 p-4 transition-colors hover:border-gold/40 focus-ring ${sevCls[a.severity]}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${a.severity === 'critical' ? 'bg-danger/10 text-danger' : a.severity === 'warning' ? 'bg-gold/15 text-gold-deep' : 'bg-sky/10 text-sky'}`}><K size={16} aria-hidden="true" /></span>
              <span className="min-w-0"><span className="flex items-start gap-1.5 text-sm font-semibold leading-tight"><Sev size={12} className="mt-0.5 shrink-0 opacity-70" aria-hidden="true" /><span>{a.title}</span></span><span className="mt-1 block text-xs text-text-muted">{a.body}</span></span>
            </Link>
          </li>
        ) })}
      </ul>
    </section>
  )
}

/** The one shipment they're most likely asking about, with the progress line and a one-tap share. */
export function NextArrivalCard({ s }: { s: NextArrival }) {
  const [copied, setCopied] = useState(false)
  const trackUrl = `${location.origin}/track?ref=${s.ref}`
  const receiverUrl = s.receiverPath ? `${location.origin}/#${s.receiverPath}` : trackUrl
  const text = `${s.recipient ? `Hi ${s.recipient.name.split(' ')[0]}, ` : ''}our shipment ${s.ref} (${s.origin} → ${s.destinationName}) is ${statusLabels[s.status as ShipmentStatus].toLowerCase()}${s.daysToEta > 0 ? `, expected around ${fmtDate(s.eta)}` : ''}. Follow it here: ${receiverUrl}`
  const copy = async () => { try { await navigator.clipboard.writeText(receiverUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt('Copy this link', receiverUrl) } }
  const Icon = s.mode === 'air' ? Plane : Ship
  const dest = countryByCode(s.destination)
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-dark mt-8 p-5 md:p-6" aria-labelledby="next-h" data-testid="next-arrival">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`eyebrow mb-1 ${s.daysToEta < 0 ? '!text-danger' : ''}`} data-testid="eta-label">{s.daysToEta < 0 ? `Past its expected date by ${-s.daysToEta} day${s.daysToEta === -1 ? '' : 's'} · ${statusLabels[s.status as ShipmentStatus].toLowerCase()}` : s.daysToEta === 0 ? 'Arriving today' : s.daysToEta === 1 ? 'Arriving tomorrow' : `Arriving in ${s.daysToEta} days`}</p>
          <h2 id="next-h" className="!text-xl">{s.origin} → <Flag code={dest?.code} /> {s.destinationName}</h2>
          <p className="mt-1 text-sm text-text-muted">{s.ref} · {s.description} · {s.shipper}</p>
        </div>
        <Pill tone={s.status === 'out_for_delivery' ? 'green' : s.status === 'customs' ? 'gold' : 'teal'}>{statusLabels[s.status as ShipmentStatus]}</Pill>
      </div>
      <ol className="mt-5 flex items-center gap-1" aria-label="Progress">
        {flowFor(s.handover).map((st, i) => <li key={st} className={`h-1.5 flex-1 rounded-full ${i <= s.stepIndex ? 'bg-gold' : 'bg-surface-2'}`} title={statusLabels[st]} />)}
      </ol>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2"><Icon size={16} className="text-gold-deep" aria-hidden="true" /><span><span className="block text-xs text-text-muted">{s.mode === 'air' ? 'Flight' : 'Vessel'}</span>{s.vessel ?? s.flight ?? 'To be assigned'}</span></div>
        <div className="flex items-center gap-2"><MapPin size={16} className="text-gold-deep" aria-hidden="true" /><span><span className="block text-xs text-text-muted">Last update</span>{s.lastEvent ? `${s.lastEvent.place || statusLabels[s.lastEvent.status as ShipmentStatus]} · ${fmtDateTime(s.lastEvent.at)}` : '—'}</span></div>
        <div className="flex items-center gap-2"><UserRound size={16} className="text-gold-deep" aria-hidden="true" /><span><span className="block text-xs text-text-muted">Recipient</span>{s.recipient ? `${s.recipient.name}${s.recipient.city ? `, ${s.recipient.city}` : ''}` : <Link to={`/dashboard?tab=shipments&recipient=${s.id}`} className="text-gold-deep hover:underline">Add who receives it</Link>}</span></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`https://wa.me/${s.recipient?.phone ? s.recipient.phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="btn-gold !min-h-10 text-sm" data-testid="share-whatsapp"><MessageCircle size={16} aria-hidden="true" /> {s.recipient ? `Send to ${s.recipient.name.split(' ')[0]} on WhatsApp` : 'Share on WhatsApp'}</a>
        <button onClick={copy} className="btn-ghost !min-h-10 text-sm">{copied ? <><Check size={16} aria-hidden="true" /> Copied</> : 'Copy tracking link'}</button>
        <Link to={`/dashboard?tab=shipments&open=${s.id}`} className="btn-ghost !min-h-10 text-sm">Details</Link>
      </div>
    </motion.section>
  )
}

/* ---------- recipients ---------- */
const empty: ConsigneeInput = { name: '', phone: '', address: '', city: '', country: 'GH', relationship: '' }

export function ConsigneeForm({ initial = empty, onSave, onCancel, busy }: { initial?: ConsigneeInput; onSave: (c: ConsigneeInput) => void; onCancel?: () => void; busy?: boolean }) {
  const [f, setF] = useState<ConsigneeInput>({ ...empty, ...initial })
  const [err, setErr] = useState('')
  const submit = (e: React.FormEvent) => { e.preventDefault(); if ((f.name ?? '').trim().length < 2) return setErr('Enter the recipient’s name.'); setErr(''); onSave(f) }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="Recipient" data-testid="consignee-form">
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Full name</span><input className="input-dark !min-h-10" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" data-testid="cs-name" /></label>
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Phone / WhatsApp</span><input className="input-dark !min-h-10" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+233 24 …" data-testid="cs-phone" /></label>
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Country</span><select className="input-dark !min-h-10" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <div className="sm:col-span-2"><AddressLookup compact country={f.country ?? 'GH'} value={{ address: f.address ?? '', city: f.city ?? '', gps: f.gps ?? '', lat: f.lat ?? null, lng: f.lng ?? null }} onChange={(p) => setF((x) => ({ ...x, ...p }))} labels={{ address: 'Address / landmark' }} /></div>
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Relationship (optional)</span><input className="input-dark !min-h-10" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="Brother, business partner…" /></label>
      {err && <p role="alert" className="text-xs text-danger sm:col-span-2">{err}</p>}
      <div className="flex gap-2 sm:col-span-2">{onCancel && <button type="button" onClick={onCancel} className="btn-ghost !min-h-10 text-sm">Cancel</button>}<button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="cs-save"><Check size={16} aria-hidden="true" /> Save recipient</button></div>
    </form>
  )
}

/** Saved recipients with "ship again" straight into the quote form. */
export function Recipients() {
  const [list, setList] = useState<Consignee[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = () => customerApi.consignees().then(setList).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { load() }, [])
  const save = async (c: ConsigneeInput, id?: string) => { setBusy(true); setErr(''); try { if (id) await customerApi.updateConsignee(id, c); else await customerApi.addConsignee(c); setAdding(false); setEditing(null); await load() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  const remove = async (id: string) => { setBusy(true); try { await customerApi.removeConsignee(id); await load() } finally { setBusy(false) } }
  const makeDefault = async (id: string) => { await customerApi.updateConsignee(id, { isDefault: true }); await load() }
  return (
    <div className="mt-6" data-testid="recipients">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="!text-lg">People you ship to</h2><p className="text-sm text-text-muted">Saved recipients pre-fill your next request and get the arrival text when the goods land.</p></div>{!adding && <button onClick={() => setAdding(true)} className="btn-gold !min-h-10 text-sm" data-testid="add-recipient"><Plus size={16} aria-hidden="true" /> Add recipient</button>}</div>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      {adding && <div className="card-dark mt-4 p-5"><ConsigneeForm onSave={(c) => save(c)} onCancel={() => setAdding(false)} busy={busy} /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Recipients">
        {list?.map((c) => (
          <li key={c.id} className="card-dark p-4" data-testid="recipient">
            {editing === c.id ? <ConsigneeForm initial={c} onSave={(x) => save(x, c.id)} onCancel={() => setEditing(null)} busy={busy} /> : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-semibold">{c.name}{c.isDefault && <Pill tone="gold">Default</Pill>}{c.relationship && <span className="text-xs font-normal text-text-muted">{c.relationship}</span>}</p><p className="text-xs text-text-muted">{[c.address, c.city, countryByCode(c.country)?.name].filter(Boolean).join(', ')}</p>{c.phone && <p className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted"><Phone size={11} aria-hidden="true" /> {c.phone}</p>}</div>
                  <div className="flex shrink-0 gap-1"><button onClick={() => setEditing(c.id)} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label={`Edit ${c.name}`}><Pencil size={14} /></button><button onClick={() => remove(c.id)} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-danger focus-ring" aria-label={`Remove ${c.name}`}><Trash2 size={14} /></button></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2"><Link to={`/quote?destination=${c.country}&consignee=${c.id}`} className="btn-gold !min-h-9 text-xs" data-testid="ship-to">Ship to {c.name.split(' ')[0]}</Link>{!c.isDefault && <button onClick={() => makeDefault(c.id)} className="btn-ghost !min-h-9 text-xs">Make default</button>}</div>
              </>
            )}
          </li>
        ))}
        {list && list.length === 0 && !adding && <li className="card-dark p-6 text-sm text-text-muted md:col-span-2">No recipients saved yet. Add your brother in Kumasi once and every request after that is two taps.</li>}
      </ul>
    </div>
  )
}


