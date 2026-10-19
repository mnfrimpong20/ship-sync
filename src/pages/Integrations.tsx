import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, Copy, Download, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { accountingCsvUrl, platformApi, type Webhook } from '../lib/platform'
import { fmtDateTime } from '../components/ui'
import { NoData, Panel } from '../components/Charts'
import { LineConnectionsPanel, QuickBooksPanel } from '../components/Connections'

const cls = 'input-dark !min-h-10 text-sm'
function CopyBox({ text, testid }: { text: string; testid?: string }) {
  const [done, setDone] = useState(false)
  return <div className="flex gap-2"><input readOnly value={text} onFocus={(e) => e.currentTarget.select()} className={`${cls} flex-1 font-mono text-xs`} data-testid={testid} /><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* select instead */ } }} className="btn-ghost !min-h-10 !px-3" aria-label="Copy">{done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}</button></div>
}

function WeeklyReport() {
  const [p, setP] = useState<{ email: boolean; whatsapp: boolean; phone: string } | null>(null); const [msg, setMsg] = useState(''); const [prev, setPrev] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { platformApi.weekly().then((r) => setP(r.prefs)).catch(() => {}) }, [])
  if (!p) return null
  const save = async (n: typeof p) => { setP(n); setMsg(''); try { await platformApi.setWeekly(n); setMsg('Saved.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.') } }
  return (
    <Panel title="Monday report" sub="Last week’s numbers and the top three things to act on, every Monday morning." testid="weekly">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.email} onChange={(e) => save({ ...p, email: e.target.checked })} data-testid="weekly-email" /> Email it to the owner</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.whatsapp} onChange={(e) => setP({ ...p, whatsapp: e.target.checked })} data-testid="weekly-wa" /> Also send it by WhatsApp</label>
        {p.whatsapp && <div className="flex gap-2"><input className={`${cls} flex-1`} placeholder="+1 713 555 0100" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} data-testid="weekly-phone" /><button type="button" className="btn-ghost !min-h-10" onClick={() => save(p)}>Save</button></div>}
        {msg && <p role="status" className="text-xs text-text-muted">{msg}</p>}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await platformApi.previewWeekly(); setPrev(`${r.subject}\n\n${r.body}`) } catch (e) { setPrev(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) } }} className="btn-ghost !min-h-9 text-sm" data-testid="weekly-preview"><Send size={14} aria-hidden="true" /> Email me a preview now</button>
        {prev && <pre className="whitespace-pre-wrap rounded-lg bg-surface-2/60 p-3 text-xs" data-testid="weekly-preview-text">{prev}</pre>}
      </div>
    </Panel>
  )
}

