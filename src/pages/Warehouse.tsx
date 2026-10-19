import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, Boxes, Check, Grid3x3, PackageCheck, PackageOpen, Plus, Receipt, Settings2, Warehouse as WarehouseIcon } from 'lucide-react'
import { useStore } from '../lib/store'
import { warehouseApi, type Site, type SiteInput, type StockItem } from '../lib/warehouse'
import { cargoLabel, type CargoType } from '../lib/data'
import { Empty, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Confirm, StatCard } from '../components/board'

const blank = (): SiteInput => ({ name: '', kind: 'origin', address: '', city: '', country: 'US', freeDays: 7, rateUsd: 1.5, vehicleRateUsd: 15, hours: '', active: true })

function SiteForm({ initial, onSaved, onCancel }: { initial: SiteInput & { id?: string }; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { if (initial.id) await warehouseApi.updateSite(initial.id, f); else await warehouseApi.createSite(f); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <form onSubmit={submit} className="card-dark grid gap-3 p-5 sm:grid-cols-2" aria-label="Site" data-testid="site-form">
      <h2 className="!text-base sm:col-span-2">{initial.id ? 'Edit site' : 'Add a warehouse or yard'}</h2>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <label className="text-xs text-text-muted">Name<input required className="input-dark mt-1 !min-h-9 text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="text-xs text-text-muted">Side<select className="input-dark mt-1 !min-h-9 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SiteInput['kind'] })}><option value="origin">Origin (before loading)</option><option value="destination">Destination (after devanning)</option></select></label>
      <label className="text-xs text-text-muted sm:col-span-2">Address<input className="input-dark mt-1 !min-h-9 text-sm" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <label className="text-xs text-text-muted">City<input className="input-dark mt-1 !min-h-9 text-sm" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
      <label className="text-xs text-text-muted">Hours<input className="input-dark mt-1 !min-h-9 text-sm" placeholder="Mon–Sat 8am–6pm" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <label className="text-xs text-text-muted">Free days<input type="number" min={0} className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.freeDays} onChange={(e) => setF({ ...f, freeDays: Number(e.target.value) || 0 })} /></label>
        <label className="text-xs text-text-muted">$ / piece / day after<input type="number" min={0} step="0.1" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.rateUsd} onChange={(e) => setF({ ...f, rateUsd: Number(e.target.value) || 0 })} /></label>
        <label className="text-xs text-text-muted">$ / vehicle / day<input type="number" min={0} className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.vehicleRateUsd} onChange={(e) => setF({ ...f, vehicleRateUsd: Number(e.target.value) || 0 })} /></label>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-9 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  )
}

