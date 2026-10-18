/** Customer dashboard tabs: Money, This week, Inbox, Documents, Saved (favourites · repeats · alerts), Issues, Account. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Bell, CalendarDays, CreditCard, Download, FileText, Gift, Heart, MessageCircle, PiggyBank, Plus, Repeat, Send, Ship, Trash2, Users, Wallet } from 'lucide-react'
import { hubApi, statementUrl, type Balance, type CalEvent, type OpenInvoice, type Spending, type Thread } from '../lib/customerHub'
import { useStore } from '../lib/store'
import { accountApi, type Device, type Profile } from '../lib/account'
import { cargoLabel, countries, countryByCode, type CargoType } from '../lib/data'
import { fmtDate, fmtDateTime, money } from './ui'
import { C, HBars, NoData, Panel, Stat, Trend } from './Charts'
import { MessageThread } from './RequestPanel'
import { ShipmentChat } from './ShipmentExtras'

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>
const cls = 'input-dark !min-h-10 text-sm'
const Err = ({ e }: { e: string }) => (e ? <p role="alert" className="mt-2 text-sm text-danger">{e}</p> : null)

/* ============================== Money ============================== */
export function MoneyTab() {
  const [sp, setSp] = useSearchParams()
  const [s, setS] = useState<Spending | null>(null); const [year, setYear] = useState<number | undefined>(); const [b, setB] = useState<Balance | null>(null)
  const [amt, setAmt] = useState<Record<string, string>>({}); const [pick, setPick] = useState<Set<string>>(new Set()); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const loadB = () => hubApi.balance().then((x) => { setB(x); setPick(new Set(x.invoices.map((i) => i.id))); setAmt(Object.fromEntries(x.invoices.map((i) => [i.id, String(i.balance)]))) }).catch((e) => setErr(e.message))
  useEffect(() => { hubApi.spending(year).then(setS).catch((e) => setErr(e.message)) }, [year])
  useEffect(() => {
    const session = sp.get('session')
    if (session) hubApi.verifyPay(session).then((r) => setOk(r.paid ? `Payment received — ${money(r.amount)} across ${r.invoices} invoice${r.invoices === 1 ? '' : 's'}.` : 'Payment still processing.')).catch((e) => setErr(e.message)).finally(() => { const n = new URLSearchParams(sp); n.delete('session'); setSp(n, { replace: true }); void loadB() })
    else void loadB()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => (b?.invoices ?? []).filter((i) => pick.has(i.id)).map((i) => ({ invoiceId: i.id, amountUsd: Math.min(i.balance, Number(amt[i.id]) || 0) })).filter((x) => x.amountUsd > 0), [b, pick, amt])
  const total = chosen.reduce((a, x) => a + x.amountUsd, 0); const credit = Math.min(b?.credit ?? 0, Math.max(0, total - 1))
  const pay = async () => { setBusy(true); setErr(''); try { const r = await hubApi.pay(chosen); window.location.href = r.url } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start payment.'); setBusy(false) } }
  const split = async (i: OpenInvoice, n: number) => { setErr(''); try { await hubApi.plan(i.id, n); setOk(`${i.number} split into ${n} instalments.`); loadB() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }
  return (
    <div className="mt-6 space-y-6" data-testid="money-tab">
      {ok && <p role="status" className="rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal" data-testid="money-ok">{ok}</p>}<Err e={err} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="You owe" value={money(b?.total ?? 0)} icon={Wallet} hint={b?.overdue ? `${money(b.overdue)} overdue` : 'Nothing overdue'} tone={b?.overdue ? 'bad' : undefined} testid="owe" />
        <Stat label={`Spent in ${s?.year ?? ''}`} value={money(s?.total ?? 0)} icon={CreditCard} hint={s ? `${s.shipments} shipments · ${s.prevTotal ? `${money(s.prevTotal)} the year before` : 'first year'}` : undefined} />
        <Stat label="Saved by comparing" value={money(s?.saved ?? 0)} icon={PiggyBank} hint={s?.comparedBookings ? `vs the typical other quote on ${s.comparedBookings} booking${s.comparedBookings === 1 ? '' : 's'}` : 'when several shippers quote'} testid="saved" />
        <Stat label="Credit" value={money(b?.credit ?? 0)} icon={Gift} hint="comes off your next online payment" />
      </div>
      <Panel title="Pay what you owe" sub="Every open invoice across your shippers, in one checkout. Change an amount to pay part now." testid="pay-panel">
        {b?.invoices.length ? <>
          <ul className="divide-y divide-border text-sm">{b.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="owe-row">
              <input type="checkbox" checked={pick.has(i.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPick(n) }} aria-label={`Pay ${i.number}`} />
              <span className="min-w-0 flex-1"><b>{i.number}</b> · {i.shipper}{i.shipmentRef ? ` · ${i.shipmentRef}` : ''}<span className={`block text-xs ${i.overdue ? 'text-danger' : 'text-text-muted'}`}>{money(i.balance)} left of {money(i.total)}{i.dueAt ? ` · due ${fmtDate(i.dueAt + 'T12:00:00Z')}` : ''}{i.overdue ? ' · overdue' : ''}</span>
                {i.plan && <span className="block text-xs text-text-muted" data-testid="plan">Instalments: {i.plan.parts.map((p) => `${money(p.amount)} by ${fmtDate(p.due + 'T12:00:00Z')}`).join(' · ')} <button type="button" className="ml-1 underline" onClick={async () => { await hubApi.dropPlan(i.id); loadB() }}>cancel plan</button></span>}
                {!i.plan && i.balance >= 40 && <span className="block text-xs">Split into <button type="button" className="text-gold-deep underline" onClick={() => split(i, 2)} data-testid="split-2">2</button> · <button type="button" className="text-gold-deep underline" onClick={() => split(i, 3)}>3</button> · <button type="button" className="text-gold-deep underline" onClick={() => split(i, 4)}>4</button> payments</span>}
              </span>
              <label className="flex items-center gap-1 text-sm">$<input type="number" min={1} step="0.01" max={i.balance} className={`${cls} !w-28`} value={amt[i.id] ?? ''} onChange={(e) => setAmt({ ...amt, [i.id]: e.target.value })} aria-label={`Amount for ${i.number}`} data-testid="owe-amount" /></label>
            </li>
          ))}</ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-sm">Paying <b>{money(total)}</b>{credit > 0 ? <> · credit −{money(credit)} · card <b>{money(total - credit)}</b></> : null}</p>
            {b.online ? <button type="button" disabled={busy || !chosen.length} onClick={pay} className="btn-gold !min-h-10" data-testid="pay-all"><CreditCard size={15} aria-hidden="true" /> {busy ? 'Opening checkout…' : `Pay ${money(total - credit)}`}</button> : <p className="text-sm text-text-muted">Online payment isn’t switched on — pay your shippers directly.</p>}
          </div>
        </> : <NoData>Nothing to pay right now.</NoData>}
      </Panel>
      {s && <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={`Spending in ${s.year}`} actions={<select value={s.year} onChange={(e) => setYear(Number(e.target.value))} className={`${cls} !w-auto`} aria-label="Year">{s.years.map((y) => <option key={y} value={y}>{y}</option>)}</select>}>
          {s.total > 0 ? <Trend data={s.months} bucket="month" label="Spent per month" format={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)} series={[{ key: 'spent', label: 'Spent', color: C.focus }]} /> : <NoData>No spending in {s.year} yet. Once a shipper invoices you, your month-by-month spending shows here.</NoData>}
        </Panel>
        <Panel title="Where it went">{s.byDestination.length ? <HBars label="Spent by destination" rows={s.byDestination.map((x) => ({ label: x.label, value: x.amount, display: money(x.amount) }))} /> : <NoData>No invoices this year.</NoData>}
          {s.perUnit.length > 0 && <div className="mt-4 border-t border-border pt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Average cost</p><ul className="space-y-1 text-sm" data-testid="per-unit">{s.perUnit.map((u) => <li key={u.cargo} className="flex justify-between"><span>{cargoLabel(u.cargo as CargoType)}</span><span><b>{money(u.avg)}</b> <span className="text-xs text-text-muted">each · {u.units}</span></span></li>)}</ul></div>}
        </Panel>
      </div>}
      {s && <Panel title="Statements" sub="For your records, taxes or your company’s accounts.">
        <div className="flex flex-wrap gap-2 text-sm"><a href={statementUrl({ year: s.year, format: 'html' })} target="_blank" rel="noreferrer" className="btn-ghost !min-h-10" data-testid="statement-year"><FileText size={14} aria-hidden="true" /> {s.year} statement</a><a href={statementUrl({ year: s.year, format: 'csv' })} className="btn-ghost !min-h-10"><Download size={14} aria-hidden="true" /> {s.year} as CSV</a>
          {s.months.filter((m) => m.spent > 0).slice(-3).reverse().map((m) => <a key={m.start} href={statementUrl({ month: m.start.slice(0, 7), format: 'html' })} target="_blank" rel="noreferrer" className="btn-ghost !min-h-10">{new Date(m.start + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long' })}</a>)}</div>
        {b?.history.length ? <ul className="mt-4 divide-y divide-border text-sm">{b.history.slice(0, 8).map((h, i) => <li key={i} className="flex justify-between py-1.5"><span>{h.number} · {h.shipper}</span><span className="tabular-nums">{money(h.amount)} <span className="text-xs text-text-muted">{h.method} · {h.at}</span></span></li>)}</ul> : null}
      </Panel>}
    </div>
  )
}

/* ============================== This week ============================== */
const KIND_ICON: Record<string, typeof Ship> = { pickup: Ship, arrival: Ship, cutoff: AlertTriangle, collection: Bell, payment: Wallet, departure: Ship, repeat: Repeat }
export function WeekTab() {
  const [days, setDays] = useState(14); const [ev, setEv] = useState<CalEvent[] | null>(null)
  useEffect(() => { hubApi.calendar(days).then((r) => setEv(r.events)).catch(() => setEv([])) }, [days])
  const groups = useMemo(() => { const m = new Map<string, CalEvent[]>(); for (const e of ev ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]); return [...m] }, [ev])
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="mt-6" data-testid="week-tab">
      <div className="mb-4 flex items-center justify-between"><p className="text-sm text-text-muted">Pickups, cutoffs, arrivals, payments and collection days.</p><div role="radiogroup" className="flex rounded-xl border border-border bg-surface p-1">{[7, 14, 30, 60].map((n) => <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)} className={`rounded-lg px-3 py-1 text-sm focus-ring ${days === n ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted'}`}>{n} d</button>)}</div></div>
      {!ev ? <NoData>Loading…</NoData> : !groups.length ? <NoData>Nothing scheduled in the next {days} days.</NoData> : (
        <ol className="space-y-4">{groups.map(([date, list]) => (
          <li key={date} className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <p className={`text-sm font-semibold ${date === today ? 'text-gold-deep' : ''}`}>{date === today ? 'Today' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <ul className="space-y-2">{list.map((e, i) => { const I = KIND_ICON[e.kind] ?? CalendarDays; return <li key={i}><Link to={e.link} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 hover:border-gold/50" data-testid="cal-event"><I size={16} className={`mt-0.5 shrink-0 ${e.kind === 'payment' || e.kind === 'cutoff' ? 'text-danger' : 'text-gold-deep'}`} aria-hidden="true" /><span className="min-w-0"><b className="block text-sm">{e.title}</b>{e.body && <span className="text-xs text-text-muted">{e.body}</span>}</span></Link></li> })}</ul>
          </li>
        ))}</ol>
      )}
    </div>
  )
}

/* ============================== Inbox ============================== */
export function InboxTab() {
  const [sp] = useSearchParams(); const [d, setD] = useState<{ threads: Thread[]; unread: number } | null>(null); const [open, setOpen] = useState<string | null>(sp.get('s'))
  const load = () => hubApi.inbox().then(setD).catch(() => setD({ threads: [], unread: 0 }))
  useEffect(() => { void load() }, [])
  const t = d?.threads.find((x) => x.id === open)
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-testid="inbox-tab">
      <Panel title="Conversations" sub={d ? `${d.unread} unread` : undefined}>
        {d?.threads.length ? <ul className="divide-y divide-border">{d.threads.map((x) => <li key={x.id}><button type="button" onClick={() => { setOpen(x.id); setTimeout(load, 800) }} className={`w-full py-3 text-left text-sm focus-ring ${open === x.id ? 'text-gold-deep' : ''}`} data-testid="thread"><span className="flex items-center justify-between gap-2"><b>{x.shipper} · {x.ref}</b>{x.unread > 0 && <span className="rounded-full bg-gold px-1.5 text-[11px] font-bold text-on-accent">{x.unread}</span>}</span><span className="block truncate text-xs text-text-muted">{x.kind === 'request' ? 'Before booking · ' : ''}{x.last}</span><span className="text-[11px] text-text-muted">{fmtDateTime(x.lastAt)}</span></button></li>)}</ul> : <NoData>No messages yet. Ask a shipper a question from a quote, or message them from a shipment.</NoData>}
      </Panel>
      <div>{t ? (t.kind === 'request' ? <Panel title={`${t.shipper} · ${t.ref}`}><MessageThread requestId={t.requestId!} shipperId={t.shipperId} /></Panel> : <ShipmentChat shipmentId={t.shipmentId!} />) : open && open.length > 6 && !t ? <ShipmentChat shipmentId={open} /> : <NoData>Pick a conversation.</NoData>}</div>
    </div>
  )
}

/* ============================== Documents ============================== */
const DOC_KIND: Record<string, string> = { invoice: 'Invoice', receipt: 'Receipt', packing_list: 'Packing list', commercial_invoice: 'Commercial invoice', pod: 'Proof of delivery', bol: 'Bill of lading', insurance: 'Insurance certificate', photo: 'Photo', other: 'Document' }
export function DocumentsTab() {
  const [d, setD] = useState<Awaited<ReturnType<typeof hubApi.documents>> | null>(null); const [q, setQ] = useState('')
  useEffect(() => { hubApi.documents().then(setD).catch(() => setD({ documents: [], invoices: [] })) }, [])
  const docs = (d?.documents ?? []).filter((x) => !q || `${x.title} ${x.shipmentRef} ${x.shipper}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="mt-6 space-y-6" data-testid="documents-tab">
      <div className="flex flex-wrap items-center justify-between gap-3"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents" className={`${cls} max-w-xs`} aria-label="Search documents" /><a href="/api/me/documents.zip" className="btn-gold !min-h-10" data-testid="docs-zip"><Download size={15} aria-hidden="true" /> Download everything (.zip)</a></div>
      <Panel title="Shipment documents" sub={d ? `${d.documents.length} documents` : undefined}>{docs.length ? <ul className="divide-y divide-border text-sm">{docs.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="doc-row"><span><b>{x.title}</b><span className="block text-xs text-text-muted">{DOC_KIND[x.kind] ?? x.kind} · {x.shipmentRef} · {x.shipper} · {fmtDate(x.createdAt)}</span></span><Link to={`/dashboard/documents/${x.id}`} className="text-sm font-semibold text-gold-deep hover:underline">Open</Link></li>)}</ul> : <NoData>No documents yet.</NoData>}</Panel>
      <Panel title="Invoices & receipts">{d?.invoices.length ? <ul className="divide-y divide-border text-sm">{d.invoices.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span><b>{i.number}</b> · {i.shipper}{i.shipmentRef ? ` · ${i.shipmentRef}` : ''}<span className="block text-xs text-text-muted">{i.issuedAt} · {money(i.total)}{i.balance > 0 ? ` · ${money(i.balance)} to pay` : ' · paid'}</span></span>{i.payToken && <Link to={`/pay/${i.payToken}`} className="text-sm font-semibold text-gold-deep hover:underline">View</Link>}</li>)}</ul> : <NoData>No invoices yet.</NoData>}</Panel>
    </div>
  )
}

/* ============================== Saved: favourites, repeats, alerts ============================== */
export function SavedTab() {
  const { requests } = useStore(); const [sp] = useSearchParams()
  const [fav, setFav] = useState<Awaited<ReturnType<typeof hubApi.favorites>> | null>(null); const [reps, setReps] = useState<R[]>([]); const [alerts, setAlerts] = useState<R[]>([])
  const [rf, setRf] = useState({ from: '', name: '', every: '90', next: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }); const [af, setAf] = useState({ kind: 'price', destination: 'GH', origin: '', cargo: '', threshold: '' }); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const load = () => { hubApi.favorites().then(setFav).catch(() => {}); hubApi.repeats().then(setReps).catch(() => {}); hubApi.alerts().then(setAlerts).catch(() => {}) }
  useEffect(() => { load() }, [])
  const past = requests.filter((r) => r.status === 'booked' || r.status === 'open')
  const hi = sp.get('repeat')
  return (
    <div className="mt-6 space-y-6" data-testid="saved-tab">
      <Err e={err} />{ok && <p role="status" className="text-sm text-teal" data-testid="saved-ok">{ok}</p>}
      <Panel title="My shippers" sub="Rebook in one tap — the request goes straight to that shipper." testid="favorites">
        {fav?.favorites.length ? <ul className="grid gap-3 sm:grid-cols-2">{fav.favorites.map((f) => <li key={f.shipperId} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3" data-testid="fav-row"><span><b>{f.name}</b><span className="block text-xs text-text-muted">{f.rating}★ · {f.shipments} shipment{f.shipments === 1 ? '' : 's'} with you{f.lastAt ? ` · last ${fmtDate(f.lastAt)}` : ''}</span></span><span className="flex gap-1.5"><Link to={`/quote?shipper=${f.shipperId}`} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="rebook">Rebook</Link><button type="button" aria-label={`Remove ${f.name}`} onClick={async () => { await hubApi.favorite(f.shipperId, false); load() }} className="btn-ghost !min-h-8 !px-2"><Heart size={13} className="fill-current text-danger" aria-hidden="true" /></button></span></li>)}</ul> : <NoData>No favourites yet. Tap the heart on a shipper’s profile.</NoData>}
        {fav?.usedBefore.length ? <p className="mt-3 text-sm text-text-muted">Used before: {fav.usedBefore.map((u) => <button key={u.shipperId} type="button" onClick={async () => { await hubApi.favorite(u.shipperId, true); load() }} className="ml-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:border-gold" data-testid="fav-add"><Heart size={11} aria-hidden="true" /> {u.name}</button>)}</p> : null}
      </Panel>
      <Panel title="Repeat shipments" sub="A reminder a week before, then one tap posts the request with the same details and recipient." testid="repeats">
        {reps.length > 0 && <ul className="mb-4 divide-y divide-border text-sm">{reps.map((p) => <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${hi === p.id ? 'bg-gold/10' : ''}`} data-testid="repeat-row"><span><b>{p.name}</b><span className="block text-xs text-text-muted">every {p.everyDays} days · next {fmtDate(p.nextOn + 'T12:00:00Z')} · {p.template.quantity} × {p.template.cargo} to {countryByCode(p.template.destination)?.name}{p.active ? '' : ' · paused'}</span></span><span className="flex gap-1.5"><button type="button" onClick={async () => { setErr(''); try { const r = await hubApi.postRepeat(p.id); setOk(`Posted ${r.request?.ref ?? 'the request'} — quotes will arrive under Requests.`); load() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="repeat-post"><Send size={12} aria-hidden="true" /> Post now</button><button type="button" onClick={async () => { await hubApi.updateRepeat(p.id, { active: !p.active }); load() }} className="btn-ghost !min-h-8 !px-3 text-xs">{p.active ? 'Pause' : 'Resume'}</button><button type="button" aria-label="Delete plan" onClick={async () => { await hubApi.deleteRepeat(p.id); load() }} className="btn-ghost !min-h-8 !px-2"><Trash2 size={13} aria-hidden="true" /></button></span></li>)}</ul>}
        {past.length ? <form className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_10rem_auto]" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await hubApi.addRepeat({ name: rf.name || 'Repeat shipment', everyDays: Number(rf.every), nextOn: rf.next, fromRequestId: rf.from }); setOk('Repeat plan saved.'); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') } }}>
          <select required className={cls} value={rf.from} onChange={(e) => { const r = past.find((x) => x.id === e.target.value); setRf({ ...rf, from: e.target.value, name: rf.name || (r ? `${r.quantity} ${r.cargo} to ${countryByCode(r.destination)?.name}` : '') }) }} aria-label="Based on" data-testid="repeat-from"><option value="">Copy a past request…</option>{past.map((r) => <option key={r.id} value={r.id}>{r.ref} · {r.quantity} × {r.cargo} → {r.destination}</option>)}</select>
          <input className={cls} placeholder="Name, e.g. Barrel to Mum" value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} aria-label="Plan name" />
          <select className={cls} value={rf.every} onChange={(e) => setRf({ ...rf, every: e.target.value })} aria-label="How often"><option value="30">Monthly</option><option value="60">Every 2 months</option><option value="90">Every 3 months</option><option value="180">Twice a year</option><option value="365">Yearly</option></select>
          <input type="date" className={cls} value={rf.next} onChange={(e) => setRf({ ...rf, next: e.target.value })} aria-label="Next one" />
          <button className="btn-gold !min-h-10" data-testid="repeat-save"><Repeat size={14} aria-hidden="true" /> Save</button>
        </form> : <NoData>Post a request first — repeat plans copy a past one.</NoData>}
      </Panel>
      <Panel title="Price & space alerts" sub="We check every few hours and message you when it matters." testid="alerts">
        {alerts.length > 0 && <ul className="mb-4 divide-y divide-border text-sm">{alerts.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 py-2" data-testid="alert-row"><span>{a.kind === 'price' ? `Prices ${a.origin ? `from ${a.origin.split(',')[0]} ` : ''}to ${countryByCode(a.destination)?.name}${a.cargo ? ` (${a.cargo})` : ''}${a.thresholdUsd ? ` below ${money(a.thresholdUsd)}` : ' drop 10%'}` : a.kind === 'groupage' ? `New shared space to ${countryByCode(a.destination)?.name}` : `Sailing cutoffs to ${countryByCode(a.destination)?.name}`}{a.lastValue ? <span className="text-xs text-text-muted"> · typical now {money(a.lastValue)}</span> : null}</span><button type="button" aria-label="Delete alert" onClick={async () => { await hubApi.deleteAlert(a.id); load() }} className="text-text-muted hover:text-danger"><Trash2 size={13} aria-hidden="true" /></button></li>)}</ul>}
        <form className="grid gap-2 sm:grid-cols-[10rem_9rem_1fr_8rem_8rem_auto]" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await hubApi.addAlert({ kind: af.kind, destination: af.destination, origin: af.origin, cargo: af.cargo, thresholdUsd: af.threshold ? Number(af.threshold) : null }); setOk('Alert saved.'); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') } }}>
          <select className={cls} value={af.kind} onChange={(e) => setAf({ ...af, kind: e.target.value })} aria-label="Alert type" data-testid="alert-kind"><option value="price">Price drop</option><option value="groupage">Shared barrel opens</option><option value="cutoff">Sailing cutoff</option></select>
          <select className={cls} value={af.destination} onChange={(e) => setAf({ ...af, destination: e.target.value })} aria-label="Destination">{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
          <input className={cls} placeholder="From (optional), e.g. Houston, TX" value={af.origin} onChange={(e) => setAf({ ...af, origin: e.target.value })} aria-label="Origin" disabled={af.kind !== 'price'} />
          <input className={cls} placeholder="Cargo" value={af.cargo} onChange={(e) => setAf({ ...af, cargo: e.target.value })} aria-label="Cargo" disabled={af.kind !== 'price'} />
          <input type="number" min={1} className={cls} placeholder="Below $" value={af.threshold} onChange={(e) => setAf({ ...af, threshold: e.target.value })} aria-label="Price below" disabled={af.kind !== 'price'} />
          <button className="btn-gold !min-h-10" data-testid="alert-save"><Bell size={14} aria-hidden="true" /> Save</button>
        </form>
      </Panel>
    </div>
  )
}

/* ============================== Issues ============================== */
export function IssuesTab() {
  const [list, setList] = useState<R[] | null>(null); const { shipments } = useStore()
  useEffect(() => { hubApi.issues().then(setList).catch(() => setList([])) }, [])
  return (
    <div className="mt-6 space-y-4" data-testid="issues-tab">
      <p className="text-sm text-text-muted">Something wrong — late, damaged, missing pieces, charged more than agreed? Open a shipment and choose <b>Open a dispute</b>; add photos. Ship Sync holds any escrow payment and mediates.</p>
      {shipments.length > 0 && <p className="text-sm"><Link to={`/dashboard?tab=shipments&s=${shipments[0].id}`} className="font-semibold text-gold-deep hover:underline">Report a problem on a shipment →</Link></p>}
      {!list ? <NoData>Loading…</NoData> : !list.length ? <NoData>No problems reported. Good.</NoData> : <ul className="space-y-3">{list.map((x) => (
        <li key={x.id} className={`rounded-xl border bg-surface p-4 ${x.status === 'open' ? 'border-danger/40' : 'border-border'}`} data-testid="issue">
          <p className="flex flex-wrap items-center justify-between gap-2"><b>{x.reasonLabel} · {x.ref}</b><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${x.status === 'open' ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-text-muted'}`}>{x.status === 'open' ? 'Open' : x.status}</span></p>
          <p className="mt-1 text-sm text-text-muted">{x.shipper} · opened {fmtDate(x.createdAt)}{x.amountClaimedUsd ? ` · claiming ${money(x.amountClaimedUsd)}` : ''}</p>
          <p className="mt-2 text-sm">{x.description}</p>
          {x.photos?.length > 0 && <div className="mt-2 flex gap-1.5">{x.photos.map((p: string, i: number) => <img key={i} src={p} alt={`Photo ${i + 1}`} className="h-14 w-14 rounded object-cover" />)}</div>}
          {x.messages?.length > 1 && <p className="mt-2 text-xs text-text-muted">Latest: “{String(x.messages.at(-1).text).slice(0, 140)}” — {x.messages.at(-1).by}</p>}
          {x.resolution && <p className="mt-2 rounded-lg bg-teal/10 px-3 py-2 text-xs">Resolved: {x.resolution.outcome?.replace(/_/g, ' ')}{x.resolution.amountUsd ? ` · ${money(x.resolution.amountUsd)}` : ''}{x.resolution.note ? ` — ${x.resolution.note}` : ''}</p>}
          <Link to={`/dashboard?tab=shipments&s=${x.shipmentId}`} className="mt-2 inline-block text-sm font-semibold text-gold-deep hover:underline">Open the shipment</Link>
        </li>
      ))}</ul>}
    </div>
  )
}

/* ============================== Account: notifications, referrals, household, business ============================== */
function NotifyPrefs() {
  const [p, setP] = useState<R | null>(null); const [msg, setMsg] = useState('')
  useEffect(() => { hubApi.notifyPrefs().then((x) => setP({ ...x, tzOffset: x.tzOffset || -new Date().getTimezoneOffset() })).catch(() => {}) }, [])
  if (!p) return null
  const toggle = (arr: string[], k: string) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k])
  const save = async () => { setMsg(''); try { await hubApi.setNotifyPrefs({ email: p.email, muted: p.muted, phone: p.phone, textChannel: p.textChannel, textKinds: p.textKinds, quietStart: p.quietStart === '' ? null : p.quietStart, quietEnd: p.quietEnd === '' ? null : p.quietEnd, tzOffset: p.tzOffset }); setMsg('Saved.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.') } }
  return (
    <Panel title="How we reach you" sub="Every update shows in the app. Choose which ones also come by email and which by text." testid="notify-prefs">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.email} onChange={(e) => setP({ ...p, email: e.target.checked })} /> Email me updates</label>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr]"><select className={cls} value={p.textChannel} onChange={(e) => setP({ ...p, textChannel: e.target.value })} aria-label="Text channel" data-testid="np-channel"><option value="off">No texts</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select><input className={cls} placeholder="Mobile, e.g. +1 713 555 0100" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} aria-label="Mobile number" data-testid="np-phone" /></div>
        <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="py-1">Update</th><th className="py-1 text-center">Email</th><th className="py-1 text-center">Text</th></tr></thead><tbody>{p.kinds.map((k: { key: string; label: string }) => <tr key={k.key} className="border-t border-border/60"><td className="py-1.5">{k.label}</td><td className="text-center"><input type="checkbox" aria-label={`Email: ${k.label}`} checked={!p.muted.includes(k.key)} onChange={() => setP({ ...p, muted: toggle(p.muted, k.key) })} /></td><td className="text-center"><input type="checkbox" aria-label={`Text: ${k.label}`} disabled={p.textChannel === 'off'} checked={p.textKinds.includes(k.key)} onChange={() => setP({ ...p, textKinds: toggle(p.textKinds, k.key) })} data-testid={`np-text-${k.key}`} /></td></tr>)}</tbody></table>
        <div className="flex flex-wrap items-center gap-2">Quiet hours (texts wait until morning): <select className={`${cls} !w-24`} value={p.quietStart ?? ''} onChange={(e) => setP({ ...p, quietStart: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Quiet from"><option value="">off</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select> to <select className={`${cls} !w-24`} value={p.quietEnd ?? ''} onChange={(e) => setP({ ...p, quietEnd: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Quiet until"><option value="">off</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></div>
        <button type="button" onClick={save} className="btn-gold !min-h-10" data-testid="np-save">Save</button>{msg && <span role="status" className="ml-2 text-sm text-text-muted">{msg}</span>}
      </div>
    </Panel>
  )
}
function Referral() {
  const [r, setR] = useState<R | null>(null); const [copied, setCopied] = useState(false)
  useEffect(() => { hubApi.referral().then(setR).catch(() => {}) }, [])
  if (!r) return null
  const text = `I ship to West Africa with Ship Sync — verified shippers and live tracking. Sign up with my link and we both get ${money(r.creditUsd)} off: ${r.link}`
  return (
    <Panel title="Invite a friend" sub={`You both get ${money(r.creditUsd)} credit when their first shipment arrives.`} testid="referral">
      <div className="flex gap-2"><input readOnly value={r.link} className={`${cls} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} data-testid="ref-link" /><button type="button" className="btn-ghost !min-h-10" onClick={async () => { try { await navigator.clipboard.writeText(r.link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</button><a className="btn-gold !min-h-10" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" /> Share</a></div>
      <p className="mt-3 text-sm">Credit available: <b data-testid="ref-credit">{money(r.available)}</b> · {r.referred.length} friend{r.referred.length === 1 ? '' : 's'} joined{r.referred.filter((x: R) => x.earned).length ? `, ${r.referred.filter((x: R) => x.earned).length} shipped` : ''}</p>
    </Panel>
  )
}
function Household() {
  const [sp] = useSearchParams(); const [a, setA] = useState<R | null>(null); const [email, setEmail] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const load = () => hubApi.accounts().then(setA).catch(() => {})
  useEffect(() => { const t = sp.get('invite'); if (t) hubApi.accept(t).then(() => { setMsg('You joined the account — switch to it below.'); load() }).catch((e) => setErr(e.message)); else void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sw = async (id: string | null) => { await hubApi.switchTo(id); window.location.hash = '#/dashboard'; window.location.reload() }
  if (!a) return null
  return (
    <Panel title="Family & team" sub="Let family members or colleagues book, pay and track on your account. Everything they do is logged with their name." testid="household">
      {msg && <p role="status" className="mb-2 text-sm text-teal">{msg}</p>}<Err e={err} />
      {a.actingAs && <p className="mb-3 rounded-lg bg-gold/10 p-3 text-sm">You’re using <b>{a.actingAs.name}</b>’s account. <button type="button" onClick={() => sw(null)} className="font-semibold underline" data-testid="switch-back">Back to my own</button></p>}
      {a.shared.length > 0 && <div className="mb-3"><p className="label-dark mb-1">Accounts you can use</p><ul className="flex flex-wrap gap-2">{a.shared.map((s: R) => <li key={s.ownerId}><button type="button" onClick={() => sw(s.ownerId)} className="btn-ghost !min-h-9 text-sm" data-testid="switch-to"><Users size={14} aria-hidden="true" /> Use {s.name}</button></li>)}</ul></div>}
      {!a.actingAs && <>
        <ul className="divide-y divide-border text-sm">{a.members.map((m: R) => <li key={m.id} className="flex items-center justify-between py-2" data-testid="member"><span>{m.name ?? m.email} <span className="text-xs text-text-muted">{m.email} · {m.status}</span></span><button type="button" aria-label="Remove" onClick={async () => { await hubApi.removeMember(m.id); load() }} className="text-text-muted hover:text-danger"><Trash2 size={13} aria-hidden="true" /></button></li>)}</ul>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await hubApi.invite(email); setMsg(`Invite sent to ${email}.`); setEmail(''); load() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') } }}><input type="email" required placeholder="Their email" className={`${cls} flex-1`} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="member-email" /><button className="btn-gold !min-h-10" data-testid="member-invite"><Plus size={14} aria-hidden="true" /> Invite</button></form>
      </>}
    </Panel>
  )
}
function Business() {
  const [b, setB] = useState<R | null>(null); const [msg, setMsg] = useState('')
  useEffect(() => { hubApi.business().then(setB).catch(() => {}) }, [])
  if (!b) return null
  return (
    <Panel title="Business details" sub="Invoices and statements show your company. Turn on PO numbers if your accounts team needs one on every booking." testid="business">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <label><span className="label-dark">Company name</span><input className={cls} value={b.companyName} onChange={(e) => setB({ ...b, companyName: e.target.value })} data-testid="biz-name" /></label>
        <label><span className="label-dark">Tax / VAT ID</span><input className={cls} value={b.taxId} onChange={(e) => setB({ ...b, taxId: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className="label-dark">Billing address</span><textarea rows={2} className="input-dark text-sm" value={b.billingAddress} onChange={(e) => setB({ ...b, billingAddress: e.target.value })} /></label>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={b.poRequired} onChange={(e) => setB({ ...b, poRequired: e.target.checked })} data-testid="biz-po" /> Require a PO number on every request</label>
      </div>
      <button type="button" className="btn-gold mt-3 !min-h-10" onClick={async () => { try { await hubApi.setBusiness(b); setMsg('Saved.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed') } }} data-testid="biz-save">Save</button>{msg && <span role="status" className="ml-2 text-sm text-text-muted">{msg}</span>}
    </Panel>
  )
}
/* ---------- profile & security ---------- */
function ProfileCard() {
  const { refresh } = useStore()
  const [p, setP] = useState<Profile | null>(null); const [f, setF] = useState({ name: '', phone: '' }); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  useEffect(() => { accountApi.profile().then((x) => { setP(x); setF({ name: x.name, phone: x.phone }) }).catch(() => {}) }, [])
  if (!p) return null
  const save = async (e: React.FormEvent) => { e.preventDefault(); setMsg(''); setErr(''); try { await accountApi.setProfile(f); setMsg('Saved.'); await refresh() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not save.') } }
  return (
    <Panel title="Profile" sub={`Signed in as ${p.email}${p.createdAt ? ` · member since ${fmtDate(p.createdAt)}` : ''}`} testid="profile">
      <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-2">
        <label><span className="label-dark">Your name</span><input required minLength={2} className={cls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="pf-name" autoComplete="name" /></label>
        <label><span className="label-dark">Mobile (with country code)</span><input type="tel" className={cls} placeholder="+1 713 555 0100" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="pf-phone" autoComplete="tel" /></label>
        <div className="flex items-center gap-2 sm:col-span-2"><button className="btn-gold !min-h-10" data-testid="pf-save">Save profile</button>{msg && <span role="status" className="text-sm text-teal">{msg}</span>}</div>
        <Err e={err} />
      </form>
      <p className="mt-3 text-xs text-text-muted">Need to change your email? <Link to="/contact" className="text-gold-deep hover:underline">Ask us</Link> — we confirm it’s you first.</p>
    </Panel>
  )
}
function SecurityCard() {
  const [f, setF] = useState({ current: '', next: '', again: '' }); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const load = () => accountApi.sessions().then(setDevices).catch(() => setDevices([]))
  useEffect(() => { void load() }, [])
  const change = async (e: React.FormEvent) => { e.preventDefault(); setMsg(''); setErr(''); if (f.next !== f.again) return setErr('The new passwords don’t match.'); setBusy(true); try { const r = await accountApi.password(f.current, f.next); setF({ current: '', next: '', again: '' }); setMsg(`Password changed.${r.signedOut ? ` Signed out ${r.signedOut} other device${r.signedOut === 1 ? '' : 's'}.` : ''}`); void load() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not change it.') } finally { setBusy(false) } }
  return (
    <Panel title="Password & devices" sub="Changing your password signs you out everywhere else." testid="security">
      <form onSubmit={change} className="grid gap-3 text-sm sm:grid-cols-3">
        <label><span className="label-dark">Current password</span><input type="password" required className={cls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" data-testid="pw-current" /></label>
        <label><span className="label-dark">New password</span><input type="password" required minLength={8} className={cls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" data-testid="pw-next" /></label>
        <label><span className="label-dark">New password again</span><input type="password" required minLength={8} className={cls} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} autoComplete="new-password" data-testid="pw-again" /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3"><button disabled={busy} className="btn-gold !min-h-10" data-testid="pw-save">{busy ? 'Changing…' : 'Change password'}</button>{msg && <span role="status" className="text-sm text-teal">{msg}</span>}</div>
        <div className="sm:col-span-3"><Err e={err} /></div>
      </form>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Where you’re signed in</p>{devices && devices.length > 1 && <button type="button" onClick={async () => { await accountApi.revokeOthers(); void load() }} className="btn-ghost !min-h-8 !px-3 text-xs" data-testid="dev-others">Sign out all other devices</button>}</div>
        <ul className="mt-2 divide-y divide-border text-sm" data-testid="devices">{(devices ?? []).map((d) => <li key={d.key} className="flex items-center justify-between gap-2 py-2" data-testid="device"><span><b>{d.device}</b>{d.current && <span className="ml-2 rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">This device</span>}<span className="block text-xs text-text-muted">Last active {d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : '—'}</span></span>{!d.current && <button type="button" onClick={async () => { await accountApi.revoke(d.key); void load() }} className="text-xs font-semibold text-danger hover:underline">Sign out</button>}</li>)}</ul>
      </div>
    </Panel>
  )
}
function DataCard() {
  const { user } = useStore(); const [open, setOpen] = useState(false); const [pw, setPw] = useState(''); const [word, setWord] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  if (user?.actingBy) return null
  const del = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); setBusy(true); try { await accountApi.remove(pw); window.location.hash = '#/'; window.location.reload() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not delete the account.'); setBusy(false) } }
  return (
    <Panel title="Your data" sub="Download everything we hold about you, or close your account." testid="your-data">
      <div className="flex flex-wrap gap-2"><a href={accountApi.exportUrl} className="btn-ghost !min-h-10 text-sm" data-testid="data-export"><Download size={14} aria-hidden="true" /> Download my data (JSON)</a>{!open && <button type="button" onClick={() => setOpen(true)} className="btn-ghost !min-h-10 text-sm text-danger" data-testid="data-delete-open"><Trash2 size={14} aria-hidden="true" /> Delete my account</button>}</div>
      {open && <form onSubmit={del} className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm" data-testid="delete-form">
        <p className="font-semibold text-danger">This can’t be undone.</p>
        <p className="mt-1 text-text-muted">We remove your name, contact details, recipients, saved shippers, alerts and messages settings, and sign you out everywhere. Invoices and shipment records stay (anonymised) because tax and customs law require them. You can’t delete while a shipment is on the way or money is owed or held.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><label><span className="label-dark">Your password</span><input type="password" required className={cls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" data-testid="del-pw" /></label><label><span className="label-dark">Type DELETE to confirm</span><input required className={cls} value={word} onChange={(e) => setWord(e.target.value)} data-testid="del-word" /></label></div>
        <Err e={err} />
        <div className="mt-3 flex gap-2"><button type="button" onClick={() => { setOpen(false); setErr('') }} className="btn-ghost !min-h-10 text-sm">Keep my account</button><button disabled={busy || word !== 'DELETE'} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50" data-testid="del-confirm">{busy ? 'Deleting…' : 'Delete my account'}</button></div>
      </form>}
    </Panel>
  )
}

export function AccountTab() {
  const [sp] = useSearchParams(); const section = sp.get('section')
  useEffect(() => { if (section) { const t = setTimeout(() => document.getElementById(`acct-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); return () => clearTimeout(t) } }, [section])
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2" data-testid="account-tab">
      <div className="min-w-0 space-y-6"><div id="acct-profile" className="scroll-mt-24"><ProfileCard /></div><div id="acct-security" className="scroll-mt-24"><SecurityCard /></div><div id="acct-alerts" className="scroll-mt-24"><NotifyPrefs /></div></div>
      <div className="min-w-0 space-y-6"><div id="acct-family" className="scroll-mt-24"><Household /></div><Referral /><Business /><DataCard /></div>
    </div>
  )
}
