import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BellRing, Check, FileText, Printer, Send, X } from 'lucide-react'
import { bpApi, usdShort, shortDate, usd, type BpFinance, type BpInvoiceView } from '../../lib/brokerPortal'
import { Trend, C } from '../../components/Charts'
import { Card, Empty, Err, Kpi, Page, Toast, errMsg, useToast } from './BrokerApp'

const remindedToday = (at?: string | null) => !!at && Date.now() - new Date(at).getTime() < 20 * 3600000
const invTone = (s: string, overdue: boolean) => (overdue ? 'bg-danger/10 text-danger' : s === 'paid' ? 'bg-teal/15 text-teal' : s === 'sent' ? 'bg-gold/20 text-gold-deep' : s === 'void' ? 'bg-surface-2 text-text-muted line-through' : 'bg-surface-2')

export function Finance() {
  const [d, setD] = useState<BpFinance | null>(null); const [err, setErr] = useState(''); const [toast, setToast] = useToast(); const [busy, setBusy] = useState('')
  const nav = useNavigate(); const [pick, setPick] = useState<string[]>([]); const [paying, setPaying] = useState<string | null>(null); const [ref, setRef] = useState(''); const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('open')
  const load = () => bpApi.finance().then(setD).catch((e) => setErr(errMsg(e)))
  useEffect(() => { void load() }, [])
  const groups = useMemo(() => { const m = new Map<string, NonNullable<typeof d>['unbilled']>(); for (const u of d?.unbilled ?? []) m.set(u.shipperId, [...(m.get(u.shipperId) ?? []), u]); return [...m.entries()] }, [d])
  if (!d) return <Page title="Finance"><Err e={err} />{!err && <p className="text-text-muted">Loading…</p>}</Page>
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); setErr(''); try { await fn(); setToast(ok); await load() } catch (e) { setErr(errMsg(e)) } finally { setBusy('') } }
  const pickedShipper = d.unbilled.find((u) => u.jobId === pick[0])?.shipperId
  const invs = d.invoices.filter((i) => (filter === 'open' ? i.status === 'sent' || i.status === 'draft' : filter === 'paid' ? i.status === 'paid' : true))
  return (
    <Page eyebrow="Finance" title="Fees, disbursements & invoices" sub={`Invoices are due ${d.settings.termsDays} days after you create them — change it under Profile & settings.`}>
      <Toast msg={toast} /><Err e={err} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Outstanding" value={usd(d.totals.outstanding)} hint={`${d.invoices.filter((i) => i.overdue).length} overdue`} tone={d.invoices.some((i) => i.overdue) ? 'warn' : undefined} />
        <Kpi label="Paid this year" value={usd(d.totals.paidYear)} tone="good" />
        <Kpi label="Ready to bill" value={usd(d.totals.unbilled)} hint={`${d.unbilled.length} job${d.unbilled.length === 1 ? '' : 's'}`} />
        <Kpi label="Disbursements to recover" value={usd(d.totals.disbursementsOpen)} hint="paid out, not yet invoiced" />
      </div>

      <Card className="mt-6" title="Ready to bill" sub="Released or cleared jobs not on an invoice yet. Pick jobs for one shipping company and create the invoice." id="rb-h">
        {groups.length ? <div className="grid gap-4">{groups.map(([sid, list]) => <div key={sid} className="rounded-xl border border-border" data-testid="bp-unbilled-group">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5"><b>{list[0].shipper}</b><span className="text-sm text-text-muted">{list.length} job{list.length === 1 ? '' : 's'} · {usd(list.reduce((n, u) => n + u.feeUsd + u.charges.reduce((a, c) => a + c.amountUsd, 0), 0))}</span></div>
          <ul className="divide-y divide-border/70">{list.map((u) => { const on = pick.includes(u.jobId); const disabled = !!pickedShipper && pickedShipper !== sid; return <li key={u.jobId}><label className={`flex min-h-12 items-center gap-3 px-4 py-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}><input type="checkbox" disabled={disabled} checked={on} onChange={(e) => setPick((p) => (e.target.checked ? [...p, u.jobId] : p.filter((x) => x !== u.jobId)))} className="h-4 w-4" data-testid="bp-bill-pick" /><span className="min-w-0 flex-1"><Link to={`/broker-portal/jobs/${u.jobId}`} className="font-mono font-semibold underline">{u.ref}</Link> <span className="text-text-muted">· {u.customer} · {u.status === 'done' ? 'cleared' : 'released'}</span>{u.charges.length > 0 && <span className="block text-xs text-text-muted">{u.charges.length} disbursement{u.charges.length === 1 ? '' : 's'} · {usd(u.charges.reduce((a, c) => a + c.amountUsd, 0))}</span>}</span><span className="tabular-nums">{usd(u.feeUsd + u.charges.reduce((a, c) => a + c.amountUsd, 0))}</span></label></li> })}</ul>
        </div>)}
          <div className="flex flex-wrap items-center gap-3"><button onClick={async () => { setBusy('inv'); setErr(''); try { const r = await bpApi.invoice(pick) as { id: string }; setPick([]); nav(`/broker-portal/invoices/${r.id}`) } catch (e) { setErr(errMsg(e)) } finally { setBusy('') } }} disabled={!pick.length || !!busy} className="btn-gold" data-testid="bp-create-invoice"><FileText size={16} aria-hidden="true" /> Create invoice{pick.length ? ` (${pick.length})` : ''}</button>{pick.length > 0 && <button onClick={() => setPick([])} className="text-sm underline">Clear</button>}</div></div> : <Empty>Nothing to bill — finished jobs appear here.</Empty>}
      </Card>

      <Card className="mt-6" title="Invoices" id="inv-h" actions={<div className="flex gap-1 rounded-lg border border-border p-0.5 text-sm" role="tablist" aria-label="Invoice filter">{([['open', 'Open'], ['paid', 'Paid'], ['all', 'All']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`min-h-9 rounded-md px-3 ${filter === k ? 'bg-gold text-on-accent' : 'text-text-muted'}`}>{l}</button>)}</div>}>
        {invs.length ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Invoices table"><table className="w-full min-w-[760px] text-sm" data-testid="bp-invoices"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Shipping company</th><th className="px-3 py-3">Created</th><th className="px-3 py-3">Due</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3">Status</th><th className="px-3 py-3" /></tr></thead>
          <tbody>{invs.map((i) => <tr key={i.id} className="border-b border-border/70 align-top" data-testid="bp-invoice-row">
            <td className="px-3 py-3"><Link to={`/broker-portal/invoices/${i.id}`} className="font-mono font-semibold text-gold-deep underline">{i.number}</Link><span className="block text-xs text-text-muted">{i.jobIds.length} job{i.jobIds.length === 1 ? '' : 's'}</span></td>
            <td className="px-3 py-3">{i.shipper}</td><td className="px-3 py-3">{shortDate(i.createdAt)}</td><td className={`px-3 py-3 ${i.overdue ? 'font-semibold text-danger' : ''}`}>{shortDate(i.dueAt)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{usd(i.totalUsd)}</td>
            <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${invTone(i.status, i.overdue)}`}>{i.overdue ? 'Overdue' : i.status[0].toUpperCase() + i.status.slice(1)}</span>{i.paidRef && <span className="block text-xs text-text-muted">ref {i.paidRef}</span>}</td>
            <td className="px-3 py-3 text-right"><div className="flex flex-wrap justify-end gap-1">
              {i.status === 'draft' && <><button onClick={() => act(i.id, () => bpApi.sendInvoice(i.id), `${i.number} sent to ${i.shipper}.`)} disabled={!!busy} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="bp-send-invoice"><Send size={13} aria-hidden="true" /> Send</button><button onClick={() => act(i.id, () => bpApi.voidInvoice(i.id), 'Draft voided.')} disabled={!!busy} className="btn-ghost !min-h-9 !px-3 text-xs">Void</button></>}
              {i.status === 'sent' && paying !== i.id && <button onClick={() => act(i.id, () => bpApi.remindInvoice(i.id), `Reminder sent to ${i.shipper} about ${i.number}.`)} disabled={!!busy || remindedToday(i.remindedAt)} title={remindedToday(i.remindedAt) ? 'Reminder already sent today' : undefined} className={`btn-ghost !min-h-9 !px-3 text-xs ${i.overdue ? '!border-danger text-danger' : ''}`} data-testid="bp-remind"><BellRing size={13} aria-hidden="true" /> {remindedToday(i.remindedAt) ? 'Reminded' : 'Remind'}</button>}
              {i.status === 'sent' && (paying === i.id ? <form onSubmit={(e) => { e.preventDefault(); void act(i.id, () => bpApi.paidInvoice(i.id, ref), `${i.number} marked paid.`).then(() => { setPaying(null); setRef('') }) }} className="flex gap-1"><label className="sr-only" htmlFor={`ref-${i.id}`}>Payment reference</label><input id={`ref-${i.id}`} className="input-dark !min-h-9 !w-32 text-xs" placeholder="Bank / MoMo ref" value={ref} onChange={(e) => setRef(e.target.value)} /><button className="btn-gold !min-h-9 !px-2 text-xs" aria-label="Save payment"><Check size={13} /></button><button type="button" onClick={() => setPaying(null)} className="btn-ghost !min-h-9 !px-2 text-xs" aria-label="Cancel"><X size={13} /></button></form> : <button onClick={() => setPaying(i.id)} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="bp-mark-paid">Mark paid</button>)}
            </div></td></tr>)}</tbody></table></div> : <Empty>No invoices in this view.</Empty>}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Billed and paid by month" id="mo-h">{d.months.length ? <Trend data={d.months.map((m) => ({ ...m, start: `${m.month}-01` }))} series={[{ key: 'billed', label: 'Billed', color: C.context }, { key: 'paid', label: 'Paid', color: C.focus }]} bucket="month" format={usdShort} label="Billed and paid per month" /> : <Empty>No invoices yet.</Empty>}</Card>
        <Card title="By shipping company" id="bs-h">{d.byShipper.length ? <ul className="divide-y divide-border text-sm">{d.byShipper.map((x) => <li key={x.shipper} className="flex items-center justify-between gap-3 py-2.5"><span className="font-medium">{x.shipper}</span><span className="text-right tabular-nums">{usd(x.billed)}<span className={`block text-xs ${x.outstanding ? 'text-danger' : 'text-text-muted'}`}>{x.outstanding ? `${usd(x.outstanding)} outstanding` : 'all paid'}</span></span></li>)}</ul> : <Empty>No billing yet.</Empty>}</Card>
      </div>
    </Page>
  )
}

/** Printable invoice — used by the broker and (read-only) by the shipping company it's addressed to. */
export function InvoiceView({ v, back, actions }: { v: BpInvoiceView; back?: React.ReactNode; actions?: React.ReactNode }) {
  const i = v.invoice; const b = v.broker
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">{back}<div className="flex flex-wrap gap-2">{actions}<button onClick={() => window.print()} className={actions ? 'btn-ghost' : 'btn-gold'}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button></div></div>
      <article className="rounded-2xl border border-border bg-surface p-8 print:border-0 print:p-0" data-testid="bp-invoice">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5"><div><p className="text-xs uppercase tracking-wider text-text-muted">Invoice</p><h1 className="!text-2xl">{b.company || b.name}</h1><p className="text-sm text-text-muted">Licensed customs broker · {b.licence}{b.authority ? ` (${b.authority})` : ''}</p><p className="text-sm text-text-muted">{[b.phone, b.email].filter(Boolean).join(' · ')}</p></div><div className="text-right text-sm"><p className="font-mono text-lg font-bold">{i.number}</p><p>Issued {shortDate(i.createdAt)}</p><p className={i.overdue ? 'font-semibold text-danger' : ''}>Due {shortDate(i.dueAt)}</p><p className="mt-2 text-text-muted">Bill to</p><p className="font-semibold">{i.shipper}</p></div></header>
        <table className="mt-5 w-full text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="py-2">Description</th><th className="py-2 text-right">Amount (USD)</th></tr></thead><tbody>{i.lines.map((l, k) => <tr key={k} className="border-b border-border/60"><td className="py-2 pr-3">{l.label}</td><td className="py-2 text-right tabular-nums">{usd(l.amountUsd)}</td></tr>)}<tr><td className="py-3 text-base font-bold">Total</td><td className="py-3 text-right text-base font-bold tabular-nums" data-testid="bp-invoice-total">{usd(i.totalUsd)}</td></tr></tbody></table>
        <footer className="mt-4 space-y-1 text-sm text-text-muted">{i.status === 'paid' && <p className="font-semibold text-teal">Paid {shortDate(i.paidAt)}{i.paidRef ? ` · ref ${i.paidRef}` : ''}</p>}{b.bank && <p><b className="text-text">Pay to:</b> {b.bank}</p>}{i.notes && <p>{i.notes}</p>}<p>Disbursements are charged at cost; local-currency amounts converted at the day’s rate.</p></footer>
      </article>
    </div>
  )
}
export function InvoicePage() {
  const { id = '' } = useParams(); const [v, setV] = useState<BpInvoiceView | null>(null); const [err, setErr] = useState(''); const [toast, setToast] = useToast(); const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState(false); const [ref, setRef] = useState(''); const nav = useNavigate()
  const load = () => bpApi.viewInvoice(id).then(setV).catch((e) => setErr(errMsg(e)))
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="p-8"><Err e={err} /></div>
  const i = v.invoice
  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => { setBusy(true); setErr(''); try { await fn(); setToast(ok); after?.(); await load() } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) } }
  // Check it, then send it — from the same page.
  const actions = i.status === 'draft' ? <>
    <button onClick={() => act(() => bpApi.sendInvoice(i.id), `${i.number} sent to ${i.shipper}.`)} disabled={busy} className="btn-gold" data-testid="bp-inv-send"><Send size={15} aria-hidden="true" /> Send to {i.shipper}</button>
    <button onClick={() => act(() => bpApi.voidInvoice(i.id), 'Draft voided — the jobs are back under Ready to bill.', () => nav('/broker-portal/finance'))} disabled={busy} className="btn-ghost">Void draft</button>
  </> : i.status === 'sent' ? (paying
    ? <form onSubmit={(e) => { e.preventDefault(); void act(() => bpApi.paidInvoice(i.id, ref), `${i.number} marked paid.`, () => setPaying(false)) }} className="flex gap-2"><label className="sr-only" htmlFor="inv-ref">Payment reference</label><input id="inv-ref" className="input-dark !w-44" placeholder="Bank / MoMo ref" value={ref} onChange={(e) => setRef(e.target.value)} /><button disabled={busy} className="btn-gold">Save</button><button type="button" onClick={() => setPaying(false)} className="btn-ghost">Cancel</button></form>
    : <><button onClick={() => act(() => bpApi.remindInvoice(i.id), `Reminder sent to ${i.shipper}.`)} disabled={busy || remindedToday(i.remindedAt)} className="btn-ghost" data-testid="bp-inv-remind"><BellRing size={15} aria-hidden="true" /> {remindedToday(i.remindedAt) ? 'Reminded today' : 'Send a reminder'}</button><button onClick={() => setPaying(true)} className="btn-gold" data-testid="bp-inv-paid"><Check size={15} aria-hidden="true" /> Mark paid</button></>) : null
  return <>
    {(toast || err || i.status === 'draft') && <div className="mx-auto w-full max-w-3xl px-4 pt-6 print:hidden"><Toast msg={toast} /><Err e={err} />{i.status === 'draft' && !toast && <p className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm" data-testid="bp-inv-draft-note">Draft — only you can see it. Check the lines, then send it to {i.shipper}.</p>}</div>}
    <InvoiceView v={v} actions={actions} back={<Link to="/broker-portal/finance" className="inline-flex min-h-10 items-center gap-1 text-sm text-text-muted"><ArrowLeft size={15} aria-hidden="true" /> Finance</Link>} />
  </>
}

/** The same invoice, as the shipping company sees it from its dashboard. */
export function OfficeInvoicePage() {
  const { id = '' } = useParams(); const [v, setV] = useState<BpInvoiceView | null>(null); const [err, setErr] = useState('')
  useEffect(() => { bpApi.officeInvoice(id).then(setV).catch((e) => setErr(errMsg(e))) }, [id])
  if (!v) return <div className="p-8"><Err e={err} /></div>
  return <InvoiceView v={v} back={<button onClick={() => window.history.back()} className="inline-flex min-h-10 items-center gap-1 text-sm text-text-muted"><ArrowLeft size={15} aria-hidden="true" /> Back</button>} />
}