export default function Warehouse() {
  const { ready, user, shipments } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof warehouseApi.get>> | null>(null)
  const [siteId, setSiteId] = useState('')
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState<(SiteInput & { id?: string }) | null>(null)
  const [rcv, setRcv] = useState({ code: '', shipmentId: '', binId: '', note: '' })
  const [binForm, setBinForm] = useState<{ zone: string; from: number; to: number; capacity: number } | null>(null)
  const [releasing, setReleasing] = useState<StockItem | null>(null)
  const [moving, setMoving] = useState<{ item: StockItem; binId: string } | null>(null)
  const load = () => warehouseApi.get().then((r) => { setD(r); if (!siteId && r.sites[0]) setSiteId(r.sites[0].id) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') void load() }, [ready, user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  const site: Site | undefined = useMemo(() => d?.sites.find((s) => s.id === siteId), [d, siteId])
  const bins = useMemo(() => (d?.bins ?? []).filter((b) => b.siteId === siteId), [d, siteId])
  const stock = useMemo(() => (d?.stock ?? []).filter((s) => s.siteId === siteId), [d, siteId])
  const zones = useMemo(() => [...new Set(bins.map((b) => b.zone))], [bins])
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/warehouse" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const act = async (fn: () => Promise<unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setReleasing(null); setMoving(null) } }
  const receive = async (e: React.FormEvent) => { e.preventDefault(); if (!site) return; await act(async () => { const r = await warehouseApi.receive({ siteId: site.id, binId: rcv.binId || undefined, code: rcv.code || undefined, shipmentId: rcv.code ? undefined : rcv.shipmentId || undefined, note: rcv.note }); setToast(`${r.received ? `${r.received} piece${r.received === 1 ? '' : 's'} received` : 'Already here'}${r.moved ? `, ${r.moved} moved` : ''} — ${r.shipment.ref}${r.bin ? ` → ${r.bin.code}` : ''}.`); setRcv({ code: '', shipmentId: '', binId: rcv.binId, note: '' }) }, 'Received.', 'rcv') }
  const candidates = shipments.filter((s) => ['booked', 'picked_up', 'arrived', 'customs'].includes(s.status) && !stock.some((x) => x.shipmentId === s.id))
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Warehouse & yard</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{d ? `${d.totals.onHand} piece${d.totals.onHand === 1 ? '' : 's'} on hand` : 'Warehouse & yard'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Receive pieces into a bin when they arrive, see what’s where, release them when they leave, and bill storage past the free days. Loading and devanning scans keep this in step automatically.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2"><Link to="/dashboard/scan" className="btn-ghost">Scanner</Link>{d?.canManage && !form && <button onClick={() => setForm(blank())} className="btn-gold" data-testid="new-site"><Plus size={16} aria-hidden="true" /> Add site</button>}</motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="On hand" value={d?.totals.onHand ?? 0} hint={`${d?.totals.shipments ?? 0} shipments`} icon={Boxes} />
            <StatCard label="Past free days" value={d?.totals.overdue ?? 0} hint="Shipments accruing storage" icon={AlertTriangle} warn={(d?.totals.overdue ?? 0) > 0} />
            <StatCard label="Storage due" value={money(d?.totals.storageDue ?? 0)} hint="Billable now" icon={Receipt} />
            <StatCard label="Sites" value={d?.sites.length ?? 0} hint={`${d?.bins.length ?? 0} bins`} icon={WarehouseIcon} />
          </motion.div>
          {form && <motion.div variants={fadeUp} className="mt-6"><SiteForm initial={form} onSaved={() => { setForm(null); void load(); setToast('Site saved.') }} onCancel={() => setForm(null)} /></motion.div>}
          {d && d.sites.length === 0 && !form && <motion.div variants={fadeUp} className="mt-6"><Empty title="No warehouse or yard yet" body="Add your origin warehouse (where customers drop off) and your destination yard (where goods wait for collection)." action={d.canManage ? <button onClick={() => setForm(blank())} className="btn-gold">Add site</button> : undefined} /></motion.div>}
          {d && d.sites.length > 0 && (
            <>
              <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2"><div role="tablist" aria-label="Warehouse sites" className="flex flex-wrap gap-2">{d.sites.map((s) => <button key={s.id} role="tab" aria-selected={siteId === s.id} onClick={() => setSiteId(s.id)} className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm ${siteId === s.id ? 'border-gold bg-gold/10 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{s.name} <span className="text-xs">· {s.onHand}</span></button>)}</div>{site && d.canManage && <button onClick={() => setForm({ id: site.id, name: site.name, kind: site.kind, address: site.address, city: site.city, country: site.country, freeDays: site.freeDays, rateUsd: site.rateUsd, vehicleRateUsd: site.vehicleRateUsd, hours: site.hours, active: site.active })} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Settings2 size={12} aria-hidden="true" /> Settings</button>}</motion.div>
              {site && <motion.p variants={fadeUp} className="mt-2 text-xs text-text-muted">{site.kind === 'origin' ? 'Origin' : 'Destination'} · {site.address}{site.city ? `, ${site.city}` : ''} · {site.hours || 'hours not set'} · {site.freeDays} free days, then {money(site.rateUsd)}/piece/day ({money(site.vehicleRateUsd)}/vehicle/day)</motion.p>}
              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0 space-y-6">
                  <motion.div variants={fadeUp} className="card-dark p-5" data-testid="receive">
                    <h2 className="flex items-center gap-2 !text-base"><PackageOpen size={16} className="text-gold-deep" aria-hidden="true" /> Receive</h2>
                    <form onSubmit={receive} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
                      <label className="text-xs text-text-muted">Sticker code<input aria-label="Sticker code" className="input-dark mt-1 !min-h-9 font-mono text-sm" placeholder="NT-XXXXXX-P1" value={rcv.code} onChange={(e) => setRcv({ ...rcv, code: e.target.value.toUpperCase() })} /></label>
                      <label className="text-xs text-text-muted">…or whole shipment<select aria-label="Shipment" className="input-dark mt-1 !min-h-9 text-sm" value={rcv.shipmentId} onChange={(e) => setRcv({ ...rcv, shipmentId: e.target.value, code: '' })}><option value="">Choose…</option>{candidates.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.customer} · {cargoLabel(s.cargo as CargoType)}</option>)}</select></label>
                      <label className="text-xs text-text-muted">Bin<select aria-label="Bin" className="input-dark mt-1 !min-h-9 text-sm" value={rcv.binId} onChange={(e) => setRcv({ ...rcv, binId: e.target.value })}><option value="">No bin</option>{bins.map((b) => <option key={b.id} value={b.id} disabled={b.count >= b.capacity}>{b.code} ({b.count}/{b.capacity})</option>)}</select></label>
                      <button disabled={busy === 'rcv' || (!rcv.code && !rcv.shipmentId)} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60" data-testid="receive-btn"><PackageCheck size={14} aria-hidden="true" /> Receive</button>
                    </form>
                  </motion.div>
                  <motion.div variants={fadeUp} className="card-dark overflow-hidden" data-testid="stock">
                    <div className="flex items-center justify-between px-5 pt-5"><h2 className="!text-base">On hand at {site?.name}</h2><span className="text-xs text-text-muted">{stock.length} shipment{stock.length === 1 ? '' : 's'}</span></div>
                    <ul className="mt-3 divide-y divide-border/70 text-sm">
                      {stock.length === 0 && <li className="px-5 py-4 text-text-muted">Nothing on hand.</li>}
                      {stock.map((it) => (
                        <li key={it.shipmentId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3" data-testid="stock-row">
                          <div className="min-w-0"><p className="font-semibold"><Link to={`/dashboard/shipments?q=${it.ref}&b=all`} className="font-mono text-xs text-gold-deep hover:underline">{it.ref}</Link> · {it.customer} <span className="font-normal text-text-muted">· {cargoLabel(it.cargo as CargoType)}</span></p><p className="text-xs text-text-muted">{it.pieces.length} piece{it.pieces.length === 1 ? '' : 's'} in {[...new Set(it.pieces.map((p) => p.bin ?? 'no bin'))].join(', ')} · {it.daysInStorage} day{it.daysInStorage === 1 ? '' : 's'} here{it.billableDays > 0 ? <span className="text-danger"> · {it.billableDays} billable → {money(it.amountUsd)}</span> : ` · ${Math.max(0, it.freeDays - it.daysInStorage)} free days left`}</p></div>
                          <div className="flex flex-wrap gap-1.5">
                            {it.amountUsd > 0 && d.canManage && <button onClick={() => act(async () => { const r = await warehouseApi.invoiceStorage(it.shipmentId); setToast(`Storage line added to a draft invoice (${money(r.line.qty * r.line.unit)}).`) }, 'Added to invoice.', 'inv' + it.shipmentId)} disabled={busy === 'inv' + it.shipmentId} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Receipt size={12} aria-hidden="true" /> Invoice storage</button>}
                            {bins.length > 0 && <button onClick={() => setMoving({ item: it, binId: it.pieces[0].binId ?? '' })} className="btn-ghost !min-h-8 !px-2.5 text-xs">Move</button>}
                            <button onClick={() => setReleasing(it)} className="btn-gold !min-h-8 !px-2.5 text-xs" data-testid="release">Release</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                </div>
                <motion.div variants={fadeUp} className="space-y-6">
                  <div className="card-dark p-5" data-testid="bins">
                    <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 !text-base"><Grid3x3 size={16} className="text-gold-deep" aria-hidden="true" /> Bins</h2>{d.canManage && !binForm && <button onClick={() => setBinForm({ zone: String.fromCharCode(65 + zones.length), from: 1, to: 12, capacity: 8 })} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Plus size={12} aria-hidden="true" /> Zone</button>}</div>
                    {binForm && site && <form onSubmit={(e) => { e.preventDefault(); void act(() => warehouseApi.addBins(site.id, binForm), 'Bins added.', 'bins'); setBinForm(null) }} className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-border bg-surface-2/40 p-2"><input aria-label="Zone" className="input-dark !min-h-8 text-xs" value={binForm.zone} onChange={(e) => setBinForm({ ...binForm, zone: e.target.value.toUpperCase().slice(0, 3) })} /><input type="number" min={1} aria-label="From" className="input-dark !min-h-8 text-xs tabular-nums" value={binForm.from} onChange={(e) => setBinForm({ ...binForm, from: Number(e.target.value) || 1 })} /><input type="number" min={1} aria-label="To" className="input-dark !min-h-8 text-xs tabular-nums" value={binForm.to} onChange={(e) => setBinForm({ ...binForm, to: Number(e.target.value) || 1 })} /><button className="btn-gold !min-h-8 !px-2 text-xs">Add</button></form>}
                    {bins.length === 0 ? <p className="mt-2 text-sm text-text-muted">No bins yet — add a zone to get a grid.</p> : zones.map((z) => (
                      <div key={z} className="mt-3"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Zone {z}</p><div className="mt-1 grid grid-cols-6 gap-1">{bins.filter((b) => b.zone === z).map((b) => { const pct = b.capacity ? b.count / b.capacity : 0; return <div key={b.id} title={`${b.code} · ${b.count}/${b.capacity}${b.shipments ? ` · ${b.shipments} shipment${b.shipments === 1 ? '' : 's'}` : ''}`} className={`rounded-md border px-1 py-1.5 text-center text-[11px] font-mono ${b.count === 0 ? 'border-border text-text-muted' : pct >= 1 ? 'border-danger/50 bg-danger/15 text-danger' : 'border-gold/50 bg-gold/15 text-gold-deep'}`} data-testid="bin">{b.code.split('-')[1]}<span className="block text-[11px]">{b.count}/{b.capacity}</span></div> })}</div></div>
                    ))}
                  </div>
                  <div className="card-dark p-5">
                    <h2 className="!text-base">Recent movements</h2>
                    <ul className="mt-2 space-y-1 text-xs text-text-muted">{d.moves.filter((m) => m.siteId === siteId).slice(0, 12).map((m) => <li key={m.id}><span className={`font-semibold ${m.kind === 'receive' ? 'text-teal' : m.kind === 'release' ? 'text-gold-deep' : 'text-text'}`}>{m.kind}</span> {m.shipmentRef}{m.bin ? ` → ${m.bin}` : ''} · {m.by}{m.note ? ` — ${m.note}` : ''}</li>)}{d.moves.filter((m) => m.siteId === siteId).length === 0 && <li>No movements yet.</li>}</ul>
                  </div>
                </motion.div>
              </div>
            </>
          )}
        </motion.div>
      </div>
      {releasing && <Confirm title={`Release ${releasing.ref} from ${releasing.siteName}?`} danger={false} body={<p>{releasing.pieces.length} piece{releasing.pieces.length === 1 ? '' : 's'} leave the yard.{releasing.amountUsd > 0 ? ` Storage due: ${money(releasing.amountUsd)} (${releasing.billableDays} billable day${releasing.billableDays === 1 ? '' : 's'}) — add it to the invoice first if you want to charge it.` : ' No storage is due.'}</p>} confirmLabel="Release" busy={busy === 'rel'} onClose={() => setReleasing(null)} onConfirm={() => act(() => warehouseApi.release({ shipmentId: releasing.shipmentId }), 'Released.', 'rel')} />}
      {moving && <Confirm title={`Move ${moving.item.ref}`} danger={false} body={<select aria-label="Bin" className="input-dark !min-h-9 w-full text-sm" value={moving.binId} onChange={(e) => setMoving({ ...moving, binId: e.target.value })}><option value="">No bin</option>{bins.map((b) => <option key={b.id} value={b.id}>{b.code} ({b.count}/{b.capacity})</option>)}</select>} confirmLabel="Move" busy={busy === 'mv'} onClose={() => setMoving(null)} onConfirm={() => act(() => warehouseApi.move(moving.item.pieces.map((p) => p.id), moving.binId || null), 'Moved.', 'mv')} />}
    </div>
  )
}
