import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Award, Camera, Check, ChevronRight, Coffee, FileText, LogIn, LogOut, MessageSquareWarning, PlayCircle, Send, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { isDriverRole } from '../lib/roles'
import { PinCard } from '../components/driver/PinCard'
import { expiryText, ShiftReview } from '../components/driver/HomeCards'
import { useT } from '../lib/i18n'
import { useDisplay } from '../lib/prefs'
import { niceDay } from '../lib/dates'
import { ADJ_LABEL, LEAVE_LABEL, hrApi, money, type AdvanceReq, type Badge, type Leave, type PayDetail, type PayQuery, type PaySummary, type Person, type Rota, type TrainingQ } from '../lib/driverHrApi'
import { CONTRACT_VERSION, contractText } from '../lib/driverHr'
import { BrandLoader } from '../components/BrandLoader'
import { SignaturePad } from '../components/SignaturePad'
import { Big, Choice } from '../components/driver/DriverUi'
import { Breakdown, PayslipView } from '../components/driver/OfficeHr'
import { CardCamera } from '../components/driver/CardCamera'
import { driverApi, type ShiftView } from '../lib/driverApi'
import { roleHome, type StaffRole } from '../lib/ops'
import QRCode from 'qrcode'

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const errOf = (e: unknown, f: string) => (e instanceof Error ? e.message : f)

