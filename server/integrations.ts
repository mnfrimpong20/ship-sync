/**
 * Integrations for shippers.
 *   Accounting export   GET /shipper/exports/accounting?format=quickbooks|xero&kind=invoices|payments&from&to  (CSV)
 *   Local currency      GET|PUT /shipper/currency { currency: USD|GHS|NGN } — rates from GHS_PER_USD / NGN_PER_USD
 *   Tracking widget     GET /widget/:shipperId (brand), GET /widget/:shipperId/track/:ref (only that shipper's
 *                       shipments), GET /widget.js?s=ID (drop-in script that adds the iframe)
 *   Webhooks            GET|POST /webhooks, PATCH|DELETE /webhooks/:id, POST /webhooks/:id/test,
 *                       GET /webhooks/:id/deliveries, POST /webhook-deliveries/:id/retry
 *                       Events are signed (X-Ntemtem-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")) and retried
 *                       with back-off (1m, 5m, 30m, 2h, 6h); 20 failures in a row switch the hook off.
 */
import { createHmac, randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'
import { featureOn, requirePerk } from './features'
import { notifyShipperStaff } from './notify'
import { statusLabels, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const num = (v: unknown) => Number(v ?? 0) || 0
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v).slice(0, 10))
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const toCsv = (head: string[], rows: unknown[][]) => [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
const usDate = (v: unknown) => { const s = D(v); if (!s) return ''; const [y, m, d] = s.split('-'); return `${m}/${d}/${y}` }
const ukDate = (v: unknown) => { const s = D(v); if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }

export const FX = () => ({ USD: 1, GHS: Number(process.env.GHS_PER_USD) || null, NGN: Number(process.env.NGN_PER_USD) || null })
export async function displayCurrency(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>('select prefs from shippers where id = $1', [shipperId]); const c = (J(rows[0]?.prefs) ?? {}).displayCurrency ?? 'USD'
  const rate = (FX() as Record<string, number | null>)[c] ?? null
  return { currency: c as 'USD' | 'GHS' | 'NGN', rate: c === 'USD' ? 1 : rate }
}

/* ---------------- webhooks ---------------- */
export const WEBHOOK_EVENTS = [
  { key: 'shipment.booked', label: 'A shipment is booked' }, { key: 'shipment.status', label: 'A shipment changes status' }, { key: 'shipment.delivered', label: 'A shipment is delivered' },
  { key: 'invoice.paid', label: 'An invoice is paid in full' }, { key: 'request.received', label: 'A matching request arrives' },
] as const
const BACKOFF = [60, 300, 1800, 7200, 21600]
function okUrl(u: string) {
  try { const x = new URL(u); if (x.protocol === 'https:') return !/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost$|\[?::1)/.test(x.hostname); return x.protocol === 'http:' && process.env.NODE_ENV !== 'production' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname) && !!process.env.WEBHOOK_ALLOW_LOCAL) } catch { return false }
}
export async function emitWebhook(db: Db, shipperId: string, event: string, data: Row) {
  try {
    if (!(await featureOn(db, 'webhooks', shipperId))) return
    const { rows } = await db.query<Row>(`select id, events from webhooks where shipper_id = $1 and active`, [shipperId])
    const hooks = rows.filter((h) => { const ev = J(h.events) ?? []; return !ev.length || ev.includes(event) || event === 'ping' }); if (!hooks.length) return
    const payload = { id: 'evt_' + randomBytes(8).toString('hex'), event, createdAt: new Date().toISOString(), data }
    for (const h of hooks) await db.query(`insert into webhook_deliveries (id,webhook_id,event,payload) values ($1,$2,$3,$4)`, ['whd_' + uid(), h.id, event, JSON.stringify(payload)])
    void deliverDue(db)
  } catch (e) { console.error('[webhooks] emit', e) }
}
export async function emitShipment(db: Db, shipmentId: string, event: 'shipment.booked' | 'shipment.status' | 'shipment.delivered', extra: Row = {}) {
  const { rows: [s] } = await db.query<Row>('select id, ref, shipper_id, status, mode, origin, destination, cargo, customer, eta, container_id, created_at from shipments where id = $1', [shipmentId]); if (!s) return
  await emitWebhook(db, s.shipper_id, event, { shipment: { id: s.id, ref: s.ref, status: s.status, statusLabel: statusLabels[s.status as ShipmentStatus] ?? s.status, mode: s.mode, origin: s.origin, destination: s.destination, cargo: s.cargo, customer: s.customer, eta: D(s.eta), containerId: s.container_id, createdAt: ISO(s.created_at) }, ...extra })
}
let running: Promise<void> | null = null
export function deliverDue(db: Db): Promise<void> {
  if (running) return running
  running = (async () => {
    const { rows } = await db.query<Row>(`select d.*, w.url, w.secret, w.shipper_id, w.failures from webhook_deliveries d join webhooks w on w.id = d.webhook_id where d.status = 'pending' and d.next_at <= now() and w.active order by d.created_at limit 50`)
    for (const d of rows) {
      const body = typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload); const t = Math.floor(Date.now() / 1000)
      const sig = createHmac('sha256', d.secret).update(`${t}.${body}`).digest('hex')
      let status = 0, err = ''
      try {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10_000)
        const r = await fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Ntemtem-Webhooks/1', 'x-ntemtem-event': d.event, 'x-ntemtem-delivery': d.id, 'x-ntemtem-signature': `t=${t},v1=${sig}` }, body, signal: ctl.signal })
        clearTimeout(timer); status = r.status; if (!r.ok) err = `HTTP ${r.status}`
      } catch (e) { err = e instanceof Error ? (e.name === 'AbortError' ? 'Timed out after 10 s' : e.message) : String(e) }
      const attempts = Number(d.attempts) + 1
      if (!err) {
        await db.query(`update webhook_deliveries set status = 'ok', attempts = $2, response_status = $3, error = '', delivered_at = now() where id = $1`, [d.id, attempts, status])
        await db.query('update webhooks set failures = 0, last_status = $2, last_at = now() where id = $1', [d.webhook_id, status])
      } else {
        const done = attempts > BACKOFF.length
        await db.query(`update webhook_deliveries set status = $2, attempts = $3, response_status = $4, error = $5, next_at = now() + ($6 || ' seconds')::interval where id = $1`, [d.id, done ? 'failed' : 'pending', attempts, status || null, err.slice(0, 300), String(BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)])])
        const { rows: [w] } = await db.query<Row>('update webhooks set failures = failures + 1, last_status = $2, last_at = now() where id = $1 returning failures, url', [d.webhook_id, status || null])
        if (Number(w?.failures) >= 20) { await db.query('update webhooks set active = false where id = $1', [d.webhook_id]); await notifyShipperStaff(db, d.shipper_id, { kind: 'system', title: 'A webhook was switched off', body: `${w.url} failed 20 times in a row (${err}). Fix the endpoint and switch it back on under Integrations.`, link: '/dashboard/integrations', dedupe: `whoff:${d.webhook_id}:${new Date().toISOString().slice(0, 10)}` }, ['owner', 'dispatcher']) }
      }
    }
  })().finally(() => { running = null })
  return running
}
export function startWebhookSweeps(getDb: () => Promise<Db>) { setInterval(() => { getDb().then(deliverDue).catch(() => {}) }, 30_000) }

