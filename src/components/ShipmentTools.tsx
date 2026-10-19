import { AddressLookup } from './AddressLookup'
import { isDriverRole } from '../lib/roles'
import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Bot, Check, ChevronRight, CircleDashed, KeyRound, PackageCheck, Pencil, Plus, RotateCcw, Store, Trash2, Truck, UserPlus, Wallet, Zap } from 'lucide-react'
import { countries, nextStatus, prevStatus, statusLabels, type Handover, type Shipment } from '../lib/data'
import { useStore } from '../lib/store'
import { clientsApi, type Consignee, type ConsigneeInput } from '../lib/clients'
import { shipmentOpsApi, type Automation, type ReleaseInfo, type ShipperPrefs } from '../lib/shipmentOps'

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
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Country</span><select className="input-dark !min-h-9 text-sm" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{countries.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}</select></label>
          <div className="sm:col-span-2"><AddressLookup compact country={f.country} value={{ address: f.address, city: f.city, gps: f.gps ?? '', lat: f.lat ?? null, lng: f.lng ?? null }} onChange={(p) => setF((x) => ({ ...x, ...p }))} labels={{ address: 'Delivery address' }} /></div>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Relationship to the sender (optional)</span><input className="input-dark !min-h-9 text-sm" placeholder="Brother, business partner…" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} /></label>
        </div>
      )}
      <p className="text-xs text-text-muted">Saved to the client’s recipients too, so it’s one tap next time. The customer is told who you added.</p>
      <div className="flex justify-end"><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60" data-testid="rcp-save"><Check size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save recipient'}</button></div>
    </form>
  )
}

/** Shown instead of a "Next step" button when something other than a click will move the status. */
export function AutoTag({ s, onOverride }: { s: Shipment; onOverride?: () => void }) {
  if (!s.autoBy) return null
  const why = s.autoBy.kind === 'container' ? `Status follows container ${s.autoBy.label.replace('follows ', '')} through Customs` : s.autoBy.kind === 'run' ? `Moves when the driver works the ${s.autoBy.label}` : 'Moves to Picked up when a piece label is scanned'
  return (
    <button type="button" onClick={onOverride} title={`${why}. Open Manage to override by hand.`} className="inline-flex max-w-[210px] items-center gap-1 whitespace-nowrap rounded-full border border-teal/40 bg-teal/10 px-2.5 py-1 text-xs font-medium text-teal focus-ring" data-testid="auto-tag">
      <Bot size={12} className="shrink-0" aria-hidden="true" /> <span className="truncate">Auto · {s.autoBy.label}</span>
    </button>
  )
}

