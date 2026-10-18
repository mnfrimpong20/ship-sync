import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, UserRound } from 'lucide-react'
import { countries } from '../lib/data'
import { shipmentOpsApi, type RecipientForm } from '../lib/shipmentOps'
import { Logo } from '../components/ui'

/** `/add-recipient/:token` — the sender tells us who collects the shipment. Phone first, no login. */
export default function AddRecipient() {
  const { token = '' } = useParams()
  const [d, setD] = useState<RecipientForm | null>(null)
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ name: '', phone: '', address: '', city: '', country: 'GH', relationship: '' })
  useEffect(() => { shipmentOpsApi.recipientForm(token).then((r) => { setD(r); setF((x) => ({ ...x, country: r.destination })) }).catch((e) => setErr(e instanceof Error ? e.message : 'Not found.')) }, [token])
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await shipmentOpsApi.submitRecipient(token, f); setDone(true) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="container-x max-w-lg py-8">
        <Logo />
        {!d && !err && <p className="mt-10 text-text-muted">Loading…</p>}
        {err && !d && <p className="mt-10 text-danger">{err}</p>}
        {d && (done || d.done) ? (
          <div className="card-dark mt-8 p-6 text-center" data-testid="recipient-done"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal/15 text-teal"><Check size={22} aria-hidden="true" /></span><h1 className="mt-3 !text-xl">Thank you</h1><p className="mt-2 text-sm text-text-muted">{done ? `${f.name} will get a text when ${d.ref} arrives, with what they need to collect it.` : `${d.recipient?.name ?? 'The recipient'} is already on file for ${d.ref}.`}</p></div>
        ) : d && (
          <form onSubmit={submit} className="card-dark mt-8 grid gap-3 p-6" data-testid="recipient-form">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep"><UserRound size={18} aria-hidden="true" /></span><div><h1 className="!text-xl">Who receives {d.ref}?</h1><p className="mt-1 text-sm text-text-muted">{d.shipper} is shipping {d.description || 'your goods'} from {d.origin} to {d.destinationName}. Tell us who collects it — we text them when it arrives.</p></div></div>
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <label className="grid gap-1 text-sm"><span className="text-text-muted">Full name</span><input required minLength={2} className="input-dark" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" data-testid="ar-name" /></label>
            <label className="grid gap-1 text-sm"><span className="text-text-muted">Phone number (WhatsApp if possible)</span><input required inputMode="tel" className="input-dark" placeholder="+233 24 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="ar-phone" /></label>
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm"><span className="text-text-muted">Town / city</span><input className="input-dark" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} data-testid="ar-city" /></label><label className="grid gap-1 text-sm"><span className="text-text-muted">Country</span><select className="input-dark" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label></div>
            <label className="grid gap-1 text-sm"><span className="text-text-muted">Address or landmark (for delivery)</span><input className="input-dark" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
            <label className="grid gap-1 text-sm"><span className="text-text-muted">Relationship to you (optional)</span><input className="input-dark" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="Mother, brother, business partner…" /></label>
            <button disabled={busy} className="btn-gold mt-1" data-testid="ar-submit">{busy ? 'Saving…' : 'Save recipient'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
