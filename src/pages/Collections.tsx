import { BrandLoader } from '../components/BrandLoader'
import { isDriverRole } from '../lib/roles'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, BellRing, Check, Copy, Mail, Receipt, Save, Settings2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { collectionsApi, payLink, type CollectionSettings, type InvoiceFull } from '../lib/collections'
import { usd } from '../lib/payments'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

type Filter = 'open' | 'overdue' | 'paid' | 'all'
const ago = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))}d ago` : '')

function SettingsCard({ s0, channels, onSaved }: { s0: CollectionSettings; channels: { email: boolean; sms: boolean }; onSaved: (s: CollectionSettings) => void }) {
  const [s, setS] = useState(s0); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const save = async () => { setBusy(true); setError(''); try { onSaved(await collectionsApi.saveSettings(s)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <div className="card-dark p-5" data-testid="collection-settings">
      <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 !text-base"><Settings2 size={16} className="text-gold-deep" aria-hidden="true" /> Reminders</h2><button onClick={save} disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60"><Save size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}</button></div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Automatic reminders</span><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={s.autoRemind} onChange={(e) => setS({ ...s, autoRemind: e.target.checked })} /></label>
      <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Nudge before due</span><span className="inline-flex items-center gap-2"><input type="number" min={0} max={30} className="input-dark !min-h-8 !w-16 text-sm tabular-nums" value={s.beforeDays} onChange={(e) => setS({ ...s, beforeDays: Math.max(0, Number(e.target.value) || 0) })} /> days</span></label>
      <label className="mt-3 block text-sm">Chase after due (days, comma-separated)<input className="input-dark mt-1 !min-h-9 text-sm" value={s.afterDays.join(', ')} onChange={(e) => setS({ ...s, afterDays: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0).slice(0, 6) })} /></label>
      <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Also text the client {channels.sms ? '' : <span className="text-xs text-text-muted">(no SMS provider yet)</span>}</span><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={s.sms} onChange={(e) => setS({ ...s, sms: e.target.checked })} /></label>
      <label className="mt-3 block text-xs text-text-muted">Message on the invoice email<textarea rows={3} className="input-dark mt-1 w-full py-2 text-sm" value={s.message} onChange={(e) => setS({ ...s, message: e.target.value })} /></label>
      {!channels.email && <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold-deep">Email isn’t configured on this server yet — invoices still reach clients with a Ntemtem account in-app, and you can copy the pay link.</p>}
    </div>
  )
}

export default function Collections() {
  const { ready, user } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof collectionsApi.list>> | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const load = () => collectionsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  const all = data?.invoices ?? []
  const list = useMemo(() => { const ql = q.trim().toLowerCase(); return all.filter((i) => (filter === 'all' ? true : filter === 'paid' ? i.status === 'paid' : filter === 'overdue' ? i.overdue : i.status === 'sent') && (!ql || [i.number, i.clientName, i.clientEmail, i.shipmentRef].join(' ').toLowerCase().includes(ql))) }, [all, filter, q])
  const pg = usePaged(list, 12, `${filter}|${q}`)
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/collections" replace />
  if (user.role !== 'shipper' || isDriverRole(user.staffRole)) return <Navigate to="/dashboard" replace />
  const send = async (inv: InvoiceFull, kind: 'invoice' | 'reminder' | 'overdue') => { setBusy(inv.id + kind); setError(''); try { const r = await collectionsApi.send(inv.id, kind); await load(); setToast(r.channels.length ? `${kind === 'invoice' ? 'Invoice' : 'Reminder'} sent by ${r.channels.join(' + ')}.` : 'Logged — no channel could deliver (add the client’s email).') } catch (e) { setError(e instanceof Error ? e.message : 'Could not send.') } finally { setBusy('') } }
  const copy = async (inv: InvoiceFull) => { if (!inv.payToken) return; try { await navigator.clipboard.writeText(payLink(inv.payToken)); setToast('Pay link copied.') } catch { setToast(payLink(inv.payToken)) } }
  const t = data?.totals
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Collections</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{t && t.overdueCount ? `${t.overdueCount} overdue · ${usd(t.overdue)}` : 'Invoices & collections'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Every invoice has a pay link — clients pay by card without signing in, the money lands in your balance, and the invoice marks itself paid. Reminders go out on your schedule; send one by hand any time.</motion.p></div>
            <motion.div variants={fadeUp}><Link to="/dashboard/clients" className="btn-ghost">Raise an invoice</Link></motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Outstanding" value={usd(t?.outstanding ?? 0)} hint="Sent, not yet paid" icon={Receipt} active={filter === 'open'} onClick={() => setFilter('open')} />
            <StatCard label="Overdue" value={usd(t?.overdue ?? 0)} hint={`${t?.overdueCount ?? 0} invoice${t?.overdueCount === 1 ? '' : 's'}`} icon={AlertTriangle} warn={(t?.overdueCount ?? 0) > 0} active={filter === 'overdue'} onClick={() => setFilter(filter === 'overdue' ? 'open' : 'overdue')} />
            <StatCard label="Collected (30d)" value={usd(t?.collected30 ?? 0)} hint="All methods" icon={Check} active={filter === 'paid'} onClick={() => setFilter(filter === 'paid' ? 'open' : 'paid')} />
            <StatCard label="Auto reminders" value={data?.settings.autoRemind ? 'On' : 'Off'} hint={data ? `${data.settings.beforeDays}d before · ${data.settings.afterDays.join('/')}d after` : ''} icon={BellRing} />
          </motion.div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
                <Chip active={filter === 'open'} onClick={() => setFilter('open')} count={all.filter((i) => i.status === 'sent').length}>Open</Chip>
                <Chip active={filter === 'overdue'} onClick={() => setFilter('overdue')} count={all.filter((i) => i.overdue).length}>Overdue</Chip>
                <Chip active={filter === 'paid'} onClick={() => setFilter('paid')} count={all.filter((i) => i.status === 'paid').length}>Paid</Chip>
                <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={all.length}>All</Chip>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
                <SearchBox value={q} onChange={setQ} label="Search invoices" placeholder="Search number, client, ref…" />
              </motion.div>
              <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className={thead}><Th>Invoice</Th><Th>Client</Th><Th>Due</Th><Th className="text-right">Balance</Th><Th>Sent</Th><Th className="text-right">Actions</Th></tr></thead>
                    <tbody>
                      {data === null && !error && <tr><td colSpan={6}><BrandLoader full={false} /></td></tr>}
                      {data && pg.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10"><Empty title={all.length ? 'Nothing matches' : 'No invoices sent yet'} body={all.length ? 'Try another filter.' : 'Raise an invoice on a client and send it — the pay link does the rest.'} /></td></tr>}
                      {pg.rows.map((inv) => (
                        <tr key={inv.id} className={trow(false, inv.status === 'paid')} data-testid="collection-row">
                          <td className="px-3 py-3"><Link to={`/dashboard/invoices/${inv.id}`} className="font-mono text-xs text-gold-deep hover:underline">{inv.number}</Link>{inv.shipmentRef && <p className="text-xs text-text-muted">{inv.shipmentRef}</p>}</td>
                          <td className="px-3 py-3"><Link to={`/dashboard/clients/${inv.clientId}?tab=invoices`} className="hover:text-gold-deep">{inv.clientName}</Link><p className="truncate text-xs text-text-muted">{inv.clientEmail || 'no email'}</p></td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs">{inv.dueAt ? fmtDate(inv.dueAt) : '—'}<p>{inv.status === 'paid' ? <Pill tone="green">Paid</Pill> : inv.overdue ? <Pill tone="danger">Overdue</Pill> : <Pill tone="gold">Open</Pill>}</p></td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{usd(inv.status === 'paid' ? inv.total : inv.balance)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-text-muted">{inv.sentAt ? `Sent ${ago(inv.sentAt)}` : 'Not sent'}{inv.remindersSent.length > 0 && <p>{inv.remindersSent.length} msg · last {ago(inv.lastReminderAt)}</p>}</td>
                          <td className="px-3 py-3 text-right">
                            {inv.status === 'sent' && <div className="inline-flex gap-1.5">
                              <button onClick={() => send(inv, inv.sentAt ? (inv.overdue ? 'overdue' : 'reminder') : 'invoice')} disabled={busy.startsWith(inv.id)} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs disabled:opacity-60" data-testid="send-invoice"><Mail size={12} aria-hidden="true" /> {inv.sentAt ? 'Remind' : 'Send'}</button>
                              <button onClick={() => copy(inv)} className="btn-ghost !min-h-8 !px-2.5 text-xs" aria-label="Copy pay link"><Copy size={12} aria-hidden="true" /> Link</button>
                            </div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager p={pg} noun="invoice" />
              </motion.div>
            </div>
            <motion.div variants={fadeUp}>{data && <SettingsCard s0={data.settings} channels={data.channels} onSaved={(s) => { setData({ ...data, settings: s }); setToast('Reminder settings saved.') }} />}</motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
