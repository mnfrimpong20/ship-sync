import { useEffect, useState } from 'react'
import { AlertOctagon, Check, MessageSquare, Star } from 'lucide-react'
import { outcomeLabels, reviewsApi, type Dispute, type DisputeReason, type Review } from '../lib/reviews'
import { money } from './ui'
import { Confirm } from './board'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const Stars = ({ n, size = 14 }: { n: number; size?: number }) => <span className="inline-flex gap-0.5" role="img" aria-label={`${n} out of 5`}>{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={size} className={i < n ? 'fill-gold text-gold-deep' : 'text-border'} aria-hidden="true" />)}</span>

/** Customer rates a delivered shipment; the office replies. */
export function ReviewCard({ shipmentId, shipperName }: { shipmentId: string; shipperName?: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof reviewsApi.forShipment>> | null>(null)
  const [f, setF] = useState<{ rating: number; tags: string[]; body: string }>({ rating: 0, tags: [], body: '' })
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const load = () => reviewsApi.forShipment(shipmentId).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || (!d.review && !d.canReview)) return null
  const rv = d.review
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) } }
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="review-card">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Star size={14} className="text-gold-deep" aria-hidden="true" /> {rv ? 'Review' : `Rate ${shipperName ?? 'your shipper'}`}</p>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {rv ? (
        <div className="mt-2 text-sm">
          <div className="flex items-center gap-2"><Stars n={rv.rating} /><span className="text-xs text-text-muted">{rv.author} · {fmt(rv.createdAt)}</span></div>
          {rv.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{rv.tags.join(' · ')}</p>}
          <p className="mt-2">{rv.body}</p>
          {rv.reply ? <p className="mt-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs"><strong>{rv.shipperName} replied:</strong> {rv.reply}</p> : d.canReply ? (
            <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.reply(rv.id, reply), 'Reply posted.') }} className="mt-2 flex gap-2"><input required minLength={2} aria-label="Reply" className="input-dark !min-h-9 flex-1 text-sm" placeholder="Reply publicly…" value={reply} onChange={(e) => setReply(e.target.value)} /><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">Reply</button></form>
          ) : null}
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.create(shipmentId, f), 'Thanks — your review is live on the shipper’s profile.') }} className="mt-2 grid gap-2" aria-label="Review" data-testid="review-form">
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={f.rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setF({ ...f, rating: n })} className="focus-ring rounded"><Star size={24} className={n <= f.rating ? 'fill-gold text-gold-deep' : 'text-border hover:text-gold-deep'} /></button>)}</div>
          <div className="flex flex-wrap gap-1.5">{d.tags.map((t) => <button key={t} type="button" onClick={() => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t].slice(0, 5) })} className={`rounded-full border px-2.5 py-1 text-xs ${f.tags.includes(t) ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{t}</button>)}</div>
          <textarea required minLength={10} rows={3} aria-label="Your review" className="input-dark py-2 text-sm" placeholder="How did it go? Packing, communication, timing, the handover…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="flex justify-end"><button disabled={busy || !f.rating} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60" data-testid="submit-review">{busy ? 'Posting…' : 'Post review'}</button></div>
        </form>
      )}
    </div>
  )
}

const roleLabel: Record<string, string> = { customer: 'Customer', office: 'Shipper', shipsync: 'Ntemtem' }

/** Open a dispute, message in the thread, see the resolution. Escrow is held while it's open. */
export function DisputeCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof reviewsApi.dispute>> | null>(null)
  const [opening, setOpening] = useState(false)
  const [f, setF] = useState<{ reason: DisputeReason; description: string; amount: string }>({ reason: 'damaged', description: '', amount: '' })
  const [msg, setMsg] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const load = () => reviewsApi.dispute(shipmentId).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || (!d.dispute && !d.canOpen)) return null
  const dp: Dispute | null = d.dispute
  const act = async (fn: () => Promise<unknown>, m: string) => { setBusy(true); setError(''); try { await fn(); await load(); setToast(m) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false); setOpening(false); setWithdrawing(false) } }
  return (
    <div className={`min-w-0 rounded-xl border bg-surface p-4 ${dp?.status === 'open' ? 'border-danger/40' : 'border-border'}`} data-testid="dispute-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><AlertOctagon size={14} className={dp?.status === 'open' ? 'text-danger' : 'text-text-muted'} aria-hidden="true" /> Dispute</p>
        {dp && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dp.status === 'open' ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-text-muted'}`} data-testid="dispute-status">{dp.status === 'open' ? 'Open — Ntemtem mediating' : dp.status === 'withdrawn' ? 'Withdrawn' : `Resolved: ${outcomeLabels[dp.resolution?.outcome ?? ''] ?? ''}`}</span>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {dp ? (
        <div className="mt-2 text-sm">
          <p><strong>{dp.reasonLabel}</strong>{dp.amountClaimedUsd ? ` · claims ${money(dp.amountClaimedUsd)}` : ''} · opened by {dp.openedBy} ({roleLabel[dp.openedByRole]}) {fmt(dp.createdAt)}</p>
          {dp.paymentId && <p className="text-xs text-text-muted">{dp.status === 'open' ? `${money(dp.paymentAmountUsd ?? 0)} in escrow is on hold until this is resolved.` : `Payment: ${dp.paymentStatus}.`}</p>}
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs">{dp.messages.map((m, i) => <li key={i} className={`rounded-lg px-3 py-2 ${m.role === 'shipsync' ? 'border border-gold/40 bg-gold/10' : 'bg-surface-2/40'}`}><span className="font-semibold">{m.by}</span> <span className="text-text-muted">· {roleLabel[m.role] ?? m.role} · {fmt(m.at)}</span><p className="mt-0.5 whitespace-pre-line">{m.text}</p></li>)}</ul>
          {(dp as { photos?: string[] }).photos?.length ? <div className="mt-2 flex flex-wrap gap-1.5" data-testid="dispute-photo-list">{(dp as { photos?: string[] }).photos!.map((p, i) => <a key={i} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`Photo ${i + 1}`} className="h-16 w-16 rounded object-cover" /></a>)}</div> : null}
          {dp.resolution && dp.status === 'resolved' && <p className="mt-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-xs"><strong>Resolution ({dp.resolution.by}):</strong> {outcomeLabels[dp.resolution.outcome]}{dp.resolution.amountUsd ? ` ${money(dp.resolution.amountUsd)}` : ''} — {dp.resolution.note}</p>}
          {dp.status === 'open' && (
            <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.message(dp.id, msg), 'Message sent.'); setMsg('') }} className="mt-2 flex gap-2"><input required aria-label="Message" className="input-dark !min-h-9 flex-1 text-sm" placeholder="Reply…" value={msg} onChange={(e) => setMsg(e.target.value)} /><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><MessageSquare size={12} aria-hidden="true" /> Send</button></form>
          )}
          {dp.status === 'open' && ((d.role === 'customer' && dp.openedByRole === 'customer') || (d.role === 'office' && dp.openedByRole === 'office')) && <button onClick={() => setWithdrawing(true)} className="btn-ghost mt-2 !min-h-8 !px-2.5 text-xs">Withdraw dispute</button>}
          {dp.status !== 'open' && d.canOpen && <button onClick={() => setOpening(true)} className="btn-ghost mt-2 !min-h-8 !px-2.5 text-xs">Open another dispute</button>}
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs text-text-muted">Something wrong with this shipment? Open a dispute — Ntemtem holds any escrow payment and mediates between you and the {d.role === 'office' ? 'customer' : 'shipper'}.</p>
          {!opening && <button onClick={() => setOpening(true)} className="btn-ghost mt-2 !min-h-8 !px-3 text-xs" data-testid="open-dispute">Open a dispute</button>}
        </div>
      )}
      {opening && (
        <form onSubmit={(e) => { e.preventDefault(); void act(() => reviewsApi.openDispute(shipmentId, { reason: f.reason, description: f.description, amountClaimedUsd: f.amount ? Number(f.amount) : undefined, photos }), 'Dispute opened — Ntemtem has been notified.') }} className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3" aria-label="Open a dispute" data-testid="dispute-form">
          <select aria-label="Reason" className="input-dark !min-h-9 text-sm" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as DisputeReason })}>{d.reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <textarea required minLength={10} rows={3} aria-label="What happened" className="input-dark py-2 text-sm" placeholder="What happened, which pieces, when you noticed…" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <label className="text-xs text-text-muted">Photos (up to 4)<input type="file" accept="image/*" multiple className="mt-1 block text-xs" data-testid="dispute-photos" onChange={async (e) => { const fs = [...(e.target.files ?? [])].slice(0, 4); const { readImage } = await import('../lib/customerHub'); setPhotos(await Promise.all(fs.map((x) => readImage(x)))) }} />{photos.length > 0 && <span className="mt-1 flex gap-1">{photos.map((p, i) => <img key={i} src={p} alt="" className="h-12 w-12 rounded object-cover" />)}</span>}</label>
          <input type="number" min={0} aria-label="Amount claimed (USD)" className="input-dark !min-h-9 text-sm tabular-nums" placeholder="Amount you’re asking for (USD, optional)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpening(false)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button disabled={busy} className="inline-flex min-h-8 items-center rounded-lg bg-danger px-3 text-xs font-semibold text-white disabled:opacity-60">{busy ? 'Opening…' : 'Open dispute'}</button></div>
        </form>
      )}
      {withdrawing && dp && <Confirm title="Withdraw this dispute?" body={<p>The thread closes and any held payment is released back to its normal flow.</p>} confirmLabel="Withdraw" busy={busy} onClose={() => setWithdrawing(false)} onConfirm={() => act(() => reviewsApi.withdraw(dp.id), 'Dispute withdrawn.')} />}
    </div>
  )
}