const hookOut = (h: Row) => ({ id: h.id, url: h.url, events: J(h.events) ?? [], active: !!h.active, failures: Number(h.failures), lastStatus: h.last_status ?? null, lastAt: ISO(h.last_at), createdAt: ISO(h.created_at), secretHint: `${String(h.secret).slice(0, 8)}…` })
const zHook = z.object({ url: z.string().trim().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS.map((e) => e.key) as [string, ...string[]])).max(10).default([]) })

export function mountIntegrations(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const office = async (db: Db, req: Request, area: 'payments' | 'shipments' = 'shipments') => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !can(u, area)) throw new HttpError(403, 'Not available for your role.'); return u }
  const managers = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.'); return u }

  /* accounting export */
  r.get('/shipper/exports/accounting', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req, 'payments'); await requirePerk(db, u.shipperId!, 'accountingExport', HttpError)
    const format = req.query.format === 'xero' ? 'xero' : 'quickbooks'; const kind = req.query.kind === 'payments' ? 'payments' : 'invoices'
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : new Date().toISOString().slice(0, 10)
    let out = ''
    if (kind === 'invoices') {
      const { rows } = await db.query<Row>(`select i.*, c.name as client_name, c.email as client_email, s.ref as shipment_ref from invoices i join clients c on c.id = i.client_id left join shipments s on s.id = i.shipment_id where i.shipper_id = $1 and i.status not in ('draft','void') and i.issued_at between $2 and $3 order by i.issued_at, i.number`, [u.shipperId, from, to])
      const lines = rows.flatMap((i) => (J(i.items) ?? []).map((l: Row, n: number) => ({ i, l, n })))
      out = format === 'quickbooks'
        ? toCsv(['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Currency'], lines.map(({ i, l }) => [i.number, i.client_name, usDate(i.issued_at), usDate(i.due_at), '', i.shipment_ref ? `Shipment ${i.shipment_ref}` : '', l.description?.split(/[,(]/)[0]?.trim().slice(0, 40) || 'Freight', l.description, num(l.qty), num(l.unit), num(l.qty) * num(l.unit), i.currency ?? 'USD']))
        : toCsv(['*ContactName', 'EmailAddress', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', '*Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'Currency'], lines.map(({ i, l }) => [i.client_name, i.client_email ?? '', i.number, i.shipment_ref ?? '', ukDate(i.issued_at), ukDate(i.due_at ?? i.issued_at), l.description, num(l.qty), num(l.unit), '200', 'Tax Exempt', i.currency ?? 'USD']))
    } else {
      const { rows } = await db.query<Row>(`select p.*, i.number, i.currency, c.name as client_name from payments p join invoices i on i.id = p.invoice_id join clients c on c.id = i.client_id where i.shipper_id = $1 and p.at between $2 and $3 order by p.at`, [u.shipperId, from, to])
      out = format === 'quickbooks'
        ? toCsv(['Date', 'Customer', 'InvoiceNo', 'Amount', 'PaymentMethod', 'Memo', 'Currency'], rows.map((p) => [usDate(p.at), p.client_name, p.number, num(p.amount), p.method, p.note ?? '', p.currency ?? 'USD']))
        : toCsv(['Date', 'Amount', 'Payee', 'Description', 'Reference', 'Currency'], rows.map((p) => [ukDate(p.at), num(p.amount), p.client_name, `Payment ${p.method}`, p.number, p.currency ?? 'USD']))
    }
    res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="${format}-${kind}-${from}-to-${to}.csv"`); res.send(out)
  }))

  /* currency */
  r.get('/shipper/currency', wrap(async (req, res) => { const db = await getDb(); const u = await office(db, req); res.json({ ...(await displayCurrency(db, u.shipperId!)), rates: FX() }) }))
  r.put('/shipper/currency', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = z.object({ currency: z.enum(['USD', 'GHS', 'NGN']) }).parse(req.body)
    if (b.currency !== 'USD' && !(FX() as Record<string, number | null>)[b.currency]) throw new HttpError(409, `No ${b.currency} exchange rate is set on the server yet (${b.currency}_PER_USD).`)
    await db.query(`update shippers set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('displayCurrency', $2::text) where id = $1`, [u.shipperId, b.currency])
    res.json(await displayCurrency(db, u.shipperId!))
  }))

  /* tracking widget */
  r.get('/widget/:id', wrap(async (req, res) => {
    const db = await getDb(); const { rows: [s] } = await db.query<Row>('select id, name, brand, initials, hue from shippers where id = $1', [req.params.id]); if (!s) throw new HttpError(404, 'Unknown shipper.')
    if (!(await featureOn(db, 'trackingWidget', s.id))) throw new HttpError(403, 'Tracking widget is switched off.')
    const b = J(s.brand) ?? {}; res.set('Cache-Control', 'public, max-age=300')
    res.json({ id: s.id, name: s.name, color: b.color ?? s.hue ?? '#F2A900', logo: b.logo ?? null, initials: s.initials })
  }))
  r.get('/widget/:id/track/:ref', wrap(async (req, res) => {
    const db = await getDb()
    const { rows: [s] } = await db.query<Row>(`select s.id, s.ref, s.status, s.mode, s.origin, s.destination, s.eta, s.vessel_name, s.flight, s.handover, s.cancelled_at from shipments s where upper(s.ref) = upper($2) and s.shipper_id = $1`, [req.params.id, String(req.params.ref).trim()])
    if (!s || s.cancelled_at) throw new HttpError(404, 'We couldn’t find that reference with this shipper. Check the code on your receipt.')
    const { rows: ev } = await db.query<Row>('select status, at, place, note from shipment_events where shipment_id = $1 order by at', [s.id])
    res.json({ ref: s.ref, status: s.status, statusLabel: statusLabels[s.status as ShipmentStatus] ?? s.status, mode: s.mode, origin: s.origin, destination: s.destination, eta: D(s.eta), vessel: s.vessel_name ?? null, flight: s.flight ?? null, events: ev.map((e) => ({ status: e.status, label: statusLabels[e.status as ShipmentStatus] ?? e.status, at: ISO(e.at), place: e.place })) })
  }))
  r.get('/widget.js', (req, res) => {
    const sid = String(req.query.s ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60)
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    res.set('Content-Type', 'application/javascript'); res.set('Cache-Control', 'public, max-age=3600')
    res.send(`(function(){var s=document.currentScript;var f=document.createElement('iframe');f.src='${base}/embed/track/${sid}';f.title='Track your shipment';f.style.cssText='width:100%;max-width:520px;height:460px;border:0;border-radius:16px;';f.loading='lazy';(s&&s.parentNode?s.parentNode.insertBefore(f,s):document.body.appendChild(f));})();`)
  })

  /* webhooks */
  r.get('/webhooks', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows } = await db.query<Row>('select * from webhooks where shipper_id = $1 order by created_at', [u.shipperId])
    res.json({ webhooks: rows.map(hookOut), events: WEBHOOK_EVENTS, enabled: await featureOn(db, 'webhooks', u.shipperId) })
  }))
  r.post('/webhooks', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); await requirePerk(db, u.shipperId!, 'webhooks', HttpError)
    if (!(await featureOn(db, 'webhooks', u.shipperId))) throw new HttpError(403, 'Webhooks are switched off for your account.')
    const b = zHook.parse(req.body); if (!okUrl(b.url)) throw new HttpError(400, 'Use a public https:// address for the webhook.')
    const { rows: [n] } = await db.query<Row>('select count(*)::int as n from webhooks where shipper_id = $1', [u.shipperId]); if (Number(n?.n) >= 5) throw new HttpError(409, 'Up to 5 webhooks per company.')
    const id = 'wh_' + uid(); const secret = 'whsec_' + randomBytes(24).toString('hex')
    await db.query('insert into webhooks (id,shipper_id,url,secret,events) values ($1,$2,$3,$4,$5)', [id, u.shipperId, b.url, secret, JSON.stringify(b.events)])
    const { rows } = await db.query<Row>('select * from webhooks where id = $1', [id])
    res.status(201).json({ webhook: hookOut(rows[0]), secret })
  }))
  r.patch('/webhooks/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const b = z.object({ url: z.string().trim().url().max(500).optional(), events: zHook.shape.events.optional(), active: z.boolean().optional() }).parse(req.body)
    if (b.url && !okUrl(b.url)) throw new HttpError(400, 'Use a public https:// address for the webhook.')
    const { rows } = await db.query<Row>(`update webhooks set url = coalesce($3, url), events = coalesce($4, events), active = coalesce($5, active), failures = case when $5 then 0 else failures end where id = $1 and shipper_id = $2 returning *`, [req.params.id, u.shipperId, b.url ?? null, b.events ? JSON.stringify(b.events) : null, b.active ?? null])
    if (!rows[0]) throw new HttpError(404, 'Webhook not found.'); res.json({ webhook: hookOut(rows[0]) })
  }))
  r.delete('/webhooks/:id', wrap(async (req, res) => { const db = await getDb(); const u = await managers(db, req); await db.query('delete from webhooks where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); res.json({ ok: true }) }))
  r.post('/webhooks/:id/test', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows: [h] } = await db.query<Row>('select * from webhooks where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); if (!h) throw new HttpError(404, 'Webhook not found.')
    const payload = { id: 'evt_' + randomBytes(8).toString('hex'), event: 'ping', createdAt: new Date().toISOString(), data: { message: 'Hello from Ntemtem', shipperId: u.shipperId } }
    const did = 'whd_' + uid(); await db.query(`insert into webhook_deliveries (id,webhook_id,event,payload) values ($1,$2,'ping',$3)`, [did, h.id, JSON.stringify(payload)])
    await deliverDue(db)
    const { rows: [x] } = await db.query<Row>('select status, response_status, error from webhook_deliveries where id = $1', [did])
    res.json({ ok: x?.status === 'ok', status: x?.response_status ?? null, error: x?.error ?? '' })
  }))
  r.get('/webhooks/:id/deliveries', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows } = await db.query<Row>(`select d.* from webhook_deliveries d join webhooks w on w.id = d.webhook_id where w.id = $1 and w.shipper_id = $2 order by d.created_at desc limit 50`, [req.params.id, u.shipperId])
    res.json({ deliveries: rows.map((x) => ({ id: x.id, event: x.event, status: x.status, attempts: x.attempts, responseStatus: x.response_status, error: x.error, createdAt: ISO(x.created_at), deliveredAt: ISO(x.delivered_at), nextAt: ISO(x.next_at) })) })
  }))
  r.post('/webhook-deliveries/:id/retry', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows } = await db.query<Row>(`update webhook_deliveries d set status = 'pending', next_at = now() from webhooks w where w.id = d.webhook_id and d.id = $1 and w.shipper_id = $2 returning d.id`, [req.params.id, u.shipperId])
    if (!rows[0]) throw new HttpError(404, 'Delivery not found.'); await deliverDue(db); res.json({ ok: true })
  }))
}
