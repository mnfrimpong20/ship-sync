import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowLeft, ChevronRight, LifeBuoy, MessageSquare, Plus, Search, Send } from 'lucide-react'
import { AUDIENCES, HELP, searchHelp, type Audience, type HelpArticle } from '../lib/help'
import { supportApi, ticketCategoryLabels, type Ticket, type TicketMessage } from '../lib/support'
import { useStore } from '../lib/store'
import { fadeUp, stagger } from '../lib/motion'
import { fmtDateTime } from '../components/ui'

function Body({ text }: { text: string }) {
  return <>{text.split(/\n\n+/).map((para, i) => { const lines = para.split('\n'); return lines.every((l) => l.startsWith('- ')) ? <ul key={i} className="mt-3 list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul> : <p key={i} className="mt-3">{para}</p> })}</>
}

/** `/help` and `/help/:slug` — searchable articles for senders, receivers and shipping companies. */
export function HelpPage() {
  const { slug } = useParams()
  const [sp, setSp] = useSearchParams()
  const { user } = useStore()
  const q = sp.get('q') ?? ''
  const tab = (sp.get('for') as Audience | null) ?? (user?.role === 'shipper' ? 'shippers' : 'senders')
  const results = useMemo(() => (q ? searchHelp(q) : []), [q])
  const article = slug ? HELP.find((a) => a.slug === slug) : undefined
  if (slug && !article) return <Navigate to="/help" replace />
  const cta = (
    <div className="card-dark mt-10 flex flex-wrap items-center justify-between gap-4 p-6">
      <div><p className="font-semibold">Still stuck?</p><p className="text-sm text-text-muted">{user ? 'Open a ticket and a person at Ntemtem will answer — usually within one business day.' : 'Send us a message and we’ll reply by email, usually within one business day.'}</p></div>
      <Link to={user ? '/support?new=1' : '/contact'} className="btn-gold !min-h-11" data-testid="help-contact"><MessageSquare size={16} aria-hidden="true" /> {user ? 'Open a ticket' : 'Contact us'}</Link>
    </div>
  )
  if (article) return (
    <div className="bg-bg text-text"><div className="container-x max-w-3xl py-10 md:py-14">
      <Link to={`/help?for=${article.audience}`} className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"><ArrowLeft size={15} aria-hidden="true" /> Help centre</Link>
      <article className="mt-4" data-testid="help-article"><h1 className="!text-[clamp(1.8rem,4vw,2.6rem)]">{article.title}</h1><p className="mt-2 text-lg text-text-muted">{article.summary}</p><div className="mt-4 leading-relaxed"><Body text={article.body} /></div>
        {article.links && <div className="mt-6 flex flex-wrap gap-2">{article.links.map((l) => <Link key={l.to} to={l.to} className="btn-ghost !min-h-10 text-sm">{l.label} <ChevronRight size={14} aria-hidden="true" /></Link>)}</div>}</article>
      {cta}
    </div></div>
  )
  const list = (items: HelpArticle[]) => <ul className="mt-4 grid gap-3 md:grid-cols-2">{items.map((a) => <li key={a.slug}><Link to={`/help/${a.slug}`} className="card-dark flex h-full items-start justify-between gap-3 p-5 transition hover:border-gold/60"><span><span className="block font-semibold">{a.title}</span><span className="mt-1 block text-sm text-text-muted">{a.summary}</span></span><ChevronRight size={16} className="mt-1 shrink-0 text-text-muted" aria-hidden="true" /></Link></li>)}</ul>
  return (
    <div className="bg-bg text-text"><motion.div initial="hidden" animate="show" variants={stagger} className="container-x max-w-5xl py-10 md:py-14">
      <motion.p variants={fadeUp} className="eyebrow mb-2">Help centre</motion.p>
      <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.5vw,3rem)]">How can we help?</motion.h1>
      <motion.form variants={fadeUp} role="search" onSubmit={(e) => e.preventDefault()} className="relative mt-6 max-w-2xl">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input type="search" aria-label="Search help" className="input-dark !min-h-12 !pl-11 text-base" placeholder="Search: payment, damaged, GhanaPost GPS, weight…" value={q} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set('q', e.target.value); else n.delete('q'); setSp(n, { replace: true }) }} data-testid="help-search" />
      </motion.form>
      {q ? (
        <motion.section variants={fadeUp} className="mt-8"><h2 className="!text-base text-text-muted">{results.length ? `${results.length} article${results.length === 1 ? '' : 's'}` : 'Nothing matched — try other words, or ask us below.'}</h2>{list(results)}</motion.section>
      ) : (
        <motion.section variants={fadeUp} className="mt-8">
          <div className="flex flex-wrap gap-2" role="tablist">{AUDIENCES.map((a) => <button key={a.key} role="tab" aria-selected={tab === a.key} onClick={() => setSp({ for: a.key }, { replace: true })} className={`rounded-full border px-4 py-2 text-sm ${tab === a.key ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted hover:text-text'}`}>{a.label}</button>)}</div>
          <p className="mt-3 text-sm text-text-muted">{AUDIENCES.find((a) => a.key === tab)?.blurb}</p>
          {list(HELP.filter((a) => a.audience === tab))}
        </motion.section>
      )}
      {cta}
    </motion.div></div>
  )
}

