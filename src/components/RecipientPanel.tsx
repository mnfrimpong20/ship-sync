import { useEffect, useState } from 'react'
import { Check, Copy, MessageSquareText, Phone, Send, UserCheck } from 'lucide-react'
import { receiverLink, recipientApi, recipientKindLabels, waLink, type RecipientInfo, type RecipientKind } from '../lib/recipient'
import { fmtDateTime } from './ui'

/** The receiver's side of a shipment: their link, texts sent, and whether they confirmed receipt. */
export function RecipientPanel({ shipmentId, shipmentRef, status }: { shipmentId: string; shipmentRef: string; status: string }) {
  const [d, setD] = useState<RecipientInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const [kind, setKind] = useState<RecipientKind>('notice')
  const [note, setNote] = useState('')
  const [toast, setToast] = useState('')
  const load = () => recipientApi.forShipment(shipmentId).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  if (error) return <div className="rounded-xl border border-border bg-surface p-4 text-xs text-danger">{error}</div>
  if (!d) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">Loading receiver…</div>
  const link = receiverLink(d.path)
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* blocked */ } }
  const send = async () => { setBusy('send'); setError(''); try { const m = await recipientApi.send(shipmentId, kind, note); await load(); setNote(''); setToast(m.status === 'sent' ? `Sent to ${m.to}.` : m.status === 'skipped' ? 'Logged — no messaging provider configured, so nothing was sent.' : m.status === 'failed' ? `Failed: ${m.error}` : 'Queued.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not send.') } finally { setBusy('') } }
  const intro = `Hi ${d.receiver?.name?.split(' ')[0] ?? ''}, a shipment (${shipmentRef}) is coming to you. Track it and confirm when it arrives: ${link}`
  const wa = waLink(d.receiver?.phoneE164 ?? null, intro)
  const statusTone = (s: string) => s === 'sent' ? 'text-teal' : s === 'failed' ? 'text-danger' : 'text-text-muted'
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="recipient-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><UserCheck size={14} className="text-gold-deep" aria-hidden="true" /> Receiver</p>
        {d.receipt && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.receipt.allGood ? 'bg-teal/15 text-teal' : 'bg-danger/15 text-danger'}`}>{d.receipt.allGood ? 'Confirmed received' : 'Problem reported'}</span>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      <p className="mt-2 text-sm">{d.receiver ? <><strong>{d.receiver.name}</strong>{d.receiver.city ? ` · ${d.receiver.city}` : ''}{d.receiver.phone ? <span className="text-text-muted"> · {d.receiver.phone}</span> : <span className="text-danger"> · no phone number</span>}</> : <span className="text-text-muted">{d.canManage ? 'No consignee on this shipment yet — add one on the client to text them.' : 'Share the link below with whoever is receiving the goods.'}</span>}</p>
      {d.receiver && (d.receiver.gps || d.receiver.address) && <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-muted" data-testid="receiver-address">{d.receiver.address && <span>{d.receiver.address}</span>}{d.receiver.gps && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text" title="GhanaPost GPS digital address">{d.receiver.gps}</span>}{d.receiver.mapUrl && <a href={d.receiver.mapUrl} target="_blank" rel="noopener" className="text-gold-deep hover:underline">Map</a>}</p>}
      {d.receipt && <p className="mt-1.5 text-xs text-text-muted">{d.receipt.allGood ? `${d.receipt.name} confirmed receipt` : `${d.receipt.name} reported a problem`}{d.receipt.at ? ` · ${fmtDateTime(d.receipt.at)}` : ''}{d.receipt.note ? ` — “${d.receipt.note}”` : ''}</p>}
      <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted" title={link}>{link}</span>
        <button onClick={copy} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md focus-ring ${copied ? 'text-teal' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`} aria-label="Copy receiver link">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
        {wa && <a href={wa} target="_blank" rel="noopener" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-teal focus-ring" aria-label="Share on WhatsApp" title="Open WhatsApp with the link"><MessageSquareText size={13} /></a>}
        {d.receiver?.phoneE164 && <a href={`tel:${d.receiver.phoneE164}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label="Call receiver"><Phone size={13} /></a>}
      </div>
      <p className="mt-1.5 text-xs text-text-muted">The receiver opens this on their phone: status, where to collect, and an “I received it” button. No sign-in needed.</p>
      {d.canManage && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <select aria-label="Message" className="input-dark !min-h-8 !w-auto !px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value as RecipientKind)}>{(Object.keys(recipientKindLabels) as RecipientKind[]).filter((k) => k !== 'charge').map((k) => <option key={k} value={k}>{recipientKindLabels[k]}</option>)}</select>
            {(kind === 'ready' || kind === 'reminder') && <input aria-label="Note" className="input-dark !min-h-8 min-w-[140px] flex-1 !px-2 text-xs" placeholder={kind === 'ready' ? 'e.g. Tema warehouse, Mon–Fri 9–5' : 'e.g. closes Friday'} value={note} onChange={(e) => setNote(e.target.value)} />}
            <button onClick={send} disabled={busy === 'send' || !d.receiver?.phoneE164 || status === 'booked' && kind !== 'notice'} className="btn-ghost !min-h-8 !px-2.5 text-xs disabled:opacity-50" title={!d.receiver?.phoneE164 ? 'Add a consignee phone number first' : ''}><Send size={12} aria-hidden="true" /> {busy === 'send' ? 'Sending…' : d.settings?.channel === 'whatsapp' ? 'Send WhatsApp' : 'Send SMS'}</button>
          </div>
          {d.settings && !d.settings.enabled && <p className="mt-1.5 text-xs text-danger">Automatic receiver texts are off for your company (Notifications → Receiver texts). Manual sends still go.</p>}
          {d.settings && d.settings.provider === 'off' && <p className="mt-1.5 text-xs text-text-muted">No SMS provider configured on this server — messages are logged, not delivered. Share the link by WhatsApp above instead.</p>}
          {d.messages.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-border pt-2 text-xs" aria-label="Messages to the receiver">
              {d.messages.map((m) => <li key={m.id} className="flex gap-2"><span className={`shrink-0 font-semibold ${statusTone(m.status)}`}>{m.status === 'sent' ? '✓' : m.status === 'failed' ? '✕' : m.status === 'skipped' ? '–' : '…'}</span><span className="min-w-0 flex-1"><span className="block text-text-muted">{recipientKindLabels[m.kind]} · {m.channel.toUpperCase()} · {m.createdAt ? fmtDateTime(m.createdAt) : ''}{m.status === 'failed' ? ` · ${m.error}` : m.status === 'skipped' ? ' · not sent (no provider)' : ''}</span><span className="block truncate text-text" title={m.text}>{m.text}</span></span></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
