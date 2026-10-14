import { useEffect, useState } from 'react'
import { Check, Copy, Handshake, MessageCircle, Send, X } from 'lucide-react'
import { shipmentOpsApi, type PartnerLink } from '../lib/shipmentOps'
import { fmtDateTime } from './ui'

const linkOf = (p: PartnerLink) => p.url.startsWith('http') ? p.url : `${location.origin}${location.pathname}#${p.path}`

/** Destination agent / partner access to one container: no login, just a link. They get a pre-alert when it sails. */
export function PartnerLinksCard({ containerId, containerRef }: { containerId: string; containerRef: string }) {
  const [list, setList] = useState<PartnerLink[] | null>(null)
  const [f, setF] = useState<{ name: string; email: string; phone: string } | null>(null)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState(''); const [note, setNote] = useState('')
  useEffect(() => { shipmentOpsApi.partners(containerId).then(setList).catch(() => setList([])) }, [containerId])
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!f) return; setBusy('add'); setErr(''); try { const p = await shipmentOpsApi.addPartner(containerId, f); setList((l) => [...(l ?? []), p]); setF(null) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not create the link.') } finally { setBusy('') } }
  const copy = async (p: PartnerLink) => { try { await navigator.clipboard.writeText(linkOf(p)); setCopied(p.id); setTimeout(() => setCopied(''), 1800) } catch { /* blocked */ } }
  const alert = async (p: PartnerLink) => { setBusy(p.id); setErr(''); try { const r = await shipmentOpsApi.preAlert(p.id); setNote(r.sent ? `Pre-alert sent to ${p.email}.` : 'Nothing sent.'); setList(await shipmentOpsApi.partners(containerId)) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy('') } }
  const revoke = async (p: PartnerLink) => { setBusy(p.id); try { await shipmentOpsApi.revokePartner(p.id); setList((l) => (l ?? []).filter((x) => x.id !== p.id)) } finally { setBusy('') } }
  return (
    <section className="card-dark p-5" aria-labelledby="partners-h" data-testid="partner-links">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="partners-h" className="flex items-center gap-2 !text-lg"><Handshake size={18} className="text-gold" aria-hidden="true" /> Destination partner</h2><p className="mt-1 text-sm text-text-muted">Give your agent in {containerRef}’s destination a link — no account. They see the manifest with every recipient, mark customs and unloading, and hand over with the recipient’s code. With an email, they get a pre-alert the moment it sails.</p></div>
        {!f && <button onClick={() => setF({ name: '', email: '', phone: '' })} className="btn-ghost !min-h-9 !px-3 text-xs" data-testid="partner-add">Add partner</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      {note && <p role="status" className="mt-2 text-xs text-teal">{note}</p>}
      {f && (
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input autoFocus required minLength={2} className="input-dark !min-h-9 text-sm" placeholder="Agent or company" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Partner name" data-testid="partner-name" />
          <input type="email" className="input-dark !min-h-9 text-sm" placeholder="Email (for the pre-alert)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Partner email" data-testid="partner-email" />
          <input className="input-dark !min-h-9 text-sm" placeholder="Phone / WhatsApp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="Partner phone" />
          <div className="flex justify-end gap-1.5 sm:col-span-3"><button type="button" onClick={() => setF(null)} className="btn-ghost !min-h-8 !px-2.5 text-xs">Cancel</button><button disabled={busy === 'add'} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="partner-save">Create link</button></div>
        </form>
      )}
      <ul className="mt-3 divide-y divide-border">
        {list?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="partner-row">
            <div className="min-w-0 text-sm"><p className="font-semibold">{p.name}</p><p className="text-xs text-text-muted">{[p.email, p.phone].filter(Boolean).join(' · ') || 'No contact'}{p.preAlertSentAt ? ` · pre-alert ${fmtDateTime(p.preAlertSentAt)}` : ''}{p.lastSeenAt ? ` · opened ${fmtDateTime(p.lastSeenAt)}` : ' · not opened yet'}</p></div>
            <div className="flex gap-1">
              <button onClick={() => copy(p)} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="partner-copy">{copied === p.id ? <><Check size={12} aria-hidden="true" /> Copied</> : <><Copy size={12} aria-hidden="true" /> Copy link</>}</button>
              {p.phone && <a href={`https://wa.me/${p.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Manifest for ${containerRef}: ${linkOf(p)}`)}`} target="_blank" rel="noopener" className="btn-ghost !min-h-8 !px-2.5 text-xs"><MessageCircle size={12} aria-hidden="true" /> WhatsApp</a>}
              {p.email && <button onClick={() => alert(p)} disabled={busy === p.id} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Send size={12} aria-hidden="true" /> Send pre-alert</button>}
              <button onClick={() => revoke(p)} disabled={busy === p.id} className="btn-ghost !min-h-8 !px-2 text-xs text-danger" aria-label={`Switch off ${p.name}’s link`}><X size={12} /></button>
            </div>
          </li>
        ))}
        {list && list.length === 0 && !f && <li className="py-3 text-sm text-text-muted">No partner yet.</li>}
      </ul>
    </section>
  )
}