/** `/support` — your tickets with Ntemtem, and the conversation on each. */
export function SupportPage() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [open, setOpen] = useState<{ ticket: Ticket; messages: TicketMessage[] } | null>(null)
  const [form, setForm] = useState({ subject: '', category: 'shipment' as Ticket['category'], shipmentRef: sp.get('ref') ?? '', body: '' })
  const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const tId = sp.get('t'); const creating = sp.get('new') === '1'
  const load = () => supportApi.mine().then(setTickets).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (user) void load() }, [user])
  useEffect(() => { if (tId && user) supportApi.get(tId).then(setOpen).catch(() => setOpen(null)); else setOpen(null) }, [tId, user])
  if (ready && !user) return <Navigate to="/login?next=/support" replace />
  const create = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const t = await supportApi.create(form); await load(); setSp({ t: t.id }); setForm({ subject: '', category: 'shipment', shipmentRef: '', body: '' }) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!open || !reply.trim()) return; setBusy(true); setErr(''); try { const m = await supportApi.reply(open.ticket.id, reply); setOpen({ ticket: { ...open.ticket, status: 'open' }, messages: m }); setReply(''); void load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  const badge = (s: Ticket['status']) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s === 'solved' ? 'bg-teal/15 text-teal' : s === 'waiting' ? 'bg-gold/20 text-gold-deep' : 'bg-sky/15 text-sky'}`}>{s === 'open' ? 'With Ntemtem' : s === 'waiting' ? 'Waiting for you' : 'Solved'}</span>
  return (
    <div className="bg-bg text-text"><div className="container-x max-w-5xl py-10 md:py-14">
      <p className="eyebrow mb-2">Support</p>
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="!text-[clamp(1.8rem,4vw,2.6rem)]">Your support tickets</h1><div className="flex gap-2"><Link to="/help" className="btn-ghost !min-h-10 text-sm"><LifeBuoy size={15} aria-hidden="true" /> Help centre</Link><button onClick={() => setSp({ new: '1' })} className="btn-gold !min-h-10 text-sm" data-testid="new-ticket"><Plus size={15} aria-hidden="true" /> New ticket</button></div></div>
      {err && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{err}</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ul className="space-y-2" aria-label="Tickets">
          {tickets?.length === 0 && <li className="card-dark p-5 text-sm text-text-muted">No tickets yet.</li>}
          {tickets?.map((t) => <li key={t.id}><button onClick={() => setSp({ t: t.id })} className={`card-dark w-full p-4 text-left ${tId === t.id ? '!border-gold' : ''}`}><span className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-text-muted">{t.ref}</span>{badge(t.status)}</span><span className="mt-1 block truncate font-semibold">{t.subject}</span><span className="block text-xs text-text-muted">{ticketCategoryLabels[t.category]}{t.shipmentRef ? ` · ${t.shipmentRef}` : ''} · {t.updatedAt ? fmtDateTime(t.updatedAt) : ''}</span></button></li>)}
        </ul>
        <div>
          {creating ? (
            <form onSubmit={create} className="card-dark grid gap-3 p-6" data-testid="ticket-form">
              <h2 className="!text-lg">What do you need help with?</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm"><span className="text-text-muted">Topic</span><select className="input-dark" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Ticket['category'] })}>{Object.entries(ticketCategoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="grid gap-1 text-sm"><span className="text-text-muted">Shipment reference (optional)</span><input className="input-dark font-mono uppercase" placeholder="NT-…" value={form.shipmentRef} onChange={(e) => setForm({ ...form, shipmentRef: e.target.value })} /></label>
              </div>
              <label className="grid gap-1 text-sm"><span className="text-text-muted">Subject</span><input required minLength={4} className="input-dark" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="ticket-subject" /></label>
              <label className="grid gap-1 text-sm"><span className="text-text-muted">Tell us what happened</span><textarea required minLength={10} rows={6} className="input-dark py-2" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="ticket-body" /></label>
              {form.body.length > 3 && searchHelp(form.subject + ' ' + form.body).slice(0, 2).map((a) => <Link key={a.slug} to={`/help/${a.slug}`} target="_blank" className="text-sm text-gold-deep hover:underline">Might help: {a.title} →</Link>)}
              <div className="flex gap-2"><button type="button" onClick={() => setSp({})} className="btn-ghost">Cancel</button><button disabled={busy} className="btn-gold" data-testid="ticket-send"><Send size={15} aria-hidden="true" /> {busy ? 'Sending…' : 'Send to Ntemtem'}</button></div>
            </form>
          ) : open ? (
            <div className="card-dark p-6" data-testid="ticket-thread">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-xs text-text-muted">{open.ticket.ref}{open.ticket.shipmentRef ? ` · ${open.ticket.shipmentRef}` : ''}</p><h2 className="!text-lg">{open.ticket.subject}</h2></div>{badge(open.ticket.status)}</div>
              <ol className="mt-4 space-y-3">{open.messages.map((m) => <li key={m.id} className={`rounded-xl p-3 text-sm ${m.fromStaff ? 'border border-gold/40 bg-gold/10' : 'bg-surface-2/60'}`}><p className="text-xs text-text-muted"><b className="text-text">{m.authorName}</b> · {m.at ? fmtDateTime(m.at) : ''}</p><p className="mt-1 whitespace-pre-wrap">{m.body}</p></li>)}</ol>
              <form onSubmit={send} className="mt-4 grid gap-2"><textarea rows={3} className="input-dark py-2" placeholder={open.ticket.status === 'solved' ? 'Reply to reopen this ticket' : 'Write a reply'} value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" data-testid="ticket-reply" /><div className="flex flex-wrap gap-2"><button disabled={busy || !reply.trim()} className="btn-gold !min-h-10 text-sm disabled:opacity-60"><Send size={14} aria-hidden="true" /> Send</button>{open.ticket.status !== 'solved' && <button type="button" onClick={async () => { await supportApi.solved(open.ticket.id); setOpen({ ...open, ticket: { ...open.ticket, status: 'solved' } }); void load() }} className="btn-ghost !min-h-10 text-sm">It’s sorted — close it</button>}</div></form>
            </div>
          ) : <div className="card-dark p-8 text-center text-sm text-text-muted">Pick a ticket, or start a new one. Many answers are already in the <Link to="/help" className="text-gold-deep underline underline-offset-2">help centre</Link>.</div>}
        </div>
      </div>
    </div></div>
  )
}
