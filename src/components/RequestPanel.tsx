import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Ban, Clock, Globe2, Lock, MessageSquare, Pencil, Plane, Send, Ship } from 'lucide-react'
import { useStore, type Quote, type QuoteRequest } from '../lib/store'
import { missingServices, requestsApi, type RequestMessage } from '../lib/requests'
import { refreshShipments } from '../lib/flowEvents'
import { Avatar, Pill, ProtectedNote, Rating, VerifiedBadge, fmtDate, fmtDateTime, money } from './ui'

const today = () => new Date().toISOString().slice(0, 10)
const live = (q: Quote) => q.status === 'sent' && !q.expired

/** One conversation between the client and one shipper about one request. Contact details are stripped until booking. */
export function MessageThread({ requestId, shipperId, onClose, compact }: { requestId: string; shipperId?: string; onClose?: () => void; compact?: boolean }) {
  const [msgs, setMsgs] = useState<RequestMessage[] | null>(null)
  const [shared, setShared] = useState(false)
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const { user } = useStore()
  const me = user?.role === 'customer' ? 'customer' : 'shipper'
  const end = useRef<HTMLDivElement>(null)
  const load = () => requestsApi.messages(requestId, shipperId).then((r) => { setMsgs(r.messages); setShared(r.contactsShared) }).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load messages.'))
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [requestId, shipperId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs?.length])
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr(''); try { const m = await requestsApi.send(requestId, text.trim(), shipperId); setMsgs((x) => [...(x ?? []), m]); setText('') } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  return (
    <div className="rounded-lg border border-border bg-surface-2/30 p-3" data-testid="message-thread">
      <div className="flex items-center justify-between gap-2"><p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><MessageSquare size={13} aria-hidden="true" /> Messages</p>{onClose && <button onClick={onClose} className="text-xs text-text-muted hover:text-text">Close</button>}</div>
      {!shared && <p className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted"><Lock size={11} aria-hidden="true" /> Phone numbers and emails are shared once you book — that keeps your payment protected.</p>}
      <div className={`mt-2 space-y-2 overflow-y-auto ${compact ? 'max-h-48' : 'max-h-72'}`}>
        {msgs === null && !err && <p className="text-xs text-text-muted">Loading…</p>}
        {msgs?.length === 0 && <p className="text-xs text-text-muted">No messages yet. Ask about sailing dates, packing or what’s included.</p>}
        {msgs?.map((m) => <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === me ? 'ml-auto bg-gold/15' : 'bg-surface'}`} data-testid="message"><p className="whitespace-pre-wrap">{m.body}</p><p className="mt-0.5 text-[11px] text-text-muted">{m.name} · {fmtDateTime(m.at)}{m.masked ? ' · contact details removed' : ''}</p></div>)}
        <div ref={end} />
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
      <form onSubmit={send} className="mt-2 flex gap-1.5"><input className="input-dark !min-h-9 flex-1 text-sm" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} aria-label="Message" data-testid="message-input" /><button disabled={busy || !text.trim()} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60" data-testid="message-send"><Send size={13} aria-hidden="true" /> Send</button></form>
    </div>
  )
}

/** The client's quotes: tagged (lowest all-in, fastest, best rated), flagged when they leave out something asked for, grouped by mode for "either". */
const SUPPLY_WORD: Record<string, string> = { barrel: 'barrels', box: 'boxes', lock: 'barrel locks', tape: 'tape', other: 'supplies' }
/** What the customer pays for a quote: freight plus any packing supplies priced in it. */
const totalOf = (q: Quote) => q.price + (q.suppliesUsd ?? 0)
export function QuoteList({ r, accept, busyQuote, threadFor }: { r: QuoteRequest; accept: (r: QuoteRequest, quoteId: string) => void; busyQuote: string | null; threadFor?: string | null }) {
  const { shipperById } = useStore()
  const [thread, setThread] = useState<string | null>(threadFor ?? null)
  const quotes = r.quotes
  const tags = useMemo(() => {
    const ls = quotes.filter(live); const t = new Map<string, string[]>()
    const add = (id: string | undefined, tag: string) => { if (!id) return; t.set(id, [...(t.get(id) ?? []), tag]) }
    if (ls.length > 1) {
      add([...ls].sort((a, b) => totalOf(a) - totalOf(b))[0]?.id, 'Lowest price')
      const fast = [...ls].sort((a, b) => a.transitDays - b.transitDays); if (fast[0] && fast[0].transitDays < (fast[1]?.transitDays ?? Infinity)) add(fast[0].id, 'Fastest')
      const rated = [...ls].map((q) => ({ q, s: shipperById(q.shipperId) })).filter((x) => (x.s?.reviews ?? 0) > 0).sort((a, b) => (b.s!.rating - a.s!.rating) || (b.s!.reviews - a.s!.reviews)); if (rated[0]) add(rated[0].q.id, 'Best rated')
    }
    return t
  }, [quotes, shipperById])
  const groups: { label: string; icon: typeof Ship; list: Quote[] }[] = r.mode === 'either'
    ? ([['ocean', 'Ocean freight', Ship], ['air', 'Air freight', Plane]] as const).map(([m, label, icon]) => ({ label, icon, list: quotes.filter((q) => (q.mode ?? 'ocean') === m) })).filter((g) => g.list.length)
    : [{ label: '', icon: Ship, list: quotes }]
  const order = (a: Quote, b: Quote) => Number(live(b)) - Number(live(a)) || totalOf(a) - totalOf(b)
  return (
    <div className="mt-4 space-y-4">
      <div className="no-print flex justify-end"><button onClick={() => window.print()} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="print-quotes">Print / save quotes as PDF</button></div>
      {groups.map((g) => (
        <div key={g.label || 'all'}>
          {g.label && <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><g.icon size={13} aria-hidden="true" /> {g.label} · {g.list.length}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {[...g.list].sort(order).map((q) => {
              const s = shipperById(q.shipperId) ?? { id: q.shipperId, name: 'Shipper', initials: 'SS', hue: '#F5B82E', rating: 0, reviews: 0, verified: false }
              const t = tags.get(q.id) ?? []
              const missing = missingServices(r, q.includes)
              const dead = !live(q) && q.status !== 'accepted'
              return (
                <div key={q.id} className={`relative rounded-[var(--radius-md)] border p-4 ${q.status === 'accepted' ? 'border-teal bg-teal/5' : dead ? 'border-border opacity-55' : t.includes('Lowest price') ? 'border-gold' : 'border-border bg-surface'}`} data-testid="quote-card">
                  {t.length > 0 && r.status === 'open' && <div className="absolute -top-2.5 left-4 flex gap-1">{t.map((x) => <span key={x} className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-on-accent" data-testid="quote-tag">{x}</span>)}</div>}
                  <div className="flex items-start gap-3">
                    <Avatar initials={s.initials} hue={s.hue} logo={'logo' in s ? s.logo : null} size={40} />
                    <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-sm font-semibold text-text">{s.name}</p>{s.verified && <p className="mt-1"><VerifiedBadge /></p>}<div className="mt-1 flex flex-wrap gap-1.5"><Rating value={s.rating} count={s.reviews} /></div></div>
                    <div className="text-right"><p className="font-heading text-2xl font-bold text-text" data-testid="quote-total">{money(totalOf(q))}</p><p className="text-xs text-text-muted">{q.suppliesUsd ? `${money(q.price)} freight + ${money(q.suppliesUsd)} supplies · ` : ''}~{q.transitDays} days{q.kind === 'estimate' ? ' · estimate' : ''}</p></div>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">{q.includes.map((x) => <li key={x} className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{x}</li>)}</ul>
                  {(q.supplies?.length ?? 0) > 0 && (
                    <ul className="mt-3 space-y-1 rounded-lg bg-surface-2/60 p-2.5 text-xs" data-testid="quote-supply-lines">
                      {q.supplies!.map((l) => <li key={l.kind} className="flex items-center justify-between gap-2">{l.source === 'none'
                        ? <span className="text-danger">Can’t supply the {SUPPLY_WORD[l.kind] ?? l.kind} you asked for</span>
                        : <><span className="min-w-0 truncate">{l.qty} × {l.name} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${l.source === 'ntemtem' ? 'bg-gold/20 text-gold-deep' : 'bg-teal/15 text-teal'}`}>{l.source === 'ntemtem' ? 'Sent by Ntemtem' : 'From the shipper'}</span></span><span className="shrink-0 tabular-nums">{money((l.unitUsd ?? 0) * l.qty)}</span></>}</li>)}
                    </ul>
                  )}
                  {missing.length > 0 && <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs text-danger" data-testid="quote-missing"><AlertTriangle size={11} aria-hidden="true" /> Doesn’t include {missing.join(', ')} you asked for — ask before booking</p>}
                  {q.kind === 'estimate' && <p className="mt-2 text-xs text-text-muted">Estimate: the final price is confirmed when your pieces are weighed at the warehouse.</p>}
                  {q.stale && live(q) && <p className="mt-2 text-xs text-gold-deep">You changed the request after this quote — the shipper may update it.</p>}
                  {q.notes && <p className="mt-3 text-xs text-text-muted">{q.notes}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-text-muted">{q.status === 'withdrawn' ? 'Withdrawn by the shipper' : !live(q) && q.status !== 'accepted' && q.status !== 'declined' ? `Expired ${fmtDate(q.validUntil)}` : `Valid until ${fmtDate(q.validUntil)}`}</p>
                    <div className="flex gap-1.5">
                      {r.status !== 'cancelled' && r.status !== 'expired' && q.status !== 'withdrawn' && <button onClick={() => setThread(thread === q.shipperId ? null : q.shipperId)} className="btn-ghost !min-h-10 !px-3 text-xs" data-testid="quote-message"><MessageSquare size={13} aria-hidden="true" /> Ask</button>}
                      {q.status === 'accepted' ? <Pill tone="green">Accepted</Pill> : q.status === 'declined' ? <Pill tone="muted">Declined</Pill> : dead ? <Pill tone="muted">{q.status === 'withdrawn' ? 'Withdrawn' : 'Expired'}</Pill> : r.status === 'open' && (
                        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => accept(r, q.id)} disabled={busyQuote !== null} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60" data-testid="accept-quote">{busyQuote === q.id ? 'Booking…' : 'Accept & book'}</motion.button>
                      )}
                    </div>
                  </div>
                  {live(q) && q.status !== 'accepted' && q.status !== 'declined' && r.status === 'open' && <ProtectedNote className="mt-3" />}
                  {thread === q.shipperId && <div className="mt-3"><MessageThread requestId={r.id} shipperId={q.shipperId} compact onClose={() => setThread(null)} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Edit details, cancel, or open a one-shipper request to everyone. */
export function RequestManage({ r, wantMarket }: { r: QuoteRequest; wantMarket?: boolean }) {
  const { shipperById } = useStore()
  const [mode, setMode] = useState<'' | 'edit' | 'cancel'>('')
  const [f, setF] = useState({ readyDate: r.readyDate, quantity: String(r.quantity), weightKg: r.weightKg ? String(r.weightKg) : '', dims: r.dims ?? '', declared: r.declaredValueUsd ? String(r.declaredValueUsd) : '', description: r.description, pickup: r.pickup, delivery: r.delivery, insurance: r.insurance })
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  if (r.status !== 'open') return r.status === 'cancelled' || r.status === 'expired' ? <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-text-muted" data-testid="request-closed">{r.status === 'cancelled' ? `You cancelled this request${r.cancelReason ? ` — ${r.cancelReason}` : ''}.` : 'This request expired without a booking.'} <a href={`#/quote?again=${r.id}`} className="text-gold-deep hover:underline">Post it again →</a></p> : null
  const preferred = r.preferredShipperId && r.source === 'picked' ? shipperById(r.preferredShipperId) : null
  const quiet = !r.quotes.some(live) && Date.now() - new Date(r.createdAt).getTime() > 24 * 3600000
  const run = async (fn: () => Promise<string>) => { setBusy(true); setErr(''); try { setOk(await fn()); setMode(''); refreshShipments() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.') } finally { setBusy(false) } }
  const save = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { const res = await requestsApi.edit(r.id, { readyDate: f.readyDate, quantity: Number(f.quantity), weightKg: f.weightKg ? Number(f.weightKg) : null, dims: f.dims, declaredValueUsd: f.declared ? Number(f.declared) : null, description: f.description, pickup: f.pickup, delivery: f.delivery, insurance: f.insurance }); return res.changed.length ? `Saved — ${r.quotes.some(live) ? 'shippers who quoted have been told' : 'shippers see the new details'}.` : 'Nothing changed.' }) }
  const cls = 'input-dark !min-h-9 text-sm'
  return (
    <div className="mt-3 space-y-3">
      {preferred && (quiet || wantMarket) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm" data-testid="open-market-banner">
          <p className="min-w-0"><Clock size={14} className="mr-1 inline text-gold-deep" aria-hidden="true" />{preferred.name} hasn’t quoted yet. Get prices from every matching shipper instead?</p>
          <button disabled={busy} onClick={() => run(async () => { await requestsApi.openMarket(r.id); return 'Opened to every matching shipper — quotes will come in here.' })} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="open-market"><Globe2 size={13} aria-hidden="true" /> Open to all shippers</button>
        </div>
      )}
      {ok && <p role="status" className="text-sm text-teal" data-testid="request-ok">{ok}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {!mode && <div className="flex flex-wrap gap-1.5"><button onClick={() => setMode('edit')} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="request-edit"><Pencil size={12} aria-hidden="true" /> Edit details</button><button onClick={() => setMode('cancel')} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger" data-testid="request-cancel"><Ban size={12} aria-hidden="true" /> Cancel request</button>{r.expiresAt && <span className="self-center text-xs text-text-muted">Open until {fmtDate(r.expiresAt)}</span>}</div>}
      {mode === 'edit' && (
        <form onSubmit={save} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3" data-testid="request-edit-form">
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Ready date</span><input type="date" min={today()} required className={cls} value={f.readyDate} onChange={(e) => setF({ ...f, readyDate: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Pieces</span><input type="number" min={1} required className={cls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} data-testid="edit-qty" /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Weight, kg</span><input inputMode="numeric" className={cls} value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value.replace(/\D/g, '') })} data-testid="edit-weight" /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Dimensions</span><input className={cls} value={f.dims} onChange={(e) => setF({ ...f, dims: e.target.value })} placeholder="90×60×60 cm" /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Declared value, USD</span><input inputMode="decimal" className={cls} value={f.declared} onChange={(e) => setF({ ...f, declared: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          <div className="flex flex-wrap items-end gap-3 text-xs">{(['pickup', 'delivery', 'insurance'] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="accent-gold" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{k === 'pickup' ? 'Pickup' : k === 'delivery' ? 'Door delivery' : 'Insurance'}</label>)}</div>
          <label className="grid gap-1 text-xs sm:col-span-3"><span className="text-text-muted">Description</span><textarea rows={2} className="input-dark py-2 text-sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <p className="text-xs text-text-muted sm:col-span-3">To change the route, mode or cargo type, cancel and post a new request.</p>
          <div className="flex justify-end gap-1.5 sm:col-span-3"><button type="button" onClick={() => setMode('')} className="btn-ghost !min-h-8 !px-2.5 text-xs">Back</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="request-save">Save changes</button></div>
        </form>
      )}
      {mode === 'cancel' && (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await requestsApi.cancel(r.id, reason); return 'Request cancelled — shippers who quoted have been told.' }) }} className="grid gap-2 rounded-lg border border-danger/40 p-3">
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Why? (optional — shared with shippers who quoted)</span><input autoFocus className={cls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shipping later / found another way" data-testid="request-cancel-reason" /></label>
          <div className="flex justify-end gap-1.5"><button type="button" onClick={() => setMode('')} className="btn-ghost !min-h-8 !px-2.5 text-xs">Keep it open</button><button disabled={busy} className="btn-ghost !min-h-8 !border-danger !px-3 text-xs text-danger" data-testid="request-cancel-confirm">Cancel request</button></div>
        </form>
      )}
    </div>
  )
}
