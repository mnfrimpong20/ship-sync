import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Award, Check, ChevronRight, FileText, PlayCircle, Send, Upload, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { isDriverRole } from '../lib/roles'
import { useT } from '../lib/i18n'
import { useDisplay } from '../lib/prefs'
import { niceDay } from '../lib/dates'
import { ADJ_LABEL, LEAVE_LABEL, hrApi, money, type Leave, type Person, type Rota, type TrainingQ } from '../lib/driverHrApi'
import { CONTRACT_VERSION, contractText } from '../lib/driverHr'
import { BrandLoader } from '../components/BrandLoader'
import { SignaturePad } from '../components/SignaturePad'
import { Big, Choice } from '../components/driver/DriverUi'
import { PayslipView } from '../components/driver/OfficeHr'

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const errOf = (e: unknown, f: string) => (e instanceof Error ? e.message : f)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT()
  return <div className="bg-bg text-text"><div className="container-x max-w-2xl py-5 pb-28 md:py-8"><Link to="/dashboard/runs" className="inline-flex min-h-11 items-center gap-1.5 text-base text-text-muted hover:text-text focus-ring"><ArrowLeft size={18} aria-hidden="true" /> {t('My runs')}</Link><h1 className="mt-1 !text-[1.7rem] leading-tight">{title}</h1>{children}</div></div>
}
const Card = ({ title, children, id, testid }: { title: string; children: React.ReactNode; id: string; testid?: string }) => <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby={id} data-testid={testid}><h2 id={id} className="!text-lg">{title}</h2>{children}</section>
const Msg = ({ err, ok }: { err?: string; ok?: string }) => <>{err && <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger">{err}</p>}{ok && <p role="status" className="mt-3 rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-base">{ok}</p>}</>

/* ---------------- My pay ---------------- */
function MyPay() {
  const t = useT(); const disp = useDisplay()
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.myPay>> | null>(null); const [rank, setRank] = useState<Awaited<ReturnType<typeof hrApi.myRank>> | null>(null); const [err, setErr] = useState('')
  useEffect(() => { hrApi.myPay().then(setD).catch((e) => setErr(errOf(e, t('Could not load.')))); hrApi.myRank().then(setRank).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Shell title={t('My pay')}>{err ? <Msg err={err} /> : <BrandLoader full={false} />}</Shell>
  const c = d.current
  return (
    <Shell title={t('My pay')}>
      {d.owed > 0 && <p className="mt-4 rounded-2xl border-2 border-gold bg-gold/10 p-4 text-base font-semibold" data-testid="owed">{t('{amount} approved and on its way to you.', { amount: money(d.owed, d.payslips[0]?.currency) })}</p>}
      {rank?.show && rank.rank && <p className="mt-4 flex items-center gap-2 rounded-2xl bg-surface-2 p-4 text-base"><Award size={20} className="text-gold-deep" aria-hidden="true" /> {t('You’re number {n} of {of} drivers this month.', { n: rank.rank, of: rank.of ?? 0 })}</p>}
      <Card title={t('This pay period so far')} id="cur-h" testid="pay-current">
        <p className="text-sm text-text-muted">{niceDay(c.start, { lang: disp.lang })} – {niceDay(c.end, { lang: disp.lang })}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{money(c.net, c.currency)}</p>
        <ul className="mt-3 divide-y divide-border text-base">{c.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{t(l.label)}{l.qty != null ? ` × ${l.qty}` : ''}</span><span className={`tabular-nums ${l.amount < 0 ? 'text-danger' : ''}`}>{money(l.amount, c.currency)}</span></li>)}</ul>
        {!c.lines.length && <p className="mt-2 text-base text-text-muted">{t('Nothing yet this period.')}</p>}
        <p className="mt-2 text-sm text-text-muted">{t('Not final until the office approves your payslip.')}</p>
      </Card>
      <Card title={t('Payslips')} id="slips-h">
        {d.payslips.length ? <ul className="mt-2 space-y-2">{d.payslips.map((s) => <li key={s.id}><Link to={`/dashboard/payslip/${s.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-border px-4 py-2 text-base focus-ring" data-testid="my-slip"><FileText size={20} aria-hidden="true" /><span className="min-w-0 flex-1"><b>{money(s.net, s.currency)}</b><span className="block text-sm text-text-muted">{niceDay(s.start, { lang: disp.lang })} – {niceDay(s.end, { lang: disp.lang })}</span></span><span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${s.status === 'paid' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold-deep'}`}>{s.status === 'paid' ? t('Paid') : t('Approved')}</span><ChevronRight size={18} aria-hidden="true" /></Link></li>)}</ul> : <p className="mt-2 text-base text-text-muted">{t('No payslips yet.')}</p>}
      </Card>
      {d.adjustments.length > 0 && <Card title={t('Advances & deductions')} id="adj-h"><ul className="mt-2 divide-y divide-border text-base">{d.adjustments.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span>{t(ADJ_LABEL[a.kind] ?? a.kind)}{a.note ? ` · ${a.note}` : ''}</span><span className="tabular-nums">{a.kind === 'bonus' ? '+' : ''}{money(a.remaining, a.currency)} {a.kind !== 'bonus' ? t('left') : ''}</span></li>)}</ul></Card>}
      {d.expenses.length > 0 && <Card title={t('My expenses')} id="exp-h"><ul className="mt-2 divide-y divide-border text-base">{d.expenses.map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><span className="capitalize">{t(e.kind[0].toUpperCase() + e.kind.slice(1))} · {money(e.amount, e.currency)}</span><span className={`text-sm font-semibold ${e.status === 'rejected' ? 'text-danger' : e.status === 'pending' ? 'text-text-muted' : 'text-teal'}`}>{e.status === 'pending' ? t('Waiting') : e.status === 'rejected' ? t('Not approved') : e.status === 'reimbursed' ? t('Paid back') : t('Approved')}</span></li>)}</ul></Card>}
    </Shell>
  )
}

