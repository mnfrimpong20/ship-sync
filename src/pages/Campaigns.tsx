import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Mail, Megaphone, MessageCircle, Send, Smartphone } from 'lucide-react'
import { useStore } from '../lib/store'
import { platformApi } from '../lib/platform'
import { fmtDate, fmtDateTime, money } from '../components/ui'
import { DataTable, NoData, Panel, Stat } from '../components/Charts'

type Client = Awaited<ReturnType<typeof platformApi.audience>>[number]
const AUD = [{ key: 'dormant', label: 'Win back', hint: 'Shipped 2+ times, nothing in 90 days' }, { key: 'recent', label: 'Recent clients', hint: 'Shipped in the last 90 days' }, { key: 'all', label: 'All clients', hint: 'Every active client' }] as const
const CH = [{ key: 'email', label: 'Email', Icon: Mail }, { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle }, { key: 'sms', label: 'SMS', Icon: Smartphone }] as const
const DEFAULT_MSG = 'Hi {name}, December sailings from {shipper} fill up fast. Reserve your space this week and we’ll pick up from your door. Book here: {link}'

/** Win-back and announcement campaigns to your own clients, with delivery and bookings tracked for 30 days. */
export default function CampaignsPage() {
  const { ready, user } = useStore()
  const [sp] = useSearchParams()
  const [list, setList] = useState<Awaited<ReturnType<typeof platformApi.campaigns>> | null>(null)
  const [aud, setAud] = useState<string>(sp.get('audience') ?? 'dormant'); const [clients, setClients] = useState<Client[]>([]); const [picked, setPicked] = useState<Set<string>>(new Set())
  const [f, setF] = useState({ name: 'Holiday rush', channel: 'email', subject: 'Ship before the holidays, {name}', message: DEFAULT_MSG })
  const [open, setOpen] = useState<string | null>(null); const [detail, setDetail] = useState<Awaited<ReturnType<typeof platformApi.campaign>> | null>(null)
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => platformApi.campaigns().then(setList).catch((e) => setErr(e.message))
  useEffect(() => { if (user?.role === 'shipper') load() }, [user])
  useEffect(() => { if (user?.role === 'shipper') platformApi.audience(aud).then((c) => { setClients(c); setPicked(new Set(c.map((x) => x.id))) }).catch(() => setClients([])) }, [user, aud])
  useEffect(() => { if (open) platformApi.campaign(open).then(setDetail).catch(() => {}); else setDetail(null) }, [open])
  const reach = useMemo(() => clients.filter((c) => picked.has(c.id) && (f.channel === 'email' ? /@/.test(c.email) : /\d{7,}/.test(String(c.phone).replace(/\D/g, '')))), [clients, picked, f.channel])
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?next=/dashboard/campaigns" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const send = async (test: boolean) => {
    setBusy(true); setErr(''); setOk('')
    try { const r = await platformApi.sendCampaign({ ...f, audience: 'custom', clientIds: [...picked], test }); setOk(test ? 'Test sent to you.' : `Sending to ${r.recipients} client${r.recipients === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} without ${f.channel === 'email' ? 'an email' : 'a phone'})` : ''}.`); load() }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not send.') } finally { setBusy(false) }
  }
  const preview = (t: string) => t.replace(/\{name\}/g, clients[0]?.name.split(' ')[0] ?? 'Ama').replace(/\{company\}/g, clients[0]?.company || clients[0]?.name || 'Ama').replace(/\{shipper\}/g, user.company ?? 'your shipper').replace(/\{link\}/g, 'ntemtem.com/order/…')
  const totals = (list?.campaigns ?? []).reduce((a, c) => ({ sent: a.sent + c.sent, booked: a.booked + c.booked, revenue: a.revenue + c.revenue }), { sent: 0, booked: 0, revenue: 0 })
  const cls = 'input-dark !min-h-10 text-sm'
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Sell</p><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Campaigns</h1>
      <p className="mt-1 max-w-2xl text-text-muted">Message your own clients by email, WhatsApp or SMS. Anyone who books within 30 days counts as a win for the campaign.</p>
      {list && !list.enabled && <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm text-text-muted">Campaigns are switched off for your account.</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Campaigns" value={list?.campaigns.length ?? 0} icon={Megaphone} /><Stat label="Messages sent" value={totals.sent} icon={Send} /><Stat label="Bookings within 30 days" value={totals.booked} /><Stat label="Revenue from them" value={money(totals.revenue)} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="New campaign" testid="campaign-form">
          <div className="space-y-4">
            <div><p className="label-dark mb-1.5">Who gets it</p><div role="radiogroup" className="flex flex-wrap gap-1.5">{AUD.map((a) => <button key={a.key} type="button" role="radio" aria-checked={aud === a.key} onClick={() => setAud(a.key)} title={a.hint} className={`rounded-full border px-3 py-1 text-sm focus-ring ${aud === a.key ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`aud-${a.key}`}>{a.label}</button>)}</div><p className="mt-1 text-xs text-text-muted">{AUD.find((a) => a.key === aud)?.hint} · {clients.length} client{clients.length === 1 ? '' : 's'} · {picked.size} selected</p></div>
            {clients.length > 0 && <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-sm" data-testid="audience-list">{clients.map((c) => <li key={c.id}><label className="flex items-center gap-2"><input type="checkbox" checked={picked.has(c.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n) }} /><span className="flex-1 truncate">{c.name}</span><span className="text-xs text-text-muted">{c.shipments} shipments · last {c.lastAt ? fmtDate(c.lastAt) : '—'}</span></label></li>)}</ul>}
            <div><p className="label-dark mb-1.5">Channel</p><div role="radiogroup" className="flex flex-wrap gap-1.5">{CH.map((c) => <button key={c.key} type="button" role="radio" aria-checked={f.channel === c.key} onClick={() => setF({ ...f, channel: c.key })} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm focus-ring ${f.channel === c.key ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`ch-${c.key}`}><c.Icon size={13} aria-hidden="true" />{c.label}</button>)}</div></div>
            <label className="block text-sm"><span className="label-dark">Campaign name (for you)</span><input className={cls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="cmp-name" /></label>
            {f.channel === 'email' && <label className="block text-sm"><span className="label-dark">Subject</span><input className={cls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="cmp-subject" /></label>}
            <label className="block text-sm"><span className="label-dark">Message</span><textarea rows={4} className="input-dark text-sm" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} data-testid="cmp-message" /><span className="mt-1 block text-xs text-text-muted">Use {'{name}'}, {'{company}'}, {'{shipper}'} and {'{link}'} (your order link). {f.channel !== 'email' && `${f.message.length} characters`}</span></label>
            <div className="rounded-lg bg-surface-2/60 p-3 text-sm" data-testid="cmp-preview"><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Preview</p>{f.channel === 'email' && <p className="font-semibold">{preview(f.subject)}</p>}<p className="whitespace-pre-wrap">{preview(f.message)}</p></div>
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}{ok && <p role="status" className="text-sm text-teal" data-testid="cmp-ok">{ok}</p>}
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !reach.length} onClick={() => send(false)} className="btn-gold !min-h-10" data-testid="cmp-send"><Send size={15} aria-hidden="true" /> Send to {reach.length}</button><button type="button" disabled={busy} onClick={() => send(true)} className="btn-ghost !min-h-10" data-testid="cmp-test">Send me a test</button></div>
          </div>
        </Panel>
        <Panel title="Sent campaigns" testid="campaign-list">
          {list?.campaigns.length ? <ul className="divide-y divide-border">{list.campaigns.map((c) => <li key={c.id} className="py-3"><button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full text-left focus-ring"><p className="flex items-center justify-between gap-2"><b>{c.name}</b><span className="text-xs text-text-muted">{c.sentAt ? fmtDateTime(c.sentAt) : ''}</span></p><p className="text-sm text-text-muted">{c.channel} · {c.sent}/{c.total} sent{c.failed ? ` · ${c.failed} failed` : ''} · <span className={c.booked ? 'font-semibold text-teal' : ''}>{c.booked} booked</span>{c.revenue ? ` · ${money(c.revenue)}` : ''}</p></button>
            {open === c.id && detail && <div className="mt-2"><DataTable rows={detail.recipients} limit={8} cols={[{ key: 'name', label: 'Client' }, { key: 'status', label: 'Status', format: (v, r) => <span className={v === 'failed' ? 'text-danger' : ''} title={r.error}>{String(v)}</span> }, { key: 'bookedRef', label: 'Booked', format: (v) => (v ? <span className="font-semibold text-teal">{String(v)}</span> : '—') }]} /></div>}
          </li>)}</ul> : <NoData>No campaigns yet. Your first win-back message usually brings back one or two regulars.</NoData>}
        </Panel>
      </div>
    </div></div>
  )
}
