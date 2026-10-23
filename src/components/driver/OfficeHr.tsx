import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Award, Check, ChevronLeft, ChevronRight, Download, FileText, Lock, MessageSquareWarning, Plus, Printer, Settings2, Share2, Trash2, Upload, UserMinus, X } from 'lucide-react'
import { ADJ_LABEL, LEAVE_LABEL, hrApi, money, type AdvanceReq, type Analytics, type HrSettings, type Leave, type PayDetail, type PayQuery, type Person, type Rota, type StaffPay } from '../../lib/driverHrApi'
import { payslipPdf, shareOrDownload } from '../../lib/payslipPdf'
import { useStore } from '../../lib/store'
import { isDriverRole } from '../../lib/roles'
import { driverApi } from '../../lib/driverApi'
import { Th, thead, trow } from '../board'
import { fmtDateTime } from '../ui'
import { Panel, Trend, C } from '../Charts'

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">{children}</p>
const Err = ({ e }: { e: string }) => (e ? <p role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{e}</p> : null)
const msg = (e: unknown, f = 'Something went wrong.') => (e instanceof Error ? e.message : f)
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const pct = (n: number | null) => (n == null ? '—' : `${n}%`)
const CURS = ['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR']
export const ROLE = (r?: string) => ({ pickup_driver: 'Pickup driver', delivery_driver: 'Delivery driver', driver: 'Driver', dispatcher: 'Dispatcher', finance: 'Finance', warehouse: 'Warehouse', agent: 'Agent', owner: 'Owner' } as Record<string, string>)[r ?? ''] ?? 'Staff'
const isDrv = (r?: string) => r === 'pickup_driver' || r === 'delivery_driver' || r === 'driver'
const payText = (p: StaffPay) => [p.monthly ? `${money(p.monthly, p.currency)}/month` : '', p.perStop ? `${money(p.perStop, p.currency)}/stop` : '', p.perRun ? `${money(p.perRun, p.currency)}/run` : '', p.perHour ? `${money(p.perHour, p.currency)}/h` : ''].filter(Boolean).join(' · ')
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })

