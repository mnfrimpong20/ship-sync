import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useRef, useState } from 'react'
import { localPrice } from '../lib/sourcingOrigins'
import { useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, Camera, Check, ClipboardCheck, Clock, Loader2, PackageCheck, Percent } from 'lucide-react'
import { Logo, Pill, fmtDate, fmtDateTime } from '../components/ui'
import { supplierApi, type SupplierPortal as Portal, type SupplierUpdate } from '../lib/sourcing'
import { fadeUp, stagger } from '../lib/motion'
import { LinkProblem } from '../components/LinkProblem'

/** Labels in English and Simplified Chinese — factories read both, the agents read both. */
const T = {
  title: ['Purchase order', '采购订单'], confirm: ['Confirm this order', '确认订单'], confirmed: ['Order confirmed', '订单已确认'], progress: ['Report progress', '汇报进度'],
  ready: ['Goods are ready', '货物已备齐'], delay: ['Report a delay', '报告延期'], note: ['Leave a note', '留言'], photos: ['Production photos', '生产照片'], addPhoto: ['Add photo', '上传照片'],
  qty: ['Quantity', '数量'], unit: ['Unit price', '单价'], readyBy: ['Ready by', '交货日期'], incoterm: ['Terms', '贸易条款'], lead: ['Lead time', '交期'], yourName: ['Your name', '您的姓名'],
  pct: ['Percent complete', '完成百分比'], newDate: ['New ready date', '新交货日期'], message: ['Message (optional)', '留言（可选）'], send: ['Send', '发送'], history: ['Updates', '更新记录'],
  agent: ['Your Ntemtem agent', '您的 Ntemtem 专员'], spec: ['Specification', '产品规格'], closed: ['This order is closed.', '此订单已关闭。'], thanks: ['Sent — your agent has been notified.', '已发送，专员已收到通知。'],
} as const
const L = ({ k }: { k: keyof typeof T }) => <>{T[k][0]} <span className="text-text-muted">{T[k][1]}</span></>

const kindIcon: Record<SupplierUpdate['kind'], typeof Check> = { confirm: ClipboardCheck, progress: Percent, ready: PackageCheck, delay: AlertTriangle, note: Clock }

