import { BrandLoader } from '../components/BrandLoader'
import { isDriverRole } from '../lib/roles'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Banknote, Check, Landmark, Lock, Save, Wallet } from 'lucide-react'
import { useStore } from '../lib/store'
import { methodLabels, paymentStatusLabels, paymentsApi, usd, type Payment, type PayoutDetails } from '../lib/payments'
import { Empty, Pill } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

type Filter = 'all' | 'held' | 'released' | 'paid_out' | 'direct' | 'refunded'
const tone: Record<Payment['status'], 'gold' | 'green' | 'muted' | 'teal' | 'danger'> = { pending: 'gold', held: 'teal', released: 'green', paid_out: 'muted', refunded: 'danger', cancelled: 'muted', direct: 'green' }
const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
const COUNTRIES = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['GH', 'Ghana'], ['NG', 'Nigeria'], ['NL', 'Netherlands'], ['DE', 'Germany'], ['FR', 'France']]

function PayoutDetailsCard({ details, canEdit, onSaved }: { details: PayoutDetails; canEdit: boolean; onSaved: (d: PayoutDetails, msg: string) => void }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState<PayoutDetails>(details)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setF(details) }, [details])
  const has = details.accountNumber || details.mobileMoney
  const save = async () => { setBusy(true); setError(''); try { const d = await paymentsApi.savePayoutDetails(f); onSaved(d, 'Payout details saved.'); setEdit(false) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <div className="card-dark p-5" data-testid="payout-details">
      <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 !text-base"><Landmark size={16} className="text-gold-deep" aria-hidden="true" /> Payout account</h2>{canEdit && !edit && <button onClick={() => setEdit(true)} className="btn-ghost !min-h-8 !px-3 text-xs">{has ? 'Change' : 'Add'}</button>}</div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {!edit ? (
        has ? <dl className="mt-3 grid gap-1 text-sm">{details.bankName && <div className="flex justify-between gap-3"><dt className="text-text-muted">Bank</dt><dd>{details.bankName}{details.country ? ` (${details.country})` : ''}</dd></div>}{details.accountName && <div className="flex justify-between gap-3"><dt className="text-text-muted">Account name</dt><dd>{details.accountName}</dd></div>}{details.accountNumber && <div className="flex justify-between gap-3"><dt className="text-text-muted">Account</dt><dd className="font-mono text-xs">{details.accountNumber}</dd></div>}{details.routing && <div className="flex justify-between gap-3"><dt className="text-text-muted">Routing / SWIFT</dt><dd className="font-mono text-xs">{details.routing}</dd></div>}{details.mobileMoney && <div className="flex justify-between gap-3"><dt className="text-text-muted">Mobile money</dt><dd>{details.mobileMoney}</dd></div>}</dl>
          : <p className="mt-2 text-sm text-text-muted">{canEdit ? 'Add the bank or mobile-money account Ntemtem should pay you into.' : 'The owner hasn’t added a payout account yet.'}</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save() }} className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Payout account">
          <label className="text-xs text-text-muted">Bank name<input className="input-dark mt-1 !min-h-9 text-sm" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Country<select className="input-dark mt-1 !min-h-9 text-sm" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">—</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="text-xs text-text-muted sm:col-span-2">Account holder name<input className="input-dark mt-1 !min-h-9 text-sm" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Account number / IBAN<input className="input-dark mt-1 !min-h-9 font-mono text-sm" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Routing / sort code / SWIFT<input className="input-dark mt-1 !min-h-9 font-mono text-sm" value={f.routing} onChange={(e) => setF({ ...f, routing: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">Mobile money (MTN MoMo, Telecel Cash, AT Money…) — number and network<input className="input-dark mt-1 !min-h-9 text-sm" placeholder="e.g. 024 555 0190 · MTN" value={f.mobileMoney} onChange={(e) => setF({ ...f, mobileMoney: e.target.value })} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => { setEdit(false); setF(details) }} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><Save size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      )}
    </div>
  )
}