/** Everything the office may need to fix on a shipment: who receives it, how it's handed over, money owed, what moves it on its own, and corrections. */
export function ShipmentManage({ s, consignees, onChanged, onDeleted }: { s: Shipment; consignees?: Consignee[]; onChanged: (toast: string) => void | Promise<void>; onDeleted: (toast: string) => void | Promise<void> }) {
  const { user } = useStore()
  const office = user?.role === 'shipper' && !isDriverRole(user.staffRole)
  const manager = user?.role === 'shipper' && ['owner', 'dispatcher', undefined].includes(user.staffRole)
  const moneyRole = manager || user?.staffRole === 'finance'
  const [auto, setAuto] = useState<Automation | null>(null)
  const [rel, setRel] = useState<ReleaseInfo | null>(null)
  const [editRcp, setEditRcp] = useState(false)
  const [mode, setMode] = useState<'' | 'forward' | 'revert' | 'delete' | 'cancel' | 'checkin' | 'charge' | 'collect'>('')
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState(true)
  const [ci, setCi] = useState({ pieces: '', weight: '', note: '', adjDesc: '', adjAmt: '' })
  const [ch, setCh] = useState({ desc: '', amt: '' })
  const [col, setCol] = useState({ code: '', name: '', skipCode: false })
  const [needOverride, setNeedOverride] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('')
  const load = () => { shipmentOpsApi.automation(s.id).then(setAuto).catch(() => {}); shipmentOpsApi.release(s.id).then(setRel).catch(() => {}) }
  useEffect(() => { load() }, [s.id, s.status, s.consigneeId, s.handover]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fetched, setFetched] = useState<Consignee[] | null>(null)
  useEffect(() => { if (!consignees && s.clientId && s.consigneeId) clientsApi.get(s.clientId).then((d) => setFetched(d.consignees)).catch(() => {}) }, [consignees, s.clientId, s.consigneeId])
  const known = consignees ?? fetched ?? undefined
  const rcp = known?.find((k) => k.id === s.consigneeId)
  const hasRcp = !!s.consigneeId
  const prev = prevStatus(s.status, s.handover)
  const nextSt = s.status === 'ready_for_collection' ? null : nextStatus(s.status, s.handover)
  const closeForm = () => { setMode(''); setReason(''); setErr(''); setNeedOverride(false) }
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr('')
    try { const t = await fn(); closeForm(); await onChanged(t) }
    catch (e) { const m = msg(e); setErr(m); if (/unpaid/.test(m) && moneyRole) setNeedOverride(true) } finally { setBusy(false) }
  }
  const override = needOverride && reason.trim().length >= 3 ? { reason: reason.trim() } : null
  const go = async () => {
    if (mode === 'forward') return run(async () => { await shipmentOpsApi.advance(s.id, { note: reason.trim() && !override ? `Updated by hand: ${reason.trim()}` : undefined, override }); return `${s.ref} moved to “${statusLabels[nextSt!]}”.` })
    if (mode === 'revert') return run(async () => { await shipmentOpsApi.revert(s.id, reason); return `${s.ref} moved back to “${statusLabels[prev!]}”.` })
    if (mode === 'delete') { setBusy(true); setErr(''); try { const r = await shipmentOpsApi.remove(s.id, reason); await onDeleted(`${s.ref} deleted${r.reopenedRequest ? ' — the customer’s request is open for quotes again' : ''}.`) } catch (e) { setErr(msg(e)) } finally { setBusy(false) } return }
    if (mode === 'cancel') { setBusy(true); setErr(''); try { const r = await shipmentOpsApi.cancel(s.id, { reason, refund }); await onDeleted(`${s.ref} cancelled${r.voided ? ` · ${r.voided} invoice${r.voided === 1 ? '' : 's'} voided` : ''}${r.refunded ? ` · $${r.refunded} refunded` : ''}${r.paidInvoices.length ? ` · settle ${r.paidInvoices.join(', ')} with the client` : ''}.`) } catch (e) { setErr(msg(e)) } finally { setBusy(false) } return }
    if (mode === 'checkin') return run(async () => { const r = await shipmentOpsApi.checkin(s.id, { pieces: Number(ci.pieces), weightKg: ci.weight ? Number(ci.weight) : undefined, note: ci.note, adjustment: ci.adjDesc && Number(ci.adjAmt) ? { description: ci.adjDesc, amountUsd: Number(ci.adjAmt) } : undefined }); return `${s.ref} checked in — ${r.pieces} piece${r.pieces === 1 ? '' : 's'}${r.invoice ? `, ${r.invoice} adjusted` : ''}.` })
    if (mode === 'charge') return run(async () => { const r = await shipmentOpsApi.charge(s.id, { description: ch.desc, amountUsd: Number(ch.amt) }); setCh({ desc: '', amt: '' }); return `Added to ${r.invoice}.` })
    if (mode === 'collect') return run(async () => { await shipmentOpsApi.collect(s.id, { code: col.skipCode ? undefined : col.code, receivedBy: col.name, override: col.skipCode || override ? { reason: reason.trim() || 'ID checked at the desk' } : null }); return `${s.ref} handed over to ${col.name}.` })
  }
  const setHandover = (h: Handover) => run(async () => { await shipmentOpsApi.handover(s.id, h); return h === 'collection' ? 'Recipient will collect from the warehouse.' : 'Switched to door delivery.' })
  const resend = async () => { setBusy(true); setErr(''); try { const r = await shipmentOpsApi.resendCode(s.id); setInfo(r.to ? `Code re-sent to ${r.to}.` : 'No phone for the recipient — read the code from the client’s notification.') } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }
  const fieldCls = 'input-dark !min-h-9 text-sm'
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="shipment-manage">
      {s.stuck && <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger" data-testid="stuck-note"><AlertTriangle size={13} aria-hidden="true" /> {s.stuck.days} days in {statusLabels[s.status]} — usually about {s.stuck.typical}.</p>}
      {/* recipient */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Recipient</p>
          {hasRcp
            ? <p className="mt-1 text-sm" data-testid="rcp-current"><strong>{rcp?.name ?? 'Recipient on file'}</strong>{rcp?.city ? ` · ${rcp.city}` : ''}{rcp && !rcp.phone && <span className="text-danger"> · no phone</span>}</p>
            : <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-danger" data-testid="rcp-missing"><AlertTriangle size={14} aria-hidden="true" /> No recipient yet — we’ve asked the client.</p>}
        </div>
        {office && <button onClick={() => setEditRcp((v) => !v)} className="btn-ghost !min-h-8 shrink-0 !px-2.5 text-xs" aria-expanded={editRcp} data-testid="rcp-toggle">{hasRcp ? <><Pencil size={12} aria-hidden="true" /> Edit</> : <><UserPlus size={12} aria-hidden="true" /> Add recipient</>}</button>}
      </div>
      {editRcp && <div className="mt-3 border-t border-border pt-3"><RecipientEditor s={s} consignees={known} onSaved={async (n) => { setEditRcp(false); await onChanged(`Recipient set to ${n}.`) }} /></div>}

      {/* handover at destination */}
      {office && s.status !== 'delivered' && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">At destination</p>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Handover">
            {(['collection', 'delivery'] as Handover[]).map((h) => <button key={h} type="button" role="radio" aria-checked={s.handover === h} disabled={busy || s.status === 'out_for_delivery'} onClick={() => s.handover !== h && setHandover(h)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs focus-ring disabled:opacity-60 ${s.handover === h ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border text-text-muted'}`} data-testid={`handover-${h}`}>{h === 'collection' ? <><Store size={12} className="mr-1 inline" aria-hidden="true" />Recipient collects</> : <><Truck size={12} className="mr-1 inline" aria-hidden="true" />Door delivery</>}</button>)}
          </div>
        </div>
      )}

      {/* money */}
      {rel && (rel.totalUsd > 0 || rel.storage) && s.status !== 'delivered' && (
        <div className="mt-4 border-t border-border pt-3" data-testid="owed">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Before release</p>
          {rel.totalUsd > 0 ? <p className={`mt-1 text-sm ${rel.rule === 'block' ? 'text-danger' : ''}`}><Wallet size={13} className="mr-1 inline" aria-hidden="true" /><strong>${rel.totalUsd.toLocaleString()}</strong> unpaid{rel.storageUsd ? ` (incl. $${rel.storageUsd} storage)` : ''} — {rel.rule === 'block' ? 'handover is blocked until it’s paid' : rel.rule === 'warn' ? 'the driver/desk is told to collect it' : 'not enforced'}.</p> : <p className="mt-1 text-sm text-teal">Paid up.</p>}
          {rel.storage && rel.storage.freeUntil && <p className="mt-0.5 text-xs text-text-muted">Free storage until {rel.storage.freeUntil}{rel.storage.amountUsd ? ` · $${rel.storage.amountUsd} accrued so far` : ''}.</p>}
        </div>
      )}

      {/* hand over (collection) */}
      {office && s.status === 'ready_for_collection' && (
        <div className="mt-4 border-t border-border pt-3" data-testid="collect-box">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Hand over at the desk</p><button onClick={resend} disabled={busy} className="text-xs text-gold-deep hover:underline" data-testid="resend-code">Resend code</button></div>
          {info && <p role="status" className="mt-1 text-xs text-teal">{info}</p>}
          {mode !== 'collect' ? <button onClick={() => setMode('collect')} className="btn-gold mt-2 !min-h-9 w-full text-xs" data-testid="collect-open"><KeyRound size={13} aria-hidden="true" /> Recipient is here — check the code</button> : (
            <form onSubmit={(e) => { e.preventDefault(); void go() }} className="mt-2 grid gap-2">
              {err && <p role="alert" className="text-xs text-danger" data-testid="manage-error">{err}</p>}
              {!col.skipCode && <label className="grid gap-1 text-xs"><span className="text-text-muted">6-digit collection code</span><input autoFocus inputMode="numeric" maxLength={6} className={`${fieldCls} font-mono tracking-[0.3em]`} value={col.code} onChange={(e) => setCol({ ...col, code: e.target.value.replace(/\D/g, '') })} required data-testid="collect-code" /></label>}
              <label className="grid gap-1 text-xs"><span className="text-text-muted">Collected by (name on their ID)</span><input className={fieldCls} required minLength={2} value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} data-testid="collect-name" /></label>
              {manager && <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" className="accent-gold" checked={col.skipCode} onChange={(e) => setCol({ ...col, skipCode: e.target.checked })} /> No code — I checked their ID (owner/dispatcher)</label>}
              {(col.skipCode || needOverride) && <input className={fieldCls} required minLength={3} placeholder={needOverride ? 'Why release with money owed? e.g. paid cash, receipt 123' : 'Why no code? e.g. phone lost, ID matches'} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="manage-reason" />}
              <div className="flex justify-end gap-1.5"><button type="button" onClick={closeForm} className="btn-ghost !min-h-8 !px-2.5 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="collect-confirm">{busy ? 'Checking…' : needOverride ? 'Release anyway' : 'Hand over'}</button></div>
            </form>
          )}
        </div>
      )}

      {/* automation */}
      <div className="mt-4 border-t border-border pt-3" data-testid="automation">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted"><Bot size={14} className="text-gold-deep" aria-hidden="true" /> Moves on its own</p>
        {s.status === 'delivered' ? <p className="mt-1 text-sm text-teal">Delivered — nothing left to move.</p>
          : auto?.next ? <p className="mt-1 text-sm"><Zap size={13} className="mr-1 inline text-gold-deep" aria-hidden="true" />Goes to <strong>{statusLabels[auto.next.to]}</strong> when {auto.next.how}.</p>
          : <p className="mt-1 text-sm text-text-muted">Loading…</p>}
        {auto && (auto.wired.pickupRun || auto.wired.container || auto.wired.deliveryRun || auto.wired.pieces > 0 || auto.wired.vessel) && (
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {auto.wired.pieces > 0 && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">{auto.wired.pieces} label{auto.wired.pieces === 1 ? '' : 's'} — scans update it</li>}
            {auto.wired.pickupRun && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Pickup run {auto.wired.pickupRun.date}</li>}
            {auto.wired.container && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Container {auto.wired.container.ref}{auto.wired.container.carrierTracking ? ' · carrier-tracked' : ''}</li>}
            {auto.wired.vessel && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Live position: {auto.wired.vessel}</li>}
            {auto.wired.deliveryRun && <li className="rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-teal">Delivery run {auto.wired.deliveryRun.date}</li>}
          </ul>
        )}
        {auto && auto.missing.length > 0 && s.status !== 'delivered' && (
          <ul className="mt-2 space-y-1 text-xs text-text-muted" aria-label="To automate the next steps">
            {auto.missing.map((m) => <li key={m} className="flex gap-1.5"><CircleDashed size={12} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />{m}</li>)}
          </ul>
        )}
      </div>

      {/* actions */}
      {office && !s.cancelledAt && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Actions &amp; manual override</p>
          {err && mode !== 'collect' && <p role="alert" className="mt-1 text-xs text-danger" data-testid="manage-error">{err}</p>}
          {(!mode || mode === 'collect') && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.status === 'booked' && <button onClick={() => { setMode('checkin'); setCi({ ...ci, pieces: ci.pieces || '' }) }} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="checkin-open"><PackageCheck size={12} aria-hidden="true" /> Check in at warehouse</button>}
              {nextSt && <button onClick={() => setMode('forward')} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="forward-open">Move forward to “{statusLabels[nextSt]}” <ChevronRight size={12} aria-hidden="true" /></button>}
              {manager && prev && <button onClick={() => setMode('revert')} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="revert-open"><RotateCcw size={12} aria-hidden="true" /> Move back to “{statusLabels[prev]}”</button>}
              {moneyRole && s.status !== 'delivered' && <button onClick={() => setMode('charge')} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="charge-open"><Plus size={12} aria-hidden="true" /> Add a charge</button>}
              {manager && s.status === 'booked' && <button onClick={() => setMode('delete')} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger" data-testid="delete-open"><Trash2 size={12} aria-hidden="true" /> Delete booking</button>}
              {manager && s.status !== 'delivered' && s.status !== 'booked' && <button onClick={() => setMode('cancel')} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger" data-testid="cancel-open"><Ban size={12} aria-hidden="true" /> Cancel shipment</button>}
            </div>
          )}
          {mode === 'checkin' && (
            <form onSubmit={(e) => { e.preventDefault(); void go() }} className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="checkin-form">
              <label className="grid gap-1 text-xs"><span className="text-text-muted">Pieces received</span><input autoFocus type="number" min={1} max={500} required className={fieldCls} value={ci.pieces} onChange={(e) => setCi({ ...ci, pieces: e.target.value })} data-testid="ci-pieces" /></label>
              <label className="grid gap-1 text-xs"><span className="text-text-muted">Weighed, kg (optional)</span><input inputMode="decimal" className={fieldCls} value={ci.weight} onChange={(e) => setCi({ ...ci, weight: e.target.value.replace(/[^\d.]/g, '') })} data-testid="ci-weight" /></label>
              <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Note (optional)</span><input className={fieldCls} value={ci.note} onChange={(e) => setCi({ ...ci, note: e.target.value })} placeholder="One barrel lid cracked — taped" /></label>
              <label className="grid gap-1 text-xs"><span className="text-text-muted">Invoice adjustment (optional)</span><input className={fieldCls} value={ci.adjDesc} onChange={(e) => setCi({ ...ci, adjDesc: e.target.value })} placeholder="Extra box + 40 kg" data-testid="ci-adj-desc" /></label>
              <label className="grid gap-1 text-xs"><span className="text-text-muted">Amount, USD (− for a credit)</span><input inputMode="decimal" className={fieldCls} value={ci.adjAmt} onChange={(e) => setCi({ ...ci, adjAmt: e.target.value.replace(/[^\d.-]/g, '') })} data-testid="ci-adj-amt" /></label>
              <p className="text-xs text-text-muted sm:col-span-2">Moves it to Picked up, creates labels for any extra pieces, and adds the adjustment to the open invoice (or raises a new one if it’s paid).</p>
              <div className="flex justify-end gap-1.5 sm:col-span-2"><button type="button" onClick={closeForm} className="btn-ghost !min-h-8 !px-2.5 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="ci-save">{busy ? 'Saving…' : 'Check in'}</button></div>
            </form>
          )}
          {mode === 'charge' && (
            <form onSubmit={(e) => { e.preventDefault(); void go() }} className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
              <input autoFocus required minLength={2} className={fieldCls} placeholder="Repacking, extra handling…" value={ch.desc} onChange={(e) => setCh({ ...ch, desc: e.target.value })} aria-label="Charge description" data-testid="charge-desc" />
              <input required inputMode="decimal" className={fieldCls} placeholder="USD" value={ch.amt} onChange={(e) => setCh({ ...ch, amt: e.target.value.replace(/[^\d.-]/g, '') })} aria-label="Amount in USD" data-testid="charge-amt" />
              <div className="flex justify-end gap-1.5 sm:col-span-2"><button type="button" onClick={closeForm} className="btn-ghost !min-h-8 !px-2.5 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="charge-save">Add to invoice</button></div>
            </form>
          )}
          {(mode === 'forward' || mode === 'revert' || mode === 'delete' || mode === 'cancel') && (
            <form onSubmit={(e) => { e.preventDefault(); void go() }} className="mt-2 grid gap-2">
              <label className="grid gap-1 text-xs"><span className="text-text-muted">{needOverride ? 'Release with money owed — why? (owner, dispatcher or finance)' : mode === 'revert' ? 'Why? (shown on the timeline and to the customer)' : mode === 'forward' ? (s.autoBy ? `Why override? This normally moves on its own (${s.autoBy.label}).` : 'Note for the timeline (optional)') : mode === 'cancel' ? 'Why? (sent to the client)' : 'Reason (sent to the customer, optional)'}</span>
                <input autoFocus className="input-dark !min-h-9 text-sm" required={mode === 'revert' || mode === 'cancel' || needOverride || (mode === 'forward' && !!s.autoBy)} minLength={mode === 'revert' || mode === 'cancel' || needOverride || (mode === 'forward' && s.autoBy) ? 3 : 0} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'revert' ? 'Marked by mistake' : mode === 'forward' ? 'Carrier update is late — confirmed by phone' : mode === 'cancel' ? 'Client changed plans' : 'Duplicate booking'} data-testid="manage-reason" /></label>
              {mode === 'delete' && <p className="text-xs text-text-muted">Only possible while nothing depends on it — no payment, sent invoice, scans or container. A marketplace booking reopens the customer’s request.</p>}
              {mode === 'cancel' && <><label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" className="accent-gold" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> Refund online payments held for it</label><p className="text-xs text-text-muted">Unloads it from its container (if it hasn’t left the yard), removes run stops and pickups, voids unpaid invoices and tells the client. The record is kept.</p></>}
              <div className="flex justify-end gap-1.5"><button type="button" onClick={closeForm} className="btn-ghost !min-h-8 !px-2.5 text-xs">Back</button><button disabled={busy} className={`!min-h-8 !px-3 text-xs disabled:opacity-60 ${mode === 'delete' || mode === 'cancel' ? 'btn-ghost !border-danger text-danger' : 'btn-gold'}`} data-testid="manage-confirm">{busy ? 'Working…' : needOverride ? 'Release anyway' : mode === 'forward' ? `Move to ${statusLabels[nextSt!]}` : mode === 'revert' ? 'Move back' : mode === 'cancel' ? 'Cancel shipment' : 'Delete for good'}</button></div>
            </form>
          )}
        </div>
      )}
      {s.cancelledAt && <p className="mt-4 border-t border-border pt-3 text-sm text-danger">Cancelled{s.cancelReason ? ` — ${s.cancelReason}` : ''}.</p>}
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
  type Bool = 'autoInvoice' | 'autoLabels' | 'autoTrackingLink' | 'autoConfirmPickups' | 'recipientNudges' | 'autoDocuments' | 'stuckAlerts'
  const Toggle = ({ k, label, hint }: { k: Bool; label: string; hint: string }) => (
    <label className="flex items-start gap-3 py-2"><input type="checkbox" className="mt-1 accent-gold" checked={p[k]} onChange={(e) => save({ [k]: e.target.checked })} data-testid={`pref-${k}`} /><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-text-muted">{hint}</span></span></label>
  )
  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => <div className="flex flex-wrap items-center justify-between gap-3 py-2"><span><span className="block text-sm">{label}</span>{hint && <span className="block text-xs text-text-muted">{hint}</span>}</span>{children}</div>
  return (
    <div className="card-dark p-5" data-testid="automation-prefs">
      <div className="flex items-start justify-between gap-3"><div><h2 className="!text-base">Automation</h2><p className="text-xs text-text-muted">What happens without anyone clicking.</p></div>{saved && <span className="text-xs text-teal" role="status">Saved</span>}{onClose && <button onClick={onClose} className="text-xs text-text-muted hover:text-text">Close</button>}</div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Bookings</p>
      <div className="divide-y divide-border">
        <Toggle k="autoInvoice" label="Invoice the customer when they accept a quote" hint="The invoice uses the quoted price and what it includes, and appears in the client’s Invoices tab." />
        <Row label="Invoices are due after"><span className="flex items-center gap-2"><input type="number" min={0} max={120} className="input-dark !min-h-9 !w-20 text-sm" value={p.invoiceDueDays} onChange={(e) => setP({ ...p, invoiceDueDays: Number(e.target.value) })} onBlur={() => save({ invoiceDueDays: p.invoiceDueDays })} data-testid="pref-due" /> days</span></Row>
        <Toggle k="autoLabels" label="Create piece labels on new bookings" hint="One scannable label per piece — scanning them moves the status on its own." />
        <Toggle k="autoDocuments" label="Generate the packing list at booking" hint="Plus a commercial invoice (office-only) when a declared value is entered." />
        <Toggle k="autoTrackingLink" label="Send the customer their tracking link on new bookings" hint="They get the reference and ETA by email and in their dashboard." />
        <Toggle k="recipientNudges" label="Ask the client for a missing recipient" hint="Up to 3 reminders with a link they can fill in without logging in." />
        <Toggle k="autoConfirmPickups" label="Confirm customer pickup requests automatically" hint="Requests in an open slot go straight onto that day’s pickup run." />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">At destination</p>
      <div className="divide-y divide-border">
        <Row label="Recipients usually" hint="Each booking can override it."><select className="input-dark !min-h-9 !w-auto text-sm" value={p.defaultHandover} onChange={(e) => save({ defaultHandover: e.target.value as Handover })} data-testid="pref-handover"><option value="collection">Collect from our warehouse</option><option value="delivery">Get door delivery</option></select></Row>
        <Row label="Collection text adds" hint="Hours, what to bring…"><input className="input-dark !min-h-9 !w-64 max-w-full text-sm" value={p.collectionNote} onChange={(e) => setP({ ...p, collectionNote: e.target.value })} onBlur={() => save({ collectionNote: p.collectionNote })} maxLength={200} /></Row>
        <Row label="Offer door delivery on arrival for" hint="0 hides the offer. Accepting adds it to the invoice."><span className="flex items-center gap-1 text-sm">$<input type="number" min={0} className="input-dark !min-h-9 !w-24 text-sm" value={p.doorDeliveryUsd} onChange={(e) => setP({ ...p, doorDeliveryUsd: Number(e.target.value) })} onBlur={() => save({ doorDeliveryUsd: p.doorDeliveryUsd })} data-testid="pref-door" /></span></Row>
        <Row label="Unpaid at handover" hint="Invoices plus storage due."><select className="input-dark !min-h-9 !w-auto text-sm" value={p.holdUnpaid} onChange={(e) => save({ holdUnpaid: e.target.value as ShipperPrefs['holdUnpaid'] })} data-testid="pref-hold"><option value="warn">Tell the driver/desk to collect it</option><option value="block">Block until paid (owners can override)</option><option value="off">Don’t check</option></select></Row>
        <Toggle k="stuckAlerts" label="Alert me when a shipment looks stuck" hint="When it sits in one status much longer than normal for its lane." />
      </div>
      <p className="mt-3 text-xs text-text-muted">Storage after the free days uses the rates on your destination warehouse (Warehouse page).</p>
    </div>
  )
}