export default function SupplierPortalPage() {
  const { token = '' } = useParams()
  const [d, setD] = useState<Portal | null>(null)
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [kind, setKind] = useState<SupplierUpdate['kind'] | null>(null)
  const [f, setF] = useState({ body: '', by: '', readyBy: '', pct: 50 })
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => supplierApi.portal(token).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.'))
  useEffect(() => { void load(); try { setF((x) => ({ ...x, by: localStorage.getItem('ss-supplier-name') ?? '' })) } catch { /* ignore */ } }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (d?.po?.readyBy && !f.readyBy) setF((x) => ({ ...x, readyBy: d.po!.readyBy })) }, [d]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !d) return <LinkProblem chrome title="This supplier link doesn’t work · 链接无效" body="It may have expired or been replaced. Ask your Ntemtem sourcing agent for a new one. · 请联系您的 Ntemtem 采购代理获取新链接。" track={false} />
  if (!d) return <div className="min-h-dvh bg-bg text-text"><BrandLoader /></div>
  const closed = ['closed', 'cancelled', 'delivered'].includes(d.job.status)
  const needsDate = kind === 'ready' || kind === 'delay'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!kind) return
    if (f.by.trim().length < 1) return setError('Please enter your name. 请输入您的姓名。')
    if (needsDate && !f.readyBy) return setError('Please choose a date. 请选择日期。')
    setBusy(true); setError('')
    try {
      try { localStorage.setItem('ss-supplier-name', f.by) } catch { /* ignore */ }
      await supplierApi.update(token, { kind, body: f.body, by: f.by, readyBy: needsDate || (kind === 'progress' && f.readyBy) ? f.readyBy : undefined, pct: kind === 'progress' ? f.pct : undefined })
      await load(); setKind(null); setF((x) => ({ ...x, body: '' })); setToast(T.thanks[0] + ' ' + T.thanks[1])
    } catch (er) { setError(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) }
  }
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (!f.by.trim()) { setError('Please enter your name first. 请先输入您的姓名。'); e.target.value = ''; return }
    if (file.size > 3_000_000) { setError('Keep photos under 3 MB. 照片请小于 3 MB。'); return }
    setBusy(true); setError('')
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(file) })
      await supplierApi.photo(token, { title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Photo', mime: file.type, data, by: f.by }); await load(); setToast(T.thanks[0] + ' ' + T.thanks[1])
    } catch (er) { setError(er instanceof Error ? er.message : 'Upload failed.') } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="container-x max-w-2xl py-8 md:py-12">
        <div className="flex items-center justify-between gap-3"><Logo /><span className="text-xs text-text-muted">Supplier portal · 供应商门户</span></div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6 space-y-4">
          <motion.div variants={fadeUp} className="card-dark p-5" data-testid="supplier-po">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="eyebrow mb-1"><L k="title" /></p><h1 className="!text-2xl">{d.po?.number ?? d.job.ref} · {d.job.title}</h1><p className="mt-1 text-sm text-text-muted">{d.supplier.name ?? 'Factory'}{d.supplier.contact ? ` · ${d.supplier.contact}` : ''}</p></div>
              {d.po?.readyAt ? <Pill tone="green">{T.ready[0]} · {T.ready[1]}</Pill> : d.po?.confirmedAt ? <Pill tone="teal">{T.confirmed[0]} · {T.confirmed[1]}</Pill> : <Pill tone="gold">Awaiting confirmation · 待确认</Pill>}
            </div>
            {toast && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-text-muted"><L k="qty" /></dt><dd className="font-semibold tabular-nums">{d.job.quantity.toLocaleString()} {d.job.unit}</dd></div>
              {d.quote && <div><dt className="text-xs text-text-muted"><L k="unit" /></dt><dd className="font-semibold tabular-nums">{localPrice(d.quote.unitPriceCny, d.quote.origin ?? 'CN')} / {d.job.unit}{d.quote.moq ? <span className="text-xs font-normal text-text-muted"> · MOQ {d.quote.moq.toLocaleString()}</span> : null}</dd></div>}
              {d.po?.incoterm && <div><dt className="text-xs text-text-muted"><L k="incoterm" /></dt><dd className="font-semibold">{d.po.incoterm}</dd></div>}
              {d.po?.readyBy && <div><dt className="text-xs text-text-muted"><L k="readyBy" /></dt><dd className="font-semibold">{fmtDate(d.po.readyBy)}{d.po.pct != null && !d.po.readyAt && <span className="ml-2 text-xs font-normal text-text-muted">{d.po.pct}%</span>}</dd></div>}
              {d.quote && <div><dt className="text-xs text-text-muted"><L k="lead" /></dt><dd className="font-semibold">{d.quote.leadDays} days · 天</dd></div>}
              <div><dt className="text-xs text-text-muted"><L k="agent" /></dt><dd className="font-semibold">{d.agent}</dd></div>
            </dl>
            {d.po?.pct != null && !d.po.readyAt && <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-label={`${d.po.pct}% complete`}><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${d.po.pct}%` }} /></div>}
            {(d.job.description || d.quote?.notes) && <details className="mt-4 text-sm"><summary className="cursor-pointer text-text-muted"><L k="spec" /></summary><p className="mt-2 whitespace-pre-wrap">{d.job.description}</p>{d.quote?.notes && <p className="mt-2 whitespace-pre-wrap text-text-muted">{d.quote.notes}</p>}</details>}
          </motion.div>

          {closed ? <motion.p variants={fadeUp} className="card-dark p-5 text-sm text-text-muted"><L k="closed" /></motion.p> : (
            <motion.div variants={fadeUp} className="card-dark p-5" data-testid="supplier-actions">
              <label className="grid gap-1 text-xs"><span className="text-text-muted"><L k="yourName" /></span><input className="input-dark !min-h-10" value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} autoComplete="name" data-testid="supplier-name" /></label>
              {!kind && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {!d.po?.confirmedAt && <button className="btn-gold !min-h-12 justify-start" onClick={() => setKind('confirm')} data-testid="act-confirm"><ClipboardCheck size={18} aria-hidden="true" /> <L k="confirm" /></button>}
                  <button className="btn-ghost !min-h-12 justify-start" onClick={() => setKind('progress')} data-testid="act-progress"><Percent size={18} aria-hidden="true" /> <L k="progress" /></button>
                  <button className="btn-ghost !min-h-12 justify-start" onClick={() => setKind('ready')} data-testid="act-ready"><PackageCheck size={18} aria-hidden="true" /> <L k="ready" /></button>
                  <button className="btn-ghost !min-h-12 justify-start" onClick={() => setKind('delay')} data-testid="act-delay"><AlertTriangle size={18} aria-hidden="true" /> <L k="delay" /></button>
                  <button className="btn-ghost !min-h-12 justify-start" onClick={() => setKind('note')}><Clock size={18} aria-hidden="true" /> <L k="note" /></button>
                  <button className="btn-ghost !min-h-12 justify-start" onClick={() => fileRef.current?.click()} disabled={busy}><Camera size={18} aria-hidden="true" /> <L k="addPhoto" /></button>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} data-testid="supplier-photo-input" />
                </div>
              )}
              {kind && (
                <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg border border-border p-4" aria-label="Update">
                  <p className="font-semibold"><L k={kind} /></p>
                  {kind === 'progress' && <label className="grid gap-1 text-xs"><span className="text-text-muted"><L k="pct" /> · <b className="text-text tabular-nums">{f.pct}%</b></span><input type="range" min={0} max={100} step={5} value={f.pct} onChange={(e) => setF({ ...f, pct: Number(e.target.value) })} className="accent-gold" data-testid="pct" /></label>}
                  {(needsDate || kind === 'progress') && <label className="grid gap-1 text-xs"><span className="text-text-muted"><L k={kind === 'delay' ? 'newDate' : 'readyBy'} /></span><input type="date" className="input-dark !min-h-10" value={f.readyBy} onChange={(e) => setF({ ...f, readyBy: e.target.value })} data-testid="ready-by" /></label>}
                  <label className="grid gap-1 text-xs"><span className="text-text-muted"><L k="message" /></span><textarea className="input-dark min-h-20" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={1500} data-testid="supplier-body" /></label>
                  <div className="flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-10" onClick={() => setKind(null)}>Back · 返回</button><button className="btn-gold !min-h-10" disabled={busy} data-testid="supplier-send">{busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} <L k="send" /></button></div>
                </form>
              )}
            </motion.div>
          )}

          {d.photos.length > 0 && (
            <motion.div variants={fadeUp} className="card-dark p-5"><p className="eyebrow mb-3"><L k="photos" /></p><ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Photos">{d.photos.map((p) => <li key={p.id}><a href={p.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2"><img src={p.url} alt={p.title} className="h-full w-full object-cover" loading="lazy" /></a><p className="mt-1 truncate text-xs text-text-muted">{p.by} · {fmtDate(p.at)}</p></li>)}</ul></motion.div>
          )}

          <motion.div variants={fadeUp} className="card-dark p-5">
            <p className="eyebrow mb-3"><L k="history" /></p>
            <ol className="space-y-3 text-sm" aria-label="Updates">
              {d.updates.map((u) => { const I = kindIcon[u.kind]; return <li key={u.id} className="flex gap-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${u.kind === 'delay' ? 'bg-danger/10 text-danger' : 'bg-gold/15 text-gold-deep'}`}><I size={14} aria-hidden="true" /></span><div className="min-w-0"><p className="font-medium"><L k={u.kind} />{u.pct != null && <span className="ml-2 text-xs text-text-muted tabular-nums">{u.pct}%</span>}{u.readyBy && <span className="ml-2 text-xs text-text-muted">→ {fmtDate(u.readyBy)}</span>}</p>{u.body && <p className="whitespace-pre-wrap text-text-muted">{u.body}</p>}<p className="text-xs text-text-muted">{u.by} · {fmtDateTime(u.at)}</p></div></li> })}
              {d.updates.length === 0 && <li className="text-text-muted">No updates yet. 暂无更新。</li>}
            </ol>
          </motion.div>
          <p className="text-center text-xs text-text-muted">This link is private to your factory. Do not forward it. · 此链接仅供贵厂使用，请勿转发。</p>
        </motion.div>
      </div>
    </div>
  )
}