export default function Payments() {
  const { ready, user } = useStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof paymentsApi.list>> | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => paymentsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load payments.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const all = data?.payments ?? []
  const list = useMemo(() => { const ql = q.trim().toLowerCase(); return all.filter((p) => (filter === 'all' ? p.status !== 'pending' : p.status === filter) && (!ql || [p.shipmentRef, p.customer, p.id].join(' ').toLowerCase().includes(ql))) }, [all, filter, q])
  const pg = usePaged(list, 12, `${filter}|${q}`)
  const count = (s: Payment['status']) => all.filter((p) => p.status === s).length

  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/payments" replace />
  if (user.role !== 'shipper' || isDriverRole(user.staffRole)) return <Navigate to="/dashboard" replace />
  const b = data?.balance
  const requestPayout = async () => { setBusy(true); setError(''); try { await paymentsApi.requestPayout(); await load(); setToast('Payout requested — Ntemtem will send it within 2 business days.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not request a payout.') } finally { setBusy(false); setRequesting(false) } }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Payments</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{b && b.availableUsd > 0 ? `${usd(b.availableUsd)} ready to pay out` : 'Payments & payouts'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Customers pay Ntemtem; the money is held in escrow and released to your balance once the shipment is {data?.config.releaseOn === 'delivered' ? 'delivered' : 'in transit'}, less the {Math.round((data?.config.takeRatePct ?? 0) * 100)}% platform fee. Request a payout whenever you like.</motion.p></div>
            {data?.canPayout && <motion.div variants={fadeUp}><button onClick={() => setRequesting(true)} disabled={!b || b.availableUsd <= 0} className="btn-gold disabled:opacity-60" data-testid="request-payout"><Banknote size={16} aria-hidden="true" /> Request payout</button></motion.div>}
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          {data && !data.config.online && <p className="mt-6 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm text-gold-deep">Online card payments aren’t switched on for the platform yet — you can still record payments received directly on each shipment.</p>}

          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="In escrow" value={usd(b?.heldUsd ?? 0)} hint="Released when goods move" icon={Lock} active={filter === 'held'} onClick={() => setFilter(filter === 'held' ? 'all' : 'held')} />
            <StatCard label="Available" value={usd(b?.availableUsd ?? 0)} hint={b?.pendingPayoutUsd ? `${usd(b.pendingPayoutUsd)} payout pending` : 'Ready to pay out'} icon={Wallet} active={filter === 'released'} onClick={() => setFilter(filter === 'released' ? 'all' : 'released')} />
            <StatCard label="Paid out" value={usd(b?.paidOutUsd ?? 0)} hint="Sent to your account" icon={Banknote} active={filter === 'paid_out'} onClick={() => setFilter(filter === 'paid_out' ? 'all' : 'paid_out')} />
            <StatCard label="Collected online" value={usd(b?.collectedUsd ?? 0)} hint={`Platform fees ${usd(b?.feesUsd ?? 0)}`} icon={Check} />
          </motion.div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
                <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={all.filter((p) => p.status !== 'pending').length}>All</Chip>
                <Chip active={filter === 'held'} onClick={() => setFilter('held')} count={count('held')}>In escrow</Chip>
                <Chip active={filter === 'released'} onClick={() => setFilter('released')} count={count('released')}>Released</Chip>
                <Chip active={filter === 'direct'} onClick={() => setFilter('direct')} count={count('direct')}>Paid directly</Chip>
                <Chip active={filter === 'refunded'} onClick={() => setFilter('refunded')} count={count('refunded')}>Refunded</Chip>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
                <SearchBox value={q} onChange={setQ} label="Search payments" placeholder="Search ref, customer…" />
              </motion.div>
              <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead><tr className={thead}><Th>Paid</Th><Th>Shipment</Th><Th className="hidden 2xl:table-cell">What</Th><Th className="text-right">Amount</Th><Th className="text-right">Fee</Th><Th className="text-right">Yours</Th><Th>Status</Th></tr></thead>
                    <tbody>
                      {data === null && !error && <tr><td colSpan={7}><BrandLoader full={false} /></td></tr>}
                      {data && pg.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10"><Empty title={all.length ? 'No payments match' : 'No payments yet'} body={all.length ? 'Try another filter.' : 'When a customer pays for a booked shipment it shows up here, held in escrow until the goods are on their way.'} /></td></tr>}
                      {pg.rows.map((p) => (
                        <tr key={p.id} className={trow(false, p.status === 'refunded' || p.status === 'cancelled')} data-testid="payment-row">
                          <td className="whitespace-nowrap px-3 py-3 text-xs">{fmt(p.paidAt)}<p className="text-text-muted">{p.method ? methodLabels[p.method] ?? p.method : ''}</p></td>
                          <td className="px-3 py-3"><Link to={`/dashboard/shipments?q=${p.shipmentRef}&b=all`} className="whitespace-nowrap font-mono text-xs text-gold-deep hover:underline">{p.shipmentRef}</Link><p className="text-xs text-text-muted">{p.customer}</p>{p.recordedBy && <p className="text-xs text-text-muted 2xl:hidden">Recorded by {p.recordedBy}</p>}</td>
                          <td className="hidden px-3 py-3 text-xs text-text-muted 2xl:table-cell"><p className="max-w-[170px] truncate" title={p.items.map((i) => i.description).join(', ')}>{p.items.map((i) => i.description).join(', ')}</p>{p.recordedBy && <p>Recorded by {p.recordedBy}</p>}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{usd(p.amountUsd)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-text-muted">{p.feeUsd ? `−${usd(p.feeUsd)}` : "—"}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{p.status === 'refunded' ? '—' : usd(p.provider === 'manual' ? p.amountUsd : p.netUsd)}</td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={tone[p.status]}>{paymentStatusLabels[p.status]}</Pill>{p.status === 'released' && p.payoutId && <p className="mt-1 text-xs text-text-muted">payout requested</p>}{p.releasedAt && p.status !== 'refunded' && <p className="mt-1 text-xs text-text-muted">released {fmt(p.releasedAt)}</p>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager p={pg} noun="payment" />
              </motion.div>
            </div>
            <motion.div variants={fadeUp} className="min-w-0 space-y-6">
              {data && <PayoutDetailsCard details={data.payoutDetails} canEdit={data.canPayout} onSaved={(d, msg) => { setData({ ...data, payoutDetails: d }); setToast(msg) }} />}
              <div className="card-dark p-5" data-testid="payouts">
                <h2 className="flex items-center gap-2 !text-base"><Banknote size={16} className="text-gold-deep" aria-hidden="true" /> Payouts</h2>
                <p className="mt-1 text-xs text-text-muted">{data?.config.payoutNote}</p>
                <ul className="mt-3 divide-y divide-border/70 text-sm">
                  {data && data.payouts.length === 0 && <li className="py-2 text-text-muted">No payouts yet.</li>}
                  {data?.payouts.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2" data-testid="payout-row">
                      <div className="min-w-0"><p className="font-semibold tabular-nums">{usd(o.amountUsd)} <span className="font-normal text-text-muted">· {o.method === 'mobile_money' ? 'mobile money' : 'bank'}</span></p><p className="truncate text-xs text-text-muted">{o.status === 'paid' ? `Sent ${fmt(o.paidAt)}${o.reference ? ` · ${o.reference}` : ''}` : o.status === 'rejected' ? o.note : `Requested ${fmt(o.requestedAt)} by ${o.requestedBy}`}</p></div>
                      <Pill tone={o.status === 'paid' ? 'green' : o.status === 'rejected' ? 'danger' : 'gold'}>{o.status === 'paid' ? 'Sent' : o.status === 'rejected' ? 'Needs attention' : 'Requested'}</Pill>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
      {requesting && b && <Confirm title={`Request a payout of ${usd(b.availableUsd)}?`} danger={false} body={<p>Ntemtem sends it to {data?.payoutDetails.mobileMoney && !data.payoutDetails.accountNumber ? `your mobile money (${data.payoutDetails.mobileMoney})` : `${data?.payoutDetails.bankName || 'your bank'} ${data?.payoutDetails.accountNumber || ''}`} within 2 business days. Released funds from {all.filter((p) => p.status === 'released' && !p.payoutId).length} shipment{all.filter((p) => p.status === 'released' && !p.payoutId).length === 1 ? '' : 's'} are included.</p>} confirmLabel="Request payout" busy={busy} onClose={() => setRequesting(false)} onConfirm={requestPayout} />}
    </div>
  )
}
