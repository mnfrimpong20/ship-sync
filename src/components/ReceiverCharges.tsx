import { useEffect, useState } from 'react'
import { Banknote, Check, Plus, Smartphone, Wallet, X } from 'lucide-react'
import { recipientApi, type ChargesView } from '../lib/recipient'
import { fmtDateTime } from './ui'

const REASONS = ['Duty and clearing', 'Delivery to the door', 'Storage', 'Balance on freight']

/**
 * Money the receiver pays at destination — duty the shipper cleared, local delivery, storage, a balance.
 * The receiver pays by mobile money from their page; the office can also mark cash or a direct MoMo transfer.
 */
export function ReceiverChargesCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<ChargesView | null>(null)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ amount: '', reason: REASONS[0], notify: true })
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const load = () => recipientApi.charges(shipmentId).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  if (!d.canEdit && d.charges.length === 0) return null
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy('add'); setErr('')
    try { const r = await recipientApi.addCharge(shipmentId, { amount: Number(f.amount), currency: d.currency, reason: f.reason, notify: f.notify }); setD({ ...d, charges: r.charges }); setAdding(false); setF({ amount: '', reason: REASONS[0], notify: true }) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not add.') } finally { setBusy('') }
  }
  const settle = async (id: string, action: 'cash' | 'momo_direct' | 'cancel') => { setBusy(id + action); setErr(''); try { const r = await recipientApi.settleCharge(shipmentId, id, action); setD({ ...d, charges: r.charges }) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not update.') } finally { setBusy('') } }
  const how = (m: string) => (m === 'paystack' ? 'mobile money online' : m === 'cash' ? 'cash' : m === 'momo_direct' ? 'MoMo to you' : '')
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="receiver-charges-card">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Wallet size={14} className="text-gold-deep" aria-hidden="true" /> Collect from receiver</p>
        {d.canEdit && !adding && <button onClick={() => setAdding(true)} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="add-charge"><Plus size={13} aria-hidden="true" /> Add</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      {d.charges.length === 0 && !adding && <p className="mt-2 text-xs text-text-muted">Duty, local delivery or storage the receiver pays. {d.online ? `They pay by ${d.methods || 'mobile money'} from their link.` : 'They pay you at collection; record it here.'}</p>}
      {d.charges.length > 0 && (
        <ul className="mt-3 space-y-2.5 text-sm">
          {d.charges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0"><strong className="tabular-nums">{c.label}</strong> <span className="text-text-muted">· {c.reason}</span>
                <span className="block text-[11px] text-text-muted">{c.status === 'paid' ? `Paid${how(c.method) ? ` by ${how(c.method)}` : ''}${c.paidAt ? ` · ${fmtDateTime(c.paidAt)}` : ''}${c.recordedBy ? ` · ${c.recordedBy}` : ''}${c.method === 'paystack' && c.settledTo === 'ntemtem' ? ' · Ntemtem pays this out to you' : ''}` : 'Waiting for the receiver'}</span></span>
              {c.status === 'paid' ? <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal"><Check size={11} aria-hidden="true" /> Paid</span>
                : d.canEdit && <span className="flex gap-1">
                  <button onClick={() => settle(c.id, 'cash')} disabled={!!busy} className="btn-ghost !min-h-8 !px-2 text-[11px]" title="Received in cash"><Banknote size={12} aria-hidden="true" /> Cash</button>
                  <button onClick={() => settle(c.id, 'momo_direct')} disabled={!!busy} className="btn-ghost !min-h-8 !px-2 text-[11px]" title="Received by MoMo to your own number"><Smartphone size={12} aria-hidden="true" /> MoMo</button>
                  <button onClick={() => settle(c.id, 'cancel')} disabled={!!busy} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-danger" aria-label="Cancel charge"><X size={13} /></button>
                </span>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={add} className="mt-3 grid gap-2 border-t border-border pt-3" data-testid="charge-form">
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <label className="grid gap-1 text-xs"><span className="text-text-muted">Amount ({d.currency})</span><input required inputMode="decimal" className="input-dark !min-h-9 text-sm tabular-nums" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} data-testid="charge-amount" /></label>
            <label className="grid gap-1 text-xs"><span className="text-text-muted">For</span><input required list="charge-reasons" className="input-dark !min-h-9 text-sm" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /><datalist id="charge-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist></label>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" className="accent-gold" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Text the receiver the payment link</label>
          <div className="flex gap-2"><button type="button" onClick={() => setAdding(false)} className="btn-ghost !min-h-9 text-xs">Cancel</button><button disabled={busy === 'add' || !Number(f.amount)} className="btn-gold !min-h-9 text-xs disabled:opacity-60" data-testid="charge-save">Add charge</button></div>
          <p className="text-[11px] text-text-muted">{d.online ? `The receiver pays by ${d.methods || 'mobile money'} from their link.` : 'Online payment isn’t switched on for this country yet — collect in person and mark it paid.'}</p>
        </form>
      )}
    </div>
  )
}
