import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, Lock, Send, Timer } from 'lucide-react'
import { supportApi, ticketCategoryLabels, type Ticket, type TicketMessage } from '../lib/support'
import { StatCard } from './board'
import { fmtDateTime } from './ui'

const ago = (iso: string | null) => { if (!iso) return ''; const h = (Date.now() - new Date(iso).getTime()) / 3600_000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days` }

/** Admin: the support inbox — tickets waiting on Ntemtem first, replies, internal notes, status. */
export function AdminTickets() {
  const [sp, setSp] = useSearchParams()
  const [filter, setFilter] = useState<'active' | 'solved' | 'all'>('active')
  const [d, setD] = useState<Awaited<ReturnType<typeof supportApi.adminList>> | null>(null)
  const [open, setOpen] = useState<{ ticket: Ticket; messages: TicketMessage[]; recentShipments: { ref: string; status: string; origin: string; destination: string }[] } | null>(null)
  const [body, setBody] = useState(''); const [internal, setInternal] = useState(false); const [solve, setSolve] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const tId = sp.get('t')
  const load = () => supportApi.adminList(filter).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tId) supportApi.adminGet(tId).then(setOpen).catch(() => setOpen(null)); else setOpen(null) }, [tId])
  const pick = (id: string) => { const n = new URLSearchParams(sp); n.set('t', id); setSp(n, { replace: true }) }
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!open || !body.trim()) return; setBusy(true); setErr('')
    try { const r = await supportApi.adminReply(open.ticket.id, { body, internal, status: solve ? 'solved' : undefined }); setOpen({ ...open, ...r }); setBody(''); setInternal(false); setSolve(false); void load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) }
  }
  const waiting = (t: Ticket) => t.status === 'open' && t.lastFrom === 'person'
  return (
    <section className="mt-10" data-testid="admin-tickets">
      {d && <div className="grid grid-cols-2 gap-4 md:grid-cols-4"><StatCard icon={Clock} label="Waiting on us" value={String(d.stats.open)} warn={d.stats.open > 0} /><StatCard icon={Send} label="Waiting on the person" value={String(d.stats.waiting)} /><StatCard icon={CheckCircle2} label="Solved this week" value={String(d.stats.solved7)} /><StatCard icon={Timer} label="First reply (30 days)" value={d.stats.firstResponseHours ? `${d.stats.firstResponseHours} h avg` : '—'} /></div>}
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div>
          <div className="mb-3 inline-flex rounded-full border border-border p-0.5 text-xs">{(['active', 'solved', 'all'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 capitalize ${filter === f ? 'bg-gold text-[#14213D]' : 'text-text-muted'}`}>{f === 'active' ? 'Open' : f}</button>)}</div>
          <ul className="space-y-2">
            {d?.tickets.length === 0 && <li className="card-dark p-5 text-sm text-text-muted">Inbox zero.</li>}
            {d?.tickets.map((t) => <li key={t.id}><button onClick={() => pick(t.id)} className={`card-dark w-full p-4 text-left ${tId === t.id ? '!border-gold' : ''}`}>
              <span className="flex items-center justify-between gap-2 text-xs"><span className="font-mono text-text-muted">{t.ref}</span>{waiting(t) ? <span className="inline-flex items-center gap-1 font-semibold text-danger"><Clock size={11} aria-hidden="true" /> {ago(t.updatedAt)}</span> : <span className="text-text-muted">{t.status === 'waiting' ? 'waiting on them' : t.status}</span>}</span>
              <span className="mt-1 block truncate font-semibold">{t.priority === 'high' && <span className="mr-1 text-danger">●</span>}{t.subject}</span>
              <span className="block truncate text-xs text-text-muted">{t.name} · {t.role}{t.source === 'contact' ? ' · contact form' : ''} · {ticketCategoryLabels[t.category]}{t.shipmentRef ? ` · ${t.shipmentRef}` : ''}</span>
            </button></li>)}
          </ul>
        </div>
        {open ? (
          <div className="card-dark p-6" data-testid="admin-ticket">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-mono text-xs text-text-muted">{open.ticket.ref} · opened {open.ticket.createdAt ? fmtDateTime(open.ticket.createdAt) : ''}</p><h2 className="!text-lg">{open.ticket.subject}</h2><p className="text-sm text-text-muted">{open.ticket.name} · {open.ticket.email || 'no email'} · {open.ticket.role}{open.ticket.assignedTo ? ` · with ${open.ticket.assignedTo}` : ''}</p></div>
              <div className="flex gap-1.5">
                <select aria-label="Priority" className="input-dark !min-h-8 !w-auto !px-2 text-xs" value={open.ticket.priority} onChange={async (e) => { const p = e.target.value as Ticket['priority']; await supportApi.adminPatch(open.ticket.id, { priority: p }); setOpen({ ...open, ticket: { ...open.ticket, priority: p } }); void load() }}><option value="normal">Normal</option><option value="high">High</option></select>
                <select aria-label="Status" className="input-dark !min-h-8 !w-auto !px-2 text-xs" value={open.ticket.status} onChange={async (e) => { const s = e.target.value as Ticket['status']; await supportApi.adminPatch(open.ticket.id, { status: s }); setOpen({ ...open, ticket: { ...open.ticket, status: s } }); void load() }}><option value="open">Open</option><option value="waiting">Waiting on them</option><option value="solved">Solved</option></select>
              </div>
            </div>
            {open.recentShipments.length > 0 && <p className="mt-2 text-xs text-text-muted">Their shipments: {open.recentShipments.map((s) => `${s.ref} (${s.status.replace(/_/g, ' ')})`).join(' · ')}</p>}
            <ol className="mt-4 space-y-3">{open.messages.map((m) => <li key={m.id} className={`rounded-xl p-3 text-sm ${m.internal ? 'border border-dashed border-border bg-surface-2/40' : m.fromStaff ? 'border border-gold/40 bg-gold/10' : 'bg-surface-2/60'}`}><p className="text-xs text-text-muted">{m.internal && <Lock size={11} className="mr-1 inline" aria-label="Internal note" />}<b className="text-text">{m.authorName}</b>{m.internal ? ' · internal note' : ''} · {m.at ? fmtDateTime(m.at) : ''}</p><p className="mt-1 whitespace-pre-wrap">{m.body}</p></li>)}</ol>
            <form onSubmit={send} className="mt-4 grid gap-2">
              <textarea rows={4} className="input-dark py-2" placeholder={internal ? 'Note for the team (not sent)' : open.ticket.source === 'contact' ? 'Reply — sent by email' : 'Reply — they get a notification and email'} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" data-testid="admin-reply" />
              <div className="flex flex-wrap items-center gap-3 text-xs"><label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-gold" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>{!internal && <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-gold" checked={solve} onChange={(e) => setSolve(e.target.checked)} /> Mark solved</label>}<button disabled={busy || !body.trim()} className="btn-gold ml-auto !min-h-9 text-sm disabled:opacity-60" data-testid="admin-send"><Send size={14} aria-hidden="true" /> {internal ? 'Save note' : 'Send reply'}</button></div>
            </form>
          </div>
        ) : <div className="card-dark p-8 text-center text-sm text-text-muted">Pick a ticket.</div>}
      </div>
    </section>
  )
}
