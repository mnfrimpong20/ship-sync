import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Database, Download, Inbox, RefreshCw, ServerCog } from 'lucide-react'
import { siteApi, type AppError, type DbExport, type SystemInfo } from '../lib/site'
import { Pill, fmtDateTime } from './ui'

const errMsg = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)
const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Admin → System: wiring check, error log, nightly exports and the contact inbox. */
export function AdminSystem() {
  return (
    <section className="mt-8" aria-label="System">
      <div className="grid gap-5 lg:grid-cols-2">
        <SystemCard />
        <ExportsCard />
      </div>
      <ErrorsCard />
      <ContactInbox />
    </section>
  )
}

function SystemCard() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { siteApi.system().then(setInfo).catch((e) => setErr(errMsg(e, 'Could not load.'))) }, [])
  const Flag = ({ on, label, warn = false }: { on: boolean; label: string; warn?: boolean }) => <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>{label}</span><Pill tone={on ? 'green' : warn ? 'danger' : 'muted'}>{on ? 'on' : 'off'}</Pill></li>
  return (
    <div className="card-dark p-5" data-testid="admin-system-card">
      <h3 className="flex items-center gap-2 font-semibold"><ServerCog size={16} className="text-gold-deep" aria-hidden="true" /> Wiring</h3>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      {info && (
        <>
          <ul className="mt-3 divide-y divide-border">
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>Database</span><span className={`text-xs ${info.database.startsWith('postgres') ? 'text-text-muted' : 'text-danger'}`}>{info.database}</span></li>
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>Email</span><Pill tone={info.email === 'resend' ? 'green' : 'danger'}>{info.email}</Pill></li>
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>SMS</span><Pill tone={info.sms === 'off' ? 'muted' : 'green'}>{info.sms}</Pill></li>
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>WhatsApp <span className="text-xs text-text-muted">(WHATSAPP_TOKEN + WHATSAPP_PHONE_ID, or TWILIO_WHATSAPP_FROM)</span></span><Pill tone={!info.whatsapp || info.whatsapp === 'off' ? 'muted' : 'green'}>{info.whatsapp ?? 'off'}</Pill></li>
            <Flag on={info.stripe} label="Stripe payments" warn />
            <Flag on={info.ais} label="Live vessel positions (AIS)" />
            <Flag on={info.terminal49} label="Container tracking (Terminal49)" />
            <Flag on={info.contact.email && info.contact.phone} label="Public contact details" warn />
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>Demo shippers in public lists</span><Pill tone={info.demoShippersHidden ? 'green' : 'danger'}>{info.demoShippersHidden ? 'hidden' : 'visible'}</Pill></li>
            <li className="flex items-center justify-between gap-3 py-1.5 text-sm"><span>Demo auto-quotes</span><Pill tone={info.demoAutoQuotes ? 'danger' : 'green'}>{info.demoAutoQuotes ? 'on' : 'off'}</Pill></li>
          </ul>
          <p className="mt-3 text-xs text-text-muted">{info.env} · Node {info.node} · up {Math.round(info.uptimeSec / 3600)}h · {info.users.real} real of {info.users.total} users · {info.shippers.real} real of {info.shippers.total} shippers{info.appUrl ? ` · ${info.appUrl}` : ' · APP_URL not set'}</p>
          {(!info.demoShippersHidden || info.demoAutoQuotes) && <p className="mt-2 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">Before launch set <span className="font-mono text-text">HIDE_DEMO_SHIPPERS=true</span> and <span className="font-mono text-text">DEMO_AUTO_QUOTES=false</span> in your environment.</p>}
        </>
      )}
    </div>
  )
}

function ExportsCard() {
  const [data, setData] = useState<{ exports: DbExport[]; nightly: boolean; hourUtc: number; keep: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => siteApi.exports().then(setData).catch((e) => setErr(errMsg(e, 'Could not load.'))), [])
  useEffect(() => { load() }, [load])
  const run = async () => { setBusy(true); setErr(''); try { await siteApi.runExport(); await load() } catch (e) { setErr(errMsg(e, 'Export failed.')) } finally { setBusy(false) } }
  return (
    <div className="card-dark p-5" data-testid="admin-exports-card">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold"><Database size={16} className="text-gold-deep" aria-hidden="true" /> Database backups</h3>
        <button onClick={run} disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden="true" /> {busy ? 'Exporting…' : 'Export now'}</button>
      </div>
      {data && <p className="mt-2 text-xs text-text-muted">{data.nightly ? `Runs every night at ${String(data.hourUtc).padStart(2, '0')}:00 UTC` : 'Nightly export is off'} · keeps the last {data.keep} · JSON of every table.</p>}
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <ul className="mt-3 divide-y divide-border">
        {data?.exports.map((x) => (
          <li key={x.name} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate font-mono text-xs">{x.name}</span>
            <span className="flex shrink-0 items-center gap-3 text-xs text-text-muted">{kb(x.bytes)}<a href={`/api/admin/exports/${x.name}`} download className="btn-ghost !min-h-8 !px-2.5 text-xs"><Download size={13} aria-hidden="true" /> Download</a></span>
          </li>
        ))}
        {data && data.exports.length === 0 && <li className="py-3 text-sm text-text-muted">No exports yet — the first one runs tonight, or press Export now.</li>}
      </ul>
    </div>
  )
}

