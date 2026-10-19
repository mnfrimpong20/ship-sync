/**
 * Shipper rules — "when this happens, if these are true, do that". Simple and safe on purpose:
 *   triggers   a shipment is booked / changes status / is weighed, a container moves stage, an invoice goes overdue,
 *              a new lead arrives
 *   conditions destination, city, cargo, mode, status, customer, value, pieces, % over declared, container stage…
 *   actions    tell the team, message the customer, assign an Ntemtem partner, add a receiver charge, set the
 *              handover, add a note to the timeline, draft a document
 * Each rule fires once per thing per trigger (and status), never cascades into other rules, and logs what it did
 * to the Autopilot log. Rules can be dry-run against a real shipment before switching them on.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { logAuto } from './autopilot'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

export const TRIGGERS = ['shipment.booked', 'shipment.status', 'shipment.measured', 'container.stage', 'invoice.overdue', 'request.received'] as const
export type Trigger = (typeof TRIGGERS)[number]
export const FIELDS = ['destination', 'origin', 'mode', 'cargo', 'status', 'receiverCity', 'customer', 'valueUsd', 'pieces', 'diffPct', 'containerStage', 'overdueDays', 'amountUsd'] as const
export const OPS = ['is', 'is_not', 'contains', 'at_least', 'at_most'] as const
export const ACTIONS = ['notify_team', 'message_customer', 'assign_partner', 'receiver_charge', 'set_handover', 'add_note', 'make_document'] as const
const zCond = z.object({ field: z.enum(FIELDS), op: z.enum(OPS), value: z.string().trim().max(80) })
const zAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify_team'), roles: z.array(z.enum(['owner', 'dispatcher', 'finance', 'agent', 'pickup_driver', 'delivery_driver', 'driver'])).min(1), message: z.string().trim().min(3).max(300) }),
  z.object({ type: z.literal('message_customer'), message: z.string().trim().min(3).max(500) }),
  z.object({ type: z.literal('assign_partner'), partnerId: z.string().min(3), services: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('receiver_charge'), amount: z.number().positive().max(1_000_000), currency: z.string().length(3).toUpperCase(), reason: z.string().trim().min(2).max(120), send: z.boolean().default(false) }),
  z.object({ type: z.literal('set_handover'), handover: z.enum(['delivery', 'collection']) }),
  z.object({ type: z.literal('add_note'), note: z.string().trim().min(2).max(300) }),
  z.object({ type: z.literal('make_document'), kind: z.enum(['packing_list', 'commercial_invoice', 'bill_of_lading', 'export_instructions']) }),
])
type Action = z.infer<typeof zAction>
const zRule = z.object({ name: z.string().trim().min(2).max(80), trigger: z.enum(TRIGGERS), status: z.string().max(30).default(''), conditions: z.array(zCond).max(8).default([]), actions: z.array(zAction).min(1, 'Add at least one action.').max(6), active: z.boolean().default(true) })

/** Facts a rule can test, gathered from whatever the trigger carries. */
async function factsFor(db: Db, ctx: Row) {
  const s = ctx.shipment as Row | undefined
  const f: Record<string, string | number | null> = {}
  if (s) {
    f.destination = s.destination; f.origin = s.origin; f.mode = s.mode; f.cargo = s.cargo; f.status = s.status; f.customer = s.customer
    const b = J<Row>(s.booking, {}); f.valueUsd = b.declaredValueUsd ?? null; f.pieces = Number(b.quantity ?? 0) || null
    const { consigneeOf } = await import('./recipient'); const rc = await consigneeOf(db, s).catch(() => null); f.receiverCity = rc?.city ?? ''
  }
  if (ctx.measure) f.diffPct = ctx.measure.diffPct
  if (ctx.container) { f.containerStage = ctx.container.status; f.destination ??= ctx.container.destination }
  if (ctx.invoice) { f.overdueDays = ctx.invoice.days; f.amountUsd = Number(ctx.invoice.total); f.customer ??= ctx.invoice.client_name }
  if (ctx.request) { f.destination = ctx.request.destination; f.origin = ctx.request.origin; f.mode = ctx.request.mode; f.cargo = ctx.request.cargo; f.valueUsd = ctx.request.declared_value_usd ?? null; f.pieces = ctx.request.quantity; f.customer = ctx.request.contact_name }
  return f
}
function test(f: Record<string, string | number | null>, c: z.infer<typeof zCond>) {
  const v = f[c.field]; if (v == null || v === '') return c.op === 'is_not'
  const a = String(v).toLowerCase(), b = c.value.toLowerCase()
  switch (c.op) { case 'is': return b.split(',').map((x) => x.trim()).includes(a); case 'is_not': return !b.split(',').map((x) => x.trim()).includes(a); case 'contains': return a.includes(b); case 'at_least': return Number(v) >= Number(c.value); case 'at_most': return Number(v) <= Number(c.value) }
}
const fill = (t: string, f: Record<string, unknown>, s?: Row) => t.replace(/\{(ref|customer|status|destination|receiverCity)\}/g, (_, k) => String(k === 'ref' ? s?.ref ?? '' : f[k] ?? ''))

