/** Per-shipment panels shared by the customer and the office: what happens next, packing list, family share, duty, messages. */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, ClipboardList, Copy, Landmark, MessageCircle, Plus, Send, Share2, Trash2 } from 'lucide-react'
import { hubApi, readImage, type Item, type Message } from '../lib/customerHub'
import { fmtDate, fmtDateTime, money } from './ui'

const card = 'rounded-xl border border-border bg-surface p-4'
const cls = 'input-dark !min-h-9 text-sm'
const CAT: Record<string, string> = { clothing: 'Clothing', shoes: 'Shoes', food: 'Food', toiletries: 'Toiletries', household: 'Household', electronics: 'Electronics', kitchen: 'Kitchen', books: 'Books', toys: 'Toys', medicine: 'Medicine', building: 'Building materials', auto_parts: 'Auto parts', other: 'Other' }

export function NextStep({ shipmentId }: { shipmentId: string }) {
  const [t, setT] = useState<Awaited<ReturnType<typeof hubApi.timeline>> | null>(null)
  useEffect(() => { hubApi.timeline(shipmentId).then(setT).catch(() => setT(null)) }, [shipmentId])
  if (!t) return null
  return (
    <div className={card} data-testid="next-step">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Now</p>
      <p className="mt-0.5 font-semibold">{t.next.title}</p>
      <p className="mt-1 text-sm text-text-muted">{t.next.body}</p>
      {t.next.you && <p className="mt-2 rounded-lg bg-gold/10 px-3 py-2 text-sm"><b>Your part:</b> {t.next.you}</p>}
      {t.slipDays !== 0 && t.eta && <p className={`mt-3 inline-flex items-center gap-1.5 text-sm ${t.slipDays > 0 ? 'text-danger' : 'text-teal'}`} data-testid="eta-slip"><AlertTriangle size={14} aria-hidden="true" /> Arrival {t.slipDays > 0 ? `${t.slipDays} days later` : `${-t.slipDays} days earlier`} than first promised ({t.etaOriginal ? fmtDate(t.etaOriginal + 'T12:00:00Z') : '—'} → {fmtDate(t.eta + 'T12:00:00Z')})</p>}
      {t.etaChanges.length > 0 && <ul className="mt-2 space-y-1 text-xs text-text-muted" data-testid="eta-history">{t.etaChanges.map((c, i) => <li key={i}>{fmtDate(c.at)}: new date {c.to}{c.from ? ` (was ${c.from})` : ''} — {c.reason}</li>)}</ul>}
    </div>
  )
}

export function PackingList({ shipmentId, destination }: { shipmentId: string; destination: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hubApi.items>> | null>(null); const [f, setF] = useState({ description: '', category: 'clothing', qty: '1', valueUsd: '' }); const [err, setErr] = useState(''); const [rules, setRules] = useState<{ level: string; note: string }[] | null>(null)
  const load = () => hubApi.items(shipmentId).then(setD).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [shipmentId])
  if (!d) return null
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); try { await hubApi.addItems(shipmentId, [{ description: f.description, category: f.category, qty: Number(f.qty) || 1, valueUsd: Number(f.valueUsd) || 0 }]); setF({ ...f, description: '', valueUsd: '' }); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not add.') } }
  return (
    <div className={card} data-testid="packing-list">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="inline-flex items-center gap-1.5 font-semibold"><ClipboardList size={15} aria-hidden="true" /> What’s inside</p><p className="text-xs text-text-muted">{d.items.length} line{d.items.length === 1 ? '' : 's'} · declared {money(d.totalValueUsd)}</p></div>
      <p className="mt-1 text-xs text-text-muted">Used for customs, insurance and the packing list. Be honest about values — under-declaring can mean fines at the port.</p>
      {d.items.length > 0 && <ul className="mt-3 divide-y divide-border text-sm">{d.items.map((i: Item) => (
        <li key={i.id} className="flex items-start justify-between gap-2 py-1.5" data-testid="item-row">
          <span className="min-w-0"><b>{i.qty} ×</b> {i.description} <span className="text-xs text-text-muted">· {CAT[i.category] ?? i.category}</span>{i.flag && <span className={`mt-0.5 block text-xs ${i.flag.level === 'banned' ? 'text-danger' : 'text-gold-deep'}`} data-testid="item-flag">{i.flag.level === 'banned' ? 'Not allowed: ' : i.flag.level === 'restricted' ? 'Restricted: ' : 'Check: '}{i.flag.note}</span>}</span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums">{money(i.valueUsd * i.qty)}{d.canEdit && <button type="button" aria-label={`Remove ${i.description}`} onClick={async () => { await hubApi.deleteItem(i.id); load() }} className="text-text-muted hover:text-danger"><Trash2 size={13} aria-hidden="true" /></button>}</span>
        </li>
      ))}</ul>}
      {d.canEdit ? (
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_4rem_6rem_auto]">
          <input required minLength={2} placeholder="e.g. Children’s school uniforms" className={cls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Item" data-testid="item-desc" />
          <select className={cls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category">{d.categories.map((c) => <option key={c} value={c}>{CAT[c] ?? c}</option>)}</select>
          <input type="number" min={1} className={cls} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} aria-label="Quantity" />
          <input type="number" min={0} step="0.01" placeholder="$ each" className={cls} value={f.valueUsd} onChange={(e) => setF({ ...f, valueUsd: e.target.value })} aria-label="Value each (USD)" data-testid="item-value" />
          <button className="btn-gold !min-h-9 !px-3 text-sm" data-testid="item-add"><Plus size={14} aria-hidden="true" /> Add</button>
        </form>
      ) : <p className="mt-2 text-xs text-text-muted">The list is locked now the goods have left the warehouse.</p>}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <button type="button" onClick={async () => setRules(rules ? null : (await hubApi.restricted(destination)).rules)} className="mt-2 text-xs text-gold-deep hover:underline">{rules ? 'Hide' : 'What can’t I send?'}</button>
      {rules && <ul className="mt-1 space-y-0.5 text-xs text-text-muted">{rules.map((r, i) => <li key={i}><b className={r.level === 'banned' ? 'text-danger' : ''}>{r.level}</b> — {r.note}</li>)}</ul>}
    </div>
  )
}

