import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, Check, CircleDashed, Pencil, RotateCcw, Trash2, UserPlus, Zap } from 'lucide-react'
import { countries, statusLabels, statusOrder, type Shipment } from '../lib/data'
import { useStore } from '../lib/store'
import { clientsApi, type Consignee, type ConsigneeInput } from '../lib/clients'
import { shipmentOpsApi, type Automation, type ShipperPrefs } from '../lib/shipmentOps'

const blank = (country: string): ConsigneeInput => ({ name: '', phone: '', address: '', city: '', country, relationship: '', isDefault: false })
const msg = (e: unknown, f = 'Something went wrong.') => (e instanceof Error ? e.message : f)

/** Recipient editor: pick one of the client's saved recipients or type a new one. Office staff only. */
export function RecipientEditor({ s, consignees: given, onSaved }: { s: Shipment; consignees?: Consignee[]; onSaved: (name: string) => void }) {
  const [list, setList] = useState<Consignee[] | null>(given ?? null)
  const current = list?.find((k) => k.id === s.consigneeId)
  const [pick, setPick] = useState<string>(s.consigneeId ?? '')
  const [f, setF] = useState<ConsigneeInput>(current ? { ...current } : blank(s.destination))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (!given && s.clientId) clientsApi.get(s.clientId).then((d) => setList(d.consignees)).catch(() => setList([])) }, [given, s.clientId])
  useEffect(() => { const c = list?.find((k) => k.id === s.consigneeId); if (c) setF({ ...c }) }, [list, s.consigneeId])
  const usingSaved = pick && pick !== s.consigneeId && pick !== 'new'
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const c = usingSaved ? await shipmentOpsApi.setConsignee(s.id, { consigneeId: pick }) : await shipmentOpsApi.setConsignee(s.id, f)
      onSaved(c.name)
    } catch (er) { setErr(msg(er, 'Could not save the recipient.')) } finally { setBusy(false) }
  }
  const others = (list ?? []).filter((k) => k.id !== s.consigneeId)
  return (
    <form onSubmit={save} className="grid gap-2.5" data-testid="recipient-editor" aria-label="Recipient details">
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {others.length > 0 && (
        <label className="grid gap-1 text-xs"><span className="text-text-muted">Use a saved recipient</span>
          <select className="input-dark !min-h-9 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="recipient-pick">
            <option value={s.consigneeId ?? ''}>{s.consigneeId ? 'Keep / edit current recipient' : '— type a new recipient below —'}</option>
            {others.map((k) => <option key={k.id} value={k.id}>{k.name}{k.city ? ` · ${k.city}` : ''}</option>)}
          </select>
        </label>
      )}
      {!usingSaved && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Full name</span><input className="input-dark !min-h-9 text-sm" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="rcp-name" /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Phone (for arrival texts)</span><input className="input-dark !min-h-9 text-sm" placeholder="+233 24 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="rcp-phone" /></label>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Delivery address</span><input className="input-dark !min-h-9 text-sm" placeholder="House no., street, landmark" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">City</span><input className="input-dark !min-h-9 text-sm" placeholder="Kumasi" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} data-testid="rcp-city" /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Country</span><select className="input-dark !min-h-9 text-sm" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{countries.map((k) => <option key={k.code} value={k.code}>{k.flag} {k.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Relationship to the sender (optional)</span><input className="input-dark !min-h-9 text-sm" placeholder="Brother, business partner…" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} /></label>
        </div>
      )}
      <p className="text-[11px] text-text-muted">Saved to the client’s recipients too, so it’s one tap next time. The customer is told who you added.</p>
      <div className="flex justify-end"><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60" data-testid="rcp-save"><Check size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save recipient'}</button></div>
    </form>
  )
}