async function act(db: Db, shipperId: string, a: Action, ctx: Row, f: Record<string, string | number | null>, dry: boolean): Promise<string> {
  const s = ctx.shipment as Row | undefined; const c = ctx.container as Row | undefined
  switch (a.type) {
    case 'notify_team': { const msg = fill(a.message, f, s); if (!dry) await notifyShipperStaff(db, shipperId, { kind: 'system', title: msg, body: s ? `${s.ref} · ${s.customer}` : c ? c.ref : '', link: s ? `/dashboard/shipments?q=${s.ref}&b=all` : c ? `/dashboard/containers/${c.id}` : '/dashboard/autopilot' }, a.roles); return `Tell ${a.roles.join(', ')}: “${msg}”` }
    case 'message_customer': {
      const msg = fill(a.message, f, s)
      if (c && !s) { const { rows } = await db.query<Row>('select id, user_id, ref from shipments where container_id = $1 and cancelled_at is null and user_id is not null', [c.id]); if (!dry) for (const x of rows) await notify(db, { userId: x.user_id, kind: 'shipment_status', title: fill(a.message, f, x).slice(0, 120), body: fill(a.message, f, x), link: `/track?ref=${x.ref}` }); return `Message ${rows.length} customer${rows.length === 1 ? '' : 's'} in ${c.ref}: “${msg}”` }
      if (!s?.user_id) return 'Message the customer — skipped (no customer account)'
      if (!dry) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: msg.slice(0, 120), body: msg, link: `/track?ref=${s.ref}` }); return `Message ${s.customer}: “${msg}”`
    }
    case 'assign_partner': {
      const cid = c?.id ?? s?.container_id; if (!cid) return 'Assign partner — skipped (not in a container yet)'
      const { rows: p } = await db.query<Row>('select name, country from destination_partners where id = $1 and active', [a.partnerId]); if (!p[0]) return 'Assign partner — skipped (partner not listed)'
      const { rows: dup } = await db.query<Row>(`select 1 from partner_assignments where container_id = $1 and partner_id = $2 and status in ('requested','accepted')`, [cid, a.partnerId]); if (dup[0]) return `Assign ${p[0].name} — already on it`
      if (!dry) {
        const { randomBytes } = await import('node:crypto'); const linkId = 'pl_' + uid(); const { rows: pp } = await db.query<Row>('select * from destination_partners where id = $1', [a.partnerId])
        await db.query('insert into partner_links (id,token,shipper_id,container_id,name,email,phone,created_by,partner_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [linkId, randomBytes(15).toString('base64url'), shipperId, cid, pp[0].name, pp[0].email, pp[0].phone, 'Rule', a.partnerId])
        await db.query('insert into partner_assignments (id,partner_id,shipper_id,container_id,link_id,services,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['pa_' + uid(), a.partnerId, shipperId, cid, linkId, JSON.stringify(a.services), 'Assigned by a rule', 'Rule'])
      }
      return `Ask ${p[0].name} to handle ${a.services.join(', ')}`
    }
    case 'receiver_charge': {
      if (!s) return 'Receiver charge — skipped (no shipment)'
      if (!dry) {
        await db.query('insert into receiver_charges (id,shipment_id,shipper_id,amount,currency,reason,status,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['rc_' + uid(), s.id, shipperId, a.amount, a.currency, a.reason, a.send ? 'due' : 'draft', 'Rule'])
        if (a.send) { const { messageRecipient } = await import('./recipient'); const { fmtMoney } = await import('../src/lib/address'); await messageRecipient(db, s, 'charge', { force: true, note: a.reason, amount: fmtMoney(a.amount, a.currency), by: 'Rule' }).catch(() => null) }
      }
      return `${a.send ? 'Charge' : 'Draft a charge for'} the receiver ${a.currency} ${a.amount} (${a.reason})`
    }
    case 'set_handover': { if (!s) return 'Set handover — skipped'; if (!dry) await db.query('update shipments set handover = $2 where id = $1', [s.id, a.handover]); return `Set handover to ${a.handover}` }
    case 'add_note': { const note = fill(a.note, f, s); if (s && !dry) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', note]); else if (c && !dry) await db.query(`insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,'',$3,'Rule','manual','')`, [c.id, c.status, note]); return `Note: “${note}”` }
    case 'make_document': { if (!s) return 'Make document — skipped'; if (!dry) { const { generateDocument } = await import('./documents'); await generateDocument(db, s, a.kind, 'shipper', 'Rule').catch(() => null) } return `Draft the ${a.kind.replace(/_/g, ' ')}` }
  }
}

/** Called from the event points. Never throws. */
export async function fireRules(db: Db, shipperId: string, trigger: Trigger, ctx: Row) {
  try {
    const { rows } = await db.query<Row>('select * from shipper_rules where shipper_id = $1 and active and trigger = $2', [shipperId, trigger]); if (!rows.length) return
    const f = await factsFor(db, ctx)
    const entity = ctx.shipment?.id ?? ctx.container?.id ?? ctx.invoice?.id ?? ctx.request?.id ?? ''
    for (const r of rows) {
      if (r.status && trigger === 'shipment.status' && ctx.shipment?.status !== r.status) continue
      if (r.status && trigger === 'container.stage' && ctx.container?.status !== r.status) continue
      const conds = J<z.infer<typeof zCond>[]>(r.conditions, []); if (!conds.every((c) => test(f, c))) continue
      const key = `rule:${r.id}:${entity}:${trigger}:${ctx.shipment?.status ?? ctx.container?.status ?? ctx.invoice?.days ?? ''}`
      const { rows: m } = await db.query<Row>('insert into autopilot_marks (key) values ($1) on conflict do nothing returning key', [key]); if (!m[0]) continue
      const done: string[] = []
      for (const a of J<Action[]>(r.actions, [])) done.push(await act(db, shipperId, a, ctx, f, false).catch((e) => `Failed: ${e instanceof Error ? e.message : e}`))
      await db.query('update shipper_rules set runs = runs + 1, last_run_at = now() where id = $1', [r.id])
      const label = ctx.shipment?.ref ?? ctx.container?.ref ?? ctx.invoice?.number ?? ctx.request?.ref ?? ''
      await logAuto(db, shipperId, 'rule', `Rule “${r.name}” ran${label ? ` for ${label}` : ''}`, { body: done.join(' · '), ref: label, link: ctx.shipment ? `/dashboard/shipments?q=${ctx.shipment.ref}&b=all` : ctx.container ? `/dashboard/containers/${ctx.container.id}` : '' })
    }
  } catch (e) { console.error('[rules]', e) }
}

const ruleOut = (r: Row) => ({ id: r.id, name: r.name, trigger: r.trigger as Trigger, status: r.status ?? '', conditions: J(r.conditions, []), actions: J(r.actions, []), active: !!r.active, runs: Number(r.runs ?? 0), lastRunAt: ISO(r.last_run_at), createdAt: ISO(r.created_at) })

export function mountRules(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const managers = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.'); return u }
  r.get('/rules', wrap(async (req, res) => { const db = await getDb(); const u = await managers(db, req); const { rows } = await db.query<Row>('select * from shipper_rules where shipper_id = $1 order by created_at', [u.shipperId]); res.set('Cache-Control', 'no-store'); res.json({ rules: rows.map(ruleOut) }) }))
  r.post('/rules', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zRule.parse(req.body)
    const { rows: n } = await db.query<Row>('select count(*)::int as n from shipper_rules where shipper_id = $1', [u.shipperId]); if (Number(n[0].n) >= 40) throw new HttpError(409, 'That’s 40 rules — tidy a few up first.')
    const id = 'rule_' + uid()
    await db.query('insert into shipper_rules (id,shipper_id,name,trigger,status,conditions,actions,active,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, u.shipperId, b.name, b.trigger, b.status, JSON.stringify(b.conditions), JSON.stringify(b.actions), b.active, u.name])
    const { rows } = await db.query<Row>('select * from shipper_rules where id = $1', [id]); res.status(201).json({ rule: ruleOut(rows[0]) })
  }))
  r.put('/rules/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zRule.parse(req.body)
    const { rows } = await db.query<Row>('update shipper_rules set name=$3, trigger=$4, status=$5, conditions=$6, actions=$7, active=$8 where id = $1 and shipper_id = $2 returning *', [String(req.params.id), u.shipperId, b.name, b.trigger, b.status, JSON.stringify(b.conditions), JSON.stringify(b.actions), b.active])
    if (!rows[0]) throw new HttpError(404, 'Rule not found.'); res.json({ rule: ruleOut(rows[0]) })
  }))
  r.delete('/rules/:id', wrap(async (req, res) => { const db = await getDb(); const u = await managers(db, req); await db.query('delete from shipper_rules where id = $1 and shipper_id = $2', [String(req.params.id), u.shipperId]); res.json({ ok: true }) }))
  /** Dry run against one of my shipments: would it match, and what would it do? Nothing is changed. */
  r.post('/rules/test', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const b = z.object({ rule: zRule, shipmentRef: z.string().trim().toUpperCase().max(20) }).parse(req.body)
    const { rows } = await db.query<Row>('select * from shipments where ref = $1 and shipper_id = $2', [b.shipmentRef, u.shipperId]); const s = rows[0]; if (!s) throw new HttpError(404, 'No shipment with that reference.')
    const ctx: Row = { shipment: s }; if (s.container_id) { const { rows: c } = await db.query<Row>('select * from containers where id = $1', [s.container_id]); if (b.rule.trigger === 'container.stage') ctx.container = c[0] }
    const f = await factsFor(db, ctx)
    const checks = b.rule.conditions.map((c) => ({ ...c, actual: f[c.field] ?? null, pass: test(f, c) }))
    const matches = checks.every((c) => c.pass)
    res.json({ matches, checks, would: matches ? await Promise.all(b.rule.actions.map((a) => act(db, u.shipperId!, a, ctx, f, true))) : [] })
  }))
}