export function FamilyShare({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hubApi.family>> | null>(null); const [copied, setCopied] = useState(false)
  useEffect(() => { hubApi.family(shipmentId).then(setD).catch(() => setD(null)) }, [shipmentId])
  if (!d) return null
  return (
    <div className={card} data-testid="family-share">
      <p className="inline-flex items-center gap-1.5 font-semibold"><Share2 size={15} aria-hidden="true" /> Tell {d.recipient?.name?.split(' ')[0] ?? 'your recipient'}</p>
      <p className="mt-1 text-sm text-text-muted">They get a link to follow the shipment{d.code ? ' and the collection code' : ''} — no account needed.</p>
      {d.code && <p className="mt-2 text-sm">Collection code: <b className="font-mono text-lg tracking-widest" data-testid="collection-code">{d.code}</b></p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={d.whatsapp} target="_blank" rel="noreferrer" className="btn-gold !min-h-9 text-sm" data-testid="share-whatsapp"><MessageCircle size={14} aria-hidden="true" /> Send on WhatsApp</a>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(d.text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }} className="btn-ghost !min-h-9 text-sm">{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} Copy message</button>
      </div>
      {d.receipt ? <p className="mt-3 rounded-lg bg-teal/10 px-3 py-2 text-sm text-teal" data-testid="receipt-confirmed"><Check size={14} className="mr-1 inline" aria-hidden="true" />{d.receipt.name} confirmed they received it {fmtDate(d.receipt.at)}{d.receipt.allGood ? ' — all good' : ` — “${d.receipt.note}”`}</p> : <p className="mt-3 text-xs text-text-muted">You’ll see here when they confirm they received it.</p>}
    </div>
  )
}

export function DutyEarly({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hubApi.duty>> | null>(null)
  useEffect(() => { hubApi.duty(shipmentId).then(setD).catch(() => setD(null)) }, [shipmentId])
  if (!d || !d.supported) return null
  const conf = d.confirmed as { amountLocal?: number; currency?: string; paid?: boolean } | null
  return (
    <div className={card} data-testid="duty-early">
      <p className="inline-flex items-center gap-1.5 font-semibold"><Landmark size={15} aria-hidden="true" /> Duty at destination</p>
      {conf?.amountLocal ? <p className="mt-1 text-sm">Customs assessed <b>{conf.currency} {Math.round(conf.amountLocal).toLocaleString()}</b>{conf.paid ? ' — paid.' : ' — pay it to release your goods.'}</p>
        : d.estimate ? <><p className="mt-1 text-sm">Estimated <b data-testid="duty-early-estimate">{d.estimate.currency} {d.estimate.local.toLocaleString()}</b> (about {money(d.estimate.usd)}), from your {d.estimate.basis} of {money(d.valueUsd)}.</p><p className="mt-1 text-xs text-text-muted">An estimate only — customs sets the final amount on arrival.</p></>
        : <p className="mt-1 text-sm text-text-muted">{d.valueUsd > 0 ? `At ${money(d.valueUsd)} declared, expect little or no duty — customs has the final say.` : 'Add what’s inside with values to see an estimate.'}</p>}
    </div>
  )
}

export function ShipmentChat({ shipmentId, office = false }: { shipmentId: string; office?: boolean }) {
  const [list, setList] = useState<Message[] | null>(null); const [text, setText] = useState(''); const [photo, setPhoto] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const fileRef = useRef<HTMLInputElement>(null)
  const load = () => hubApi.shipmentMessages(shipmentId).then(setList).catch(() => setList([]))
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr(''); try { await hubApi.sendShipmentMessage(shipmentId, text.trim(), photo ?? undefined); setText(''); setPhoto(null); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not send.') } finally { setBusy(false) } }
  return (
    <div className={card} data-testid="shipment-chat">
      <p className="inline-flex items-center gap-1.5 font-semibold"><MessageCircle size={15} aria-hidden="true" /> {office ? 'Messages with the client' : 'Messages with your shipper'}</p>
      <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">{(list ?? []).map((m) => <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.mine ? 'ml-auto bg-gold/15' : 'bg-surface-2'}`} data-testid="chat-msg"><p className="whitespace-pre-wrap">{m.body}</p>{m.photo && <img src={m.photo} alt="Attached" className="mt-1.5 max-h-40 rounded" />}<p className="mt-0.5 text-[11px] text-text-muted">{m.author} · {fmtDateTime(m.at)}</p></li>)}{list && !list.length && <li className="text-sm text-text-muted">No messages yet.</li>}</ul>
      <form onSubmit={send} className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" className={`${cls} flex-1`} aria-label="Message" data-testid="chat-input" />
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { setPhoto(await readImage(f)) } catch (x) { setErr(x instanceof Error ? x.message : 'Bad photo') } }} />
        <button type="button" onClick={() => fileRef.current?.click()} className={`btn-ghost !min-h-9 !px-2.5 ${photo ? 'text-teal' : ''}`} aria-label="Attach a photo"><Camera size={15} aria-hidden="true" /></button>
        <button disabled={busy} className="btn-gold !min-h-9 !px-3" aria-label="Send" data-testid="chat-send"><Send size={14} aria-hidden="true" /></button>
      </form>
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  )
}