/* ============================== Payroll ============================== */
export function PayrollTab({ toast }: { toast: (m: string) => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.pay>> | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('')
  const [paying, setPaying] = useState<string | null>(null); const [pm, setPm] = useState({ method: 'momo', ref: '' }); const [rules, setRules] = useState(false)
  const [qs, setQs] = useState<PayQuery[]>([]); const [ars, setArs] = useState<AdvanceReq[]>([]); const [ans, setAns] = useState<Record<string, string>>({})
  const load = () => { hrApi.queries().then(setQs).catch(() => {}); hrApi.advances().then(setArs).catch(() => {}); return hrApi.pay().then(setD).catch((e) => setErr(msg(e))) }
  useEffect(() => { void load() }, [])
  if (!d) return err ? <Err e={err} /> : <p className="text-sm text-text-muted">Loading pay…</p>
  const openQ = qs.filter((q) => q.status === 'open'); const pendAr = ars.filter((a) => a.status === 'pending')
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); setErr(''); try { await fn(); toast(ok); await load() } catch (e) { setErr(msg(e)) } finally { setBusy('') } }
  const prevStart = addDays(d.current.start, -d.settings.periodDays)
  const pendingEx = d.expenses.filter((e) => e.status === 'pending')
  const drafts = d.payslips.filter((s) => s.status === 'draft'); const owed = d.payslips.filter((s) => s.status === 'approved')
  return (
    <div className="grid gap-6">
      <Err e={err} />
      <Panel title={`This pay period · ${day(d.current.start)} – ${day(d.current.end)}`} sub="Running totals — nothing is final until you close the period and approve the payslips." actions={<div className="flex flex-wrap gap-2">
        <button onClick={() => act('closeprev', () => hrApi.close(prevStart), 'Last period closed — check the draft payslips below.')} disabled={!!busy} className="btn-ghost !min-h-10 text-sm" data-testid="close-prev"><Lock size={14} aria-hidden="true" /> Close last period</button>
        <button onClick={() => { if (confirm('Close this period now? Anything done after this goes on the next payslip.')) void act('closecur', () => hrApi.close(d.current.start), 'Period closed — check the draft payslips below.') }} disabled={!!busy} className="btn-gold !min-h-10 text-sm" data-testid="close-cur"><Lock size={14} aria-hidden="true" /> Close this period now</button>
      </div>}>
        {d.preview.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className={thead}><tr><Th>Person</Th><Th>Stops</Th><Th>Hours</Th><Th>Pay</Th><Th>Expenses back</Th><Th>Deductions</Th><Th>Net so far</Th></tr></thead>
          <tbody>{d.preview.map((p) => <tr key={p.staffId} className={trow()} data-testid="pay-preview"><td className="px-3 py-3 font-semibold">{p.name}<span className="block text-xs font-normal text-text-muted">{ROLE(p.role)}</span></td><td className="px-3 py-3 tabular-nums">{isDrv(p.role) ? p.stats.stops : '—'}</td><td className="px-3 py-3 tabular-nums">{p.stats.hours}{p.stats.overtime ? <span className="block text-xs text-gold-deep">{p.stats.overtime} h overtime</span> : null}</td><td className="px-3 py-3 tabular-nums">{money(p.gross, p.currency)}</td><td className="px-3 py-3 tabular-nums">{money(p.reimbursed, p.currency)}</td><td className="px-3 py-3 tabular-nums">{p.deducted ? `−${money(p.deducted, p.currency)}` : '—'}</td><td className="px-3 py-3 font-semibold tabular-nums">{money(p.net, p.currency)}</td></tr>)}</tbody></table></div> : <Empty>No active staff.</Empty>}
      </Panel>

      <Panel title="Payslips" sub={`${drafts.length} to approve · ${owed.length} approved and not paid yet`} actions={drafts.length ? <button onClick={() => act('all', () => hrApi.approveAll(drafts[0].periodId), 'Payslips approved — everyone can see theirs now.')} disabled={!!busy} className="btn-gold !min-h-10 text-sm" data-testid="approve-all"><Check size={14} aria-hidden="true" /> Approve all drafts</button> : null}>
        {d.payslips.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className={thead}><tr><Th>Person</Th><Th>Period</Th><Th>Gross</Th><Th>Back</Th><Th>Deducted</Th><Th>Net</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{d.payslips.map((s) => <tr key={s.id} className={trow()} data-testid="slip-row">
            <td className="px-3 py-3 font-semibold">{s.name}{s.stats.final && <span className="ml-1 rounded bg-surface-2 px-1.5 text-xs">final</span>}</td>
            <td className="px-3 py-3">{day(s.start)} – {day(s.end)}</td><td className="px-3 py-3 tabular-nums">{money(s.gross, s.currency)}</td><td className="px-3 py-3 tabular-nums">{money(s.reimbursed, s.currency)}</td><td className="px-3 py-3 tabular-nums">{s.deducted ? `−${money(s.deducted, s.currency)}` : '—'}</td><td className="px-3 py-3 font-semibold tabular-nums">{money(s.net, s.currency)}</td>
            <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === 'paid' ? 'bg-teal/15 text-teal' : s.status === 'approved' ? 'bg-gold/15 text-gold-deep' : 'bg-surface-2'}`}>{s.status === 'paid' ? `Paid · ${s.paidMethod}` : s.status === 'approved' ? 'To pay' : 'Draft'}</span></td>
            <td className="px-3 py-3 text-right"><div className="flex flex-wrap justify-end gap-1">
              <Link to={`/dashboard/payslip/${s.id}`} className="btn-ghost !min-h-9 !px-2.5 text-xs" aria-label={`Open payslip for ${s.name}`}><Printer size={13} aria-hidden="true" /> Open</Link>
              {s.status === 'draft' && <><button onClick={() => act(s.id, () => hrApi.recalc(s.id), 'Recalculated.')} disabled={!!busy} className="btn-ghost !min-h-9 !px-2.5 text-xs">Recalculate</button><button onClick={() => act(s.id, () => hrApi.approve(s.id), `${s.name}’s payslip approved.`)} disabled={!!busy} className="btn-gold !min-h-9 !px-2.5 text-xs" data-testid="slip-approve">Approve</button></>}
              {s.status === 'approved' && (paying === s.id ? <form onSubmit={(e) => { e.preventDefault(); void act(s.id, () => hrApi.paid(s.id, pm.method, pm.ref), `${s.name} marked paid.`).then(() => setPaying(null)) }} className="flex flex-wrap items-center gap-1"><label className="sr-only" htmlFor={`pm-${s.id}`}>How paid</label><select id={`pm-${s.id}`} className="input-dark !min-h-9 !w-auto text-xs" value={pm.method} onChange={(e) => setPm({ ...pm, method: e.target.value })}>{['momo', 'bank', 'zelle', 'cash', 'check', 'other'].map((m) => <option key={m}>{m}</option>)}</select><label className="sr-only" htmlFor={`pr-${s.id}`}>Reference</label><input id={`pr-${s.id}`} className="input-dark !min-h-9 !w-28 text-xs" placeholder="Ref (optional)" value={pm.ref} onChange={(e) => setPm({ ...pm, ref: e.target.value })} /><button className="btn-gold !min-h-9 !px-2.5 text-xs" data-testid="slip-paid-save">Save</button></form>
                : <button onClick={() => { setPaying(s.id); setPm({ method: 'momo', ref: '' }) }} className="btn-gold !min-h-9 !px-2.5 text-xs" data-testid="slip-paid">Mark paid</button>)}
            </div></td></tr>)}</tbody></table></div> : <Empty>No payslips yet. Close a pay period to make them.</Empty>}
      </Panel>

      {(qs.length > 0 || ars.length > 0) && <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Pay questions" sub={openQ.length ? `${openQ.length} waiting for an answer` : 'All answered'} testid="pay-queries">
          {qs.length ? <ul className="space-y-2 text-sm">{qs.map((q) => <li key={q.id} className={`rounded-xl border p-3 ${q.status === 'open' ? 'border-gold/60' : 'border-border'}`} data-testid="query-row"><p className="text-xs text-text-muted"><b className="text-text">{q.name}</b> · {fmtDateTime(q.at)}{q.line ? ` · ${q.line}` : ''}{q.payslipId ? <> · <Link to={`/dashboard/payslip/${q.payslipId}`} className="underline">payslip</Link></> : ' · this period'}</p><p className="mt-1">{q.note}</p>
            {q.status === 'answered' ? <p className="mt-1 text-teal">↳ {q.answer} <span className="text-xs text-text-muted">— {q.answeredBy}</span></p> : <form onSubmit={(e) => { e.preventDefault(); void act(q.id, () => hrApi.answer(q.id, ans[q.id] ?? ''), 'Answer sent.') }} className="mt-2 flex gap-2"><label className="sr-only" htmlFor={`ans-${q.id}`}>Answer</label><input id={`ans-${q.id}`} className="input-dark !min-h-10 flex-1" value={ans[q.id] ?? ''} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} placeholder="Your answer (they get a notification)" data-testid="query-answer" /><button disabled={(ans[q.id] ?? '').trim().length < 2 || !!busy} className="btn-gold !min-h-10 text-xs">Send</button></form>}</li>)}</ul> : <Empty>No questions.</Empty>}
        </Panel>
        <Panel title="Advance requests" sub={pendAr.length ? `${pendAr.length} waiting` : 'Nothing waiting'} testid="adv-requests">
          {ars.length ? <ul className="space-y-2 text-sm">{ars.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3" data-testid="adv-row"><span className="min-w-0 flex-1"><b>{a.name}</b> · {money(a.amount, a.currency)} over {a.installments} payslip{a.installments === 1 ? '' : 's'}<span className="block text-xs text-text-muted">{a.reason} · {fmtDateTime(a.at)}</span></span>
            {a.status === 'pending' ? <><button onClick={() => act(a.id, () => hrApi.decideAdvance(a.id, 'approved'), 'Advance approved — it’s on their payslip plan.')} disabled={!!busy} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="adv-approve">Approve</button><button onClick={() => act(a.id, () => hrApi.decideAdvance(a.id, 'declined'), 'Declined.')} disabled={!!busy} className="btn-ghost !min-h-9 !px-3 text-xs">Decline</button></> : <span className={`text-xs font-semibold ${a.status === 'approved' ? 'text-teal' : 'text-text-muted'}`}>{a.status === 'approved' ? 'Approved' : 'Declined'} · {a.decidedBy}</span>}</li>)}</ul> : <Empty>No requests.</Empty>}
        </Panel>
      </div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Expenses to approve" sub="Approved expenses someone paid for themselves go on their next payslip. Rejected ones come out of Costs & profit.">
          {pendingEx.length ? <ul className="space-y-2">{pendingEx.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm" data-testid="exp-pending">
            {e.photo ? <a href={e.photo} target="_blank" rel="noreferrer"><img src={e.photo} alt={`Receipt: ${e.kind}`} className="h-12 w-12 rounded object-cover" /></a> : <span className="grid h-12 w-12 place-items-center rounded bg-surface-2 text-xs text-text-muted">No photo</span>}
            <span className="min-w-0 flex-1"><b>{e.name}</b> · <span className="capitalize">{e.kind}</span> · {money(e.amount, e.currency)}<span className="block text-xs text-text-muted">{e.note || '—'} · {fmtDateTime(e.at)} · {e.paidBy === 'company' ? 'company card' : 'they paid'}</span></span>
            <button onClick={() => act(e.id, () => hrApi.decideExpense(e.id, 'approved'), 'Expense approved.')} disabled={!!busy} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="exp-approve">Approve</button>
            <button onClick={() => act(e.id, () => hrApi.decideExpense(e.id, 'rejected'), 'Expense rejected.')} disabled={!!busy} className="btn-ghost !min-h-9 !px-3 text-xs">Reject</button></li>)}</ul> : <Empty>Nothing waiting.</Empty>}
        </Panel>
        <Panel title="Advances, deductions & bonuses" sub="Add them from someone’s file under People. Deductions come off in instalments and never take a payslip below zero.">
          {d.adjustments.length ? <ul className="divide-y divide-border text-sm">{d.adjustments.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1"><b>{a.name}</b> · {ADJ_LABEL[a.kind] ?? a.kind} {money(a.amount, a.currency)}{a.note ? ` · ${a.note}` : ''}</span><span className={`text-xs ${a.remaining > 0 ? 'text-gold-deep' : 'text-teal'}`}>{a.remaining > 0 ? `${money(a.remaining, a.currency)} left${a.installments > 1 ? ` · ${a.installments} instalments` : ''}` : 'settled'}</span>{!a.applied && <button onClick={() => act(a.id, () => hrApi.delAdjust(a.id), 'Removed.')} className="grid h-9 w-9 place-items-center rounded-md text-text-muted hover:text-danger" aria-label={`Remove ${ADJ_LABEL[a.kind]} for ${a.name}`}><Trash2 size={14} /></button>}</li>)}</ul> : <Empty>None.</Empty>}
        </Panel>
      </div>

      <Panel title="Pay rates" sub="Office staff usually have a monthly salary; drivers are paid per stop, per run or per hour. Mix them if you need to.">
        <Rates rows={d.preview.map((p) => ({ staffId: p.staffId, name: p.name, role: p.role ?? '', pay: p.pay ?? {} }))} onSaved={() => { toast('Pay rates saved.'); void load() }} />
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setRules((v) => !v)} aria-expanded={rules} className="btn-ghost !min-h-10 text-sm" data-testid="pay-rules"><Settings2 size={14} aria-hidden="true" /> Pay rules, bonuses &amp; reminders</button>
        <a href={`/api/drivers/year-end.csv?year=${new Date().getFullYear()}`} download className="btn-ghost !min-h-10 text-sm"><Download size={14} aria-hidden="true" /> Year-end totals (1099 / tax)</a>
        <a href={`/api/drivers/monthly.csv?year=${new Date().getFullYear()}`} download className="btn-ghost !min-h-10 text-sm"><Download size={14} aria-hidden="true" /> Monthly pay for your accountant</a>
      </div>
      {rules && <HrSettingsForm initial={d.settings} onSaved={(s) => { setD({ ...d, settings: s }); toast('Pay rules saved.') }} />}
      <p className="text-xs text-text-muted">The year-end file flags US contractors paid at or above your 1099 threshold. Ghana SSNIT and PAYE, and US withholding for employees, are worked out by your accountant from the monthly file — the app doesn’t file tax.</p>
    </div>
  )
}

function Rates({ rows, onSaved }: { rows: { staffId: string; name: string; role: string; pay: StaffPay }[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null); const [f, setF] = useState({ monthly: '', perStop: '', perRun: '', perHour: '', currency: 'USD' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const save = async () => { if (!edit) return; setBusy(true); setErr(''); try { await driverApi.setPay(edit, { monthly: Number(f.monthly) || 0, perStop: Number(f.perStop) || 0, perRun: Number(f.perRun) || 0, perHour: Number(f.perHour) || 0, currency: f.currency }); setEdit(null); onSaved() } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }
  if (!rows.length) return <Empty>No staff yet.</Empty>
  return <><Err e={err} /><ul className="divide-y divide-border text-sm">{rows.map((s) => <li key={s.staffId} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="rate-row">
    <span className="min-w-[10rem] flex-1"><b>{s.name}</b><span className="block text-xs text-text-muted">{ROLE(s.role)}</span></span>
    {edit === s.staffId ? <div className="flex flex-wrap items-end gap-2">{(['monthly', 'perStop', 'perRun', 'perHour'] as const).map((k) => <label key={k} className="text-xs">{k === 'monthly' ? 'Monthly salary' : k === 'perStop' ? 'Per stop' : k === 'perRun' ? 'Per run' : 'Per hour'}<input inputMode="decimal" className="input-dark mt-1 !min-h-9 !w-24 tabular-nums" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></label>)}<label className="text-xs">Currency<select className="input-dark mt-1 !min-h-9 !w-24" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURS.map((c) => <option key={c}>{c}</option>)}</select></label><button onClick={save} disabled={busy} className="btn-gold !min-h-9 text-xs" data-testid="pay-save">Save</button><button onClick={() => setEdit(null)} className="btn-ghost !min-h-9 text-xs">Cancel</button></div>
      : <><span className="text-text-muted">{payText(s.pay) || 'No rate set'}</span><button onClick={() => { setEdit(s.staffId); setF({ monthly: String(s.pay.monthly ?? ''), perStop: String(s.pay.perStop ?? ''), perRun: String(s.pay.perRun ?? ''), perHour: String(s.pay.perHour ?? ''), currency: s.pay.currency ?? 'USD' }) }} className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`Set pay for ${s.name}`} data-testid="pay-edit">Edit</button></>}
  </li>)}</ul></>
}

function HrSettingsForm({ initial, onSaved }: { initial: HrSettings; onSaved: (s: HrSettings) => void }) {
  const [s, setS] = useState(initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [hol, setHol] = useState(initial.holidays.join(', ')); const [vids, setVids] = useState(initial.trainingVideos.map((v) => `${v.title} | ${v.url}`).join('\n'))
  const num = (k: keyof HrSettings, id: string) => <input id={id} inputMode="decimal" className="input-dark !min-h-10 tabular-nums" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
  const save = async () => { setBusy(true); setErr(''); try { const holidays = hol.split(/[\s,]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)); const trainingVideos = vids.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x.length === 2 && x[0] && /^https?:\/\//.test(x[1])).map(([title, url]) => ({ title, url })); onSaved(await hrApi.saveSettings({ ...s, holidays, trainingVideos })) } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }
  return (
    <section className="card-dark grid gap-4 p-5 md:grid-cols-3" aria-label="Pay rules" data-testid="hr-settings">
      <Err e={err} />
      <div><label htmlFor="hs-days" className="label-dark">Pay period</label><select id="hs-days" className="input-dark !min-h-10" value={s.periodDays} onChange={(e) => setS({ ...s, periodDays: Number(e.target.value) as 7 | 14 })}><option value={7}>Weekly</option><option value={14}>Every two weeks</option></select></div>
      <div><label htmlFor="hs-anchor" className="label-dark">Periods start on (any start date)</label><input id="hs-anchor" type="date" className="input-dark !min-h-10" value={s.periodAnchor} onChange={(e) => setS({ ...s, periodAnchor: e.target.value })} /></div>
      <div><label htmlFor="hs-ot" className="label-dark">Overtime after (hours a week)</label>{num('overtimeAfter', 'hs-ot')}</div>
      <div><label htmlFor="hs-otr" className="label-dark">Overtime rate (× hourly)</label>{num('overtimeRate', 'hs-otr')}</div>
      <div><label htmlFor="hs-wk" className="label-dark">Weekend rate (× normal)</label>{num('weekendRate', 'hs-wk')}<p className="mt-1 text-xs text-text-muted">1 = no extra</p></div>
      <div><label htmlFor="hs-hol" className="label-dark">Public holiday rate (× normal)</label>{num('holidayRate', 'hs-hol')}</div>
      <div className="md:col-span-3"><label htmlFor="hs-hols" className="label-dark">Public holidays (YYYY-MM-DD, comma separated)</label><input id="hs-hols" className="input-dark !min-h-10" value={hol} onChange={(e) => setHol(e.target.value)} placeholder="2026-12-25, 2027-01-01, 2027-03-06" /></div>
      <div><label htmlFor="hs-warn" className="label-dark">Warn after (hours on one shift)</label>{num('warnShiftHours', 'hs-warn')}</div>
      <div><label htmlFor="hs-max" className="label-dark">Longest shift allowed (hours)</label>{num('maxShiftHours', 'hs-max')}<p className="mt-1 text-xs text-text-muted">A missed clock-out is flagged 2 hours after this.</p></div>
      <div><label htmlFor="hs-leave" className="label-dark">Holiday days a year (default for everyone)</label>{num('leaveDays', 'hs-leave')}</div>
      <div><label htmlFor="hs-otp" className="label-dark">On-time bonus: at or above (%)</label><input id="hs-otp" inputMode="numeric" className="input-dark !min-h-10" value={s.bonusOnTime.pct} onChange={(e) => setS({ ...s, bonusOnTime: { ...s.bonusOnTime, pct: Number(e.target.value.replace(/\D/g, '')) || 0 } })} /></div>
      <div><label htmlFor="hs-ota" className="label-dark">On-time bonus amount (USD, 0 = off)</label><input id="hs-ota" inputMode="decimal" className="input-dark !min-h-10" value={s.bonusOnTime.amount} onChange={(e) => setS({ ...s, bonusOnTime: { ...s.bonusOnTime, amount: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } })} /></div>
      <div><label htmlFor="hs-nd" className="label-dark">No-damage bonus per period (USD, 0 = off)</label>{num('bonusNoDamage', 'hs-nd')}</div>
      <div><label htmlFor="hs-1099" className="label-dark">1099 threshold (USD)</label>{num('threshold1099', 'hs-1099')}<p className="mt-1 text-xs text-text-muted">Ask your accountant for this year’s figure.</p></div>
      <div className="flex items-end"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={s.showLeaderboard} onChange={(e) => setS({ ...s, showLeaderboard: e.target.checked })} /> Show drivers their place on the leaderboard</label></div>
      <div className="md:col-span-3"><label htmlFor="hs-vids" className="label-dark">Training videos for new drivers (one per line: Title | https://link)</label><textarea id="hs-vids" rows={3} className="input-dark py-2" value={vids} onChange={(e) => setVids(e.target.value)} placeholder="Proof of delivery | https://youtu.be/…" /></div>
      <div className="md:col-span-3 flex justify-end"><button onClick={save} disabled={busy} className="btn-gold !min-h-10 text-sm" data-testid="hr-settings-save"><Check size={14} aria-hidden="true" /> Save rules</button></div>
    </section>
  )
}

/* ============================== Hours (with corrections) ============================== */
export function HoursTab({ toast }: { toast: (m: string) => void }) {
  const [shifts, setShifts] = useState<Awaited<ReturnType<typeof driverApi.shifts>>['shifts'] | null>(null); const [edit, setEdit] = useState<string | null>(null)
  const [f, setF] = useState({ start: '', end: '', reason: '' }); const [err, setErr] = useState('')
  const load = () => driverApi.shifts().then((r) => setShifts(r.shifts)).catch((e) => setErr(msg(e)))
  useEffect(() => { void load() }, [])
  const local = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  const save = async (id: string) => { setErr(''); try { await hrApi.editShift(id, new Date(f.start).toISOString(), f.end ? new Date(f.end).toISOString() : null, f.reason); setEdit(null); toast('Shift corrected — they were told.'); await load() } catch (e) { setErr(msg(e)) } }
  if (!shifts) return <p className="text-sm text-text-muted">Loading…</p>
  const long = shifts.filter((s) => !s.end && Date.now() - new Date(s.start).getTime() > 12 * 3600e3)
  return (
    <section aria-labelledby="hrs-h">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 id="hrs-h" className="!text-lg">Timesheet (last 14 days)</h2><a href="/api/drivers/timesheet.csv?days=14" className="btn-ghost !min-h-10 text-sm" download><Download size={15} aria-hidden="true" /> Download CSV</a></div>
      <Err e={err} />
      {long.length > 0 && <p className="mb-3 flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm"><AlertTriangle size={15} aria-hidden="true" /> {long.map((s) => s.name).join(', ')} still clocked in after 12 hours — probably a missed clock-out.</p>}
      {shifts.length ? <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[680px] text-sm"><thead className={thead}><tr><Th>Person</Th><Th>Clock in</Th><Th>Clock out</Th><Th>Breaks</Th><Th>Hours</Th><Th /></tr></thead>
        <tbody>{shifts.map((s) => <tr key={s.id} className={trow(edit === s.id)} data-testid="ts-row">
          <td className="px-3 py-3">{s.name}</td>
          {edit === s.id ? <td colSpan={4} className="px-3 py-3"><div className="flex flex-wrap items-end gap-2"><label className="text-xs">Clock in<input type="datetime-local" className="input-dark mt-1 !min-h-9" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label><label className="text-xs">Clock out<input type="datetime-local" className="input-dark mt-1 !min-h-9" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label><label className="text-xs">Reason<input className="input-dark mt-1 !min-h-9 !w-56" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. forgot to clock out at 6 pm" data-testid="shift-reason" /></label></div></td>
            : <><td className="px-3 py-3">{fmtDateTime(s.start)}</td><td className="px-3 py-3">{s.end ? fmtDateTime(s.end) : <span className="text-teal">{s.onBreak ? 'On a break' : 'On shift'}</span>}</td><td className="px-3 py-3">{s.breaks.length}</td><td className="px-3 py-3 font-semibold tabular-nums">{s.hours}</td></>}
          <td className="px-3 py-3 text-right">{edit === s.id ? <div className="flex justify-end gap-1"><button onClick={() => save(s.id)} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="shift-save">Save</button><button onClick={() => setEdit(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button></div> : <button onClick={() => { setEdit(s.id); setF({ start: local(s.start), end: local(s.end), reason: '' }) }} className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`Correct ${s.name}’s shift`} data-testid="shift-edit">Correct</button>}</td>
        </tr>)}</tbody></table></div> : <Empty>No clock-ins yet.</Empty>}
      <p className="mt-2 text-xs text-text-muted">Every correction is logged with who made it and why, and the person gets a notification. Office staff clock in from My time; drivers from My runs.</p>
    </section>
  )
}

/* ============================== Rota & time off ============================== */
export function RotaTab({ toast }: { toast: (m: string) => void }) {
  const monday = (d: string) => { const x = new Date(d + 'T12:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)) }
  const [from, setFrom] = useState(monday(today())); const [r, setR] = useState<Rota | null>(null); const [leave, setLeave] = useState<Leave[]>([]); const [err, setErr] = useState('')
  const [cell, setCell] = useState<null | { staffId: string; day: string }>(null); const [cf, setCf] = useState({ kind: 'work' as 'work' | 'off' | 'leave' | 'clear', start: '08:00', end: '17:00' })
  const load = () => { hrApi.rota(from, 7).then(setR).catch((e) => setErr(msg(e))); hrApi.leave().then(setLeave).catch(() => {}) }
  useEffect(() => { void load() }, [from]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from])
  const [why, setWhy] = useState<Record<string, string>>({}); const [declining, setDeclining] = useState<string | null>(null)
  const decide = async (l: Leave, status: 'approved' | 'declined') => { setErr(''); try { const x = await hrApi.decideLeave(l.id, status, status === 'declined' ? why[l.id] ?? '' : ''); setDeclining(null); toast(status === 'approved' ? (x.clashes.length ? `Approved. ${l.name} still has ${x.clashes.length} planned run${x.clashes.length === 1 ? '' : 's'} then — reassign ${x.clashes.map((c) => c.name).join(', ')}.` : 'Approved and added to the rota.') : 'Declined.'); load() } catch (e) { setErr(msg(e)) } }
  const saveCell = async () => { if (!cell) return; try { await hrApi.setRota({ ...cell, kind: cf.kind, start: cf.kind === 'work' ? cf.start : '', end: cf.kind === 'work' ? cf.end : '' }); setCell(null); load() } catch (e) { setErr(msg(e)) } }
  const pending = leave.filter((l) => l.status === 'pending')
  return (
    <div className="grid gap-6">
      <Err e={err} />
      <Panel title="Requests" sub={pending.length ? `${pending.length} waiting` : 'Nothing waiting'}>
        {leave.length ? <ul className="divide-y divide-border text-sm">{leave.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5" data-testid="leave-row"><span className="min-w-0 flex-1"><b>{l.name}</b> · {LEAVE_LABEL[l.kind]} · {day(l.start)}{l.end !== l.start ? ` – ${day(l.end)}` : ''}{l.kind === 'swap' && l.swapName ? ` with ${l.swapName}` : ''}{l.note ? <span className="block text-xs text-text-muted">{l.note}</span> : null}</span>
          {l.status === 'pending' ? (declining === l.id ? <form onSubmit={(e) => { e.preventDefault(); void decide(l, 'declined') }} className="flex w-full gap-2 sm:w-auto"><label className="sr-only" htmlFor={`why-${l.id}`}>Reason</label><input id={`why-${l.id}`} className="input-dark !min-h-9 flex-1 text-xs" value={why[l.id] ?? ''} onChange={(e) => setWhy({ ...why, [l.id]: e.target.value })} placeholder="Why (they see this)" /><button className="btn-gold !min-h-9 !px-3 text-xs">Decline</button><button type="button" onClick={() => setDeclining(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button></form> : <><button onClick={() => decide(l, 'approved')} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="leave-approve">Approve</button><button onClick={() => setDeclining(l.id)} className="btn-ghost !min-h-9 !px-3 text-xs" data-testid="leave-decline">Decline…</button></>) : <span className={`text-xs font-semibold ${l.status === 'approved' ? 'text-teal' : 'text-text-muted'}`}>{l.status === 'approved' ? 'Approved' : 'Declined'}{l.decidedBy ? ` · ${l.decidedBy}` : ''}</span>}</li>)}</ul> : <Empty>No time-off or swap requests.</Empty>}
      </Panel>
      <Panel title="Rota" sub="Tap a day to set work hours or a day off. Runs already planned show under each day." actions={<div className="flex items-center gap-1"><button onClick={() => setFrom(addDays(from, -7))} className="grid h-10 w-10 place-items-center rounded-lg border border-border" aria-label="Previous week"><ChevronLeft size={16} /></button><span className="px-2 text-sm font-semibold">{day(from)} – {day(addDays(from, 6))}</span><button onClick={() => setFrom(addDays(from, 7))} className="grid h-10 w-10 place-items-center rounded-lg border border-border" aria-label="Next week"><ChevronRight size={16} /></button></div>}>
        {!r ? <p className="text-sm text-text-muted">Loading…</p> : !r.staff.length ? <Empty>No staff yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] table-fixed text-sm" data-testid="rota"><thead className={thead}><tr><Th className="w-40">Person</Th>{days.map((d) => <Th key={d}>{day(d)}</Th>)}</tr></thead>
          <tbody>{r.staff.map((s) => <tr key={s.id} className="border-b border-border/70 align-top"><td className="px-3 py-2 font-semibold">{s.name}<span className="block text-xs font-normal text-text-muted">{ROLE(s.role)}</span></td>
            {days.map((d) => { const e = r.entries.find((x) => x.staffId === s.id && x.day === d); const lv = r.leave.find((x) => x.staffId === s.id && x.start <= d && x.end >= d); const runs = r.runs.filter((x) => x.staffId === s.id && x.day === d); const away = lv || e?.kind === 'off' || e?.kind === 'leave'
              return <td key={d} className="px-1.5 py-1.5"><button onClick={() => { setCell({ staffId: s.id, day: d }); setCf({ kind: e?.kind ?? 'work', start: e?.start || '08:00', end: e?.end || '17:00' }) }} className={`block min-h-14 w-full rounded-lg border px-2 py-1 text-left text-xs ${away ? 'border-gold/50 bg-gold/10' : e ? 'border-teal/40 bg-teal/5' : 'border-dashed border-border'}`} aria-label={`${s.name}, ${day(d)}: ${lv ? LEAVE_LABEL[lv.kind] : e ? (e.kind === 'work' ? `${e.start}–${e.end}` : e.kind) : 'not set'}${runs.length ? `, ${runs.length} run` : ''}`} data-testid="rota-cell">
                <span className="font-semibold">{lv ? LEAVE_LABEL[lv.kind] : e ? (e.kind === 'work' ? `${e.start || '?'}–${e.end || '?'}` : e.kind === 'off' ? 'Off' : 'Leave') : '—'}</span>
                {runs.map((x) => <span key={x.id} className={`mt-0.5 block truncate ${away ? 'font-semibold text-danger' : 'text-text-muted'}`}>{away ? '⚠ ' : ''}{x.name}</span>)}
              </button></td> })}
          </tr>)}</tbody></table></div>}
        {cell && <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-2/50 p-3" data-testid="rota-edit"><p className="w-full text-sm font-semibold">{r?.staff.find((s) => s.id === cell.staffId)?.name} · {day(cell.day)}</p>
          <label className="text-xs">Type<select className="input-dark mt-1 !min-h-9" value={cf.kind} onChange={(e) => setCf({ ...cf, kind: e.target.value as typeof cf.kind })}><option value="work">Working</option><option value="off">Day off</option><option value="leave">Leave</option><option value="clear">Clear</option></select></label>
          {cf.kind === 'work' && <><label className="text-xs">From<input type="time" className="input-dark mt-1 !min-h-9" value={cf.start} onChange={(e) => setCf({ ...cf, start: e.target.value })} /></label><label className="text-xs">To<input type="time" className="input-dark mt-1 !min-h-9" value={cf.end} onChange={(e) => setCf({ ...cf, end: e.target.value })} /></label></>}
          <button onClick={saveCell} className="btn-gold !min-h-9 text-xs" data-testid="rota-save">Save</button><button onClick={() => setCell(null)} className="btn-ghost !min-h-9 text-xs">Cancel</button></div>}
      </Panel>
    </div>
  )
}

/* ============================== Analytics ============================== */
export function AnalyticsTab() {
  const [a, setA] = useState<Analytics | null>(null); const [who, setWho] = useState(''); const [err, setErr] = useState(''); const [svc, setSvc] = useState<string | null>(null); const [sf, setSf] = useState({ everyKm: '', lastKm: '', lastAt: '' })
  const load = () => hrApi.analytics(12).then((x) => { setA(x); setWho((w) => w || x.scorecards[0]?.staffId || '') }).catch((e) => setErr(msg(e)))
  useEffect(() => { void load() }, [])
  if (!a) return err ? <Err e={err} /> : <p className="text-sm text-text-muted">Loading analytics…</p>
  const sc = a.scorecards.find((s) => s.staffId === who)
  const saveSvc = async (id: string) => { try { await hrApi.service(id, { everyKm: sf.everyKm ? Number(sf.everyKm) : null, lastKm: sf.lastKm ? Number(sf.lastKm) : null, lastAt: sf.lastAt || null }); setSvc(null); await load() } catch (e) { setErr(msg(e)) } }
  return (
    <div className="grid gap-6">
      <Err e={err} />
      <Panel title="Driver scorecards" sub="Last 12 weeks. First try = delivered without a “try again later”. Cash accuracy = handovers that matched to the cent.">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className={thead}><tr><Th>Driver</Th><Th>Stops done</Th><Th>On time</Th><Th>First try</Th><Th>Rating</Th><Th>Damage / incidents</Th><Th>Cash accuracy</Th></tr></thead>
          <tbody>{a.scorecards.map((s) => <tr key={s.staffId} className={trow(s.staffId === who)} data-testid="scorecard"><td className="px-3 py-3"><button onClick={() => setWho(s.staffId)} aria-pressed={s.staffId === who} className="font-semibold text-gold-deep underline-offset-2 hover:underline">{s.name}</button><span className="block text-xs text-text-muted">{ROLE(s.role)}</span></td><td className="px-3 py-3 tabular-nums">{s.done}/{s.stops}</td><td className="px-3 py-3 tabular-nums">{pct(s.onTimePct)}</td><td className="px-3 py-3 tabular-nums">{pct(s.firstTryPct)}</td><td className="px-3 py-3 tabular-nums">{s.rating != null ? `${s.rating}★ (${s.ratings})` : '—'}</td><td className={`px-3 py-3 tabular-nums ${s.incidents ? 'text-danger' : ''}`}>{s.incidents}</td><td className="px-3 py-3 tabular-nums">{pct(s.cashOkPct)}</td></tr>)}</tbody></table></div>
        {sc && <div className="mt-5 grid gap-5 lg:grid-cols-2" data-testid="trend"><div><h3 className="mb-2 text-sm font-semibold">{sc.name} · stops done per week</h3><Trend data={sc.series.map((w) => ({ ...w, start: w.week }))} series={[{ key: 'done', label: 'Stops done', color: C.focus }]} bucket="week" label={`${sc.name} stops per week`} /></div><div><h3 className="mb-2 text-sm font-semibold">{sc.name} · on time and first try (%)</h3><Trend data={sc.series.map((w) => ({ ...w, start: w.week, onTime: w.onTimePct ?? 0, first: w.firstTryPct ?? 0 }))} series={[{ key: 'onTime', label: 'On time %', color: C.focus }, { key: 'first', label: 'First try %', color: C.alt }]} bucket="week" format={(v) => `${v}%`} label={`${sc.name} on-time and first-try percentages`} /></div></div>}
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Leaderboard" sub={a.showLeaderboard ? 'Drivers can see their own place.' : 'Only the office sees this. Turn it on for drivers under Payroll → Pay rules.'}>
          {a.leaderboard.length ? <ol className="space-y-1.5 text-sm">{a.leaderboard.map((l, i) => <li key={l.staffId} className="flex items-center gap-3 rounded-lg bg-surface-2/50 px-3 py-2" data-testid="leader"><span className="grid h-7 w-7 place-items-center rounded-full bg-gold/20 text-xs font-bold">{i + 1}</span><span className="flex-1 font-semibold">{l.name}</span>{i === 0 && <Award size={16} className="text-gold-deep" aria-label="Top driver" />}<span className="tabular-nums">{l.score}</span></li>)}</ol> : <Empty>Needs at least 3 completed stops per driver in the last 30 days.</Empty>}
          <p className="mt-2 text-xs text-text-muted">Score: on time 40%, first try 30%, customer rating 20%, plus 10 points with no damage in 30 days.</p>
        </Panel>
        <Panel title="Cost by area" sub="Last 30 days, driver pay and expenses spread across stops.">
          {a.areas.length ? <ul className="divide-y divide-border text-sm">{a.areas.map((x) => <li key={x.area} className="flex items-center gap-3 py-2"><span className="flex-1 font-semibold">{x.area}</span><span className="text-text-muted">{x.stops} stops</span><span className="w-28 text-right tabular-nums">{x.perStop != null ? `${money(x.perStop)}/stop` : '—'}</span></li>)}</ul> : <Empty>No runs in the last 30 days.</Empty>}
        </Panel>
      </div>
      <Panel title="Cost per run" sub="Last 30 days. Cost = driver pay (per stop, per run, hours that day) + logged expenses. Freight = invoices on the run’s shipments.">
        {a.runs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className={thead}><tr><Th>Run</Th><Th>Driver</Th><Th>Stops</Th><Th>km</Th><Th>Cost</Th><Th>Per stop</Th><Th>Per km</Th><Th>Freight invoiced</Th><Th>Cost as % of freight</Th></tr></thead>
          <tbody>{a.runs.map((x) => <tr key={x.id} className={trow()} data-testid="run-econ"><td className="px-3 py-3"><Link to={`/dashboard/routes/${x.id}`} className="font-semibold text-gold-deep hover:underline">{x.name}</Link><span className="block text-xs text-text-muted">{day(x.date)} · {x.kind}</span></td><td className="px-3 py-3">{x.driver ?? '—'}</td><td className="px-3 py-3 tabular-nums">{x.done}/{x.stops}</td><td className="px-3 py-3 tabular-nums">{x.km || '—'}</td><td className="px-3 py-3 tabular-nums">{money(x.cost)}</td><td className="px-3 py-3 tabular-nums">{x.perStop != null ? money(x.perStop) : '—'}</td><td className="px-3 py-3 tabular-nums">{x.perKm != null ? money(x.perKm) : '—'}</td><td className="px-3 py-3 tabular-nums">{x.revenue ? money(x.revenue) : '—'}</td><td className={`px-3 py-3 tabular-nums ${x.costPct != null && x.costPct > 25 ? 'text-danger font-semibold' : ''}`}>{x.costPct != null ? `${x.costPct}%` : '—'}</td></tr>)}</tbody></table></div> : <Empty>No runs in the last 30 days.</Empty>}
      </Panel>
      <Panel title="Fleet use" sub="Distance from the odometer readings in vehicle checks; fuel from driver expenses on runs with that vehicle.">
        {a.fleet.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className={thead}><tr><Th>Vehicle</Th><Th>Odometer</Th><Th>Last 30 days</Th><Th>Fuel (30 days)</Th><Th>Check problems</Th><Th>Next service</Th><Th /></tr></thead>
          <tbody>{a.fleet.map((v) => <tr key={v.id} className={trow(svc === v.id)} data-testid="fleet-row"><td className="px-3 py-3 font-semibold">{v.name}<span className="block text-xs font-normal text-text-muted">{v.plate}</span></td><td className="px-3 py-3 tabular-nums">{v.odometer?.toLocaleString() ?? '—'}</td><td className="px-3 py-3 tabular-nums">{v.km30 != null ? `${v.km30.toLocaleString()} km` : '—'}</td><td className="px-3 py-3 tabular-nums">{money(v.fuelUsd30)}{v.fuelPerKm != null && <span className="block text-xs text-text-muted">{money(v.fuelPerKm)}/km</span>}</td><td className={`px-3 py-3 tabular-nums ${v.checkIssues30 ? 'text-danger' : ''}`}>{v.checkIssues30}</td>
            <td className="px-3 py-3">{svc === v.id ? <div className="flex flex-wrap gap-1"><label className="text-xs">Every km<input inputMode="numeric" className="input-dark mt-1 !min-h-9 !w-24" value={sf.everyKm} onChange={(e) => setSf({ ...sf, everyKm: e.target.value.replace(/\D/g, '') })} /></label><label className="text-xs">Last at km<input inputMode="numeric" className="input-dark mt-1 !min-h-9 !w-24" value={sf.lastKm} onChange={(e) => setSf({ ...sf, lastKm: e.target.value.replace(/\D/g, '') })} /></label><label className="text-xs">Date<input type="date" className="input-dark mt-1 !min-h-9" value={sf.lastAt} onChange={(e) => setSf({ ...sf, lastAt: e.target.value })} /></label></div> : v.nextServiceKm != null ? <span className={v.serviceDue ? 'font-semibold text-danger' : ''}>{v.serviceDue ? 'Due now · ' : ''}{v.nextServiceKm.toLocaleString()} km</span> : <span className="text-text-muted">Not set</span>}</td>
            <td className="px-3 py-3 text-right">{svc === v.id ? <div className="flex justify-end gap-1"><button onClick={() => saveSvc(v.id)} className="btn-gold !min-h-9 !px-3 text-xs">Save</button><button onClick={() => setSvc(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button></div> : <button onClick={() => { setSvc(v.id); setSf({ everyKm: String(v.serviceEveryKm ?? ''), lastKm: String(v.lastServiceKm ?? ''), lastAt: v.lastServiceAt ?? '' }) }} className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`Set service interval for ${v.name}`}>Service</button>}</td></tr>)}</tbody></table></div> : <Empty>No vehicles on the Fleet page yet.</Empty>}
      </Panel>
    </div>
  )
}

/* ============================== People (HR file) ============================== */
export function PeopleTab({ open, onOpen, toast, isOwner, canPay }: { open: string | null; onOpen: (id: string | null) => void; toast: (m: string) => void; isOwner: boolean; canPay: boolean }) {
  const [list, setList] = useState<Person[] | null>(null); const [err, setErr] = useState('')
  const load = () => hrApi.people().then(setList).catch((e) => setErr(msg(e)))
  useEffect(() => { void load() }, [])
  if (open) return <PersonFile id={open} onBack={() => { onOpen(null); void load() }} toast={toast} isOwner={isOwner} canPay={canPay} />
  if (!list) return err ? <Err e={err} /> : <p className="text-sm text-text-muted">Loading…</p>
  return (
    <section aria-labelledby="ppl-h">
      <h2 id="ppl-h" className="mb-2 !text-lg">Everyone on the team</h2>
      {list.length ? <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[760px] text-sm"><thead className={thead}><tr><Th>Person</Th><Th>Status</Th><Th>Onboarding</Th><Th>Papers</Th><Th>Holiday left</Th><Th>Owed</Th><Th /></tr></thead>
        <tbody>{list.map((p) => { const done = p.checklist.filter((c) => c.done).length; return <tr key={p.staffId} className={trow(false, p.status === 'offboarded')} data-testid="person-row">
          <td className="px-3 py-3 font-semibold">{p.name}<span className="block text-xs font-normal text-text-muted">{ROLE(p.role)} · {p.employment === 'employee' ? 'Employee' : 'Contractor'} · {p.country}</span></td>
          <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === 'active' ? 'bg-teal/15 text-teal' : p.status === 'onboarding' ? 'bg-gold/15 text-gold-deep' : 'bg-surface-2'}`}>{p.status === 'active' ? 'Active' : p.status === 'onboarding' ? 'Onboarding' : 'Left'}</span>{p.trialUntil && p.trialUntil >= today() && <span className="block text-xs text-text-muted">Trial until {day(p.trialUntil)}</span>}</td>
          <td className="px-3 py-3 tabular-nums">{done}/{p.checklist.length}</td>
          <td className="px-3 py-3">{p.expiringSoon.length ? p.expiringSoon.map((e) => <span key={e.kind} className={`block text-xs font-semibold ${e.expired ? 'text-danger' : 'text-gold-deep'}`}>{e.label} {e.expired ? 'expired' : `expires ${day(e.date)}`}</span>) : <span className="text-xs text-text-muted">{p.docCount ? `${p.docCount} on file` : 'None uploaded'}</span>}</td>
          <td className="px-3 py-3 tabular-nums">{p.leave.left} / {p.leave.allowance}</td>
          <td className="px-3 py-3 tabular-nums">{p.owed ? money(p.owed, p.pay.currency) : '—'}</td>
          <td className="px-3 py-3 text-right"><button onClick={() => onOpen(p.staffId)} className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`Open ${p.name}’s file`} data-testid="person-open">Open file</button></td></tr> })}</tbody></table></div> : <Empty>No staff yet. Invite them from Team.</Empty>}
    </section>
  )
}