function Currency() {
  const [c, setC] = useState<Awaited<ReturnType<typeof platformApi.currency>> | null>(null); const [msg, setMsg] = useState('')
  useEffect(() => { platformApi.currency().then(setC).catch(() => {}) }, [])
  if (!c) return null
  return (
    <Panel title="Show prices in local currency" sub="Invoices show the local equivalent next to the USD total." testid="currency">
      <div role="radiogroup" className="flex gap-1.5">{['USD', 'GHS', 'NGN'].map((k) => <button key={k} type="button" role="radio" aria-checked={c.currency === k} onClick={async () => { setMsg(''); try { const r = await platformApi.setCurrency(k); setC({ ...c, ...r }) } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not change.') } }} className={`rounded-full border px-3 py-1 text-sm focus-ring ${c.currency === k ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`cur-${k}`}>{k === 'USD' ? 'US dollars only' : k === 'GHS' ? 'Ghana cedi' : 'Nigerian naira'}</button>)}</div>
      <p className="mt-2 text-xs text-text-muted">{c.rates.GHS ? `1 USD = ${c.rates.GHS} GHS` : 'GHS rate not set'} · {c.rates.NGN ? `1 USD = ${c.rates.NGN} NGN` : 'NGN rate not set'}</p>
      {msg && <p role="alert" className="mt-2 text-sm text-danger">{msg}</p>}
    </Panel>
  )
}

function Accounting() {
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const [q, setQ] = useState({ format: 'quickbooks', kind: 'invoices', from: d90, to: new Date().toISOString().slice(0, 10) })
  return (
    <Panel title="Accounting export" sub="Invoices or payments as a CSV your accounting software imports." testid="accounting">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label><span className="label-dark">Software</span><select className={cls} value={q.format} onChange={(e) => setQ({ ...q, format: e.target.value })} data-testid="acc-format"><option value="quickbooks">QuickBooks Online</option><option value="xero">Xero</option></select></label>
        <label><span className="label-dark">What</span><select className={cls} value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value })}><option value="invoices">Invoices (one line per item)</option><option value="payments">Payments received</option></select></label>
        <label><span className="label-dark">From</span><input type="date" className={cls} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></label>
        <label><span className="label-dark">To</span><input type="date" className={cls} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></label>
      </div>
      <a href={accountingCsvUrl(q)} className="btn-gold mt-3 !min-h-10" data-testid="acc-download"><Download size={15} aria-hidden="true" /> Download CSV</a>
      <p className="mt-2 text-xs text-text-muted">Needs the Pro plan. In Xero, sales go to account 200 — change it during import if yours differs.</p>
    </Panel>
  )
}

function Widget({ shipperId }: { shipperId: string }) {
  const base = window.location.origin
  const script = `<script src="${base}/api/widget.js?s=${shipperId}" async></script>`
  const iframe = `<iframe src="${base}/embed/track/${shipperId}" title="Track your shipment" style="width:100%;max-width:520px;height:460px;border:0"></iframe>`
  return (
    <Panel title="Tracking widget for your website" sub="Clients type their reference on your site and see the live status — only your shipments are found." testid="widget">
      <p className="label-dark mb-1">Paste this where the box should appear</p><CopyBox text={script} testid="widget-script" />
      <p className="label-dark mb-1 mt-3">Or use an iframe</p><CopyBox text={iframe} />
      <a href={`/embed/track/${shipperId}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-gold-deep hover:underline">Open a preview</a>
    </Panel>
  )
}

function Webhooks() {
  const [d, setD] = useState<Awaited<ReturnType<typeof platformApi.webhooks>> | null>(null)
  const [url, setUrl] = useState(''); const [events, setEvents] = useState<string[]>([]); const [secret, setSecret] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState<Record<string, string>>({})
  const [log, setLog] = useState<{ id: string; rows: Record<string, unknown>[] } | null>(null)
  const load = () => platformApi.webhooks().then(setD).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  if (!d) return <Panel title="Webhooks">{err ? <p className="text-sm text-danger">{err}</p> : <NoData>Loading…</NoData>}</Panel>
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); try { const r = await platformApi.addWebhook({ url, events }); setSecret(r.secret); setUrl(''); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not add.') } }
  return (
    <Panel title="Webhooks" sub="We POST a signed JSON event to your system when things happen. Header X-Ntemtem-Signature: t=…,v1=HMAC-SHA256(secret, “t.body”)." testid="webhooks">
      {!d.enabled && <p className="mb-3 rounded-lg bg-surface-2 p-3 text-sm text-text-muted">Webhooks are switched off for your account.</p>}
      <form onSubmit={add} className="space-y-2">
        <input type="url" required placeholder="https://your-system.example.com/shipsync" className={cls} value={url} onChange={(e) => setUrl(e.target.value)} data-testid="wh-url" />
        <div className="flex flex-wrap gap-1.5">{d.events.map((ev) => <label key={ev.key} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${events.includes(ev.key) ? 'border-gold bg-gold/15' : 'border-border text-text-muted'}`}><input type="checkbox" className="sr-only" checked={events.includes(ev.key)} onChange={(e) => setEvents(e.target.checked ? [...events, ev.key] : events.filter((x) => x !== ev.key))} />{ev.key}</label>)}<span className="self-center text-xs text-text-muted">{events.length ? '' : '(none picked = all events)'}</span></div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <button className="btn-gold !min-h-10" data-testid="wh-add"><Plus size={15} aria-hidden="true" /> Add webhook</button>
      </form>
      {secret && <div className="mt-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm" data-testid="wh-secret"><p className="mb-1 font-semibold">Signing secret — copy it now, it won’t be shown again</p><CopyBox text={secret} /></div>}
      <ul className="mt-4 divide-y divide-border text-sm">{d.webhooks.map((w: Webhook) => (
        <li key={w.id} className="py-3" data-testid="wh-row">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 truncate font-mono text-xs">{w.url}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${w.active ? 'bg-teal/10 text-teal' : 'bg-danger/10 text-danger'}`}>{w.active ? 'On' : 'Off'}</span></div>
          <p className="mt-0.5 text-xs text-text-muted">{w.events.length ? w.events.join(', ') : 'All events'} · last {w.lastStatus ?? '—'}{w.lastAt ? ` at ${fmtDateTime(w.lastAt)}` : ''}{w.failures ? ` · ${w.failures} failures in a row` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="btn-ghost !min-h-8 !px-2.5 text-xs" onClick={async () => { const r = await platformApi.testWebhook(w.id); setMsg({ ...msg, [w.id]: r.ok ? `Delivered (HTTP ${r.status})` : `Failed: ${r.error || r.status}` }); load() }} data-testid="wh-test"><Send size={12} aria-hidden="true" /> Send test</button>
            <button type="button" className="btn-ghost !min-h-8 !px-2.5 text-xs" onClick={async () => setLog({ id: w.id, rows: await platformApi.deliveries(w.id) })}>Deliveries</button>
            <button type="button" className="btn-ghost !min-h-8 !px-2.5 text-xs" onClick={async () => { await platformApi.updateWebhook(w.id, { active: !w.active }); load() }}>{w.active ? 'Switch off' : 'Switch on'}</button>
            <button type="button" className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger" onClick={async () => { await platformApi.deleteWebhook(w.id); load() }}><Trash2 size={12} aria-hidden="true" /> Delete</button>
          </div>
          {msg[w.id] && <p role="status" className="mt-1 text-xs" data-testid="wh-test-result">{msg[w.id]}</p>}
          {log?.id === w.id && <ul className="mt-2 space-y-1 rounded-lg bg-surface-2/60 p-2 text-xs" data-testid="wh-log">{log.rows.length ? log.rows.map((x) => <li key={String(x.id)} className="flex items-center justify-between gap-2"><span>{String(x.event)} · {String(x.status)} · {x.attempts as number} tries{x.error ? ` · ${String(x.error)}` : ''}</span>{x.status !== 'ok' && <button type="button" onClick={async () => { await platformApi.retryDelivery(String(x.id)); setLog({ id: w.id, rows: await platformApi.deliveries(w.id) }) }} className="inline-flex items-center gap-1 hover:underline"><RefreshCw size={11} aria-hidden="true" /> Retry</button>}</li>) : <li>No deliveries yet.</li>}</ul>}
        </li>
      ))}</ul>
    </Panel>
  )
}

export default function IntegrationsPage() {
  const { ready, user } = useStore()
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?next=/dashboard/integrations" replace />
  if (user.role !== 'shipper' || !user.shipperId) return <Navigate to="/dashboard" replace />
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Company</p><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Integrations</h1>
      <p className="mt-1 max-w-2xl text-text-muted">Reports, accounting, your website and your own systems.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">{['owner', 'finance'].includes(user.staffRole ?? 'owner') && <QuickBooksPanel />}{['owner', 'dispatcher'].includes(user.staffRole ?? 'owner') && <LineConnectionsPanel />}<WeeklyReport /><Currency /><Accounting /><Widget shipperId={user.shipperId} /></div>
      <div className="mt-6"><Webhooks /></div>
    </div></div>
  )
}