/** Drivers and office staff share these pages; drivers get the extras (badge, agreement, quiz) and live under My runs. */
const SelfCtx = createContext<{ driver: boolean; home: string }>({ driver: true, home: '/dashboard/runs' })
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT(); const { driver, home } = useContext(SelfCtx)
  return <div className="bg-bg text-text"><div className="container-x max-w-2xl py-5 pb-28 md:py-8">
    <Link to={home} className="inline-flex min-h-11 items-center gap-1.5 text-base text-text-muted hover:text-text focus-ring"><ArrowLeft size={18} aria-hidden="true" /> {driver ? t('My runs') : t('Dashboard')}</Link>
    {!driver && <nav aria-label={t('My HR')} className="mt-2 flex gap-1 rounded-2xl border border-border bg-surface p-1">{([['pay', 'My pay'], ['time', 'My time'], ['file', 'My file']] as const).map(([k, l]) => <NavLink key={k} to={`/dashboard/me/${k}`} className={({ isActive }) => `flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold ${isActive ? 'bg-gold text-on-accent' : 'text-text-muted hover:text-text'}`}>{t(l)}</NavLink>)}</nav>}
    <h1 className="mt-3 !text-[1.7rem] leading-tight">{title}</h1>{children}</div></div>
}
const Card = ({ title, children, id, testid }: { title: string; children: React.ReactNode; id: string; testid?: string }) => <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby={id} data-testid={testid}><h2 id={id} className="!text-lg">{title}</h2>{children}</section>
const Msg = ({ err, ok }: { err?: string; ok?: string }) => <>{err && <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger">{err}</p>}{ok && <p role="status" className="mt-3 rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-base">{ok}</p>}</>

/* ---------------- My pay ---------------- */
function PayHistory({ rows, cur }: { rows: PaySummary['history']; cur: string }) {
  const t = useT(); const disp = useDisplay(); const max = Math.max(1, ...rows.map((r) => r.net))
  if (!rows.length) return null
  return (
    <figure className="mt-3" data-testid="pay-history">
      <div className="flex h-32 items-end gap-1.5" aria-hidden="true">{rows.map((r, i) => <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><div className={`w-full rounded-t-md ${r.status === 'paid' ? 'bg-gold' : 'bg-gold/50'}`} style={{ height: `${Math.max(4, (r.net / max) * 100)}%` }} /></div>)}</div>
      <div className="mt-1 flex gap-1.5 text-[0.7rem] text-text-muted" aria-hidden="true">{rows.map((r, i) => <span key={i} className="flex-1 truncate text-center">{new Date(r.end + 'T12:00:00Z').toLocaleDateString(disp.lang === 'fr' ? 'fr-FR' : undefined, { day: 'numeric', month: 'short' })}</span>)}</div>
      <table className="sr-only"><caption>{t('Pay for each period')}</caption><tbody>{rows.map((r, i) => <tr key={i}><th>{r.start} – {r.end}</th><td>{money(r.net, r.currency || cur)}</td></tr>)}</tbody></table>
    </figure>
  )
}
function MyPay() {
  const t = useT(); const disp = useDisplay(); const { driver } = useContext(SelfCtx)
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.myPay>> | null>(null); const [sum, setSum] = useState<PaySummary | null>(null); const [rank, setRank] = useState<Awaited<ReturnType<typeof hrApi.myRank>> | null>(null)
  const [qs, setQs] = useState<PayQuery[]>([]); const [ars, setArs] = useState<AdvanceReq[]>([]); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [det, setDet] = useState<PayDetail | null>(null); const [open, setOpen] = useState(false); const [q, setQ] = useState<{ line: string; note: string } | null>(null)
  const [adv, setAdv] = useState<{ amount: string; currency: string; reason: string; installments: number } | null>(null); const [busy, setBusy] = useState(false)
  const load = () => { hrApi.myPay().then(setD).catch((e) => setErr(errOf(e, t('Could not load.')))); hrApi.paySummary().then(setSum).catch(() => {}); if (driver) hrApi.myRank().then(setRank).catch(() => {}); hrApi.myQueries().then(setQs).catch(() => {}); hrApi.myAdvances().then(setArs).catch(() => {}) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Shell title={t('My pay')}>{err ? <Msg err={err} /> : <BrandLoader full={false} />}</Shell>
  const c = d.current; const curr = sum?.currency ?? c.currency
  const showDetail = async () => { setOpen((v) => !v); if (!det) setDet(await hrApi.slipDetail('current').catch(() => null)) }
  const sendQ = async () => { if (!q) return; setBusy(true); setErr(''); try { await hrApi.askQuery('current', q.line, q.note); setQ(null); setOk(t('Sent to the office — you’ll get a notification when they answer.')); load() } catch (e) { setErr(errOf(e, t('Could not send.'))) } finally { setBusy(false) } }
  const sendAdv = async () => { if (!adv) return; setBusy(true); setErr(''); try { await hrApi.askAdvance({ amount: Number(adv.amount), currency: adv.currency, reason: adv.reason, installments: adv.installments }); setAdv(null); setOk(t('Advance request sent.')); load() } catch (e) { setErr(errOf(e, t('Could not send.'))) } finally { setBusy(false) } }
  const pendingAdv = ars.find((a) => a.status === 'pending')
  return (
    <Shell title={t('My pay')}>
      {sum && <section className="mt-4 grid grid-cols-2 gap-2" aria-label={t('Pay day')} data-testid="pay-summary">
        <div className="rounded-2xl border-2 border-gold bg-gold/10 p-4"><p className="text-sm text-text-muted">{t('Pay day')}</p><p className="text-xl font-bold">{niceDay(sum.payDay, { lang: disp.lang })}</p><p className="text-sm">{sum.closesIn === 0 ? t('Period closes today') : t('Period closes in {n} days', { n: sum.closesIn })}</p></div>
        <div className="rounded-2xl border-2 border-border bg-surface p-4"><p className="text-sm text-text-muted">{driver ? t('Earned today') : t('Hours today')}</p><p className="text-xl font-bold tabular-nums" data-testid="earned-today">{driver || sum.today.earned ? money(sum.today.earned, curr) : `${sum.today.hours} h`}</p><p className="text-sm">{driver ? `${sum.today.stops === 1 ? t('1 stop') : t('{n} stops', { n: sum.today.stops })} · ` : ''}{sum.today.hours} h</p></div>
      </section>}
      {d.owed > 0 && <p className="mt-4 rounded-2xl border-2 border-teal/50 bg-teal/10 p-4 text-base font-semibold" data-testid="owed">{t('{amount} approved and on its way to you.', { amount: money(d.owed, d.payslips[0]?.currency) })}</p>}
      {rank?.show && rank.rank && <p className="mt-4 flex items-center gap-2 rounded-2xl bg-surface-2 p-4 text-base"><Award size={20} className="text-gold-deep" aria-hidden="true" /> {t('You’re number {n} of {of} drivers this month.', { n: rank.rank, of: rank.of ?? 0 })}</p>}
      <Msg err={err} ok={ok} />
      <Card title={t('This pay period so far')} id="cur-h" testid="pay-current">
        <p className="text-sm text-text-muted">{niceDay(c.start, { lang: disp.lang })} – {niceDay(c.end, { lang: disp.lang })}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{money(c.net, c.currency)}</p>
        <ul className="mt-3 divide-y divide-border text-base">{c.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{t(l.label)}{l.qty != null ? ` × ${l.qty}` : ''}</span><span className={`tabular-nums ${l.amount < 0 ? 'text-danger' : ''}`}>{money(l.amount, c.currency)}</span></li>)}</ul>
        {!c.lines.length && <p className="mt-2 text-base text-text-muted">{t('Nothing yet this period.')}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={showDetail} aria-expanded={open} className="min-h-12 rounded-xl border-2 border-border text-base font-semibold focus-ring" data-testid="pay-detail">{open ? t('Hide details') : t('How was this worked out?')}</button>
          <button onClick={() => setQ(q ? null : { line: '', note: '' })} className="min-h-12 rounded-xl border-2 border-border text-base font-semibold focus-ring" data-testid="pay-query"><MessageSquareWarning size={18} className="mr-1 inline" aria-hidden="true" />{t('Something’s wrong?')}</button>
        </div>
        {q && <div className="mt-3 grid gap-2" data-testid="query-form"><label htmlFor="pq-line" className="label-dark">{t('Which line?')}</label><select id="pq-line" className="input-dark !min-h-12" value={q.line} onChange={(e) => setQ({ ...q, line: e.target.value })}><option value="">{t('The whole period')}</option>{c.lines.map((l, i) => <option key={i} value={l.label}>{t(l.label)}</option>)}</select><label htmlFor="pq-note" className="label-dark">{t('What looks wrong?')}</label><textarea id="pq-note" rows={3} className="input-dark py-2 text-base" value={q.note} onChange={(e) => setQ({ ...q, note: e.target.value })} placeholder={t('e.g. I did 3 stops on Saturday that aren’t here')} data-testid="query-note" /><Big tone="gold" disabled={busy || q.note.trim().length < 5} onClick={sendQ} testid="query-send"><Send size={20} aria-hidden="true" /> {t('Send to the office')}</Big></div>}
        {open && (det ? (det.stops.length || det.shifts.length ? <Breakdown det={det} /> : <p className="mt-3 text-base text-text-muted">{t('No stops or shifts yet this period.')}</p>) : <p className="mt-3 text-text-muted">{t('Loading…')}</p>)}
        <p className="mt-3 text-sm text-text-muted">{t('Not final until the office approves your payslip.')}</p>
      </Card>
      {qs.length > 0 && <Card title={t('My questions')} id="q-h"><ul className="mt-2 space-y-2 text-base">{qs.map((x) => <li key={x.id} className="rounded-xl bg-surface-2/60 p-3" data-testid="my-query"><p>{x.line ? <b>{t(x.line)}: </b> : null}{x.note}</p>{x.status === 'answered' ? <p className="mt-1 text-teal">↳ {x.answer} <span className="text-sm text-text-muted">— {x.answeredBy}</span></p> : <p className="mt-1 text-sm text-text-muted">{t('Waiting for the office')}</p>}</li>)}</ul></Card>}
      {sum && sum.history.length > 0 && <Card title={t('Last {n} pay periods', { n: sum.history.length })} id="hist-h"><PayHistory rows={sum.history} cur={curr} />{sum.year.map((y) => <p key={y.currency} className="mt-3 text-base" data-testid="year-total">{t('This year: {amount} paid', { amount: money(y.net, y.currency) })} <span className="text-sm text-text-muted">({t('{amount} pay + {back} expenses back', { amount: money(y.gross, y.currency), back: money(y.reimbursed, y.currency) })})</span></p>)}</Card>}
      <Card title={t('Payslips')} id="slips-h">
        {d.payslips.length ? <ul className="mt-2 space-y-2">{d.payslips.map((s) => <li key={s.id}><Link to={`/dashboard/payslip/${s.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-border px-4 py-2 text-base focus-ring" data-testid="my-slip"><FileText size={20} aria-hidden="true" /><span className="min-w-0 flex-1"><b>{money(s.net, s.currency)}</b><span className="block text-sm text-text-muted">{niceDay(s.start, { lang: disp.lang })} – {niceDay(s.end, { lang: disp.lang })}</span></span><span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${s.status === 'paid' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold-deep'}`}>{s.status === 'paid' ? t('Paid') : t('Approved')}</span><ChevronRight size={18} aria-hidden="true" /></Link></li>)}</ul> : <p className="mt-2 text-base text-text-muted">{t('No payslips yet.')}</p>}
        <p className="mt-2 text-sm text-text-muted">{t('Open a payslip to share it as a PDF — for a bank, landlord or visa letter.')}</p>
      </Card>
      <Card title={t('Need an advance?')} id="adv-h" testid="advance">
        {pendingAdv ? <p className="mt-2 text-base">{t('Your request for {amount} is waiting for the office.', { amount: money(pendingAdv.amount, pendingAdv.currency) })}</p> : !adv ? <div className="mt-2"><Big onClick={() => setAdv({ amount: '', currency: curr, reason: '', installments: 2 })} testid="adv-open">{t('Ask for an advance')}</Big></div> : <div className="mt-2 grid gap-3">
          <div className="grid grid-cols-[1fr_7rem] gap-2"><div><label htmlFor="adv-amt" className="label-dark">{t('Amount')}</label><input id="adv-amt" inputMode="decimal" className="input-dark !min-h-14 text-2xl font-bold tabular-nums" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value.replace(/[^\d.]/g, '') })} data-testid="adv-amount" /></div><div><label htmlFor="adv-cur" className="label-dark">{t('Currency')}</label><select id="adv-cur" className="input-dark !min-h-14" value={adv.currency} onChange={(e) => setAdv({ ...adv, currency: e.target.value })}>{['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
          <div><label htmlFor="adv-why" className="label-dark">{t('What is it for?')}</label><input id="adv-why" className="input-dark !min-h-12" value={adv.reason} onChange={(e) => setAdv({ ...adv, reason: e.target.value })} placeholder={t('e.g. car repair, school fees')} data-testid="adv-reason" /></div>
          <div><p className="label-dark" id="adv-inst">{t('Pay it back over')}</p><div className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby="adv-inst">{[1, 2, 3, 4].map((n) => <button key={n} type="button" role="radio" aria-checked={adv.installments === n} onClick={() => setAdv({ ...adv, installments: n })} className={`min-h-12 rounded-xl border-2 text-base font-semibold focus-ring ${adv.installments === n ? 'border-gold bg-gold/15' : 'border-border'}`}>{n}</button>)}</div><p className="mt-1 text-sm text-text-muted">{t('payslips')}{Number(adv.amount) ? ` · ${t('{amount} each', { amount: money(Number(adv.amount) / adv.installments, adv.currency) })}` : ''}</p></div>
          <Big tone="gold" onClick={sendAdv} disabled={busy || !Number(adv.amount) || adv.reason.trim().length < 3} testid="adv-send"><Send size={20} aria-hidden="true" /> {t('Send request')}</Big>
        </div>}
        {ars.filter((a) => a.status !== 'pending').slice(0, 3).map((a) => <p key={a.id} className="mt-2 text-sm text-text-muted">{money(a.amount, a.currency)} · {a.status === 'approved' ? t('Approved') : t('Not approved')}{a.note ? ` — “${a.note}”` : ''}</p>)}
      </Card>
      {d.adjustments.length > 0 && <Card title={t('Advances & deductions')} id="adj-h"><ul className="mt-2 divide-y divide-border text-base">{d.adjustments.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span>{t(ADJ_LABEL[a.kind] ?? a.kind)}{a.note ? ` · ${a.note}` : ''}</span><span className="tabular-nums">{a.kind === 'bonus' ? '+' : ''}{money(a.remaining, a.currency)} {a.kind !== 'bonus' ? t('left') : ''}</span></li>)}</ul></Card>}
      {d.expenses.length > 0 && <Card title={t('My expenses')} id="exp-h"><ul className="mt-2 divide-y divide-border text-base">{d.expenses.map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><span className="capitalize">{t(e.kind[0].toUpperCase() + e.kind.slice(1))} · {money(e.amount, e.currency)}</span><span className={`text-sm font-semibold ${e.status === 'rejected' ? 'text-danger' : e.status === 'pending' ? 'text-text-muted' : 'text-teal'}`}>{e.status === 'pending' ? t('Waiting') : e.status === 'rejected' ? t('Not approved') : e.status === 'reimbursed' ? t('Paid back') : t('Approved')}</span></li>)}</ul></Card>}
    </Shell>
  )
}

