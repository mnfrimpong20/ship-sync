import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import QRCode from 'qrcode'
import { AlertTriangle, Check, CircleCheck, Languages, MapPin, Navigation, Package, Plane, Ship, Smartphone, Wallet } from 'lucide-react'
import { Logo } from '../components/ui'
import { recipientApi, type ReceiverCharge, type ReceiverPage } from '../lib/recipient'
import { statusOrder } from '../lib/data'
import { RX, STATUS_FR, type RxCopy } from '../lib/receiverText'
import type { Lang } from '../lib/address'
import { fadeUp, stagger } from '../lib/motion'
import { setPageTitle } from '../lib/site'

const STEP_DONE: ((s: string) => boolean)[] = [
  () => true,
  (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('in_transit'),
  (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('arrived'),
  (s) => statusOrder.indexOf(s as never) >= statusOrder.indexOf('ready_for_collection'),
  (s) => s === 'delivered',
]
const fmtD = (iso: string, lang: Lang, time = false) => new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })

/** `/r/:token` — the page the receiver in Africa opens from the text message. Phone first, no sign-in, English or French. */
export default function Receive() {
  const { token = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const [d, setD] = useState<ReceiverPage | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')
  const [form, setForm] = useState({ name: '', note: '', allGood: true })
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState<null | boolean>(null)
  const [payMsg, setPayMsg] = useState('')
  const t: RxCopy = RX[lang]
  const load = () => recipientApi.page(token).then((r) => { setD(r); setForm((f) => ({ ...f, name: f.name || r.receiver?.name || '' })); return r })
  useEffect(() => {
    load().then((r) => {
      setLang(r.lang)
      // Back from Paystack: confirm the payment straight away (the webhook may land a moment later).
      const cid = sp.get('charge')
      if (cid) { setPayMsg(RX[r.lang].checking); recipientApi.verify(token, cid).then((c) => { setPayMsg(c.status === 'paid' ? RX[r.lang].paidThanks : ''); void load() }).catch(() => setPayMsg('')).finally(() => { const n = new URLSearchParams(sp); n.delete('charge'); n.delete('reference'); n.delete('trxref'); setSp(n, { replace: true }) }) }
    }).catch((e) => setError(e instanceof Error ? e.message : RX.en.invalid))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d) QRCode.toDataURL(d.trackUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320, color: { dark: '#14213D', light: '#FFFFFF' } }).then(setQr).catch(() => {}) }, [d])
  useEffect(() => { document.documentElement.lang = lang; return () => { document.documentElement.lang = 'en' } }, [lang])
  const switchLang = () => { const next: Lang = lang === 'fr' ? 'en' : 'fr'; setLang(next); void recipientApi.setLang(token, next).catch(() => {}) }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!d) return
    setBusy('receipt'); setError('')
    try { const r = await recipientApi.received(token, form); setDone(r.delivered); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Could not send.') } finally { setBusy('') }
  }
  const pay = async (c: ReceiverCharge) => {
    setBusy(c.id); setError('')
    try { const r = await recipientApi.pay(token, c.id); location.assign(r.url) } catch (err) { setError(err instanceof Error ? err.message : 'Could not open payment.'); setBusy('') }
  }
  if (error && !d) { document.title = 'Link not valid · Ntemtem'; return <div className="container-x py-24 text-center"><Logo /><p className="mt-6 text-danger">{error}</p><p className="mt-2 text-sm text-text-muted">{t.askSender} <Link to="/track" className="text-gold-deep hover:underline">{t.trackRef}</Link>.</p></div> }
  if (!d) return <div className="container-x py-24 text-center text-text-muted">{t.loading}</div>
  const s = d.shipment
  setPageTitle(`${s.ref} · your shipment`)
  const delivered = s.status === 'delivered'
  const collect = !delivered && (d.readyForCollection || s.status === 'customs' || s.status === 'arrived')
  const due = d.charges.filter((c) => c.status === 'due')
  return (
    <div className="bg-bg text-text" lang={lang}>
      <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-xl px-4 py-8 md:py-12">
        <motion.div variants={fadeUp} className="flex items-center justify-between gap-3">
          <Logo />
          <div className="flex items-center gap-2">
            <button onClick={switchLang} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold hover:bg-surface-2 focus-ring" data-testid="lang-toggle" title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}><Languages size={14} aria-hidden="true" /> {t.lang}</button>
            <span className="hidden font-mono text-xs text-text-muted sm:inline">{s.ref}</span>
          </div>
        </motion.div>
        <motion.h1 variants={fadeUp} className="mt-6 !text-[clamp(1.6rem,6vw,2.2rem)]">{d.receiver ? t.hiName(d.receiver.name.split(' ')[0]) : ''}{delivered ? t.delivered : collect ? t.ready : t.coming}</motion.h1>
        <motion.p variants={fadeUp} className="mt-2 text-text-muted">{t.from} <strong className="text-text">{s.sender}</strong> {t.in} {s.origin}, {t.handledBy} {d.shipper.name}.{s.description ? ` ${s.description}.` : ''}</motion.p>

        <motion.div variants={fadeUp} className="card-dark mt-6 p-5" data-testid="receiver-status">
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">{s.mode === 'air' ? <Plane size={16} className="text-sky" aria-hidden="true" /> : <Ship size={16} className="text-sea" aria-hidden="true" />} {t.steps[Math.max(0, STEP_DONE.map((f) => f(s.status)).lastIndexOf(true))]}</p>
            {s.eta && !delivered && <p className="text-xs text-text-muted">{t.expected} {fmtD(s.eta + 'T12:00:00Z', lang)}</p>}
          </div>
          <ol className="mt-4 grid grid-cols-5 gap-1 text-center text-xs">
            {t.steps.map((label, i) => { const on = STEP_DONE[i](s.status); return <li key={label} className={on ? 'text-text' : 'text-text-muted'}><span className={`mx-auto mb-1 block h-2 rounded-full ${on ? 'bg-gold' : 'bg-border'}`} />{label}</li> })}
          </ol>
          {collect && (
            <div className="mt-4 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm" data-testid="collect-box">
              <p className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span>{d.readyForCollection ? <><strong>{t.readyTitle}</strong> {t.readyFrom} {d.shipper.name}{s.port ? ` (${s.port})` : ''}. {t.bringId} <strong className="font-mono">{s.ref}</strong>.</> : t.reached(s.port || s.destinationName)}</span></p>
            </div>
          )}
          {s.vesselName && !delivered && statusOrder.indexOf(s.status as never) < statusOrder.indexOf('arrived') && <p className="mt-3 text-xs text-text-muted">{t.sailingOn} {s.vesselName}. <a href={d.trackUrl} className="text-gold-deep hover:underline">{t.seeMap}</a>.</p>}
          {d.pieces.length > 1 && <p className="mt-3 inline-flex items-center gap-2 text-xs text-text-muted"><Package size={14} aria-hidden="true" /> {t.pieces(d.pieces.length, d.pieces.filter((p) => p.status === 'delivered').length)}</p>}
          {d.deliverTo && !delivered && (d.deliverTo.address || d.deliverTo.gps || d.deliverTo.city) && (
            <div className="mt-4 flex items-start justify-between gap-3 border-t border-border pt-3 text-sm" data-testid="deliver-to">
              <p className="min-w-0"><span className="block text-xs text-text-muted">{t.deliverTo}</span>{[d.deliverTo.address, d.deliverTo.city].filter(Boolean).join(', ')}{d.deliverTo.gps && <span className="mt-1 block text-xs text-text-muted">{t.gps} <span className="font-mono text-text">{d.deliverTo.gps}</span></span>}</p>
              {d.deliverTo.mapUrl && <a href={d.deliverTo.mapUrl} target="_blank" rel="noopener" className="btn-ghost !min-h-9 shrink-0 !px-3 text-xs"><Navigation size={13} aria-hidden="true" /> {t.openMap}</a>}
            </div>
          )}
        </motion.div>

        {d.charges.length > 0 && (
          <motion.div variants={fadeUp} className={`mt-4 rounded-xl border p-5 ${due.length ? 'border-gold/50 bg-gold/10' : 'border-teal/40 bg-teal/10'}`} data-testid="receiver-charges">
            <p className="inline-flex items-center gap-2 text-sm font-semibold"><Wallet size={16} className="text-gold-deep" aria-hidden="true" /> {t.toPay}</p>
            {payMsg && <p role="status" className="mt-2 text-sm text-teal">{payMsg}</p>}
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
            <ul className="mt-3 space-y-3">
              {d.charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0"><strong className="tabular-nums">{c.label}</strong><span className="block text-xs text-text-muted">{c.reason}</span></span>
                  {c.status === 'paid' ? <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-1 text-xs font-semibold text-teal"><Check size={12} aria-hidden="true" /> {t.paid}{c.paidAt ? ` · ${fmtD(c.paidAt, lang)}` : ''}</span>
                    : d.online ? <button onClick={() => pay(c)} disabled={!!busy} className="btn-gold !min-h-11 !px-4 text-sm disabled:opacity-60" data-testid="pay-charge"><Smartphone size={15} aria-hidden="true" /> {busy === c.id ? t.paying : t.payMomo}</button>
                    : null}
                </li>
              ))}
            </ul>
            {due.length > 0 && (d.online ? d.methods && <p className="mt-3 text-xs text-text-muted">{d.methods}</p> : <p className="mt-3 text-xs text-text-muted">{t.payAtCollection}</p>)}
          </motion.div>
        )}

        {(d.receipt || done !== null) ? (
          <motion.div variants={fadeUp} className={`mt-4 rounded-xl border p-5 ${d.receipt?.allGood !== false ? 'border-teal/40 bg-teal/10' : 'border-danger/40 bg-danger/10'}`} data-testid="receipt-done">
            <p className="flex items-start gap-2 text-sm">{d.receipt?.allGood !== false ? <CircleCheck size={18} className="shrink-0 text-teal" aria-hidden="true" /> : <AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden="true" />}<span>{d.receipt?.allGood !== false ? <><strong>{t.thanks}{d.receipt ? `, ${d.receipt.name.split(' ')[0]}` : ''}.</strong> {t.confirmedNote(d.receipt?.at ? fmtD(d.receipt.at, lang, true) : '', s.sender, d.shipper.name)}</> : <><strong>{t.flagged}</strong> {t.followUp(d.shipper.name)}</>}</span></p>
          </motion.div>
        ) : (
          <motion.form variants={fadeUp} onSubmit={submit} className="card-dark mt-4 p-5" aria-label={t.didYou} data-testid="receipt-form">
            <h2 className="!text-base">{t.didYou}</h2>
            <p className="mt-1 text-xs text-text-muted">{delivered ? t.confirmOnce : t.onlyConfirm}</p>
            {error && !d.charges.length && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
            <input aria-label={t.yourName} required minLength={2} className="input-dark mt-3 !min-h-11 text-base" placeholder={t.yourName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border p-2.5 text-center ${form.allGood ? 'border-teal bg-teal/10' : 'border-border'}`}><input type="radio" name="ok" className="sr-only" checked={form.allGood} onChange={() => setForm({ ...form, allGood: true })} /><Check size={14} aria-hidden="true" /> {t.allGood}</label>
              <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border p-2.5 text-center ${!form.allGood ? 'border-danger bg-danger/10' : 'border-border'}`}><input type="radio" name="ok" className="sr-only" checked={!form.allGood} onChange={() => setForm({ ...form, allGood: false })} /><AlertTriangle size={14} aria-hidden="true" /> {t.wrong}</label>
            </div>
            <input aria-label={t.addNote} className="input-dark mt-2 !min-h-11 text-base" placeholder={form.allGood ? t.addNote : t.whatsWrong} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <button disabled={busy === 'receipt'} className="btn-gold mt-3 w-full !min-h-12 text-base disabled:opacity-60">{busy === 'receipt' ? t.sending : form.allGood ? t.iReceived : t.report}</button>
          </motion.form>
        )}

        <motion.div variants={fadeUp} className="card-dark mt-4 flex items-center gap-4 p-5">
          {qr ? <img src={qr} alt={`QR ${s.ref}`} className="h-24 w-24 shrink-0 rounded-lg bg-white p-1" /> : <div className="h-24 w-24 shrink-0 rounded-lg bg-surface-2" />}
          <div className="min-w-0 text-sm"><p className="font-semibold">{t.showAt}</p><p className="mt-0.5 text-xs text-text-muted">{t.refLabel} <span className="font-mono text-text">{s.ref}</span>. {t.staffScan}</p><a href={d.trackUrl} className="mt-1 inline-block text-xs text-gold-deep hover:underline">{t.fullTracking}</a></div>
        </motion.div>

        <motion.details variants={fadeUp} className="card-dark mt-4 p-5">
          <summary className="cursor-pointer text-sm font-semibold">{t.history}</summary>
          <ol className="mt-3 space-y-2 text-xs">{[...d.events].reverse().map((e, i) => <li key={i}><span className="font-semibold">{lang === 'fr' ? STATUS_FR[e.status] ?? e.label : e.label}</span>{e.place ? ` · ${e.place}` : ''}{e.at ? <span className="text-text-muted"> · {fmtD(e.at, lang, true)}</span> : ''}{e.note ? <span className="block text-text-muted">{e.note}</span> : null}</li>)}</ol>
        </motion.details>
        <p className="mt-6 text-center text-xs text-text-muted">{t.footer(d.shipper.name)}</p>
      </motion.div>
    </div>
  )
}
