import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gift, Hourglass, KeyRound } from 'lucide-react'
import { refreshShipments } from '../lib/flowEvents'
import { shipmentOpsApi, type Offer, type StuckRow } from '../lib/shipmentOps'
import type { Shipment } from '../lib/data'

/** Customer: one-tap upgrades the shipper offers (door delivery on arrival, duty prepayment once customs confirms it). */
export function OffersCard({ s }: { s: Shipment }) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [busy, setBusy] = useState(''); const [done, setDone] = useState(''); const [err, setErr] = useState('')
  useEffect(() => { shipmentOpsApi.offers(s.id).then(setOffers).catch(() => setOffers([])) }, [s.id, s.status, s.handover])
  if (!offers.length && !done) return null
  const take = async (o: Offer) => { setBusy(o.kind); setErr(''); try { const r = await shipmentOpsApi.acceptOffer(s.id, o.kind); setDone(`${o.kind === 'door_delivery' ? 'Door delivery added' : 'Duty prepayment added'}${r.invoice ? ` to ${r.invoice}` : ''}.`); setOffers((x) => x.filter((y) => y.kind !== o.kind)); refreshShipments() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add it.') } finally { setBusy('') } }
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/5 p-4" data-testid="offers-card">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold-deep"><Gift size={14} aria-hidden="true" /> Options for {s.ref}</p>
      {done && <p role="status" className="mt-2 text-sm text-teal">{done}</p>}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <ul className="mt-2 space-y-3">
        {offers.map((o) => <li key={o.kind} className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{o.title}</p><p className="text-xs text-text-muted">{o.body}</p></div><button onClick={() => take(o)} disabled={!!busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60" data-testid={`offer-${o.kind}`}>{busy === o.kind ? 'Adding…' : `Add for $${o.amountUsd.toLocaleString()}`}</button></li>)}
      </ul>
    </div>
  )
}

/** Customer: the collection code once the shipment is ready, so they can forward it if the recipient's text didn't land. */
export function CollectionNotice({ s }: { s: Shipment }) {
  if (s.status !== 'ready_for_collection') return null
  return <div className="rounded-xl border border-teal/40 bg-teal/10 p-4 text-sm" data-testid="collection-notice"><p className="inline-flex items-center gap-2 font-semibold text-teal"><KeyRound size={15} aria-hidden="true" /> Ready for collection</p><p className="mt-1 text-text-muted">Your recipient brings a photo ID and the 6-digit collection code we texted them (it’s also in your notifications). Forward it if they didn’t get it.</p></div>
}

/** Shipper overview: shipments sitting much longer than normal in one status. */
export function StuckCard() {
  const [rows, setRows] = useState<StuckRow[] | null>(null)
  useEffect(() => { shipmentOpsApi.stuck().then(setRows).catch(() => setRows([])) }, [])
  if (!rows || !rows.length) return null
  return (
    <section className="card-dark border-l-4 border-l-danger p-5" aria-labelledby="stuck-h" data-testid="stuck-card">
      <div className="mb-2 flex items-center justify-between"><h2 id="stuck-h" className="flex items-center gap-2 !text-base"><Hourglass size={16} className="text-danger" aria-hidden="true" /> Looks stuck</h2><Link to="/dashboard/shipments?b=stuck" className="text-xs text-gold-deep hover:underline">All {rows.length} →</Link></div>
      <ul className="divide-y divide-border text-sm">
        {rows.slice(0, 5).map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><Link to={`/dashboard/shipments?b=stuck&q=${r.ref}`} className="min-w-0 truncate hover:text-gold-deep"><span className="font-mono text-xs text-gold-deep">{r.ref}</span> · {r.customer}</Link><span className="shrink-0 text-xs text-danger">{r.days}d in {r.statusLabel} <span className="text-text-muted">(usually {r.typical})</span></span></li>)}
      </ul>
    </section>
  )
}