/* ---------------- Time off & rota ---------------- */
/** Office staff clock in here (drivers do it on My runs). */
function ClockCard() {
  const t = useT(); const [v, setV] = useState<ShiftView | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { driverApi.shift().then(setV).catch((e) => setErr(errOf(e, t('Could not load.')))) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (a: 'in' | 'break' | 'resume' | 'out') => { setBusy(true); setErr(''); try { setV(await driverApi.clock(a)) } catch (e) { setErr(errOf(e, t('Could not save.'))) } finally { setBusy(false) } }
  const c = v?.current
  return (
    <>
    {v?.review && <ShiftReview sh={v.review} onSaved={setV} />}
    <Card title={t('Clock in & out')} id="clk-h" testid="clock">
      <p className="mt-1 text-base">{!v ? t('Loading…') : c ? (c.onBreak ? t('On a break') : t('On shift since {time}', { time: new Date(c.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })) : t('Not clocked in')} {v && <span className="text-sm text-text-muted">· {t('{n} h this week', { n: v.week })}</span>}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!c ? <div className="col-span-2"><Big tone="gold" disabled={busy || !v} onClick={() => go('in')} testid="clock-in"><LogIn size={20} aria-hidden="true" /> {t('Clock in')}</Big></div> : <>
          <Big disabled={busy} onClick={() => go(c.onBreak ? 'resume' : 'break')} testid="clock-break"><Coffee size={20} aria-hidden="true" /> {c.onBreak ? t('Back from break') : t('Start a break')}</Big>
          <Big tone="danger" disabled={busy} onClick={() => go('out')} testid="clock-out"><LogOut size={20} aria-hidden="true" /> {t('Clock out')}</Big></>}
      </div>
      <Msg err={err} />
    </Card>
    </>
  )
}

function MyTime() {
  const t = useT(); const disp = useDisplay(); const { driver } = useContext(SelfCtx)
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.myLeave>> | null>(null); const [rota, setRota] = useState<Rota | null>(null)
  const [f, setF] = useState({ kind: 'vacation' as Leave['kind'], start: addDays(today(), 7), end: addDays(today(), 7), swapWith: '', note: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const load = () => { hrApi.myLeave().then(setD).catch((e) => setErr(errOf(e, t('Could not load.')))); hrApi.rota(today(), 14).then(setRota).catch(() => {}) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); setOk(''); try { await hrApi.askLeave({ kind: f.kind, start: f.start, end: f.kind === 'swap' ? f.start : f.end, swapWith: f.kind === 'swap' ? f.swapWith : undefined, note: f.note }); setOk(f.kind === 'sick' ? t('Sent. Get well soon.') : t('Sent to the office.')); setF({ ...f, note: '' }); load() } catch (er) { setErr(errOf(er, t('Could not send.'))) } finally { setBusy(false) } }
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i))
  return (
    <Shell title={t('Time off & rota')}>
      {!driver && <ClockCard />}
      {d && <p className="mt-3 text-lg" data-testid="leave-balance">{t('{left} of {all} holiday days left this year', { left: d.balance.left, all: d.balance.allowance })}</p>}
      <Card title={t('My next two weeks')} id="rota-h" testid="my-rota">
        {!rota ? <p className="text-text-muted">{t('Loading…')}</p> : <ul className="mt-2 divide-y divide-border">{days.map((dd) => { const e = rota.entries.find((x) => x.day === dd); const lv = rota.leave.find((x) => x.start <= dd && x.end >= dd); const runs = rota.runs.filter((x) => x.day === dd)
          return <li key={dd} className="flex items-center gap-3 py-2.5 text-base"><span className="w-28 shrink-0 font-semibold">{niceDay(dd, { lang: disp.lang })}</span><span className="min-w-0 flex-1">{lv ? <span className="text-gold-deep">{t(LEAVE_LABEL[lv.kind])}</span> : e ? (e.kind === 'work' ? `${e.start}–${e.end}` : <span className="text-text-muted">{e.kind === 'off' ? t('Day off') : t('Leave')}</span>) : <span className="text-text-muted">—</span>}{runs.map((r) => <span key={r.id} className="block text-sm text-text-muted">{r.name}</span>)}</span></li> })}</ul>}
      </Card>
      <Card title={t('Ask for time off')} id="ask-h">
        <form onSubmit={send} className="mt-2 grid gap-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('What for?')}>{(['vacation', 'sick', 'personal', 'swap'] as const).map((k) => <Choice key={k} on={f.kind === k} onClick={() => setF({ ...f, kind: k })} testid={`leave-${k}`}>{t(LEAVE_LABEL[k])}</Choice>)}</div>
          <div className="grid grid-cols-2 gap-2"><div><label htmlFor="lv-start" className="label-dark">{f.kind === 'swap' ? t('Day') : t('First day')}</label><input id="lv-start" type="date" className="input-dark !min-h-12" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end })} /></div>
            {f.kind !== 'swap' && <div><label htmlFor="lv-end" className="label-dark">{t('Last day')}</label><input id="lv-end" type="date" className="input-dark !min-h-12" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>}</div>
          {f.kind === 'swap' && <div><label htmlFor="lv-mate" className="label-dark">{t('Swap with')}</label><select id="lv-mate" className="input-dark !min-h-12" value={f.swapWith} onChange={(e) => setF({ ...f, swapWith: e.target.value })} required><option value="">—</option>{d?.mates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="mt-1 text-sm text-text-muted">{t('Agree it with them first. When the office approves, your shifts and runs that day swap.')}</p></div>}
          <div><label htmlFor="lv-note" className="label-dark">{t('Note')} <span className="font-normal text-text-muted">({t('optional')})</span></label><input id="lv-note" className="input-dark !min-h-12" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <Big type="submit" tone="gold" disabled={busy} testid="leave-send"><Send size={20} aria-hidden="true" /> {t('Send request')}</Big>
        </form>
        <Msg err={err} ok={ok} />
      </Card>
      {d && d.requests.length > 0 && <Card title={t('My requests')} id="req-h"><ul className="mt-2 divide-y divide-border text-base">{d.requests.map((l) => <li key={l.id} className="py-2.5" data-testid="my-leave"><div className="flex items-center justify-between gap-3"><span>{t(LEAVE_LABEL[l.kind])} · {niceDay(l.start, { lang: disp.lang })}{l.end !== l.start ? ` – ${niceDay(l.end, { lang: disp.lang })}` : ''}{l.swapName ? ` · ${l.swapName}` : ''}</span><span className={`text-sm font-semibold ${l.status === 'approved' ? 'text-teal' : l.status === 'declined' ? 'text-danger' : 'text-text-muted'}`}>{l.status === 'approved' ? t('Approved') : l.status === 'declined' ? t('Not approved') : t('Waiting')}</span></div>
        {l.status !== 'pending' && l.decidedBy && <p className="text-sm text-text-muted">{t('By {name}', { name: l.decidedBy })}{l.decisionNote ? ` — “${l.decisionNote}”` : ''}</p>}
        {l.status === 'pending' && <button onClick={async () => { setErr(''); try { await hrApi.cancelLeave(l.id); setOk(t('Request cancelled.')); load() } catch (e) { setErr(errOf(e, t('Could not cancel.'))) } }} className="mt-1 inline-flex min-h-11 items-center text-base font-semibold text-danger underline-offset-2 hover:underline" data-testid="leave-cancel">{t('Cancel request')}</button>}</li>)}</ul></Card>}
    </Shell>
  )
}

