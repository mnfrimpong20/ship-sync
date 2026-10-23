import { useEffect, useState } from 'react'
import { Check, Smartphone } from 'lucide-react'
import { api } from '../lib/store'
import type { ReceiverCharge } from '../lib/recipient'

type Row = ReceiverCharge & { ref: string; shipper: string }
interface ShipperLite { id: string; name: string; paystackSubaccount: string }

/** Admin: receiver mobile-money payments (Paystack) and where each shipper's money settles. */
export function AdminReceiverPayments() {
  const [d, setD] = useState<{ configured: boolean; payments: Row[] } | null>(null)
  const [shippers, setShippers] = useState<ShipperLite[]>([])
  const [pick, setPick] = useState(''); const [code, setCode] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const load = () => { api<{ configured: boolean; payments: Row[] }>('/admin/receiver-payments').then(setD).catch(() => {}); api<{ shippers: ShipperLite[] }>('/admin/shippers').then((r) => setShippers(r.shippers)).catch(() => {}) }
  useEffect(load, [])
  useEffect(() => { setCode(shippers.find((s) => s.id === pick)?.paystackSubaccount ?? '') }, [pick, shippers])
  if (!d) return null
  const owed = d.payments.filter((p) => p.settledTo === 'ntemtem' && !p.payoutDone)
  const saveSub = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); setMsg(''); try { await api(`/admin/shippers/${pick}/paystack`, { method: 'PUT', json: { subaccount: code.trim() } }); setMsg('Saved.'); load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not save.') } }
  const paidOut = async (id: string) => { await api(`/admin/receiver-payments/${id}/paid-out`, { json: {} }); load() }
  return (
    <section className="mt-14" data-testid="admin-receiver-payments">
      <p className="eyebrow">Destination</p>
      <h2 className="mt-2">Receiver mobile money</h2>
      <p className="mt-2 max-w-2xl text-text-muted">Duty, delivery and storage that receivers pay on their link (MTN MoMo, Telecel Cash, AirtelTigo, M-Pesa, Orange Money through Paystack). {d.configured ? 'Paystack is connected.' : 'Paystack isn’t connected yet — add PAYSTACK_SECRET_KEY in the server secrets and point the Paystack webhook at /api/paystack/webhook. Until then receivers pay at collection.'}</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card-dark p-5">
          <h3 className="!text-base">Payments{owed.length ? ` · ${owed.length} to pay out` : ''}</h3>
          {d.payments.length === 0 ? <p className="mt-2 text-sm text-text-muted">No receiver payments yet.</p> : (
            <ul className="mt-3 divide-y divide-border/70 text-sm">{d.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0"><b className="tabular-nums">{p.label}</b> · {p.ref} · {p.shipper}<span className="block text-xs text-text-muted">{p.reason}{p.paidPhone ? ` · ${p.paidPhone}` : ''} · {p.settledTo === 'shipper' ? 'settled to the shipper’s subaccount' : p.payoutDone ? 'paid out to the shipper' : 'settled to Ntemtem — owed to the shipper'}</span></span>
                {p.settledTo === 'ntemtem' && !p.payoutDone && <button onClick={() => paidOut(p.id)} className="btn-ghost !min-h-8 !px-3 text-xs"><Check size={13} aria-hidden="true" /> Mark paid out</button>}
              </li>))}</ul>
          )}
        </div>
        <form onSubmit={saveSub} className="card-dark p-5">
          <h3 className="inline-flex items-center gap-2 !text-base"><Smartphone size={16} className="text-gold-deep" aria-hidden="true" /> Settle straight to a shipper</h3>
          <p className="mt-1 text-xs text-text-muted">Create a subaccount for the shipper in Paystack (their MoMo wallet or bank) and paste its code. Their receiver payments then settle to them directly, minus Ntemtem’s fee.</p>
          <select required aria-label="Shipper" className="input-dark mt-3 !min-h-10 w-full text-sm" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose a shipper…</option>{shippers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.paystackSubaccount ? ' ✓' : ''}</option>)}</select>
          <input className="input-dark mt-2 !min-h-10 w-full font-mono text-sm" placeholder="ACCT_xxxxxxxx" value={code} onChange={(e) => setCode(e.target.value)} disabled={!pick} />
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}{msg && <p role="status" className="mt-2 text-xs text-teal">{msg}</p>}
          <button disabled={!pick} className="btn-gold mt-3 !min-h-10 text-sm disabled:opacity-60">Save</button>
        </form>
      </div>
    </section>
  )
}
