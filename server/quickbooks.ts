/**
 * QuickBooks Online: a shipper connects their QuickBooks company (Intuit OAuth 2.0) and Ntemtem copies their
 * invoices (with customers) and the payments against them — on demand and every night. CSV export stays for Xero
 * and for anyone who prefers it.
 *
 *   Ntemtem's Intuit app: QB_CLIENT_ID, QB_CLIENT_SECRET, QB_ENV (sandbox | production, default sandbox),
 *   QB_REDIRECT_URI (default APP_URL/api/quickbooks/callback — register it in the Intuit developer portal).
 *   QB_AUTH_URL / QB_TOKEN_URL / QB_API_URL override the hosts (used for a local mock).
 *   Tokens are encrypted (secrets.ts); access tokens are refreshed when they expire (refresh tokens last ~100 days
 *   and roll on every refresh). Each invoice/payment is synced once (qb_sync map); edits after a sync aren't re-sent.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { seal, unseal } from './secrets'
import { requirePerk } from './features'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : undefined)
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const cfg = () => {
  const env = process.env.QB_ENV === 'production' ? 'production' : 'sandbox'
  return {
    id: process.env.QB_CLIENT_ID?.trim() || '', secret: process.env.QB_CLIENT_SECRET?.trim() || '', env,
    redirect: process.env.QB_REDIRECT_URI?.trim() || `${(process.env.APP_URL || '').replace(/\/$/, '')}/api/quickbooks/callback`,
    auth: process.env.QB_AUTH_URL?.trim() || 'https://appcenter.intuit.com/connect/oauth2',
    token: process.env.QB_TOKEN_URL?.trim() || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
    api: process.env.QB_API_URL?.trim() || (env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'),
  }
}
export const qbConfigured = () => !!(cfg().id && cfg().secret)
const basic = () => 'Basic ' + Buffer.from(`${cfg().id}:${cfg().secret}`).toString('base64')

async function tokenCall(body: Record<string, string>) {
  const r = await fetch(cfg().token, { method: 'POST', headers: { authorization: basic(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() })
  const j = (await r.json().catch(() => ({}))) as Row
  if (!r.ok) throw new Error(j.error_description || j.error || `Intuit answered ${r.status}`)
  return j as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number }
}
async function saveTokens(db: Db, shipperId: string, t: Awaited<ReturnType<typeof tokenCall>>) {
  await db.query(`update qb_connections set access_token = $2, refresh_token = $3, access_expires_at = now() + ($4 || ' seconds')::interval, refresh_expires_at = now() + ($5 || ' seconds')::interval where shipper_id = $1`, [shipperId, await seal(db, t.access_token), await seal(db, t.refresh_token), String(Math.max(60, t.expires_in - 60)), String(t.x_refresh_token_expires_in ?? 8640000)])
}
async function accessToken(db: Db, c: Row) {
  if (c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now()) return unseal(db, c.access_token)
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: await unseal(db, c.refresh_token) })
  await saveTokens(db, c.shipper_id, t); return t.access_token
}
async function qbo<T = Row>(db: Db, c: Row, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const tok = await accessToken(db, c)
  const url = `${cfg().api}/v3/company/${c.realm_id}/${path}${path.includes('?') ? '&' : '?'}minorversion=73`
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${tok}`, accept: 'application/json', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = (await r.json().catch(() => ({}))) as Row
  if (!r.ok) throw new Error(j.Fault?.Error?.[0]?.Detail || j.Fault?.Error?.[0]?.Message || `QuickBooks answered ${r.status}`)
  return j as T
}
const q = (s: string) => s.replace(/'/g, "\\'")
async function query(db: Db, c: Row, sql: string) { return (await qbo<Row>(db, c, 'GET', `query?query=${encodeURIComponent(sql)}`)).QueryResponse ?? {} }

async function mapped(db: Db, shipperId: string, kind: string, localId: string, realm: string) { const { rows } = await db.query<Row>('select qb_id from qb_sync where shipper_id = $1 and kind = $2 and local_id = $3 and realm_id = $4', [shipperId, kind, localId, realm]); return rows[0]?.qb_id as string | undefined }
async function remember(db: Db, shipperId: string, kind: string, localId: string, qbId: string, realm: string) { await db.query(`insert into qb_sync (shipper_id,realm_id,kind,local_id,qb_id) values ($1,$5,$2,$3,$4) on conflict (shipper_id,realm_id,kind,local_id) do update set qb_id = $4, synced_at = now()`, [shipperId, kind, localId, qbId, realm]) }

async function ensureCustomer(db: Db, c: Row, client: Row) {
  const have = await mapped(db, c.shipper_id, 'customer', client.id, c.realm_id); if (have) return have
  const name = String(client.company || client.name).slice(0, 100)
  const found = (await query(db, c, `select Id from Customer where DisplayName = '${q(name)}'`)).Customer?.[0]?.Id
  const id = found ?? (await qbo<Row>(db, c, 'POST', 'customer', { DisplayName: name, ...(client.email ? { PrimaryEmailAddr: { Address: client.email } } : {}), ...(client.phone ? { PrimaryPhone: { FreeFormNumber: client.phone } } : {}) })).Customer.Id
  await remember(db, c.shipper_id, 'customer', client.id, String(id), c.realm_id); return String(id)
}
async function ensureItem(db: Db, c: Row) {
  if (c.item_id) return String(c.item_id)
  const name = 'Freight (Ntemtem)'
  let id = (await query(db, c, `select Id from Item where Name = '${name}'`)).Item?.[0]?.Id
  if (!id) { const acct = (await query(db, c, `select Id from Account where AccountType = 'Income' maxresults 1`)).Account?.[0]?.Id; if (!acct) throw new Error('No income account in QuickBooks to post freight to.'); id = (await qbo<Row>(db, c, 'POST', 'item', { Name: name, Type: 'Service', IncomeAccountRef: { value: acct } })).Item.Id }
  await db.query('update qb_connections set item_id = $2 where shipper_id = $1', [c.shipper_id, String(id)]); return String(id)
}

/** Push every issued invoice and recorded payment not yet in QuickBooks. */
export async function syncShipper(db: Db, shipperId: string) {
  const { rows: cs } = await db.query<Row>('select * from qb_connections where shipper_id = $1 and realm_id is not null', [shipperId]); const c = cs[0]; if (!c) throw new Error('QuickBooks isn’t connected.')
  const out = { invoices: 0, payments: 0, skipped: 0, errors: [] as string[] }
  try {
    const item = await ensureItem(db, c)
    const { rows: invs } = await db.query<Row>(`select i.*, s.ref as shipment_ref from invoices i left join shipments s on s.id = i.shipment_id where i.shipper_id = $1 and i.status not in ('draft','void') and not exists (select 1 from qb_sync m where m.shipper_id = $1 and m.kind = 'invoice' and m.local_id = i.id and m.realm_id = $2) order by i.issued_at limit 200`, [shipperId, c.realm_id])
    for (const i of invs) {
      try {
        const { rows: cl } = await db.query<Row>('select * from clients where id = $1', [i.client_id]); if (!cl[0]) { out.skipped++; continue }
        const cust = await ensureCustomer(db, c, cl[0])
        const items = J<{ description: string; qty: number; unit: number }[]>(i.items, [])
        const lines = items.map((l) => ({ DetailType: 'SalesItemLineDetail', Amount: Math.round(Number(l.qty) * Number(l.unit) * 100) / 100, Description: String(l.description).slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: item }, Qty: Number(l.qty), UnitPrice: Number(l.unit) } }))
        if (Number(i.tax) > 0) lines.push({ DetailType: 'SalesItemLineDetail', Amount: Number(i.tax), Description: 'Tax', SalesItemLineDetail: { ItemRef: { value: item }, Qty: 1, UnitPrice: Number(i.tax) } })
        const r = await qbo<Row>(db, c, 'POST', 'invoice', { DocNumber: String(i.number).slice(0, 21), TxnDate: D(i.issued_at), DueDate: D(i.due_at), CustomerRef: { value: cust }, Line: lines, PrivateNote: `Ntemtem${i.shipment_ref ? ` · shipment ${i.shipment_ref}` : ''}`.slice(0, 4000), ...(i.currency && i.currency !== (c.home_currency || 'USD') ? { CurrencyRef: { value: i.currency } } : {}) })
        await remember(db, shipperId, 'invoice', i.id, String(r.Invoice.Id), c.realm_id); out.invoices++
      } catch (e) { out.errors.push(`Invoice ${i.number}: ${e instanceof Error ? e.message : e}`) }
    }
    const { rows: pays } = await db.query<Row>(`select p.*, i.client_id from payments p join invoices i on i.id = p.invoice_id where i.shipper_id = $1 and not exists (select 1 from qb_sync m where m.shipper_id = $1 and m.kind = 'payment' and m.local_id = p.id::text and m.realm_id = $2) order by p.at limit 300`, [shipperId, c.realm_id])
    for (const p of pays) {
      try {
        const inv = await mapped(db, shipperId, 'invoice', p.invoice_id, c.realm_id); const cust = await mapped(db, shipperId, 'customer', p.client_id, c.realm_id)
        if (!inv || !cust) { out.skipped++; continue }
        const r = await qbo<Row>(db, c, 'POST', 'payment', { CustomerRef: { value: cust }, TotalAmt: Number(p.amount), TxnDate: D(p.at), PrivateNote: `${p.method ?? ''} ${p.note ?? ''}`.trim().slice(0, 4000), Line: [{ Amount: Number(p.amount), LinkedTxn: [{ TxnId: inv, TxnType: 'Invoice' }] }] })
        await remember(db, shipperId, 'payment', String(p.id), String(r.Payment.Id), c.realm_id); out.payments++
      } catch (e) { out.errors.push(`Payment on ${p.invoice_id}: ${e instanceof Error ? e.message : e}`) }
    }
    await db.query(`update qb_connections set last_sync_at = now(), last_error = $2, last_result = $3 where shipper_id = $1`, [shipperId, out.errors[0] ?? '', JSON.stringify(out)])
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); await db.query('update qb_connections set last_error = $2 where shipper_id = $1', [shipperId, msg.slice(0, 300)]); throw e }
  return out
}
export function startQuickBooksSweeps(getDb: () => Promise<Db>) {
  setInterval(() => { void (async () => { if (!qbConfigured()) return; const db = await getDb(); const { rows } = await db.query<Row>(`select shipper_id from qb_connections where realm_id is not null and (last_sync_at is null or last_sync_at < now() - interval '20 hours')`); for (const r of rows) await syncShipper(db, r.shipper_id).catch((e) => console.error('[quickbooks] sync', r.shipper_id, e instanceof Error ? e.message : e)) })() }, 60 * 60_000).unref?.()
}