/* ---------------- My file: onboarding, agreement, training, papers, details ---------------- */
function MyFile() {
  const t = useT(); const disp = useDisplay(); const [sp] = useSearchParams(); const { driver } = useContext(SelfCtx)
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.me>> | null>(null); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const load = () => hrApi.me().then(setD).catch((e) => setErr(errOf(e, t('Could not load.'))))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Shell title={t('My file')}>{err ? <Msg err={err} /> : <BrandLoader full={false} />}</Shell>
  const p = d.person; const left = p.checklist.filter((c) => !c.done)
  return (
    <Shell title={t('My file')}>
      <Card title={left.length ? t('Getting started · {n} to do', { n: left.length }) : t('All set')} id="ob-h" testid="checklist">
        <ul className="mt-2 grid gap-1.5">{p.checklist.map((c) => <li key={c.key} className="flex items-center gap-2 text-base">{c.done ? <Check size={18} className="text-teal" aria-label={t('Done')} /> : <X size={18} className="text-text-muted" aria-label={t('Not done')} />}{t(c.label)}</li>)}</ul>
      </Card>
      {p.expiringSoon.length > 0 && <p className="mt-4 rounded-2xl border-2 border-danger/50 bg-danger/10 p-4 text-base" role="alert">{p.expiringSoon.map((e) => <span key={e.kind} className="block">{expiryText(t, e, disp.lang)}{e.expired ? ` — ${t('upload the new one below.')}` : ''}</span>)}</p>}
      {driver && <Agreement company={d.company} person={p} onDone={() => { setOk(t('Agreement signed.')); void load() }} />}
      {driver && <Training videos={d.settings.trainingVideos} passed={!!p.training?.passedAt} onDone={() => void load()} open={sp.get('quiz') === '1'} />}
      <Papers person={p} onDone={(m) => { setOk(m); void load() }} />
      {driver && <BadgeCard />}
      <Details person={p} onDone={(m) => { setOk(m); void load() }} />
      <PinCard always />
      <Msg err={err} ok={ok} />
    </Shell>
  )
}
function Agreement({ company, person, onDone }: { company: string; person: Person; onDone: () => void }) {
  const t = useT(); const [name, setName] = useState(person.name); const [sig, setSig] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const text = contractText(company, person.name, person.employment)
  return (
    <Card title={t('Driver agreement')} id="agr-h" testid="agreement">
      {person.contractSignedAt ? <p className="mt-2 text-base text-teal">{t('Signed {date}', { date: new Date(person.contractSignedAt).toLocaleDateString() })}</p> : <>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-base">{text.map((x, i) => <li key={i}>{x}</li>)}</ol>
        <label htmlFor="agr-name" className="label-dark mt-4">{t('Your full name')}</label><input id="agr-name" className="input-dark !min-h-12" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="label-dark mt-3">{t('Sign here')}</p><SignaturePad value={sig} onChange={setSig} height={160} />
        <div className="mt-3"><Big tone="gold" disabled={busy || !sig || name.trim().length < 2} onClick={async () => { setBusy(true); setErr(''); try { await hrApi.sign(name.trim(), sig, CONTRACT_VERSION); onDone() } catch (e) { setErr(errOf(e, t('Could not save.'))) } finally { setBusy(false) } }} testid="agr-sign"><Check size={20} aria-hidden="true" /> {t('I agree and sign')}</Big></div>
        <Msg err={err} />
      </>}
    </Card>
  )
}
function Training({ videos, passed, onDone, open }: { videos: { title: string; url: string }[]; passed: boolean; onDone: () => void; open: boolean }) {
  const t = useT(); const [qs, setQs] = useState<TrainingQ[] | null>(null); const [ans, setAns] = useState<number[]>([]); const [res, setRes] = useState<{ score: number; passed: boolean; wrong: number[] } | null>(null); const [show, setShow] = useState(open && !passed)
  useEffect(() => { if (show && !qs) hrApi.training().then((x) => { setQs(x.questions); setAns(x.questions.map(() => -1)) }).catch(() => {}) }, [show, qs])
  return (
    <Card title={t('Training')} id="tr-h" testid="training">
      {videos.length > 0 && <ul className="mt-2 space-y-2">{videos.map((v) => <li key={v.url}><a href={v.url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-border px-3 text-base font-semibold focus-ring"><PlayCircle size={20} aria-hidden="true" /> {v.title}</a></li>)}</ul>}
      {passed && !show ? <p className="mt-2 text-base text-teal">{t('Quiz passed.')}</p> : !show ? <div className="mt-3"><Big tone="gold" onClick={() => setShow(true)} testid="quiz-start">{t('Take the quiz (8 questions)')}</Big></div> : !qs ? <p className="mt-2 text-text-muted">{t('Loading…')}</p> : <>
        <ol className="mt-3 space-y-5">{qs.map((q, i) => <li key={i}><p className="text-base font-semibold" id={`q-${i}`}>{i + 1}. {t(q.q)}</p><div className="mt-2 grid gap-2" role="radiogroup" aria-labelledby={`q-${i}`}>{q.options.map((o, j) => <Choice key={j} on={ans[i] === j} onClick={() => setAns((a) => a.map((x, k) => (k === i ? j : x)))} testid={`q${i}-${j}`}>{t(o)}</Choice>)}</div>{res?.wrong.includes(i) && <p className="mt-1 text-sm text-danger">{t(q.why)}</p>}</li>)}</ol>
        <div className="mt-4"><Big tone="gold" disabled={ans.some((x) => x < 0)} onClick={async () => { const r = await hrApi.sendTraining(ans); setRes(r); if (r.passed) { setShow(false); onDone() } }} testid="quiz-send">{t('Check my answers')}</Big></div>
        {res && <p role="status" className={`mt-3 text-base font-semibold ${res.passed ? 'text-teal' : 'text-danger'}`}>{res.passed ? t('{n}% — passed.', { n: res.score }) : t('{n}% — you need 80%. Read the notes in red and try again.', { n: res.score })}</p>}
      </>}
    </Card>
  )
}
const DRIVER_PAPERS: [string, string, boolean][] = [['licence', 'Driving licence', true], ['id', 'ID', true], ['medical', 'Medical card', false], ['insurance', 'Insurance', false], ['permit', 'Work / DOT / DVLA permit', false]]
const OFFICE_PAPERS: [string, string, boolean][] = [['id', 'ID', true], ['contract', 'Signed employment contract', false], ['right_to_work', 'Right to work', false], ['tax', 'Tax form (W-4 / SSNIT / TIN)', false], ['certificate', 'Certificate', false], ['permit', 'Work permit', false]]
function Papers({ person, onDone }: { person: Person; onDone: (m: string) => void }) {
  const t = useT(); const [sp] = useSearchParams(); const renew = sp.get('renew'); const { driver } = useContext(SelfCtx); const PAPER_KINDS = driver ? DRIVER_PAPERS : OFFICE_PAPERS
  const [kind, setKind] = useState(renew && PAPER_KINDS.some((k) => k[0] === renew) ? renew : PAPER_KINDS[0][0]); const [exp, setExp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [cam, setCam] = useState<null | 'front' | 'back' | 'single'>(null)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { if (renew) setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }, [renew])
  const twoSided = PAPER_KINDS.find((k) => k[0] === kind)?.[2] ?? false
  const label = t(PAPER_KINDS.find((k) => k[0] === kind)?.[1] ?? kind)
  const save = async (dataUrl: string, side: '' | 'front' | 'back') => {
    setBusy(true); setErr('')
    try {
      await hrApi.addDoc('me', { kind, title: `${PAPER_KINDS.find((k) => k[0] === kind)?.[1] ?? kind}${side ? ` — ${side}` : ''}`, dataUrl, expiresOn: ['id', 'contract', 'tax', 'certificate'].includes(kind) ? null : exp || null, side })
      if (side === 'front' && twoSided) { setCam('back'); onDone(t('Front saved — now the back.')) } else { setCam(null); onDone(t('Uploaded — the office will check it.')); setExp('') }
    } catch (e) { setErr(errOf(e, t('Could not upload.'))); setCam(null) } finally { setBusy(false) }
  }
  const status = (x: Person['docs'][number]) => x.status === 'checked' ? <span className="rounded-full bg-teal/15 px-2 py-0.5 text-sm font-semibold text-teal">{t('Checked')}</span> : x.status === 'rejected' ? <span className="rounded-full bg-danger/10 px-2 py-0.5 text-sm font-semibold text-danger">{t('Upload again')}</span> : <span className="rounded-full bg-gold/15 px-2 py-0.5 text-sm font-semibold text-gold-deep">{t('Waiting for the office')}</span>
  return (
    <section ref={box} className={`mt-5 rounded-3xl border bg-surface p-5 ${renew ? 'border-2 border-gold' : 'border-border'}`} aria-labelledby="pap-h" data-testid="papers">
      <h2 id="pap-h" className="!text-lg">{t('My papers')}</h2>
      {person.docs.length ? <ul className="mt-2 divide-y divide-border text-base">{person.docs.map((x) => <li key={x.id} className="py-2.5" data-testid="my-doc"><div className="flex items-center gap-2"><FileText size={18} aria-hidden="true" /><span className="min-w-0 flex-1">{x.title || x.kind}{x.expiresOn ? <span className="block text-sm text-text-muted">{t('Expires {date}', { date: niceDay(x.expiresOn) })}</span> : null}</span>{status(x)}</div>{x.status === 'rejected' && x.reviewNote && <p className="mt-1 rounded-xl bg-danger/10 p-2 text-sm">“{x.reviewNote}” — {x.reviewedBy}</p>}</li>)}</ul> : <p className="mt-2 text-base text-text-muted">{t('Nothing uploaded yet.')}</p>}
      <div className="mt-4 grid gap-3">
        <div><label htmlFor="pap-kind" className="label-dark">{renew ? t('Upload the new one') : t('What is it?')}</label><select id="pap-kind" className="input-dark !min-h-12" value={kind} onChange={(e) => setKind(e.target.value)}>{PAPER_KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        {!['id', 'contract', 'tax', 'certificate'].includes(kind) && <div><label htmlFor="pap-exp" className="label-dark">{t('Expiry date')}</label><input id="pap-exp" type="date" className="input-dark !min-h-12" value={exp} onChange={(e) => setExp(e.target.value)} /></div>}
        <Big tone="gold" disabled={busy} onClick={() => setCam(twoSided ? 'front' : 'single')} testid="pap-camera"><Camera size={20} aria-hidden="true" /> {busy ? t('Uploading…') : twoSided ? t('Photograph the front, then the back') : t('Take a photo')}</Big>
      </div>
      {cam && <CardCamera title={cam === 'back' ? t('{doc} — back', { doc: label }) : cam === 'front' ? t('{doc} — front', { doc: label }) : label} hint={cam === 'back' ? t('Turn it over and photograph the back.') : t('Lay it flat on a dark surface, in good light, with no glare.')} shape={['id', 'licence'].includes(kind) ? 'card' : 'page'} onClose={() => setCam(null)} onPhoto={(u) => void save(u, cam === 'single' ? '' : cam)} />}
      <Msg err={err} />
    </section>
  )
}

/** Digital driver badge with a QR code the warehouse gate or a checkpoint can scan. */
function BadgeCard() {
  const t = useT(); const [b, setB] = useState<{ badge: Badge; verifyUrl: string } | null>(null); const [qr, setQr] = useState(''); const [cam, setCam] = useState(false); const [err, setErr] = useState('')
  const load = () => hrApi.badge().then((x) => { setB(x); void QRCode.toDataURL(x.verifyUrl, { margin: 1, width: 240 }).then(setQr) }).catch((e) => setErr(errOf(e, t('Could not load.'))))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return err ? <Msg err={err} /> : null
  const x = b.badge; const ok = x.active && x.papersOk
  return (
    <section className="mt-5" aria-labelledby="badge-h" data-testid="badge">
      <h2 id="badge-h" className="!text-lg">{t('My driver badge')}</h2>
      <div className="mt-2 overflow-hidden rounded-3xl border-2 border-border bg-white text-[#0D1424] shadow-sm">
        <div className="flex items-center justify-between bg-[#0D1424] px-5 py-3 text-white"><span className="font-heading text-lg font-bold">{x.company}</span><span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${ok ? 'bg-[#3FB950] text-[#0D1424]' : 'bg-[#F5B82E] text-[#0D1424]'}`}>{ok ? t('Valid') : t('Not valid')}</span></div>
        <div className="flex gap-4 p-5">
          {x.photo ? <img src={x.photo} alt={t('Photo of {name}', { name: x.name })} className="h-32 w-24 shrink-0 rounded-xl object-cover" /> : <button onClick={() => setCam(true)} className="grid h-32 w-24 shrink-0 place-items-center rounded-xl border-2 border-dashed border-[#0D1424]/30 text-center text-sm font-semibold" data-testid="badge-photo"><Camera size={22} aria-hidden="true" />{t('Add photo')}</button>}
          <div className="min-w-0 flex-1"><p className="text-xl font-bold leading-tight">{x.name}</p><p className="text-base">{t(x.role === 'pickup_driver' ? 'Pickup driver' : x.role === 'delivery_driver' ? 'Delivery driver' : 'Driver')}</p>{x.licenceClass && <p className="mt-1 text-sm">{t('Licence class {c}', { c: x.licenceClass })}{x.licenceExpires ? ` · ${t('expires {date}', { date: x.licenceExpires })}` : ''}</p>}{x.since && <p className="text-sm">{t('Since {date}', { date: x.since })}</p>}</div>
        </div>
        {qr && <div className="flex items-center gap-4 border-t border-[#0D1424]/10 px-5 py-4"><img src={qr} alt={t('QR code to check this badge')} className="h-28 w-28" /><p className="text-sm">{t('Scan to check this badge is valid right now. It shows only the name, photo and company.')}</p></div>}
      </div>
      {!ok && <p className="mt-2 text-base text-danger">{x.expired.length ? t('Not valid until you upload: {list}.', { list: x.expired.map((e) => t(e)).join(', ') }) : t('Ask the office to activate your account.')}</p>}
      {x.photo && <button onClick={() => setCam(true)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-gold-deep"><Camera size={18} aria-hidden="true" /> {t('Change photo')}</button>}
      {cam && <CardCamera title={t('Badge photo')} hint={t('Face the camera, plain background, no sunglasses or hat.')} shape="face" onClose={() => setCam(false)} onPhoto={async (u) => { try { await hrApi.setPhoto(u); setCam(false); await load() } catch (e) { setErr(errOf(e, t('Could not save.'))); setCam(false) } }} />}
      <Msg err={err} />
    </section>
  )
}

function Details({ person, onDone }: { person: Person; onDone: (m: string) => void }) {
  const t = useT(); const [em, setEm] = useState({ name: person.emergency.name ?? '', phone: person.emergency.phone ?? '', relation: person.emergency.relation ?? '' }); const [po, setPo] = useState({ method: person.payout.method ?? '', momo: person.payout.momo ?? '', zelle: person.payout.zelle ?? '', bankName: person.payout.bankName ?? '', bankLast4: person.payout.bankLast4 ?? '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  return (
    <Card title={t('Emergency contact & how you get paid')} id="det-h" testid="details">
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await hrApi.saveMe({ emergency: em, payout: po as Person['payout'] }); onDone(t('Saved.')) } catch (er) { setErr(errOf(er, t('Could not save.'))) } finally { setBusy(false) } }} className="mt-2 grid gap-3">
        <div><label htmlFor="em-name" className="label-dark">{t('Emergency contact')}</label><input id="em-name" className="input-dark !min-h-12" value={em.name} onChange={(e) => setEm({ ...em, name: e.target.value })} data-testid="em-name" /></div>
        <div className="grid grid-cols-2 gap-2"><div><label htmlFor="em-phone" className="label-dark">{t('Their phone')}</label><input id="em-phone" inputMode="tel" className="input-dark !min-h-12" value={em.phone} onChange={(e) => setEm({ ...em, phone: e.target.value })} /></div><div><label htmlFor="em-rel" className="label-dark">{t('Relation')}</label><input id="em-rel" className="input-dark !min-h-12" value={em.relation} onChange={(e) => setEm({ ...em, relation: e.target.value })} /></div></div>
        <div><label htmlFor="po-m" className="label-dark">{t('Pay me by')}</label><select id="po-m" className="input-dark !min-h-12" value={po.method} onChange={(e) => setPo({ ...po, method: e.target.value })}><option value="">—</option><option value="momo">{t('Mobile money')}</option><option value="bank">{t('Bank')}</option><option value="zelle">Zelle</option><option value="cash">{t('Cash')}</option></select></div>
        {po.method === 'momo' && <div><label htmlFor="po-momo" className="label-dark">{t('MoMo number')}</label><input id="po-momo" inputMode="tel" className="input-dark !min-h-12" value={po.momo} onChange={(e) => setPo({ ...po, momo: e.target.value })} /></div>}
        {po.method === 'zelle' && <div><label htmlFor="po-z" className="label-dark">{t('Zelle email or phone')}</label><input id="po-z" className="input-dark !min-h-12" value={po.zelle} onChange={(e) => setPo({ ...po, zelle: e.target.value })} /></div>}
        {po.method === 'bank' && <div className="grid grid-cols-2 gap-2"><div><label htmlFor="po-b" className="label-dark">{t('Bank')}</label><input id="po-b" className="input-dark !min-h-12" value={po.bankName} onChange={(e) => setPo({ ...po, bankName: e.target.value })} /></div><div><label htmlFor="po-l4" className="label-dark">{t('Account (last 4)')}</label><input id="po-l4" inputMode="numeric" maxLength={4} className="input-dark !min-h-12" value={po.bankLast4} onChange={(e) => setPo({ ...po, bankLast4: e.target.value.replace(/\D/g, '') })} /></div><p className="col-span-2 text-sm text-text-muted">{t('Give the full account details to the office in person — the app keeps only the last 4 digits.')}</p></div>}
        <Big type="submit" tone="gold" disabled={busy} testid="details-save"><Check size={20} aria-hidden="true" /> {t('Save')}</Big>
      </form>
      <Msg err={err} />
    </Card>
  )
}

/** Drivers: /dashboard/runs/pay · time · me. Office staff: /dashboard/me/pay · time · file (same pages, without the driver extras). */
export default function DriverHr({ section, office = false }: { section: 'pay' | 'time' | 'me'; office?: boolean }) {
  const { ready, user } = useStore()
  if (!ready) return <BrandLoader partner />
  const here = office ? `/dashboard/me/${section === 'me' ? 'file' : section}` : `/dashboard/runs/${section}`
  if (!user) return <Navigate to={`/login?role=shipper&next=${here}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const driver = isDriverRole(user.staffRole)
  if (driver && office) return <Navigate to={`/dashboard/runs/${section}`} replace />
  if (!driver && !office) return <Navigate to={`/dashboard/me/${section === 'me' ? 'file' : section}`} replace />
  return <SelfCtx.Provider value={{ driver, home: driver ? '/dashboard/runs' : roleHome[(user.staffRole ?? 'owner') as StaffRole] ?? '/dashboard/shipper' }}>{section === 'pay' ? <MyPay /> : section === 'time' ? <MyTime /> : <MyFile />}</SelfCtx.Provider>
}

/** /dashboard/payslip/:id — drivers and the office. */
export function PayslipPage() {
  const { id } = useParams(); const { ready, user } = useStore()
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login" replace />
  return <PayslipView id={id ?? ''} />
}

/** Public: /verify/driver/:token — what a gate or checkpoint sees when they scan a badge. */
export function VerifyDriverPage() {
  const { token } = useParams(); const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.verify>> | null>(null); const [err, setErr] = useState('')
  useEffect(() => { hrApi.verify(token ?? '').then(setD).catch((e) => setErr(errOf(e, 'This badge isn’t valid.'))) }, [token])
  return (
    <div className="bg-bg text-text"><div className="container-x max-w-md py-12" data-testid="verify-page">
      <h1 className="!text-2xl">Driver check</h1>
      {err && <p role="alert" className="mt-4 rounded-2xl border-2 border-danger bg-danger/10 p-5 text-lg font-semibold text-danger">{err}</p>}
      {d && <div className={`mt-4 rounded-3xl border-2 p-5 ${d.valid ? 'border-teal bg-teal/5' : 'border-danger bg-danger/5'}`}>
        <p className={`text-2xl font-bold ${d.valid ? 'text-teal' : 'text-danger'}`}>{d.valid ? '✓ Valid driver' : '✕ Not valid'}</p>
        <div className="mt-4 flex gap-4">{d.photo && <img src={d.photo} alt={`Photo of ${d.name}`} className="h-32 w-24 rounded-xl object-cover" />}<div><p className="text-xl font-bold">{d.name}</p><p>{d.role === 'pickup_driver' ? 'Pickup driver' : d.role === 'delivery_driver' ? 'Delivery driver' : 'Driver'}</p><p className="font-semibold">{d.company}</p></div></div>
        {!d.valid && <p className="mt-3 text-base">{!d.active ? 'No longer works for this company.' : 'Their papers have expired.'}</p>}
        <p className="mt-4 text-sm text-text-muted">Checked {new Date(d.checkedAt).toLocaleString()} · Ntemtem</p>
      </div>}
    </div></div>
  )
}