/** Everything the office may need to fix on a shipment: who receives it, what moves it on its own, and corrections. */
export function ShipmentManage({ s, consignees, onChanged, onDeleted }: { s: Shipment; consignees?: Consignee[]; onChanged: (toast: string) => void | Promise<void>; onDeleted: (toast: string) => void | Promise<void> }) {
  const { user } = useStore()
  const manager = user?.role === 'shipper' && ['owner', 'dispatcher', undefined].includes(user.staffRole)
  const [auto, setAuto] = useState<Automation | null>(null)
  const [editRcp, setEditRcp] = useState(false)
  const [mode, setMode] = useState<'' | 'revert' | 'delete'>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const load = () => shipmentOpsApi.automation(s.id).then(setAuto).catch(() => {})
  useEffect(() => { void load() }, [s.id, s.status, s.consigneeId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fetched, setFetched] = useState<Consignee[] | null>(null)
  useEffect(() => { if (!consignees && s.clientId && s.consigneeId) clientsApi.get(s.clientId).then((d) => setFetched(d.consignees)).catch(() => {}) }, [consignees, s.clientId, s.consigneeId])
  const known = consignees ?? fetched ?? undefined
  const rcp = known?.find((k) => k.id === s.consigneeId)
  const hasRcp = !!s.consigneeId
  const idx = statusOrder.indexOf(s.status)
  const prev = idx > 0 ? statusOrder[idx - 1] : null
  const go = async () => {
    setBusy(true); setErr('')
    try {
      if (mode === 'revert') { await shipmentOpsApi.revert(s.id, reason); setMode(''); setReason(''); await onChanged(`${s.ref} moved back to “${statusLabels[prev!]}”.`) }
      else if (mode === 'delete') { const r = await shipmentOpsApi.remove(s.id, reason); await onDeleted(`${s.ref} deleted${r.reopenedRequest ? ' — the customer’s request is open for quotes again' : ''}.`) }
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="shipment-manage">
      {/* recipient */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Recipient</p>
          {hasRcp
            ? <p className="mt-1 text-sm" data-testid="rcp-current"><strong>{rcp?.name ?? 'Recipient on file'}</strong>{rcp?.city ? ` · ${rcp.city}` : ''}{rcp && !rcp.phone && <span className="text-danger"> · no phone</span>}</p>
            : <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-danger" data-testid="rcp-missing"><AlertTriangle size={14} aria-hidden="true" /> No recipient yet — the customer didn’t add one.</p>}
        </div>
        {user?.staffRole !== 'driver' && <button onClick={() => setEditRcp((v) => !v)} className="btn-ghost !min-h-8 shrink-0 !px-2.5 text-xs" aria-expanded={editRcp} data-testid="rcp-toggle">{hasRcp ? <><Pencil size={12} aria-hidden="true" /> Edit</> : <><UserPlus size={12} aria-hidden="true" /> Add recipient</>}</button>}
      </div>
      {editRcp && <div className="mt-3 border-t border-border pt-3"><RecipientEditor s={s} consignees={known} onSaved={async (n) => { setEditRcp(false); await onChanged(`Recipient set to ${n}.`) }} /></div>}

      {/* automation */}
      <div className="mt-4 border-t border-border pt-3" data-testid="automation">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><Bot size={14} className="text-gold" aria-hidden="true" /> Moves on its own</p>
        {s.status === 'delivered' ? <p className="mt-1 text-sm text-teal">Delivered — nothing left to move.</p>
          : auto?.next ? <p className="mt-1 text-sm"><Zap size={13} className="mr-1 inline text-gold" aria-hidden="true" />Goes to <strong>{statusLabels[auto.next.to]}</strong> when {auto.next.how}.</p>
          : <p className="mt-1 text-sm text-text-muted">Loading…</p>}
        {auto && (auto.wired.pickupRun || auto.wired.container || auto.wired.deliveryRun || auto.wired.pieces > 0 || auto.wired.vessel) && (
          <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {auto.wired.pieces > 0 && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">{auto.wired.pieces} label{auto.wired.pieces === 1 ? '' : 's'} — scans update it</li>}
            {auto.wired.pickupRun && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Pickup run {auto.wired.pickupRun.date}</li>}
            {auto.wired.container && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Container {auto.wired.container.ref}{auto.wired.container.carrierTracking ? ' · carrier-tracked' : ''}</li>}
            {auto.wired.vessel && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Live position: {auto.wired.vessel}</li>}
            {auto.wired.deliveryRun && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Delivery run {auto.wired.deliveryRun.date}</li>}
          </ul>
        )}
        {auto && auto.missing.length > 0 && s.status !== 'delivered' && (
          <ul className="mt-2 space-y-1 text-xs text-text-muted" aria-label="To automate the next steps">
            {auto.missing.map((m) => <li key={m} className="flex gap-1.5"><CircleDashed size={12} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />{m}</li>)}
          </ul>
        )}
      </div>

      {/* corrections */}
      {manager && (prev || s.status === 'booked') && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Corrections</p>
          {err && <p role="alert" className="mt-1 text-xs text-danger" data-testid="manage-error">{err}</p>}
          {!mode && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prev && <button onClick={() => setMode('revert')} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="revert-open"><RotateCcw size={12} aria-hidden="true" /> Move back to “{statusLabels[prev]}”</button>}
              {s.status === 'booked' && <button onClick={() => setMode('delete')} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger" data-testid="delete-open"><Trash2 size={12} aria-hidden="true" /> Delete booking</button>}
            </div>
          )}
          {mode && (
            <form onSubmit={(e) => { e.preventDefault(); void go() }} className="mt-2 grid gap-2">
              <label className="grid gap-1 text-xs"><span className="text-text-muted">{mode === 'revert' ? 'Why? (shown on the timeline and to the customer)' : 'Reason (sent to the customer, optional)'}</span>
                <input autoFocus className="input-dark !min-h-9 text-sm" required={mode === 'revert'} minLength={mode === 'revert' ? 3 : 0} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'revert' ? 'Marked by mistake' : 'Duplicate booking'} data-testid="manage-reason" /></label>
              {mode === 'delete' && <p className="text-[11px] text-text-muted">Only possible while nothing depends on it — no payment, sent invoice, scans or container. A marketplace booking reopens the customer’s request.</p>}
              <div className="flex justify-end gap-1.5"><button type="button" onClick={() => { setMode(''); setReason(''); setErr('') }} className="btn-ghost !min-h-8 !px-2.5 text-xs">Cancel</button><button disabled={busy} className={`!min-h-8 !px-3 text-xs disabled:opacity-60 ${mode === 'delete' ? 'btn-ghost !border-danger text-danger' : 'btn-gold'}`} data-testid="manage-confirm">{busy ? 'Working…' : mode === 'revert' ? 'Move back' : 'Delete for good'}</button></div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

/** Shipper-wide automation switches. */
export function AutomationPrefs({ onClose }: { onClose?: () => void }) {
  const [p, setP] = useState<ShipperPrefs | null>(null)
  const [saved, setSaved] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { shipmentOpsApi.prefs().then(setP).catch((e) => setErr(msg(e))) }, [])
  const save = async (patch: Partial<ShipperPrefs>) => { setErr(''); try { setP(await shipmentOpsApi.savePrefs(patch)); setSaved(true); setTimeout(() => setSaved(false), 1800) } catch (e) { setErr(msg(e)) } }
  if (!p) return <div className="card-dark p-5 text-sm text-text-muted">{err || 'Loading…'}</div>
  const Toggle = ({ k, label, hint }: { k: 'autoInvoice' | 'autoLabels' | 'autoTrackingLink'; label: string; hint: string }) => (
    <label className="flex items-start gap-3 py-2"><input type="checkbox" className="mt-1 accent-gold" checked={p[k]} onChange={(e) => save({ [k]: e.target.checked })} data-testid={`pref-${k}`} /><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-text-muted">{hint}</span></span></label>
  )
  return (
    <div className="card-dark p-5" data-testid="automation-prefs">
      <div className="flex items-start justify-between gap-3"><div><h2 className="!text-base">Automation</h2><p className="text-xs text-text-muted">What happens without anyone clicking.</p></div>{saved && <span className="text-xs text-teal" role="status">Saved</span>}{onClose && <button onClick={onClose} className="text-xs text-text-muted hover:text-text">Close</button>}</div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      <div className="mt-2 divide-y divide-border">
        <Toggle k="autoInvoice" label="Invoice the customer when they accept a quote" hint="The invoice uses the quoted price and what it includes, and appears in the client’s Invoices tab." />
        <label className="flex items-center justify-between gap-3 py-2 text-sm"><span>Invoices are due after</span><span className="flex items-center gap-2"><input type="number" min={0} max={120} className="input-dark !min-h-9 !w-20 text-sm" value={p.invoiceDueDays} onChange={(e) => setP({ ...p, invoiceDueDays: Number(e.target.value) })} onBlur={() => save({ invoiceDueDays: p.invoiceDueDays })} data-testid="pref-due" /> days</span></label>
        <Toggle k="autoLabels" label="Create piece labels on new bookings" hint="One scannable label per piece — scanning them moves the status on its own." />
        <Toggle k="autoTrackingLink" label="Send the customer their tracking link on new bookings" hint="They get the reference and ETA by email and in their dashboard." />
      </div>
    </div>
  )
}