export function mountQuickBooks(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const owner = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'finance'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and finance staff only.'); return u }
  const status = async (db: Db, shipperId: string) => {
    const { rows } = await db.query<Row>('select * from qb_connections where shipper_id = $1', [shipperId]); const c = rows[0]
    const { rows: n } = await db.query<Row>(`select count(*) filter (where kind = 'invoice')::int as invoices, count(*) filter (where kind = 'payment')::int as payments from qb_sync where shipper_id = $1 and realm_id = $2`, [shipperId, c?.realm_id ?? ''])
    return { configured: qbConfigured(), env: cfg().env, connected: !!c?.realm_id, company: c?.company_name ?? '', connectedBy: c?.connected_by ?? '', connectedAt: ISO(c?.connected_at), lastSyncAt: ISO(c?.last_sync_at), lastError: c?.last_error ?? '', lastResult: J<Row | null>(c?.last_result, null), synced: { invoices: Number(n[0].invoices), payments: Number(n[0].payments) } }
  }
  r.get('/shipper/quickbooks', wrap(async (req, res) => { const db = await getDb(); const u = await owner(db, req); res.set('Cache-Control', 'no-store'); res.json(await status(db, u.shipperId!)) }))
  r.post('/shipper/quickbooks/connect', wrap(async (req, res) => {
    const db = await getDb(); const u = await owner(db, req); await requirePerk(db, u.shipperId!, 'accountingExport', HttpError)
    if (!qbConfigured()) throw new HttpError(409, 'QuickBooks isn’t switched on for Ntemtem yet. Use the CSV export for now.')
    const state = randomBytes(18).toString('base64url')
    await db.query(`insert into qb_connections (shipper_id,state,state_user,state_at) values ($1,$2,$3,now()) on conflict (shipper_id) do update set state = $2, state_user = $3, state_at = now()`, [u.shipperId, state, u.name])
    res.json({ url: `${cfg().auth}?${new URLSearchParams({ client_id: cfg().id, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: cfg().redirect, state })}` })
  }))
  /** Intuit sends the browser back here after the owner approves. */
  r.get('/quickbooks/callback', async (req, res) => {
    const back = (q: string) => res.redirect(`/dashboard/integrations?qb=${q}`)
    try {
      const db = await getDb(); const { code, state, realmId } = req.query as Record<string, string>
      if (!code || !state || !realmId) return back('cancelled')
      const { rows } = await db.query<Row>(`select * from qb_connections where state = $1 and state_at > now() - interval '15 minutes'`, [state]); const c = rows[0]; if (!c) return back('expired')
      const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: cfg().redirect })
      await db.query(`update qb_connections set realm_id = $2, state = null, connected_by = state_user, connected_at = now(), last_error = '', item_id = null where shipper_id = $1`, [c.shipper_id, realmId])
      await saveTokens(db, c.shipper_id, t)
      const { rows: fresh } = await db.query<Row>('select * from qb_connections where shipper_id = $1', [c.shipper_id])
      const info = await qbo<Row>(db, fresh[0], 'GET', `companyinfo/${encodeURIComponent(realmId)}`).catch(() => null)
      const pref = await qbo<Row>(db, fresh[0], 'GET', 'preferences').catch(() => null)
      await db.query('update qb_connections set company_name = $2, home_currency = $3 where shipper_id = $1', [c.shipper_id, info?.CompanyInfo?.CompanyName ?? '', pref?.Preferences?.CurrencyPrefs?.HomeCurrency?.value ?? 'USD'])
      back('connected')
    } catch (e) { console.error('[quickbooks] callback', e); back('error') }
  })
  r.post('/shipper/quickbooks/sync', wrap(async (req, res) => {
    const db = await getDb(); const u = await owner(db, req)
    try { const r2 = await syncShipper(db, u.shipperId!); res.json({ result: r2, status: await status(db, u.shipperId!) }) } catch (e) { throw new HttpError(502, e instanceof Error ? e.message : 'Sync failed.') }
  }))
  r.post('/shipper/quickbooks/disconnect', wrap(async (req, res) => {
    const db = await getDb(); const u = await owner(db, req)
    const { rows } = await db.query<Row>('select * from qb_connections where shipper_id = $1', [u.shipperId]); const c = rows[0]
    if (c?.refresh_token && qbConfigured()) await fetch(cfg().revoke, { method: 'POST', headers: { authorization: basic(), accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ token: await unseal(db, c.refresh_token) }) }).catch(() => null)
    await db.query('delete from qb_connections where shipper_id = $1', [u.shipperId]) // the sync map stays, per company, so reconnecting doesn't duplicate
    res.json(await status(db, u.shipperId!))
  }))
  void uid
}
