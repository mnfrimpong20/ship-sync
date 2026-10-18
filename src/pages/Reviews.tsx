import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertOctagon, Check, MessageSquare, Star } from 'lucide-react'
import { useStore } from '../lib/store'
import { outcomeLabels, reviewsApi, type Dispute, type Review } from '../lib/reviews'
import { Empty, Pill, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { StatCard } from '../components/board'
import { Stars } from '../components/ReviewCards'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

/** `/dashboard/reviews` — the shipper's reviews (reply) and disputes. */
export default function ReviewsPage() {
  const { ready, user } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof reviewsApi.mine>> | null>(null)
  const [disputes, setDisputes] = useState<Dispute[] | null>(null)
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const load = () => Promise.all([reviewsApi.mine().then(setD), reviewsApi.disputes().then(setDisputes)]).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/reviews" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />
  const send = async () => { if (!reply) return; setBusy(reply.id); setError(''); try { await reviewsApi.reply(reply.id, reply.text); await load(); setToast('Reply posted.'); setReply(null) } catch (e) { setError(e instanceof Error ? e.message : 'Could not reply.') } finally { setBusy('') } }
  const open = (disputes ?? []).filter((x) => x.status === 'open')
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Reputation</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{d ? `${d.rating.toFixed(1)} ★ from ${d.count} review${d.count === 1 ? '' : 's'}` : 'Reviews & disputes'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Only customers who booked through Ntemtem can review, after delivery. Reply once to each; replies are public. Disputes are mediated by Ntemtem and hold any escrow payment while open.</motion.p></div>
            <motion.div variants={fadeUp}><Link to={`/shippers/${user.shipperId}`} className="btn-ghost">Public profile</Link></motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Rating" value={d ? d.rating.toFixed(1) : '—'} hint={`${d?.count ?? 0} reviews (incl. listing baseline)`} icon={Star} />
            <StatCard label="To reply" value={d?.reviews.filter((r) => !r.reply).length ?? 0} hint="Replies are public" icon={MessageSquare} />
            <StatCard label="Awaiting review" value={d?.awaiting ?? 0} hint="Delivered, not yet rated" icon={Star} />
            <StatCard label="Open disputes" value={open.length} hint={open.length ? `${money(open.reduce((n, x) => n + (x.paymentAmountUsd ?? 0), 0))} on hold` : 'None'} icon={AlertOctagon} warn={open.length > 0} />
          </motion.div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <motion.div variants={fadeUp} className="card-dark overflow-hidden" data-testid="reviews-list">
              <div className="px-5 pt-5"><h2 className="!text-base">Reviews</h2></div>
              <ul className="mt-3 divide-y divide-border/70">
                {d && d.reviews.length === 0 && <li className="px-5 py-6"><Empty title="No reviews yet" body="Deliver a few shipments and your customers will be asked to rate you." /></li>}
                {d?.reviews.map((r: Review) => (
                  <li key={r.id} className="px-5 py-4" data-testid="review-row">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Stars n={r.rating} /><span className="text-sm font-semibold">{r.author}</span><span className="text-xs text-text-muted">· {r.lane} · {r.cargo} · <Link to={`/dashboard/shipments?q=${r.shipmentRef}&b=all`} className="font-mono text-gold-deep hover:underline">{r.shipmentRef}</Link></span></div><span className="text-xs text-text-muted">{fmt(r.createdAt)}{r.status === 'hidden' ? ' · hidden by Ntemtem' : ''}</span></div>
                    {r.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{r.tags.join(' · ')}</p>}
                    <p className="mt-2 text-sm">{r.body}</p>
                    {r.reply ? <p className="mt-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs"><strong>You replied:</strong> {r.reply}</p> : reply?.id === r.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); void send() }} className="mt-2 flex gap-2"><input autoFocus required minLength={2} aria-label="Reply" className="input-dark !min-h-9 flex-1 text-sm" placeholder="Thank them, or explain what happened…" value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} /><button type="button" onClick={() => setReply(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy === r.id} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">Post</button></form>
                    ) : <button onClick={() => setReply({ id: r.id, text: '' })} className="btn-ghost mt-2 !min-h-8 !px-2.5 text-xs" data-testid="reply-btn"><MessageSquare size={12} aria-hidden="true" /> Reply</button>}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5" data-testid="disputes-list">
              <h2 className="flex items-center gap-2 !text-base"><AlertOctagon size={16} className="text-gold-deep" aria-hidden="true" /> Disputes</h2>
              <ul className="mt-3 divide-y divide-border/70 text-sm">
                {disputes && disputes.length === 0 && <li className="py-3 text-text-muted">No disputes. Keep it that way.</li>}
                {disputes?.map((x) => <li key={x.id} className="py-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold">{x.reasonLabel} <span className="font-normal text-text-muted">· <Link to={`/dashboard/shipments?q=${x.shipmentRef}&b=all`} className="font-mono text-xs text-gold-deep hover:underline">{x.shipmentRef}</Link></span></p><Pill tone={x.status === 'open' ? 'danger' : 'muted'}>{x.status === 'open' ? 'Open' : x.status === 'withdrawn' ? 'Withdrawn' : outcomeLabels[x.resolution?.outcome ?? '']}</Pill></div><p className="mt-1 text-xs text-text-muted">{x.customer} · opened by {x.openedBy} · {x.messages.length} message{x.messages.length === 1 ? '' : 's'}{x.paymentAmountUsd ? ` · ${money(x.paymentAmountUsd)} ${x.status === 'open' ? 'on hold' : ''}` : ''}</p></li>)}
              </ul>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/** Admin: open disputes to mediate and resolve, and every review (hide abuse). */
export function AdminDisputes() {
  const [d, setD] = useState<Awaited<ReturnType<typeof reviewsApi.admin>> | null>(null)
  const [sel, setSel] = useState<Dispute | null>(null)
  const [msg, setMsg] = useState('')
  const [res, setRes] = useState<{ outcome: 'refund_full' | 'refund_partial' | 'release' | 'no_action'; amountUsd: string; note: string }>({ outcome: 'no_action', amountUsd: '', note: '' })
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const load = () => reviewsApi.admin().then((r) => { setD(r); if (sel) setSel(r.disputes.find((x) => x.id === sel.id) ?? null) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  const act = async (fn: () => Promise<unknown>, m: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(m) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') } }
  const open = d?.disputes.filter((x) => x.status === 'open') ?? []
  return (
    <section className="mt-14" data-testid="admin-disputes">
      <p className="eyebrow mb-1">Disputes & reviews</p>
      <h2 className="!text-[clamp(1.5rem,3vw,2rem)]">Mediation</h2>
      <p className="mt-1 text-text-muted">Open disputes hold the escrow payment. Read the thread, add a message, then resolve with a refund (full or partial, back to the customer's card), a release to the shipper, or no action.</p>
      {toast && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="card-dark p-4">
          <h3 className="!text-base">Disputes <span className="text-xs font-normal text-text-muted">· {open.length} open</span></h3>
          <ul className="mt-2 divide-y divide-border/70 text-sm">{d?.disputes.map((x) => <li key={x.id}><button onClick={() => { setSel(x); setRes({ outcome: x.paymentId ? 'refund_partial' : 'no_action', amountUsd: x.amountClaimedUsd ? String(x.amountClaimedUsd) : '', note: '' }) }} className={`w-full py-2.5 text-left ${sel?.id === x.id ? 'text-gold-deep' : ''}`} data-testid="admin-dispute-row"><p className="font-semibold">{x.reasonLabel} · <span className="font-mono text-xs">{x.shipmentRef}</span></p><p className="text-xs text-text-muted">{x.customer} vs {x.shipperName} · {x.status}{x.paymentAmountUsd ? ` · ${money(x.paymentAmountUsd)}` : ''}</p></button></li>)}{d && d.disputes.length === 0 && <li className="py-3 text-text-muted">No disputes.</li>}</ul>
        </div>
        <div className="card-dark p-5">
          {!sel ? <p className="text-sm text-text-muted">Pick a dispute.</p> : (
            <div data-testid="admin-dispute-detail">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="!text-base">{sel.reasonLabel} — {sel.shipmentRef}</h3><Pill tone={sel.status === 'open' ? 'danger' : 'muted'}>{sel.status}</Pill></div>
              <p className="mt-1 text-xs text-text-muted">{sel.customer} (customer) vs {sel.shipperName} (shipper) · opened by {sel.openedBy} · {sel.amountClaimedUsd ? `claims ${money(sel.amountClaimedUsd)} · ` : ''}{sel.paymentId ? `payment ${money(sel.paymentAmountUsd ?? 0)} (${sel.paymentStatus})` : 'no platform payment'}</p>
              <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto text-xs">{sel.messages.map((m, i) => <li key={i} className={`rounded-lg px-3 py-2 ${m.role === 'shipsync' ? 'border border-gold/40 bg-gold/10' : 'bg-surface-2/40'}`}><span className="font-semibold">{m.by}</span> <span className="text-text-muted">· {m.role} · {fmt(m.at)}</span><p className="mt-0.5 whitespace-pre-line">{m.text}</p></li>)}</ul>
              {sel.status === 'open' ? (
                <>
                  <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.message(sel.id, msg), 'Message sent to both sides.', 'msg'); setMsg('') }} className="mt-3 flex gap-2"><input required aria-label="Message" className="input-dark !min-h-9 flex-1 text-sm" placeholder="Message as Ntemtem…" value={msg} onChange={(e) => setMsg(e.target.value)} /><button disabled={busy === 'msg'} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60">Send</button></form>
                  <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.resolve(sel.id, { outcome: res.outcome, amountUsd: res.outcome === 'refund_partial' ? Number(res.amountUsd) || 0 : undefined, note: res.note }), 'Resolved — both sides notified.', 'res') }} className="mt-4 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-[1fr_auto]" aria-label="Resolve" data-testid="resolve-form">
                    <select aria-label="Outcome" className="input-dark !min-h-9 text-sm" value={res.outcome} onChange={(e) => setRes({ ...res, outcome: e.target.value as typeof res.outcome })}><option value="refund_full" disabled={!sel.paymentId}>Full refund to the customer</option><option value="refund_partial" disabled={!sel.paymentId}>Partial refund</option><option value="release" disabled={!sel.paymentId}>Release the payment to the shipper</option><option value="no_action">No action</option></select>
                    {res.outcome === 'refund_partial' ? <input type="number" min={1} required aria-label="Refund amount" className="input-dark !min-h-9 !w-32 text-sm tabular-nums" placeholder="USD" value={res.amountUsd} onChange={(e) => setRes({ ...res, amountUsd: e.target.value })} /> : <span />}
                    <input required minLength={2} aria-label="Resolution note" className="input-dark !min-h-9 text-sm sm:col-span-2" placeholder="Decision note (shown to both sides)" value={res.note} onChange={(e) => setRes({ ...res, note: e.target.value })} />
                    <div className="flex justify-end sm:col-span-2"><button disabled={busy === 'res'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy === 'res' ? 'Resolving…' : 'Resolve'}</button></div>
                  </form>
                </>
              ) : sel.resolution && <p className="mt-3 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-xs"><strong>{outcomeLabels[sel.resolution.outcome]}</strong>{sel.resolution.amountUsd ? ` ${money(sel.resolution.amountUsd)}` : ''} — {sel.resolution.note} ({sel.resolution.by}, {fmt(sel.resolution.at)})</p>}
            </div>
          )}
        </div>
      </div>
      <div className="card-dark mt-6 p-5">
        <h3 className="!text-base">Latest reviews</h3>
        <ul className="mt-2 divide-y divide-border/70 text-sm">{d?.reviews.slice(0, 20).map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0"><div className="flex items-center gap-2"><Stars n={r.rating} size={12} /><span className="font-semibold">{r.author}</span><span className="text-xs text-text-muted">on {r.shipperName} · {r.shipmentRef}</span></div><p className="truncate text-xs text-text-muted">{r.body}</p></div><button onClick={() => act(() => reviewsApi.hide(r.id, r.status === 'hidden' ? 'published' : 'hidden'), r.status === 'hidden' ? 'Review republished.' : 'Review hidden.', r.id)} disabled={busy === r.id} className="btn-ghost !min-h-8 !px-2.5 text-xs">{r.status === 'hidden' ? 'Unhide' : 'Hide'}</button></li>)}{d && d.reviews.length === 0 && <li className="py-2 text-text-muted">No reviews yet.</li>}</ul>
      </div>
    </section>
  )
}
