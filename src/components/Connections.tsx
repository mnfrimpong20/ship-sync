import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Anchor, Check, Link2, Mail, Plus, RefreshCw, Ship, Unplug } from 'lucide-react'
import { api } from '../lib/store'
import { Panel } from './Charts'
import { fmtDateTime } from './ui'
import { PasswordInput } from './PasswordInput'

const cls = 'input-dark !min-h-10 text-sm'
const msgOf = (e: unknown, f: string) => (e instanceof Error ? e.message : f)

/* ---------------- QuickBooks ---------------- */
interface QbStatus { configured: boolean; env: string; connected: boolean; company: string; connectedBy: string; connectedAt: string | null; lastSyncAt: string | null; lastError: string; lastResult: { invoices: number; payments: number; skipped: number; errors: string[] } | null; synced: { invoices: number; payments: number } }
export function QuickBooksPanel() {
  const [sp, setSp] = useSearchParams()
  const [s, setS] = useState<QbStatus | null>(null); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { api<QbStatus>('/shipper/quickbooks').then(setS).catch(() => {}) }, [])
  useEffect(() => { const q = sp.get('qb'); if (!q) return; setMsg(q === 'connected' ? { ok: true, text: 'QuickBooks connected. Your invoices and payments will sync every night — or sync now.' } : { ok: false, text: q === 'cancelled' ? 'Connection cancelled.' : 'That didn’t work — try connecting again.' }); const n = new URLSearchParams(sp); n.delete('qb'); setSp(n, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null
  const connect = async () => { setBusy('connect'); setMsg(null); try { const r = await api<{ url: string }>('/shipper/quickbooks/connect', { json: {} }); location.assign(r.url) } catch (e) { setMsg({ ok: false, text: msgOf(e, 'Could not start.') }); setBusy('') } }
  const sync = async () => { setBusy('sync'); setMsg(null); try { const r = await api<{ result: NonNullable<QbStatus['lastResult']>; status: QbStatus }>('/shipper/quickbooks/sync', { json: {} }); setS(r.status); setMsg({ ok: !r.result.errors.length, text: `Sent ${r.result.invoices} invoice${r.result.invoices === 1 ? '' : 's'} and ${r.result.payments} payment${r.result.payments === 1 ? '' : 's'}.${r.result.errors.length ? ` ${r.result.errors.length} failed: ${r.result.errors[0]}` : ''}` }) } catch (e) { setMsg({ ok: false, text: msgOf(e, 'Sync failed.') }) } finally { setBusy('') } }
  const disconnect = async () => { setBusy('off'); try { setS(await api<QbStatus>('/shipper/quickbooks/disconnect', { json: {} })); setMsg({ ok: true, text: 'Disconnected.' }) } finally { setBusy('') } }
  return (
    <Panel title="QuickBooks Online" sub="Invoices, customers and payments copied into your QuickBooks automatically — no CSV." testid="quickbooks">
      {msg && <p role="status" className={`mb-3 text-sm ${msg.ok ? 'text-teal' : 'text-danger'}`}>{msg.text}</p>}
      {s.connected ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2"><Check size={15} className="text-teal" aria-hidden="true" /> Connected to <b>{s.company || 'your company'}</b>{s.env === 'sandbox' ? ' (sandbox)' : ''}</p>
          <p className="text-xs text-text-muted">{s.synced.invoices} invoices and {s.synced.payments} payments in QuickBooks · last sync {s.lastSyncAt ? fmtDateTime(s.lastSyncAt) : 'not yet'}{s.connectedBy ? ` · connected by ${s.connectedBy}` : ''}</p>
          {s.lastError && <p className="text-xs text-danger">Last problem: {s.lastError}</p>}
          <div className="flex gap-2"><button onClick={sync} disabled={!!busy} className="btn-gold !min-h-10 text-sm" data-testid="qb-sync"><RefreshCw size={15} className={busy === 'sync' ? 'animate-spin' : ''} aria-hidden="true" /> Sync now</button><button onClick={disconnect} disabled={!!busy} className="btn-ghost !min-h-10 text-sm"><Unplug size={15} aria-hidden="true" /> Disconnect</button></div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-text-muted">Sign in to QuickBooks and approve Ntemtem. Issued invoices (with the customer and each line) and every payment you record are copied across, once each.</p>
          <button onClick={connect} disabled={!!busy || !s.configured} className="btn-gold !min-h-10 text-sm disabled:opacity-60" data-testid="qb-connect"><Link2 size={15} aria-hidden="true" /> Connect QuickBooks</button>
          {!s.configured && <p className="text-xs text-text-muted">Coming soon — use the CSV export below in the meantime.</p>}
        </div>
      )}
    </Panel>
  )
}

/* ---------------- Shipping line connections ---------------- */
interface Conn { id: string; line: string; lineName: string; label: string; mode: 'dcsa' | 'email'; baseUrl: string; keyHeader: string; keyHint: string; contract: string; bookingEmail: string; active: boolean; lastOkAt: string | null; lastError: string }
const blankConn = { line: 'MAEU', label: '', mode: 'dcsa' as 'dcsa' | 'email', baseUrl: '', apiKey: '', keyHeader: 'Authorization', contract: '', bookingEmail: '', active: true }
export function LineConnectionsPanel() {
  const [d, setD] = useState<{ connections: Conn[]; lines: Record<string, string> } | null>(null)
  const [f, setF] = useState<(typeof blankConn & { id?: string }) | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => api<{ connections: Conn[]; lines: Record<string, string> }>('/line-connections').then(setD).catch(() => {})
  useEffect(() => { void load() }, [])
  if (!d) return null
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (!f) return; setBusy(true); setErr(''); try { const { id, ...b } = f; await api(id ? `/line-connections/${id}` : '/line-connections', { method: id ? 'PUT' : 'POST', json: b }); setF(null); await load() } catch (er) { setErr(msgOf(er, 'Could not save.')) } finally { setBusy(false) } }
  return (
    <Panel title="Shipping lines" sub="Book container space with the line straight from a container — by API (DCSA) or by email to their booking desk." testid="line-connections">
      <ul className="space-y-2 text-sm">{d.connections.filter((c) => c.active).map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
          <span className="min-w-0"><b>{c.lineName}</b>{c.label ? ` · ${c.label}` : ''}<span className="block text-xs text-text-muted">{c.mode === 'dcsa' ? `API ${c.baseUrl.replace(/^https?:\/\//, '')} · key ${c.keyHint || 'none'}` : `Email ${c.bookingEmail}`}{c.contract ? ` · contract ${c.contract}` : ''}{c.lastError ? ` · last error: ${c.lastError}` : c.lastOkAt ? ` · worked ${fmtDateTime(c.lastOkAt)}` : ''}</span></span>
          <span className="flex gap-1"><button onClick={() => setF({ ...blankConn, id: c.id, line: c.line, label: c.label, mode: c.mode, baseUrl: c.baseUrl, keyHeader: c.keyHeader, contract: c.contract, bookingEmail: c.bookingEmail })} className="btn-ghost !min-h-8 !px-2.5 text-xs">Edit</button><button onClick={async () => { await api(`/line-connections/${c.id}`, { method: 'DELETE' }); await load() }} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger">Remove</button></span>
        </li>))}</ul>
      {!f ? <button onClick={() => setF({ ...blankConn })} className="btn-ghost mt-3 !min-h-10 text-sm" data-testid="line-add"><Plus size={15} aria-hidden="true" /> Add a line</button> : (
        <form onSubmit={save} className="mt-3 grid gap-2.5 text-sm" data-testid="line-form">
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          <div className="grid grid-cols-2 gap-2"><label><span className="label-dark">Line</span><select className={cls} value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })}>{Object.entries(d.lines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label><span className="label-dark">How</span><select className={cls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'dcsa' | 'email' })}><option value="dcsa">Booking API (DCSA)</option><option value="email">Email the booking desk</option></select></label></div>
          {f.mode === 'dcsa' ? <>
            <label><span className="label-dark">Booking API address (from the line’s developer portal)</span><input className={cls} placeholder="https://api.line.com/booking/v2" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></label>
            <div className="grid grid-cols-[1fr_150px] gap-2"><label><span className="label-dark">API key{f.id ? ' (blank keeps the saved one)' : ''}</span><PasswordInput autoComplete="off" className={cls} value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></label><label><span className="label-dark">Key header</span><input className={cls} value={f.keyHeader} onChange={(e) => setF({ ...f, keyHeader: e.target.value })} /></label></div>
          </> : <label><span className="label-dark">Booking desk email</span><input type="email" className={cls} value={f.bookingEmail} onChange={(e) => setF({ ...f, bookingEmail: e.target.value })} /></label>}
          <div className="grid grid-cols-2 gap-2"><label><span className="label-dark">Service contract (optional)</span><input className={cls} value={f.contract} onChange={(e) => setF({ ...f, contract: e.target.value })} /></label><label><span className="label-dark">Name (optional)</span><input className={cls} placeholder="e.g. Houston desk" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label></div>
          <div className="flex gap-2"><button type="button" onClick={() => setF(null)} className="btn-ghost !min-h-10 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 text-sm" data-testid="line-save">Save</button></div>
          <p className="text-xs text-text-muted">Your key is stored encrypted and never shown again. Maersk uses the “Consumer-Key” header, CMA CGM “KeyId”; most others “Authorization”.</p>
        </form>
      )}
    </Panel>
  )
}

