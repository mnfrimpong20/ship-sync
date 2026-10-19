import { useEffect, useState } from 'react'
import { Check, Scale, X } from 'lucide-react'
import { autopilotApi, type Adjustment } from '../lib/autopilot'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Updated price after weighing: the office reviews and sends it; the customer approves or declines. */
export function PriceAdjustmentCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<{ adjustments: Adjustment[]; canEdit: boolean } | null>(null)
  const [edit, setEdit] = useState<number | null>(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  useEffect(() => { autopilotApi.adjustments(shipmentId).then(setD).catch(() => setD(null)) }, [shipmentId])
  if (!d || !d.adjustments.length) return null
  const a = d.adjustments[0]
  const act = async (action: 'send' | 'withdraw' | 'approve' | 'decline') => { setBusy(action); setErr(''); try { const list = await autopilotApi.adjust(shipmentId, a.id, action, action === 'send' && edit ? edit : undefined); setD({ ...d, adjustments: list }); setEdit(null) } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy('') } }
  const tone = a.status === 'approved' ? 'border-teal/40' : a.status === 'declined' ? 'border-danger/40' : 'border-gold/50'
  return (
    <div className={`min-w-0 rounded-xl border bg-surface p-4 ${tone}`} data-testid="price-adjustment">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Scale size={14} className="text-gold-deep" aria-hidden="true" /> Updated price after weighing</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{usd(a.oldUsd)} → {usd(edit ?? a.newUsd)} <span className="text-sm font-normal text-text-muted">(+{usd((edit ?? a.newUsd) - a.oldUsd)})</span></p>
      <p className="mt-1 text-xs text-text-muted">{a.reason}</p>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      {d.canEdit ? (
        a.status === 'proposed' ? <div className="mt-3 flex flex-wrap items-center gap-2"><label className="flex items-center gap-1.5 text-xs">New price $<input type="number" min={1} className="input-dark !min-h-8 !w-24 !px-2 text-xs" value={edit ?? a.newUsd} onChange={(e) => setEdit(Number(e.target.value) || null)} /></label><button onClick={() => act('send')} disabled={!!busy} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="adj-send">Send to customer</button><button onClick={() => act('withdraw')} disabled={!!busy} className="btn-ghost !min-h-8 !px-3 text-xs">Keep the original price</button></div>
        : <p className="mt-2 text-xs">{a.status === 'sent' ? 'Waiting for the customer to approve.' : a.status === 'approved' ? `Approved by ${a.decidedBy} — added to what they owe.` : a.status === 'declined' ? `${a.decidedBy} declined — call them before it ships.` : 'Withdrawn — original price kept.'}</p>
      ) : a.status === 'sent' ? (
        <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => act('approve')} disabled={!!busy} className="btn-gold !min-h-10 text-sm" data-testid="adj-approve"><Check size={15} aria-hidden="true" /> Approve {usd(a.newUsd)}</button><button onClick={() => act('decline')} disabled={!!busy} className="btn-ghost !min-h-10 text-sm"><X size={15} aria-hidden="true" /> Decline</button></div>
      ) : <p className="mt-2 text-xs">{a.status === 'approved' ? 'You approved this price.' : 'You declined — your shipper will be in touch.'}</p>}
    </div>
  )
}
