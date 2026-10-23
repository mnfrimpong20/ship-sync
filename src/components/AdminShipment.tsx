import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Image, Mail, MessageCircle, Phone, Send } from 'lucide-react'
import { api } from '../lib/store'
import { Pill, fmtDate, fmtDateTime, money } from './ui'

type Case = {
  shipment: { id: string; ref: string; status: string; mode: string; origin: string; destination: string; cargo: string; description: string; eta: string | null; customer: string; createdAt: string | null }
  shipper: { id: string; name: string; verified: boolean; owner: { name: string; email: string; phone: string } | null }
  customer: { name: string; email: string; phone: string } | null
  events: { status: string; place: string; note: string; at: string | null }[]
  messages: { from: string; role: string; body: string; photo: boolean; at: string | null }[]
  payments: { id: string; amountUsd: number; feeUsd: number; status: string; hold: boolean; paidAt: string | null; releasedAt: string | null }[]
  disputes: { id: string; status: string; reason: string; createdAt: string | null }[]
  snoozes: { key: string; until: string | null; note: string; by: string; at: string | null }[]
}
const wa = (p: string) => `https://wa.me/${p.replace(/[^\d]/g, '')}`
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`

/** Admin → one shipment: who to call, what has happened, the money and any dispute — and a message to the shipping company. */
export function AdminShipment() {
  const [sp] = useSearchParams(); const id = sp.get('id') ?? ''
  const [d, setD] = useState<Case | null>(null); const [err, setErr] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [toast, setToast] = useState('')
  const load = () => api<Case>(`/admin/shipments/${encodeURIComponent(id)}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { setD(null); setErr(''); if (id) void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return <p className="mt-6 text-sm text-text-muted">Open a shipment from Attention or search.</p>
  if (err) return <p role="alert" className="mt-6 text-sm text-danger">{err}</p>
  if (!d) return <p className="mt-6 text-sm text-text-muted">Loading…</p>
  const s = d.shipment
  const send = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await api(`/admin/shipments/${s.id}/message`, { json: { body } }); setBody(''); setToast(`Sent to ${d.shipper.name}’s office — it’s in their notifications.`) } catch (x) { setErr(x instanceof Error ? x.message : 'Could not send.') } finally { setBusy(false) } }
  const Contact = ({ who, c }: { who: string; c: { name: string; email: string; phone: string } | null }) => (
    <div className="card-dark p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{who}</p>
      {c ? <>
        <p className="mt-1 font-semibold">{c.name}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={`mailto:${c.email}?subject=${encodeURIComponent(`About ${s.ref}`)}`} className="btn-ghost !min-h-9 !px-3 text-xs"><Mail size={13} aria-hidden="true" /> {c.email}</a>
          {c.phone && <a href={tel(c.phone)} className="btn-ghost !min-h-9 !px-3 text-xs"><Phone size={13} aria-hidden="true" /> {c.phone}</a>}
          {c.phone && <a href={wa(c.phone)} target="_blank" rel="noreferrer" className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`WhatsApp ${c.name}`}><MessageCircle size={13} aria-hidden="true" /> WhatsApp</a>}
        </div>
      </> : <p className="mt-1 text-sm text-text-muted">No account linked.</p>}
    </div>
  )
  return (
    <div className="mt-6 space-y-5" data-testid="admin-shipment">
      <Link to="/admin?view=attention" className="inline-flex min-h-10 items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft size={15} aria-hidden="true" /> Attention</Link>
      <div className="card-dark p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-mono text-lg font-bold">{s.ref}</p><p className="text-sm text-text-muted">{s.origin} → {s.destination} · {s.mode} · {s.description || s.cargo} · for {s.customer}</p></div>
          <div className="text-right text-sm"><Pill tone="gold">{s.status.replace(/_/g, ' ')}</Pill><p className="mt-1 text-text-muted">ETA {s.eta ? fmtDate(s.eta) : '—'}</p></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link to={`/track?ref=${s.ref}`} target="_blank" className="btn-ghost !min-h-9 !px-3 text-xs"><ExternalLink size={13} aria-hidden="true" /> Public tracking page</Link>
          <Link to={`/admin?view=shippers`} className="btn-ghost !min-h-9 !px-3 text-xs">{d.shipper.name}{d.shipper.verified ? ' · verified' : ' · not verified'}</Link>
          {d.shipper.owner && <Link to={`/admin?view=support&q=${encodeURIComponent(d.shipper.owner.email)}`} className="btn-ghost !min-h-9 !px-3 text-xs">See it as the shipper</Link>}
        </div>
        {d.snoozes.length > 0 && <p className="mt-3 text-xs text-text-muted">{d.snoozes.map((z) => `${z.note || 'Snoozed'} by ${z.by} ${fmtDateTime(z.at!)} — back ${fmtDate(z.until!)}`).join(' · ')}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2"><Contact who={`Shipping company · ${d.shipper.name}`} c={d.shipper.owner} /><Contact who="Customer" c={d.customer} /></div>
      <form onSubmit={send} className="card-dark p-5">
        <label htmlFor="adm-msg" className="font-semibold">Message {d.shipper.name}</label>
        <p className="text-xs text-text-muted">Goes to their owner and dispatchers as a notification (and email or WhatsApp, per their settings). Recorded in the audit log.</p>
        {toast && <p role="status" className="mt-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm text-teal">{toast}</p>}
        <textarea id="adm-msg" rows={3} className="input-dark mt-2 py-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`e.g. ${s.ref} is past its ETA — can you post an update for the customer?`} data-testid="adm-msg" />
        <button disabled={busy || body.trim().length < 5} className="btn-gold mt-2" data-testid="adm-msg-send"><Send size={15} aria-hidden="true" /> Send</button>
      </form>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-dark p-5" aria-labelledby="ev-h"><h2 id="ev-h" className="!text-base">Tracking history</h2>
          {d.events.length ? <ol className="mt-2 space-y-2 text-sm">{d.events.map((e, i) => <li key={i}><b>{e.status.replace(/_/g, ' ')}</b> <span className="text-text-muted">· {e.place} · {e.at ? fmtDateTime(e.at) : ''}</span>{e.note && <p className="text-text-muted">{e.note}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-text-muted">No events yet.</p>}
        </section>
        <section className="card-dark p-5" aria-labelledby="msg-h"><h2 id="msg-h" className="!text-base">Messages between customer and shipper</h2>
          {d.messages.length ? <ul className="mt-2 space-y-2 text-sm">{d.messages.map((m, i) => <li key={i} className="rounded-lg bg-surface-2/60 p-2.5"><p className="text-xs text-text-muted">{m.from} · {m.role} · {m.at ? fmtDateTime(m.at) : ''}{m.photo && <span className="ml-1 inline-flex items-center gap-0.5"><Image size={11} aria-hidden="true" /> photo</span>}</p><p>{m.body}</p></li>)}</ul> : <p className="mt-2 text-sm text-text-muted">No messages.</p>}
        </section>
      </div>
      <section className="card-dark p-5" aria-labelledby="pay-h"><h2 id="pay-h" className="!text-base">Money</h2>
        {d.payments.length ? <ul className="mt-2 divide-y divide-border text-sm">{d.payments.map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{money(p.amountUsd)} · {p.status.replace(/_/g, ' ')}{p.hold ? ' · on hold' : ''}</span><span className="text-text-muted">{p.paidAt ? `paid ${fmtDate(p.paidAt)}` : 'not paid'}{p.releasedAt ? ` · released ${fmtDate(p.releasedAt)}` : ''}</span></li>)}</ul> : <p className="mt-2 text-sm text-text-muted">Nothing paid through Ntemtem.</p>}
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><Link to="/admin?view=payments" className="font-semibold text-gold-deep underline">Payments</Link>{d.disputes.map((x) => <Link key={x.id} to={`/admin?view=disputes&d=${x.id}`} className="font-semibold text-gold-deep underline">Dispute · {x.reason.replace(/_/g, ' ')} · {x.status}</Link>)}</div>
      </section>
    </div>
  )
}