function PersonFile({ id, onBack, toast, isOwner, canPay }: { id: string; onBack: () => void; toast: (m: string) => void; isOwner: boolean; canPay: boolean }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.person>> | null>(null); const [f, setF] = useState<Person | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState({ kind: '', title: '', expiresOn: '' }); const [note, setNote] = useState({ kind: 'note', body: '' }); const [adj, setAdj] = useState({ kind: 'advance', amount: '', currency: 'USD', note: '', installments: '1' })
  const [rejecting, setRejecting] = useState<string | null>(null); const [rejectWhy, setRejectWhy] = useState('')
  const [off, setOff] = useState<null | { lastDay: string; reason: string; returned: { equipment: boolean; fuelCard: boolean; keys: boolean; uniform: boolean }; finalPay: boolean }>(null)
  const load = () => hrApi.person(id).then((x) => { setD(x); setF(x.person) }).catch((e) => setErr(msg(e)))
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !f) return err ? <Err e={err} /> : <p className="text-sm text-text-muted">Loading…</p>
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setErr(''); try { await fn(); toast(ok); await load() } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }
  const p = d.person
  const save = () => run(() => hrApi.savePerson(id, { employment: f.employment, country: f.country, startDate: f.startDate, trialUntil: f.trialUntil, leaveDays: f.leave.allowance, licence: f.licence, emergency: f.emergency, payout: f.payout, expiries: f.expiries, status: f.status === 'offboarded' ? undefined : f.status } as never), 'Saved.')
  const exp = (k: string, label: string) => <label className="text-sm">{label}<input type="date" className="input-dark mt-1 !min-h-10" value={f.expiries[k] ?? ''} onChange={(e) => setF({ ...f, expiries: { ...f.expiries, [k]: e.target.value } })} /></label>
  return (
    <div className="grid gap-6" data-testid="person-file">
      <button onClick={onBack} className="inline-flex min-h-10 items-center gap-1 justify-self-start text-sm text-text-muted hover:text-text"><ChevronLeft size={16} aria-hidden="true" /> Everyone</button>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="!text-2xl">{p.name}</h2><p className="text-sm text-text-muted">{ROLE(p.role)} · {p.email}{p.phone ? ` · ${p.phone}` : ''}</p></div>
        {p.status !== 'offboarded' && canPay && <button onClick={() => setOff({ lastDay: today(), reason: '', returned: { equipment: false, fuelCard: false, keys: false, uniform: false }, finalPay: true })} className="btn-ghost !min-h-10 text-sm text-danger" data-testid="offboard"><UserMinus size={14} aria-hidden="true" /> Offboard</button>}</div>
      <Err e={err} />
      {p.offboarding && <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm">Left on {String((p.offboarding as Record<string, unknown>).lastDay)} · {String((p.offboarding as Record<string, unknown>).reason || 'no reason given')} · by {String((p.offboarding as Record<string, unknown>).by)}</p>}
      {off && <section className="card-dark grid gap-3 p-5" aria-label="Offboard" data-testid="offboard-form">
        <h3 className="!text-base">Offboard {p.name}</h3>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Last day<input type="date" className="input-dark mt-1 !min-h-10" value={off.lastDay} onChange={(e) => setOff({ ...off, lastDay: e.target.value })} /></label><label className="text-sm">Reason<input className="input-dark mt-1 !min-h-10" value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} /></label></div>
        <fieldset><legend className="label-dark">Returned</legend><div className="flex flex-wrap gap-4 text-sm">{(['equipment', 'fuelCard', 'keys', 'uniform'] as const).map((k) => <label key={k} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={off.returned[k]} onChange={(e) => setOff({ ...off, returned: { ...off.returned, [k]: e.target.checked } })} /> {k === 'fuelCard' ? 'Fuel card' : k[0].toUpperCase() + k.slice(1)}</label>)}</div></fieldset>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={off.finalPay} onChange={(e) => setOff({ ...off, finalPay: e.target.checked })} /> Make a final payslip up to the last day</label>
        <p className="text-xs text-text-muted">Signs them out on every device, removes their PIN, takes them off planned runs and stops them signing in.</p>
        <div className="flex gap-2"><button onClick={() => run(() => hrApi.offboard(id, off), `${p.name} offboarded.`).then(() => setOff(null))} disabled={busy} className="btn-gold !min-h-10 text-sm" data-testid="offboard-save">Offboard</button><button onClick={() => setOff(null)} className="btn-ghost !min-h-10 text-sm">Cancel</button></div>
      </section>}

      <section className="card-dark p-5" aria-labelledby="ob-h"><h3 id="ob-h" className="!text-base">Onboarding</h3>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{p.checklist.map((c) => <li key={c.key} className="flex items-center gap-2 text-sm">{c.done ? <Check size={16} className="text-teal" aria-label="Done" /> : <X size={16} className="text-text-muted" aria-label="Not done" />}{c.label}</li>)}</ul>
        <p className="mt-2 text-xs text-text-muted">{!p.isDriver ? '' : p.contractSignedAt ? `Agreement signed ${fmtDateTime(p.contractSignedAt)} as ${p.contractName}. ` : 'Agreement not signed yet. '}{p.training ? ` Quiz: ${p.training.score}% after ${p.training.tries} tr${p.training.tries === 1 ? 'y' : 'ies'}.` : ''} {p.isDriver ? 'The driver does these on their phone under “My file”.' : 'They add their ID, contact and payout details under My HR → My file; upload a signed contract below.'}</p></section>

      <section className="card-dark grid gap-4 p-5 md:grid-cols-3" aria-labelledby="det-h"><h3 id="det-h" className="!text-base md:col-span-3">Details</h3>
        <label className="text-sm">Employment<select className="input-dark mt-1 !min-h-10" value={f.employment} onChange={(e) => setF({ ...f, employment: e.target.value as Person['employment'] })}><option value="contractor">Contractor</option><option value="employee">Employee</option></select></label>
        <label className="text-sm">Country (for tax)<select className="input-dark mt-1 !min-h-10" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{['US', 'GH', 'NG', 'CI', 'SN', 'TG', 'BJ', 'GB', 'OTHER'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm">Status<select className="input-dark mt-1 !min-h-10" value={f.status} disabled={f.status === 'offboarded'} onChange={(e) => setF({ ...f, status: e.target.value as Person['status'] })}><option value="onboarding">Onboarding</option><option value="active">Active</option>{f.status === 'offboarded' && <option value="offboarded">Left</option>}</select></label>
        <label className="text-sm">Start date<input type="date" className="input-dark mt-1 !min-h-10" value={f.startDate ?? ''} onChange={(e) => setF({ ...f, startDate: e.target.value || null })} /></label>
        <label className="text-sm">Trial until<input type="date" className="input-dark mt-1 !min-h-10" value={f.trialUntil ?? ''} onChange={(e) => setF({ ...f, trialUntil: e.target.value || null })} /></label>
        <label className="text-sm">Holiday days a year<input inputMode="numeric" className="input-dark mt-1 !min-h-10" value={f.leave.allowance} onChange={(e) => setF({ ...f, leave: { ...f.leave, allowance: Number(e.target.value.replace(/\D/g, '')) || 0 } })} /></label>
        {p.isDriver && <><label className="text-sm">Licence class<input className="input-dark mt-1 !min-h-10" value={f.licence.class ?? ''} onChange={(e) => setF({ ...f, licence: { ...f.licence, class: e.target.value } })} /></label>
        <label className="text-sm">Licence number (last 4)<input maxLength={4} className="input-dark mt-1 !min-h-10" value={f.licence.last4 ?? ''} onChange={(e) => setF({ ...f, licence: { ...f.licence, last4: e.target.value } })} /></label>
        <label className="text-sm">Issued by (state / country)<input className="input-dark mt-1 !min-h-10" value={f.licence.state ?? ''} onChange={(e) => setF({ ...f, licence: { ...f.licence, state: e.target.value } })} /></label>
        {exp('licence', 'Licence expires')}{exp('medical', 'Medical card expires')}{exp('insurance', 'Insurance expires')}</>}{exp('permit', 'Work permit expires')}
        <label className="text-sm">Emergency contact<input className="input-dark mt-1 !min-h-10" value={f.emergency.name ?? ''} onChange={(e) => setF({ ...f, emergency: { ...f.emergency, name: e.target.value } })} /></label>
        <label className="text-sm">Their phone<input className="input-dark mt-1 !min-h-10" value={f.emergency.phone ?? ''} onChange={(e) => setF({ ...f, emergency: { ...f.emergency, phone: e.target.value } })} /></label>
        <label className="text-sm">Paid by<select className="input-dark mt-1 !min-h-10" value={f.payout.method ?? ''} onChange={(e) => setF({ ...f, payout: { ...f.payout, method: e.target.value } })}><option value="">—</option><option value="momo">Mobile money</option><option value="bank">Bank</option><option value="zelle">Zelle</option><option value="cash">Cash</option></select></label>
        <label className="text-sm">{f.payout.method === 'zelle' ? 'Zelle email / phone' : f.payout.method === 'bank' ? 'Bank name' : 'MoMo number'}<input className="input-dark mt-1 !min-h-10" value={(f.payout.method === 'zelle' ? f.payout.zelle : f.payout.method === 'bank' ? f.payout.bankName : f.payout.momo) ?? ''} onChange={(e) => setF({ ...f, payout: { ...f.payout, [f.payout.method === 'zelle' ? 'zelle' : f.payout.method === 'bank' ? 'bankName' : 'momo']: e.target.value } })} /></label>
        {f.payout.method === 'bank' && <label className="text-sm">Account (last 4 only)<input maxLength={4} inputMode="numeric" className="input-dark mt-1 !min-h-10" value={f.payout.bankLast4 ?? ''} onChange={(e) => setF({ ...f, payout: { ...f.payout, bankLast4: e.target.value.replace(/\D/g, '') } })} /></label>}
        <div className="flex items-end justify-end md:col-span-3"><button onClick={save} disabled={busy} className="btn-gold !min-h-10 text-sm" data-testid="person-save"><Check size={14} aria-hidden="true" /> Save details</button></div>
      </section>

      <section className="card-dark p-5" aria-labelledby="docs-h"><h3 id="docs-h" className="!text-base">Papers</h3>
        {p.docs.length ? <ul className="mt-2 divide-y divide-border text-sm">{p.docs.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><FileText size={15} aria-hidden="true" /><span className="min-w-0 flex-1">{x.title || x.kind}<span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${x.status === 'checked' ? 'bg-teal/15 text-teal' : x.status === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-gold/15 text-gold-deep'}`}>{x.status === 'checked' ? 'Checked' : x.status === 'rejected' ? 'Rejected' : 'To check'}</span><span className="block text-xs text-text-muted">{x.kind}{x.side ? ` (${x.side})` : ''}{x.expiresOn ? ` · expires ${day(x.expiresOn)}` : ''} · {x.uploadedBy} · {fmtDateTime(x.at)}{x.reviewNote ? ` · “${x.reviewNote}”` : ''}</span></span>
                {x.status !== 'checked' && <button onClick={() => run(() => hrApi.reviewDoc(x.id, 'checked'), 'Marked as checked.')} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="doc-check">Looks good</button>}
                {x.status !== 'rejected' && (rejecting === x.id ? <form onSubmit={(e) => { e.preventDefault(); void run(() => hrApi.reviewDoc(x.id, 'rejected', rejectWhy), 'Sent back — they were asked to upload it again.').then(() => { setRejecting(null); setRejectWhy('') }) }} className="flex gap-1"><label className="sr-only" htmlFor={`rj-${x.id}`}>What’s wrong</label><input id={`rj-${x.id}`} className="input-dark !min-h-9 !w-48 text-xs" value={rejectWhy} onChange={(e) => setRejectWhy(e.target.value)} placeholder="What’s wrong (they see this)" data-testid="doc-reject-why" /><button className="btn-ghost !min-h-9 !px-2 text-xs" disabled={rejectWhy.trim().length < 3}>Send</button></form> : <button onClick={() => setRejecting(x.id)} className="btn-ghost !min-h-9 !px-3 text-xs" data-testid="doc-reject">Ask again</button>)}<button onClick={async () => { const r = await hrApi.doc(x.id); const w = window.open(); if (w) w.document.write(r.dataUrl.startsWith('data:application/pdf') ? `<iframe src="${r.dataUrl}" style="border:0;width:100%;height:100vh"></iframe>` : `<img src="${r.dataUrl}" style="max-width:100%">`) }} className="btn-ghost !min-h-9 !px-3 text-xs">View</button><button onClick={() => run(() => hrApi.delDoc(x.id), 'Removed.')} className="grid h-9 w-9 place-items-center rounded-md text-text-muted hover:text-danger" aria-label={`Delete ${x.title || x.kind}`}><Trash2 size={14} /></button></li>)}</ul> : <p className="mt-2 text-sm text-text-muted">Nothing uploaded.</p>}
        <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs">Type<select className="input-dark mt-1 !min-h-9" value={doc.kind || (p.isDriver ? 'licence' : 'contract')} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>{(p.isDriver ? [['licence', 'Driving licence'], ['id', 'ID'], ['medical', 'Medical card'], ['insurance', 'Insurance'], ['permit', 'Work permit'], ['contract', 'Contract'], ['other', 'Other']] : [['contract', 'Employment contract'], ['id', 'ID'], ['right_to_work', 'Right to work'], ['tax', 'Tax form (W-4 / SSNIT / TIN)'], ['certificate', 'Certificate'], ['permit', 'Work permit'], ['other', 'Other']]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label className="text-xs">Title<input className="input-dark mt-1 !min-h-9" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} /></label><label className="text-xs">Expires<input type="date" className="input-dark mt-1 !min-h-9" value={doc.expiresOn} onChange={(e) => setDoc({ ...doc, expiresOn: e.target.value })} /></label>
          <label className="btn-ghost !min-h-9 cursor-pointer text-xs"><Upload size={13} aria-hidden="true" /> Upload photo or PDF<input type="file" accept="image/*,application/pdf" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2_900_000) { setErr('Keep files under 3 MB.'); return } const dataUrl = await fileToDataUrl(file); await run(() => hrApi.addDoc(id, { kind: doc.kind || (p.isDriver ? 'licence' : 'contract'), title: doc.title || file.name, dataUrl, expiresOn: doc.expiresOn || null }), 'Uploaded.'); e.target.value = '' }} /></label></div>
      </section>

      {canPay && <section className="card-dark p-5" aria-labelledby="adj-h"><h3 id="adj-h" className="!text-base">Advances, deductions &amp; bonuses</h3>
        {d.adjustments.length ? <ul className="mt-2 divide-y divide-border text-sm">{d.adjustments.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2"><span className="flex-1">{ADJ_LABEL[a.kind]} {money(a.amount, a.currency)}{a.note ? ` · ${a.note}` : ''}</span><span className="text-xs text-text-muted">{a.remaining > 0 ? `${money(a.remaining, a.currency)} left` : 'settled'}</span></li>)}</ul> : null}
        <form onSubmit={(e) => { e.preventDefault(); void run(() => hrApi.adjust(id, { kind: adj.kind, amount: Number(adj.amount), currency: adj.currency, note: adj.note, installments: Number(adj.installments) || 1 }), 'Added — it goes on the next payslip.').then(() => setAdj({ ...adj, amount: '', note: '' })) }} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">Type<select className="input-dark mt-1 !min-h-9" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>{Object.entries(ADJ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="text-xs">Amount<input inputMode="decimal" required className="input-dark mt-1 !min-h-9 !w-24" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value.replace(/[^\d.]/g, '') })} data-testid="adj-amount" /></label>
          <label className="text-xs">Currency<select className="input-dark mt-1 !min-h-9" value={adj.currency} onChange={(e) => setAdj({ ...adj, currency: e.target.value })}>{CURS.map((c) => <option key={c}>{c}</option>)}</select></label>
          {adj.kind !== 'bonus' && <label className="text-xs">Over how many payslips<input inputMode="numeric" className="input-dark mt-1 !min-h-9 !w-20" value={adj.installments} onChange={(e) => setAdj({ ...adj, installments: e.target.value.replace(/\D/g, '') })} /></label>}
          <label className="text-xs">Note<input className="input-dark mt-1 !min-h-9" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></label>
          <button className="btn-gold !min-h-9 text-xs" disabled={busy} data-testid="adj-add"><Plus size={13} aria-hidden="true" /> Add</button></form>
      </section>}

      {isOwner && d.notes && <section className="card-dark p-5" aria-labelledby="notes-h"><h3 id="notes-h" className="!text-base">Notes, warnings &amp; commendations <span className="text-xs font-normal text-text-muted">· only the owner sees these</span></h3>
        {d.notes.length ? <ul className="mt-2 space-y-2 text-sm">{d.notes.map((n) => <li key={n.id} className={`rounded-lg border p-3 ${n.kind === 'warning' ? 'border-danger/40' : n.kind === 'commendation' ? 'border-teal/40' : 'border-border'}`}><p className="text-xs text-text-muted"><b className="capitalize">{n.kind.replace('_', ' ')}</b> · {n.by} · {fmtDateTime(n.at)}</p><p className="mt-1 whitespace-pre-line">{n.body}</p><button onClick={() => run(() => hrApi.delNote(n.id), 'Removed.')} className="mt-1 text-xs text-text-muted underline">Delete</button></li>)}</ul> : <p className="mt-2 text-sm text-text-muted">No notes.</p>}
        <form onSubmit={(e) => { e.preventDefault(); void run(() => hrApi.addNote(id, note.kind, note.body), 'Saved.').then(() => setNote({ ...note, body: '' })) }} className="mt-3 grid gap-2 md:grid-cols-[10rem_1fr_auto]"><label className="sr-only" htmlFor="note-kind">Kind</label><select id="note-kind" className="input-dark !min-h-10" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })}><option value="note">Note</option><option value="warning">Written warning</option><option value="commendation">Commendation</option><option value="follow_up">Incident follow-up</option></select><label className="sr-only" htmlFor="note-body">Note</label><input id="note-body" className="input-dark !min-h-10" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} placeholder="What happened, what was agreed" data-testid="note-body" /><button className="btn-gold !min-h-10 text-sm" disabled={busy || note.body.trim().length < 2}>Add</button></form>
      </section>}
    </div>
  )
}