function ErrorsCard() {
  const [data, setData] = useState<{ errors: AppError[]; open: number; last24h: number } | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => siteApi.errors(showResolved).then(setData).catch((e) => setErr(errMsg(e, 'Could not load.'))), [showResolved])
  useEffect(() => { load() }, [load])
  const resolve = async (id: string) => { try { await siteApi.resolveError(id); await load() } catch (e) { setErr(errMsg(e, 'Failed.')) } }
  const resolveAll = async () => { try { await siteApi.resolveAllErrors(); await load() } catch (e) { setErr(errMsg(e, 'Failed.')) } }
  return (
    <div className="card-dark mt-5 p-5" data-testid="admin-errors-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className={data && data.open > 0 ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /> Error log {data && <span className="text-xs font-normal text-text-muted">{data.open} open · {data.last24h} in the last 24h</span>}</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" className="h-4 w-4 accent-gold" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
          {data && data.open > 0 && <button onClick={resolveAll} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Check size={13} aria-hidden="true" /> Resolve all</button>}
        </div>
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <ul className="mt-3 divide-y divide-border">
        {data?.errors.map((e) => (
          <li key={e.id} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="min-w-0 flex-1 text-left focus-ring rounded" aria-expanded={open === e.id}>
                <span className="flex flex-wrap items-center gap-2"><Pill tone={e.source === 'client' ? 'sky' : e.source === 'job' ? 'teal' : 'danger'}>{e.source}</Pill><span className="font-mono text-xs text-text-muted">{e.method ? `${e.method} ` : ''}{e.route}</span><span className="text-xs text-text-muted">{fmtDateTime(e.createdAt)}</span>{e.resolvedAt && <Pill tone="muted">resolved</Pill>}</span>
                <span className="mt-1 block break-words">{e.message}</span>
              </button>
              {!e.resolvedAt && <button onClick={() => resolve(e.id)} className="btn-ghost !min-h-8 !px-2.5 text-xs">Resolve</button>}
            </div>
            {open === e.id && e.stack && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-muted">{e.stack}</pre>}
            {open === e.id && e.userAgent && <p className="mt-1 text-[11px] text-text-muted">{e.userAgent}{e.userId ? ` · user ${e.userId}` : ''}</p>}
          </li>
        ))}
        {data && data.errors.length === 0 && <li className="py-3 text-sm text-text-muted">Nothing has failed{showResolved ? '' : ' — or everything is resolved'}. Browser crashes and server 500s show up here automatically.</li>}
      </ul>
    </div>
  )
}

function ContactInbox() {
  const [msgs, setMsgs] = useState<Awaited<ReturnType<typeof siteApi.adminMessages>> | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => siteApi.adminMessages().then(setMsgs).catch((e) => setErr(errMsg(e, 'Could not load.'))), [])
  useEffect(() => { load() }, [load])
  const handled = async (id: string) => { try { await siteApi.handled(id); await load() } catch (e) { setErr(errMsg(e, 'Failed.')) } }
  const open = msgs?.filter((m) => !m.handled) ?? []
  return (
    <div className="card-dark mt-5 p-5" data-testid="admin-contact-card">
      <h3 className="flex items-center gap-2 font-semibold"><Inbox size={16} className="text-gold-deep" aria-hidden="true" /> Contact form inbox {msgs && <span className="text-xs font-normal text-text-muted">{open.length} unanswered</span>}</h3>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <ul className="mt-3 divide-y divide-border">
        {msgs?.slice(0, 50).map((m) => (
          <li key={m.id} className={`py-3 text-sm ${m.handled ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">{m.name} <Pill tone="muted">{m.topic}</Pill> <span className="text-xs font-normal text-text-muted">{fmtDateTime(m.createdAt)}</span></p>
                <p className="text-xs text-text-muted"><a href={`mailto:${m.email}`} className="hover:text-gold-deep">{m.email}</a>{m.phone ? ` · ${m.phone}` : ''}{m.company ? ` · ${m.company}` : ''}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.message}</p>
              </div>
              {!m.handled && <button onClick={() => handled(m.id)} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Check size={13} aria-hidden="true" /> Handled</button>}
            </div>
          </li>
        ))}
        {msgs && msgs.length === 0 && <li className="py-3 text-sm text-text-muted">No messages yet.</li>}
      </ul>
    </div>
  )
}