/* ---------------- Book a container with the line ---------------- */
interface Booking { id: string; line: string; mode: 'dcsa' | 'email'; requestRef: string; bookingRef: string; status: string; statusDetail: string; pol: string; pod: string; equipment: string; error: string; createdBy: string; createdAt: string | null; lastPolledAt: string | null; confirmed: { bookingRef: string; vesselName: string; voyage: string; etd: string | null } | null }
interface BookingView { bookings: Booking[]; connections: Conn[]; suggest: { equipment: string; pol: string; pod: string; weightKg: number; commodity: string; etd: string | null } }
const LIVE = ['SENDING', 'RECEIVED', 'PENDING_UPDATE', 'UPDATE_RECEIVED', 'PENDING_AMENDMENT', 'REQUESTED']
export function LineBookingCard({ containerId, onChanged }: { containerId: string; onChanged?: () => void }) {
  const [d, setD] = useState<BookingView | null>(null)
  const [f, setF] = useState<{ connectionId: string; equipment: string; units: number; commodity: string; weightKg: number; pol: string; pod: string; etd: string | null } | null>(null)
  const [conf, setConf] = useState<{ id: string; bookingRef: string; vesselName: string; voyage: string; etd: string } | null>(null)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const load = () => api<BookingView>(`/containers/${containerId}/line-booking`).then(setD).catch((e) => setErr(msgOf(e, '')))
  useEffect(() => { void load() }, [containerId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const live = d.bookings.find((b) => LIVE.includes(b.status) || b.status === 'CONFIRMED')
  const start = () => setF({ connectionId: d.connections[0]?.id ?? '', ...d.suggest, units: 1 })
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!f) return; setBusy('send'); setErr(''); try { await api(`/containers/${containerId}/line-booking`, { json: f }); setF(null); await load(); onChanged?.() } catch (er) { setErr(msgOf(er, 'Could not send.')) } finally { setBusy('') } }
  const refresh = async (b: Booking) => { setBusy(b.id); try { await api(`/line-bookings/${b.id}/refresh`, { json: {} }); await load(); onChanged?.() } finally { setBusy('') } }
  const confirm = async (e: React.FormEvent) => { e.preventDefault(); if (!conf) return; setBusy('conf'); setErr(''); try { await api(`/line-bookings/${conf.id}/confirm`, { json: { bookingRef: conf.bookingRef, vesselName: conf.vesselName, voyage: conf.voyage, etd: conf.etd || null } }); setConf(null); await load(); onChanged?.() } catch (er) { setErr(msgOf(er, 'Could not save.')) } finally { setBusy('') } }
  const tone = (s: string) => (s === 'CONFIRMED' ? 'bg-teal/15 text-teal' : ['REJECTED', 'DECLINED', 'FAILED', 'CANCELLED'].includes(s) ? 'bg-danger/15 text-danger' : 'bg-gold/20 text-gold-deep')
  return (
    <section className="card-dark p-5" data-testid="line-booking">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 !text-lg"><Anchor size={18} className="text-gold-deep" aria-hidden="true" /> Book with the line</h2><p className="mt-1 text-sm text-text-muted">Request space for this container; the confirmation fills in the booking number, vessel and dates.</p></div>
        {!live && !f && d.connections.length > 0 && <button onClick={start} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="booking-start"><Ship size={14} aria-hidden="true" /> Request booking</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      {d.connections.length === 0 && <p className="mt-3 text-sm text-text-muted">Add your shipping line under <Link to="/dashboard/integrations" className="text-gold-deep hover:underline">Integrations → Shipping lines</Link> first.</p>}
      {d.bookings.length > 0 && <ul className="mt-3 space-y-2 text-sm">{d.bookings.slice(0, 4).map((b) => (
        <li key={b.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{b.equipment}</b> {b.pol} → {b.pod}{b.bookingRef ? <> · booking <span className="font-mono">{b.bookingRef}</span></> : b.requestRef ? <span className="text-xs text-text-muted"> · request {b.requestRef}</span> : ''}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone(b.status)}`}>{b.status.replace(/_/g, ' ').toLowerCase()}</span></div>
          <p className="mt-1 text-xs text-text-muted">{b.mode === 'email' ? 'By email' : 'By API'} · {b.createdBy} · {b.createdAt ? fmtDateTime(b.createdAt) : ''}{b.confirmed?.vesselName ? ` · ${b.confirmed.vesselName} ${b.confirmed.voyage}` : ''}{b.confirmed?.etd ? ` · ETD ${b.confirmed.etd}` : ''}{b.statusDetail ? ` · ${b.statusDetail}` : ''}{b.error ? ` · ${b.error}` : ''}</p>
          {LIVE.includes(b.status) && <div className="mt-2 flex gap-2">{b.mode === 'dcsa' ? <button onClick={() => refresh(b)} disabled={!!busy} className="btn-ghost !min-h-8 !px-2.5 text-xs"><RefreshCw size={12} className={busy === b.id ? 'animate-spin' : ''} aria-hidden="true" /> Check now</button> : <button onClick={() => setConf({ id: b.id, bookingRef: '', vesselName: '', voyage: '', etd: '' })} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="booking-confirm-open"><Mail size={12} aria-hidden="true" /> Line confirmed — enter details</button>}</div>}
        </li>))}</ul>}
      {conf && (
        <form onSubmit={confirm} className="mt-3 grid gap-2 sm:grid-cols-4">
          <input required className="input-dark !min-h-9 text-sm" placeholder="Booking number" value={conf.bookingRef} onChange={(e) => setConf({ ...conf, bookingRef: e.target.value })} />
          <input className="input-dark !min-h-9 text-sm" placeholder="Vessel" value={conf.vesselName} onChange={(e) => setConf({ ...conf, vesselName: e.target.value })} />
          <input className="input-dark !min-h-9 text-sm" placeholder="Voyage" value={conf.voyage} onChange={(e) => setConf({ ...conf, voyage: e.target.value })} />
          <input type="date" className="input-dark !min-h-9 text-sm" value={conf.etd} onChange={(e) => setConf({ ...conf, etd: e.target.value })} aria-label="ETD" />
          <div className="flex gap-2 sm:col-span-4"><button type="button" onClick={() => setConf(null)} className="btn-ghost !min-h-8 text-xs">Cancel</button><button disabled={busy === 'conf'} className="btn-gold !min-h-8 text-xs">Save to container</button></div>
        </form>
      )}
      {f && (
        <form onSubmit={send} className="mt-4 grid gap-2.5 border-t border-border pt-4 text-sm sm:grid-cols-2" data-testid="booking-form">
          <label className="sm:col-span-2"><span className="label-dark">Line</span><select className={cls} value={f.connectionId} onChange={(e) => setF({ ...f, connectionId: e.target.value })}>{d.connections.map((c) => <option key={c.id} value={c.id}>{c.lineName}{c.label ? ` · ${c.label}` : ''} ({c.mode === 'dcsa' ? 'API' : 'email'})</option>)}</select></label>
          <label><span className="label-dark">Equipment</span><span className="flex gap-2"><input type="number" min={1} max={20} className={`${cls} !w-16`} value={f.units} onChange={(e) => setF({ ...f, units: Number(e.target.value) || 1 })} aria-label="How many" /><select className={`${cls} flex-1`} value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })}><option value="20ft">20ft dry</option><option value="40ft">40ft dry</option><option value="40hc">40ft high cube</option><option value="45hc">45ft high cube</option></select></span></label>
          <label><span className="label-dark">Wanted sailing on/after</span><input type="date" className={cls} value={f.etd ?? ''} onChange={(e) => setF({ ...f, etd: e.target.value || null })} /></label>
          <label><span className="label-dark">Port of loading (UN/LOCODE)</span><input required className={`${cls} font-mono uppercase`} maxLength={5} value={f.pol} onChange={(e) => setF({ ...f, pol: e.target.value.toUpperCase() })} placeholder="USHOU" /></label>
          <label><span className="label-dark">Port of discharge</span><input required className={`${cls} font-mono uppercase`} maxLength={5} value={f.pod} onChange={(e) => setF({ ...f, pod: e.target.value.toUpperCase() })} placeholder="GHTEM" /></label>
          <label><span className="label-dark">Commodity</span><input required className={cls} value={f.commodity} onChange={(e) => setF({ ...f, commodity: e.target.value })} /></label>
          <label><span className="label-dark">Gross weight (kg)</span><input type="number" min={100} className={cls} value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: Number(e.target.value) })} /></label>
          <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => setF(null)} className="btn-ghost !min-h-10 text-sm">Cancel</button><button disabled={busy === 'send'} className="btn-gold !min-h-10 text-sm" data-testid="booking-send">{busy === 'send' ? 'Sending…' : 'Send to the line'}</button></div>
        </form>
      )}
    </section>
  )
}