/** Public: a shipper's real reviews with the distribution. */
export function ShipperReviews({ shipperId, fallback }: { shipperId: string; fallback: { n: string; d: string; r: number; t: string }[] }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof reviewsApi.forShipper>> | null>(null)
  useEffect(() => { reviewsApi.forShipper(shipperId).then(setD).catch(() => setD({ reviews: [], summary: { count: 0, average: null, distribution: [], tags: [] } })) }, [shipperId])
  const list: Review[] = d?.reviews ?? []
  return (
    <div data-testid="shipper-reviews">
      {d && d.summary.count > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
          <div><p className="text-3xl font-bold">{d.summary.average}</p><Stars n={Math.round(d.summary.average ?? 0)} /><p className="text-xs text-text-muted">{d.summary.count} verified review{d.summary.count === 1 ? '' : 's'}</p></div>
          <div className="space-y-1">{d.summary.distribution.map((x) => <div key={x.stars} className="flex items-center gap-2 text-xs"><span className="w-3 text-text-muted">{x.stars}</span><div className="h-1.5 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${d.summary.count ? (x.count / d.summary.count) * 100 : 0}%` }} /></div><span className="w-4 text-right text-text-muted">{x.count}</span></div>)}{d.summary.tags.length > 0 && <p className="pt-1 text-xs text-text-muted">{d.summary.tags.map((t) => `${t.tag} (${t.count})`).join(' · ')}</p>}</div>
        </div>
      )}
      <ul className="mt-4 divide-y divide-border">
        {list.map((r) => <li key={r.id} className="py-4" data-testid="shipper-review"><div className="flex items-center justify-between"><p className="font-semibold text-text">{r.author} <span className="font-normal text-xs text-text-muted">· verified · {r.lane}</span></p><span className="text-xs text-text-muted">{fmt(r.createdAt)}</span></div><div className="mt-1"><Stars n={r.rating} /></div>{r.tags.length > 0 && <p className="mt-1 text-xs text-text-muted">{r.tags.join(' · ')}</p>}<p className="mt-2 text-sm text-text-muted">{r.body}</p>{r.reply && <p className="mt-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs"><strong>Reply:</strong> {r.reply}</p>}</li>)}
        {d && list.length === 0 && fallback.map((r) => <li key={r.n} className="py-4"><div className="flex items-center justify-between"><p className="font-semibold text-text">{r.n}</p><span className="text-xs text-text-muted">{r.d}</span></div><div className="mt-1"><Stars n={r.r} /></div><p className="mt-2 text-sm text-text-muted">{r.t}</p></li>)}
      </ul>
    </div>
  )
}