/* ---------------- Time off & rota ---------------- */
function MyTime() {
  const t = useT(); const disp = useDisplay()
  const [d, setD] = useState<Awaited<ReturnType<typeof hrApi.myLeave>> | null>(null); const [rota, setRota] = useState<Rota | null>(null)
  const [f, setF] = useState({ kind: 'vacation' as Leave['kind'], start: addDays(today(), 7), end: addDays(today(), 7), swapWith: '', note: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const load = () => { hrApi.myLeave().then(setD).catch((e) => setErr(errOf(e, t('Could not load.')))); hrApi.rota(today(), 14).then(setRota).catch(() => {}) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); setOk(''); try { await hrApi.askLeave({ kind: f.kind, start: f.start, end: f.kind === 'swap' ? f.start : f.end, swapWith: f.kind === 'swap' ? f.swapWith : undefined, note: f.note }); setOk(f.kind === 'sick' ? t('Sent. Get well soon.') : t('Sent to the office.')); setF({ ...f, note: '' }); load() } catch (er) { setErr(errOf(er, t('Could not send.'))) } finally { setBusy(false) } }
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i))
  return (
    <Shell title={t('Time off & rota')}>
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
      {d && d.requests.length > 0 && <Card title={t('My requests')} id="req-h"><ul className="mt-2 divide-y divide-border text-base">{d.requests.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2"><span>{t(LEAVE_LABEL[l.kind])} · {niceDay(l.start, { lang: disp.lang })}{l.end !== l.start ? ` – ${niceDay(l.end, { lang: disp.lang })}` : ''}{l.swapName ? ` · ${l.swapName}` : ''}</span><span className={`text-sm font-semibold ${l.status === 'approved' ? 'text-teal' : l.status === 'declined' ? 'text-danger' : 'text-text-muted'}`}>{l.status === 'approved' ? t('Approved') : l.status === 'declined' ? t('Not approved') : t('Waiting')}</span></li>)}</ul></Card>}
    </Shell>
  )
}

/* ---------------- My file: onboarding, agreement, training, papers, details ---------------- */
function MyFile() {
  const t = useT(); const [sp] = useSearchParams()
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
      {p.expiringSoon.length > 0 && <p className="mt-4 rounded-2xl border-2 border-danger/50 bg-danger/10 p-4 text-base" role="alert">{p.expiringSoon.map((e) => <span key={e.kind} className="block">{e.expired ? t('{doc} has expired — upload the new one.', { doc: t(e.label) }) : t('{doc} expires {date}.', { doc: t(e.label), date: e.date })}</span>)}</p>}
      <Agreement company={d.company} person={p} onDone={() => { setOk(t('Agreement signed.')); void load() }} />
      <Training videos={d.settings.trainingVideos} passed={!!p.training?.passedAt} onDone={() => void load()} open={sp.get('quiz') === '1'} />
      <Papers person={p} onDone={(m) => { setOk(m); void load() }} />
      <Details person={p} onDone={(m) => { setOk(m); void load() }} />
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
function Papers({ person, onDone }: { person: Person; onDone: (m: string) => void }) {
  const t = useT(); const [kind, setKind] = useState('licence'); const [exp, setExp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const KINDS: [string, string][] = [['licence', 'Driving licence'], ['id', 'ID'], ['medical', 'Medical card'], ['insurance', 'Insurance'], ['permit', 'Work / DOT / DVLA permit']]
  return (
    <Card title={t('My papers')} id="pap-h" testid="papers">
      {person.docs.length ? <ul className="mt-2 divide-y divide-border text-base">{person.docs.map((x) => <li key={x.id} className="flex items-center gap-2 py-2"><FileText size={18} aria-hidden="true" /><span className="flex-1">{x.title || x.kind}{x.expiresOn ? <span className="block text-sm text-text-muted">{t('Expires {date}', { date: x.expiresOn })}</span> : null}</span></li>)}</ul> : <p className="mt-2 text-base text-text-muted">{t('Nothing uploaded yet.')}</p>}
      <div className="mt-4 grid gap-3">
        <div><label htmlFor="pap-kind" className="label-dark">{t('What is it?')}</label><select id="pap-kind" className="input-dark !min-h-12" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        {kind !== 'id' && <div><label htmlFor="pap-exp" className="label-dark">{t('Expiry date')}</label><input id="pap-exp" type="date" className="input-dark !min-h-12" value={exp} onChange={(e) => setExp(e.target.value)} /></div>}
        <label className={`flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface text-base font-semibold focus-within:ring-2 focus-within:ring-gold ${busy ? 'opacity-50' : ''}`}><Upload size={20} aria-hidden="true" /> {busy ? t('Uploading…') : t('Take a photo or choose a file')}<input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 2_900_000) { setErr(t('Keep files under 3 MB.')); return } setBusy(true); setErr(''); try { await hrApi.addDoc('me', { kind, title: KINDS.find((x) => x[0] === kind)?.[1] ?? kind, dataUrl: await fileToDataUrl(f), expiresOn: kind === 'id' ? null : exp || null }); onDone(t('Uploaded — the office can see it.')); setExp('') } catch (er) { setErr(errOf(er, t('Could not upload.'))) } finally { setBusy(false); e.target.value = '' } }} data-testid="pap-file" /></label>
      </div>
      <Msg err={err} />
    </Card>
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

/** /dashboard/runs/pay · /dashboard/runs/time · /dashboard/runs/me */
export default function DriverHr({ section }: { section: 'pay' | 'time' | 'me' }) {
  const { ready, user } = useStore()
  if (!ready) return <BrandLoader partner />
  if (!user) return <Navigate to={`/login?role=shipper&next=/dashboard/runs/${section}`} replace />
  if (!isDriverRole(user.staffRole)) return <Navigate to="/dashboard/drivers" replace />
  return section === 'pay' ? <MyPay /> : section === 'time' ? <MyTime /> : <MyFile />
}

/** /dashboard/payslip/:id — drivers and the office. */
export function PayslipPage() {
  const { id } = useParams(); const { ready, user } = useStore()
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login" replace />
  return <PayslipView id={id ?? ''} />
}