/* ============================== Payslip page (print) ============================== */
export function PayslipView({ id }: { id: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.slip>> | null>(null); const [err, setErr] = useState(''); const [info, setInfo] = useState('')
  const [det, setDet] = useState<PayDetail | null>(null); const [q, setQ] = useState<{ line: string; note: string } | null>(null)
  const { user } = useStore(); const driver = isDriverRole(user?.staffRole)
  useEffect(() => { hrApi.slip(id).then(setD).catch((e) => setErr(msg(e))); hrApi.slipDetail(id).then(setDet).catch(() => {}) }, [id])
  const share = async () => { if (!d) return; setInfo(''); try { const b = await payslipPdf(d.payslip, d.employment, d.payout); const r = await shareOrDownload(b, `payslip-${(d.payslip.name ?? 'driver').replace(/\s+/g, '-').toLowerCase()}-${d.payslip.start}.pdf`, 'Payslip'); if (r === 'downloaded') setInfo('PDF downloaded.') } catch (e) { setErr(msg(e, 'Could not make the PDF.')) } }
  const sendQ = async () => { if (!q) return; setErr(''); try { await hrApi.askQuery(id, q.line, q.note); setQ(null); setInfo('Sent to the office — you’ll get a notification when they answer.') } catch (e) { setErr(msg(e)) } }
  if (!d) return <div className="container-x py-10">{err ? <Err e={err} /> : <p className="text-text-muted">Loading…</p>}</div>
  const s = d.payslip; const sec = (k: string[]) => s.lines.filter((l) => k.includes(l.kind))
  const Rows = ({ rows }: { rows: typeof s.lines }) => <>{rows.map((l, i) => <tr key={i} className="border-b border-border/60"><td className="py-2 pr-3">{l.label}</td><td className="py-2 pr-3 text-right tabular-nums">{l.qty != null ? l.qty : ''}</td><td className="py-2 pr-3 text-right tabular-nums">{l.rate != null ? money(l.rate, s.currency) : ''}</td><td className="py-2 text-right tabular-nums">{money(l.amount, s.currency)}</td></tr>)}</>
  return (
    <div className="bg-bg text-text print:bg-white print:text-black">
      <div className="container-x max-w-3xl py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden"><button onClick={() => history.back()} className="inline-flex min-h-10 items-center gap-1 text-sm text-text-muted"><ChevronLeft size={16} aria-hidden="true" /> Back</button><div className="flex flex-wrap gap-2"><button onClick={share} className="btn-gold !min-h-10 text-sm" data-testid="share-slip"><Share2 size={14} aria-hidden="true" /> Share or download PDF</button><button onClick={() => window.print()} className="btn-ghost !min-h-10 text-sm" data-testid="print-slip"><Printer size={14} aria-hidden="true" /> Print</button></div></div>
        {info && <p role="status" className="mb-3 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm print:hidden">{info}</p>}
        <Err e={err} />
        <article className="rounded-2xl border border-border bg-surface p-6 print:border-0 print:p-0" data-testid="payslip">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4"><div><p className="text-xs uppercase tracking-wider text-text-muted">Payslip{s.stats.final ? ' · final' : ''}</p><h1 className="!text-2xl">{s.company}</h1></div><div className="text-right text-sm"><p className="font-semibold">{s.name}</p><p className="text-text-muted">{d.employment === 'employee' ? 'Employee' : 'Contractor'}</p><p className="text-text-muted">{day(s.start)} – {day(s.end)}</p></div></header>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="text-text-muted">Stops</dt><dd className="font-semibold">{s.stats.stops ?? 0}</dd></div><div><dt className="text-text-muted">Runs</dt><dd className="font-semibold">{s.stats.runs ?? 0}</dd></div><div><dt className="text-text-muted">Hours</dt><dd className="font-semibold">{s.stats.hours ?? 0}{s.stats.overtime ? ` (${s.stats.overtime} OT)` : ''}</dd></div><div><dt className="text-text-muted">On time</dt><dd className="font-semibold">{pct(s.stats.onTimePct ?? null)}</dd></div></dl>
          <table className="mt-5 w-full text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody><Rows rows={sec(['earning', 'bonus'])} /><tr><td colSpan={3} className="py-2 font-semibold">Gross pay</td><td className="py-2 text-right font-semibold tabular-nums">{money(s.gross, s.currency)}</td></tr>
              {sec(['reimbursement']).length > 0 && <><Rows rows={sec(['reimbursement'])} /><tr><td colSpan={3} className="py-2 font-semibold">Expenses paid back</td><td className="py-2 text-right font-semibold tabular-nums">{money(s.reimbursed, s.currency)}</td></tr></>}
              {sec(['deduction']).length > 0 && <><Rows rows={sec(['deduction'])} /><tr><td colSpan={3} className="py-2 font-semibold">Deductions</td><td className="py-2 text-right font-semibold tabular-nums">−{money(s.deducted, s.currency)}</td></tr></>}
              <tr className="border-t-2 border-text"><td colSpan={3} className="py-3 text-base font-bold">Net pay</td><td className="py-3 text-right text-base font-bold tabular-nums" data-testid="slip-net">{money(s.net, s.currency)}</td></tr></tbody></table>
          {driver && <div className="mt-4 print:hidden">{q ? <div className="rounded-xl border border-border p-3" data-testid="query-form"><label htmlFor="q-line" className="label-dark">Which line?</label><select id="q-line" className="input-dark !min-h-11" value={q.line} onChange={(e) => setQ({ ...q, line: e.target.value })}><option value="">The whole payslip</option>{s.lines.map((l, i) => <option key={i} value={l.label}>{l.label}</option>)}</select><label htmlFor="q-note" className="label-dark mt-2">What looks wrong?</label><textarea id="q-note" rows={3} className="input-dark py-2" value={q.note} onChange={(e) => setQ({ ...q, note: e.target.value })} placeholder="e.g. I did 3 stops on Saturday that aren’t here" data-testid="query-note" /><div className="mt-2 flex gap-2"><button onClick={sendQ} disabled={q.note.trim().length < 5} className="btn-gold !min-h-11 text-sm" data-testid="query-send">Send to the office</button><button onClick={() => setQ(null)} className="btn-ghost !min-h-11 text-sm">Cancel</button></div></div> : <button onClick={() => setQ({ line: '', note: '' })} className="btn-ghost !min-h-11 text-sm" data-testid="query-open"><MessageSquareWarning size={15} aria-hidden="true" /> Something’s wrong?</button>}</div>}
          <footer className="mt-4 text-xs text-text-muted"><p>Status: {s.status === 'paid' ? `paid ${s.paidAt ? fmtDateTime(s.paidAt) : ''} by ${s.paidMethod}${s.paidRef ? ` (ref ${s.paidRef})` : ''}` : s.status === 'approved' ? `approved by ${s.approvedBy}, not paid yet` : 'draft'}</p>{d.payout.method && <p>Paid to: {d.payout.method === 'momo' ? `MoMo ${d.payout.momo}` : d.payout.method === 'zelle' ? `Zelle ${d.payout.zelle}` : d.payout.method === 'bank' ? `${d.payout.bankName} ••••${d.payout.bankLast4}` : 'cash'}</p>}<p className="mt-1">{d.employment === 'contractor' ? 'Contractor payment — no tax withheld.' : 'Tax and social security are handled separately by the company’s payroll.'}</p></footer>
        </article>
        {det && (det.stops.length > 0 || det.shifts.length > 0) && <Breakdown det={det} />}
      </div>
    </div>
  )
}

/** The stops and shifts behind a payslip, by day. */
export function Breakdown({ det }: { det: PayDetail }) {
  const byDay = new Map<string, { stops: PayDetail['stops']; shifts: PayDetail['shifts'] }>()
  for (const x of det.stops) { const k = x.doneAt.slice(0, 10); const e = byDay.get(k) ?? { stops: [], shifts: [] }; e.stops.push(x); byDay.set(k, e) }
  for (const x of det.shifts) { const k = x.start.slice(0, 10); const e = byDay.get(k) ?? { stops: [], shifts: [] }; e.shifts.push(x); byDay.set(k, e) }
  const t2 = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5 print:hidden" aria-labelledby="bd-h" data-testid="breakdown">
      <h2 id="bd-h" className="!text-lg">What’s behind it</h2>
      <p className="text-sm text-text-muted">{det.stops.length} stops · {det.shifts.reduce((n, x) => n + x.hours, 0).toFixed(1)} hours on the clock</p>
      <ul className="mt-3 space-y-3">{[...byDay.entries()].sort().map(([k, v]) => <li key={k} className="rounded-xl bg-surface-2/50 p-3"><p className="font-semibold">{day(k)}{v.stops.some((x) => x.holiday) ? ' · public holiday' : v.stops.some((x) => x.weekend) ? ' · weekend' : ''}</p>
        {v.shifts.map((x, i) => <p key={i} className="text-sm text-text-muted">Shift {t2(x.start)}–{t2(x.end)} · {x.hours} h{x.breaks ? ` · ${x.breaks} break${x.breaks === 1 ? '' : 's'}` : ''}{x.edited ? ' · corrected by the office' : ''}</p>)}
        {v.stops.length > 0 && <ul className="mt-1 text-sm">{v.stops.map((x, i) => <li key={i} className="flex justify-between gap-3 border-t border-border/50 py-1"><span className="min-w-0 truncate">{x.label}<span className="block truncate text-xs text-text-muted">{x.address || x.run}</span></span><span className="shrink-0 text-xs text-text-muted">{t2(x.doneAt)}</span></li>)}</ul>}
      </li>)}</ul>
    </section>
  )
}

