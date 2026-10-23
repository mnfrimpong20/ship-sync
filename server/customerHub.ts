/**
 * Customer hub — everything on the customer dashboard beyond requests and shipments.
 *   1  GET /me/spending?year=  ·  GET /me/statement?year=|month=&format=csv|html
 *   2  GET /me/balance  ·  POST /me/pay { items:[{invoiceId, amountUsd}] , useCredit }  ·  POST /me/pay/verify { session }
 *      POST /me/invoices/:id/plan { parts }  ·  DELETE /me/invoices/:id/plan            (instalments)
 *   3  GET /me/calendar
 *   4  GET /me/shipments/:id/timeline            (what happens next + arrival-date history)
 *   5  GET|POST /shipments/:id/items · PATCH|DELETE /shipment-items/:id · GET /items/restricted?destination=
 *   6  GET /me/documents · GET /me/documents.zip
 *   7  GET /me/shipments/:id/family              (WhatsApp share text, tracking link, collection code, receipt)
 *   8  GET /me/shipments/:id/duty · POST /me/duty-preview
 *   9  GET /me/favorites · PUT|DELETE /me/favorites/:shipperId
 *  10  GET|POST /me/repeats · PATCH|DELETE /me/repeats/:id · POST /me/repeats/:id/post
 *  11  GET|POST /me/alerts · DELETE /me/alerts/:id
 *  12  GET /me/inbox · GET|POST /shipments/:id/messages
 *  13  GET /me/issues (disputes with photos)
 *  14  GET|PUT /me/notify-prefs (texts by SMS/WhatsApp per kind, quiet hours)
 *  15  GET /me/referral (code, link, credit)
 *  16  GET /me/accounts · POST /me/members · DELETE /me/members/:id · POST /me/accounts/accept · POST /me/accounts/switch
 *      GET|PUT /me/business
 */
import { randomBytes } from 'node:crypto'
import { isDriverRole } from '../src/lib/roles'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { emailTemplate, notify, notifyShipperStaff, sendEmail } from './notify'
import { normalisePhone, sendText } from './sms'
import { countryByCode, statusLabels, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const DAY = 86400000
const num = (v: unknown) => Number(v ?? 0) || 0
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10))
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v).length === 10 ? `${v}T12:00:00Z` : String(v)).getTime())
const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '')
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const dest = (c: string) => countryByCode(c)?.name ?? c
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Invoices addressed to this customer, across every shipper (via the shipper's client record). */
export async function myInvoices(db: Db, userId: string) {
  const { rows } = await db.query<Row>(`select i.*, sh.name as shipper_name, s.ref as shipment_ref, s.destination, s.cargo, s.origin, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)::float as paid
    from invoices i join clients c on c.id = i.client_id join shippers sh on sh.id = i.shipper_id left join shipments s on s.id = i.shipment_id where c.user_id = $1 and i.status not in ('draft','void') order by i.issued_at desc`, [userId])
  return rows.map((i): Row => ({ ...i, balance: Math.max(0, Math.round((num(i.total) - num(i.paid)) * 100) / 100) }))
}
async function ownShipment(db: Db, u: ApiUser, id: string, Err: Deps['HttpError']) {
  const { rows } = await db.query<Row>('select * from shipments where id = $1', [id]); const s = rows[0]; if (!s) throw new Err(404, 'Shipment not found.')
  const office = u.role === 'shipper' && s.shipper_id === u.shipperId && !isDriverRole(u.staffRole)
  if (!office && !(u.role === 'customer' && s.user_id === u.id)) throw new Err(403, 'You do not have access to this shipment.')
  return { s, office }
}

/* =============================== 4 · what happens next =============================== */
export function nextStep(s: Row): { title: string; body: string; you: string | null } {
  const air = s.mode === 'air'; const collection = s.handover === 'collection'
  const map: Record<string, [string, string, string | null]> = {
    booked: ['Waiting for pickup or drop-off', `Your shipper collects the goods${s.ready_date ? '' : ''} or you drop them at their warehouse. Each piece gets a sticker so it can be scanned along the way.`, 'Pack and label everything, and add what’s inside to the packing list so customs and insurance match.'],
    picked_up: ['At the origin warehouse', `Your goods are weighed, checked and loaded into ${air ? 'the next flight allocation' : 'a container'}.`, null],
    at_origin_port: [air ? 'At the airport' : 'At the port', air ? 'Cleared for export and waiting for the flight.' : 'The container is gated in and waiting to be loaded on the vessel.', null],
    in_transit: [air ? 'In the air' : 'On the water', air ? 'Usually 2–5 days to land, including transfers.' : 'Ocean crossings take about 3–5 weeks. You can follow the vessel live on the tracking page.', 'Make sure your recipient’s phone number is right so they get the arrival text.'],
    arrived: ['Arrived at destination', 'Unloading and paperwork for customs start now — usually 2–5 days.', 'Have the duty money ready; you’ll see the confirmed amount here as soon as customs assesses it.'],
    customs: ['Clearing customs', 'Customs inspects the paperwork and sometimes the goods, then assesses duty.', 'Pay any confirmed duty quickly — storage fees can start after the free days.'],
    ready_for_collection: ['Ready to collect', 'Your recipient can collect from the warehouse with the 6-digit code and a photo ID.', 'Share the code with your recipient (button below) if you haven’t already.'],
    out_for_delivery: ['Out for delivery', 'A driver is bringing it to the door today or tomorrow.', 'Tell your recipient to keep their phone on.'],
    delivered: ['Delivered', collection ? 'Collected by your recipient.' : 'Handed over at the door.', 'Leave a review — it helps the next customer choose.'],
  }
  const m = map[s.status] ?? ['In progress', '', null]
  return { title: m[0], body: m[1], you: m[2] }
}

/* =============================== 5 · packing list & restricted goods =============================== */
export const ITEM_CATEGORIES = ['clothing', 'shoes', 'food', 'toiletries', 'household', 'electronics', 'kitchen', 'books', 'toys', 'medicine', 'building', 'auto_parts', 'other'] as const
type Rule = { re: RegExp; level: 'banned' | 'restricted' | 'check'; note: string }
const COMMON: Rule[] = [
  { re: /\b(gun|firearm|pistol|rifle|ammo|ammunition|bullet|explosive|fireworks?)\b/i, level: 'banned', note: 'Weapons, ammunition and explosives can’t be shipped.' },
  { re: /\b(cannabis|marijuana|weed|cocaine|tramadol|codeine)\b/i, level: 'banned', note: 'Controlled drugs are prohibited.' },
  { re: /\b(fake|counterfeit|replica)\b/i, level: 'banned', note: 'Counterfeit goods are seized at customs.' },
  { re: /\b(gas cylinder|propane|lighter fluid|aerosol|perfume|nail polish|paint thinner|battery|batteries|power bank)\b/i, level: 'restricted', note: 'Flammables and lithium batteries need declaring — your shipper may refuse or charge for hazardous handling.' },
  { re: /\b(medicine|drugs?|tablets|pills|antibiotic|prescription)\b/i, level: 'check', note: 'Medicines need to be in original packs with a prescription or receipt.' },
  { re: /\b(cash|gold|jewell?ery|diamond)\b/i, level: 'check', note: 'Valuables are best not packed in barrels — insurance usually excludes cash and jewellery.' },
]
const BY_DEST: Record<string, Rule[]> = {
  GH: [
    { re: /\b(used|second[- ]hand)\s+(fridge|refrigerator|freezer|air ?condition\w*|ac unit)/i, level: 'banned', note: 'Ghana bans used fridges, freezers and air conditioners.' },
    { re: /\b(used|second[- ]hand)\s+(underwear|panties|bras?|undergarments?)\b/i, level: 'banned', note: 'Ghana bans used underwear.' },
    { re: /\b(mercury|skin bleach\w*|hydroquinone)\b/i, level: 'banned', note: 'Skin-bleaching products with mercury or hydroquinone are banned in Ghana.' },
    { re: /\b(car|vehicle|truck|suv)\b/i, level: 'check', note: 'Vehicles over 10 years old attract heavy penalties at Tema.' },
  ],
  NG: [
    { re: /\b(used|second[- ]hand)\s+(clothes|clothing|garments?)\b/i, level: 'banned', note: 'Nigeria bans the import of used clothing.' },
    { re: /\b(chicken|poultry|turkey|pork|beef|frozen meat|eggs?)\b/i, level: 'banned', note: 'Frozen poultry, pork, beef and eggs are on Nigeria’s import prohibition list.' },
    { re: /\b(bottled water|fruit juice|spaghetti|noodles|soap|detergent|carpet|mosquito net)\b/i, level: 'restricted', note: 'On Nigeria’s import prohibition list in commercial quantities — small personal amounts are usually tolerated.' },
    { re: /\b(car|vehicle|truck|suv)\b/i, level: 'check', note: 'Vehicles over 15 years old can’t be imported into Nigeria.' },
  ],
}
export function checkItem(description: string, destination: string) {
  for (const r of [...(BY_DEST[destination] ?? []), ...COMMON]) if (r.re.test(description)) return { level: r.level, note: r.note }
  return null
}
async function syncItemTotals(db: Db, shipmentId: string) {
  const { rows } = await db.query<Row>('select coalesce(sum(value_usd * qty),0)::float as v, coalesce(sum(qty),0)::int as n from shipment_items where shipment_id = $1', [shipmentId])
  const { rows: [s] } = await db.query<Row>('select booking from shipments where id = $1', [shipmentId])
  const b = { ...(J(s?.booking) ?? {}), itemsValueUsd: Math.round(rows[0].v), itemsCount: rows[0].n }
  if (!b.declaredValueUsd || b.declaredFromItems) { b.declaredValueUsd = Math.round(rows[0].v) || b.declaredValueUsd; b.declaredFromItems = true }
  await db.query('update shipments set booking = $2 where id = $1', [shipmentId, JSON.stringify(b)])
  return b
}

/* =============================== 8 · duty preview =============================== */
const GOODS_FOR: Record<string, string> = { clothing: 'personal_effects', shoes: 'personal_effects', food: 'food', toiletries: 'personal_effects', household: 'household_new', electronics: 'electronics', kitchen: 'household_new', books: 'personal_effects', toys: 'household_new', medicine: 'other', building: 'building', auto_parts: 'machinery', other: 'other' }
const CARGO_GOODS: Record<string, string> = { barrels: 'personal_effects', boxes: 'personal_effects', pallets: 'household_new', vehicle: 'vehicle', container20: 'household_new', container40: 'household_new', commercial: 'other' }
async function dutyPreview(db: Db, o: { destination: string; cargo: string; valueUsd: number; freightUsd: number; items?: Row[] }) {
  if (!['GH', 'NG'].includes(o.destination) || !o.valueUsd) return null
  const { estimateDuty } = await import('./duty')
  if (o.items?.length) {
    const groups = new Map<string, number>(); for (const i of o.items) { const g = GOODS_FOR[i.category] ?? 'other'; groups.set(g, (groups.get(g) ?? 0) + num(i.value_usd) * num(i.qty)) }
    const total = [...groups.values()].reduce((a, b) => a + b, 0) || 1
    const parts = [...groups].map(([goods, v]) => ({ goods, v, e: estimateDuty({ destination: o.destination, goods: goods as never, valueUsd: v, freightUsd: (o.freightUsd * v) / total } as never) as Row }))
    const usd = parts.reduce((a, p) => a + num(p.e.totalUsd ?? p.e.totalUSD ?? p.e.usd ?? 0), 0); const local = parts.reduce((a, p) => a + num(p.e.totalLocal ?? p.e.local ?? 0), 0)
    return { usd: Math.round(usd), local: Math.round(local), currency: o.destination === 'GH' ? 'GHS' : 'NGN', basis: 'packing list', parts: parts.map((p) => ({ goods: p.goods, valueUsd: Math.round(p.v), usd: Math.round(num(p.e.totalUsd ?? p.e.usd ?? 0)) })) }
  }
  const e = estimateDuty({ destination: o.destination, goods: (CARGO_GOODS[o.cargo] ?? 'other') as never, valueUsd: o.valueUsd, freightUsd: o.freightUsd } as never) as Row
  return { usd: Math.round(num(e.totalUsd ?? e.usd ?? 0)), local: Math.round(num(e.totalLocal ?? e.local ?? 0)), currency: o.destination === 'GH' ? 'GHS' : 'NGN', basis: 'declared value', parts: [] }
}

/* =============================== 14 · texts (SMS / WhatsApp) with quiet hours =============================== */
export async function queueText(db: Db, userId: string, n: { kind: string; title: string; body?: string; link?: string }) {
  const { rows: [p] } = await db.query<Row>('select phone, text_channel, text_kinds, quiet_start, quiet_end, tz_offset from notification_prefs where user_id = $1', [userId])
  if (!p || p.text_channel === 'off' || !p.phone) return
  const kinds: string[] = J(p.text_kinds) ?? []; if (!kinds.includes(n.kind)) return
  const to = String(p.phone).trim().startsWith('+') ? String(p.phone).replace(/[^\d+]/g, '') : normalisePhone(p.phone, 'US') ?? p.phone
  let after = new Date()
  if (p.quiet_start != null && p.quiet_end != null) {
    const local = new Date(Date.now() + num(p.tz_offset) * 60_000); const h = local.getUTCHours()
    const inQuiet = p.quiet_start <= p.quiet_end ? h >= p.quiet_start && h < p.quiet_end : h >= p.quiet_start || h < p.quiet_end
    if (inQuiet) { const end = new Date(local); end.setUTCHours(p.quiet_end, 0, 0, 0); if (end <= local) end.setUTCDate(end.getUTCDate() + 1); after = new Date(end.getTime() - num(p.tz_offset) * 60_000) }
  }
  const body = `${n.title}${n.body ? ` — ${String(n.body).slice(0, 220)}` : ''}${n.link ? `\n${n.link.startsWith('http') ? n.link : `${appUrl()}/#${n.link}`}` : ''}`
  await db.query('insert into user_texts (id,user_id,to_phone,channel,body,send_after) values ($1,$2,$3,$4,$5,$6)', ['ut_' + uid(), userId, to, p.text_channel, body.slice(0, 600), after])
  if (after.getTime() <= Date.now() + 1000) void sweepTexts(db)
}
let textsBusy = false
export async function sweepTexts(db: Db) {
  if (textsBusy) return; textsBusy = true
  try {
    const { rows } = await db.query<Row>(`select * from user_texts where status = 'pending' and send_after <= now() order by created_at limit 50`)
    for (const t of rows) {
      try { await sendText(t.to_phone, t.body, t.channel === 'whatsapp' ? 'whatsapp' : 'sms'); await db.query(`update user_texts set status = 'sent', sent_at = now() where id = $1`, [t.id]) }
      catch (e) { await db.query(`update user_texts set status = 'failed', error = $2 where id = $1`, [t.id, String(e instanceof Error ? e.message : e).slice(0, 200)]) }
    }
  } finally { textsBusy = false }
}

/* =============================== 15 · referrals =============================== */
const CREDIT_USD = () => Number(process.env.REFERRAL_CREDIT_USD) || 15
async function codeFor(db: Db, userId: string) {
  const { rows: [u] } = await db.query<Row>('select referral_code, name from users where id = $1', [userId]); if (u?.referral_code) return u.referral_code as string
  for (let i = 0; i < 5; i++) { const c = `${String(u?.name ?? 'SS').replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase() || 'SHIP'}${randomBytes(2).toString('hex').toUpperCase()}`; try { await db.query('update users set referral_code = $2 where id = $1 and referral_code is null', [userId, c]); return c } catch { /* clash */ } }
  return null
}
export async function applyReferral(db: Db, userId: string, code: string) {
  const { rows: [r] } = await db.query<Row>('select id from users where upper(referral_code) = upper($1)', [code.trim()])
  if (r && r.id !== userId) await db.query('update users set referred_by = $2 where id = $1 and referred_by is null', [userId, r.id])
}
/** First delivered shipment of a referred customer → credit for both. */
export async function onDelivered(db: Db, s: Row) {
  if (!s.user_id) return
  const { rows: [u] } = await db.query<Row>('select id, name, referred_by from users where id = $1', [s.user_id]); if (!u?.referred_by) return
  const { rows: done } = await db.query('select 1 from credits where source_user_id = $1 and reason = $2', [u.id, 'referral'])
  if (done.length) return
  const amt = CREDIT_USD()
  await db.query(`insert into credits (id,user_id,amount_usd,reason,source_user_id) values ($1,$2,$3,'referral',$4), ($5,$4,$3,'welcome',$4)`, ['cr_' + uid(), u.referred_by, amt, u.id, 'cr_' + uid()])
  await notify(db, { userId: u.referred_by, kind: 'payment', title: `You earned ${money(amt)} credit`, body: `${u.name.split(' ')[0]}’s first shipment arrived. The credit comes off your next payment on Ntemtem.`, link: '/dashboard?tab=money' })
  await notify(db, { userId: u.id, kind: 'payment', title: `${money(amt)} welcome credit`, body: 'Thanks for shipping with Ntemtem — it comes off your next online payment.', link: '/dashboard?tab=money' })
}
export async function creditBalance(db: Db, userId: string) { const { rows } = await db.query<Row>('select coalesce(sum(amount_usd),0)::float as v from credits where user_id = $1 and used_at is null', [userId]); return num(rows[0]?.v) }

/* =============================== sweeps: instalments, repeats, alerts =============================== */
export async function sweepCustomer(db: Db) {
  const today = new Date().toISOString().slice(0, 10)
  // instalment reminders: due in 2 days or overdue, not yet covered by what's been paid
  const { rows: inv } = await db.query<Row>(`select i.*, c.user_id, sh.name as shipper_name, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id),0)::float as paid from invoices i join clients c on c.id = i.client_id join shippers sh on sh.id = i.shipper_id where i.plan is not null and i.status = 'sent' and c.user_id is not null`)
  for (const i of inv) {
    let cum = 0
    for (const [k, part] of (J(i.plan)?.parts ?? []).entries()) {
      cum += num(part.amount); if (num(i.paid) >= cum - 0.5) continue
      const days = Math.round((ms(part.due) - ms(today)) / DAY)
      if (days <= 2) await notify(db, { userId: i.user_id, kind: 'payment', title: days < 0 ? `Instalment ${k + 1} for ${i.number} is overdue` : `Instalment ${k + 1} for ${i.number} is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`, body: `${money(cum - num(i.paid))} to ${i.shipper_name}.`, link: '/dashboard?tab=money', dedupe: `inst:${i.id}:${k}:${days < 0 ? 'late' : 'due'}` })
      break
    }
  }
  // repeat shipments: remind 7 days before, then roll the date
  const { rows: rp } = await db.query<Row>(`select * from repeat_plans where active and next_on <= current_date + 7 and (last_reminded_on is null or last_reminded_on < next_on - 7)`)
  for (const p of rp) {
    await notify(db, { userId: p.user_id, kind: 'booking_confirmed', title: `Time for “${p.name}”`, body: `Your repeat shipment is due ${new Date(ms(D(p.next_on))).toDateString()}. One tap posts the request with the same details.`, link: `/dashboard?tab=plans&repeat=${p.id}`, dedupe: `repeat:${p.id}:${D(p.next_on)}` })
    await db.query('update repeat_plans set last_reminded_on = current_date where id = $1', [p.id])
  }
  await db.query(`update repeat_plans set next_on = next_on + every_days, last_reminded_on = null where active and next_on < current_date - 3`)
  // alerts
  const { rows: al } = await db.query<Row>(`select * from alerts where active and (last_sent_at is null or last_sent_at < now() - interval '3 days')`)
  for (const a of al) {
    try {
      if (a.kind === 'price') {
        const { rows: [q] } = await db.query<Row>(`select percentile_cont(0.5) within group (order by q.price)::float as med, count(*)::int as n from quotes q join requests r on r.id = q.request_id where r.destination = $1 and ($2 = '' or r.origin = $2) and ($3 = '' or r.cargo = $3) and r.mode = $4 and q.sent_at > now() - interval '30 days'`, [a.destination, a.origin, a.cargo, a.mode])
        const med = q?.n >= 3 ? Math.round(num(q.med)) : null; if (med == null) continue
        const hit = (a.threshold_usd != null && med <= num(a.threshold_usd)) || (a.last_value != null && med <= num(a.last_value) * 0.9)
        if (hit) await notify(db, { userId: a.user_id, kind: 'quote_received', title: `Prices ${a.origin ? `from ${a.origin.split(',')[0]} ` : ''}to ${dest(a.destination)} are down — typical ${money(med)}`, body: `${a.cargo || 'Shipments'} by ${a.mode}, median of the last 30 days of quotes.`, link: `/quote?destination=${a.destination}` })
        await db.query('update alerts set last_value = $2, last_sent_at = case when $3 then now() else last_sent_at end where id = $1', [a.id, med, hit])
      } else if (a.kind === 'groupage') {
        const { rows: g } = await db.query<Row>(`select id, title, closes_at from groupages where destination = $1 and status = 'open' and created_at > coalesce($2, now() - interval '7 days') order by created_at desc limit 1`, [a.destination, a.last_sent_at])
        if (g[0]) { await notify(db, { userId: a.user_id, kind: 'groupage', title: `Shared space to ${dest(a.destination)}: ${g[0].title}`, body: `Reserve before ${new Date(g[0].closes_at).toDateString()}.`, link: '/groupage' }); await db.query('update alerts set last_sent_at = now() where id = $1', [a.id]) }
      } else if (a.kind === 'cutoff') {
        const { rows: sl } = await db.query<Row>(`select id, vessel_name, cutoff, etd from sailings where destination = $1 and cutoff between current_date and current_date + 7 and status <> 'cancelled' order by cutoff limit 1`, [a.destination])
        if (sl[0]) { await notify(db, { userId: a.user_id, kind: 'booking_confirmed', title: `Sailing cutoff ${new Date(ms(D(sl[0].cutoff))).toDateString()} for ${dest(a.destination)}`, body: `${sl[0].vessel_name ?? 'The next vessel'} departs ${sl[0].etd ? new Date(ms(D(sl[0].etd))).toDateString() : 'soon'}. Book now to make it.`, link: `/quote?destination=${a.destination}`, dedupe: `cutoff:${a.id}:${sl[0].id}` }); await db.query('update alerts set last_sent_at = now() where id = $1', [a.id]) }
      }
    } catch (e) { console.error('[alerts]', a.id, e) }
  }
}
export function startCustomerSweeps(getDb: () => Promise<Db>) {
  setInterval(() => { getDb().then(sweepTexts).catch(() => {}) }, 5 * 60_000)
  const run = () => getDb().then(sweepCustomer).catch((e) => console.error('[customer]', e)); setTimeout(run, 55_000); setInterval(run, 3 * 3600_000)
}

/* =============================== tiny ZIP writer (stored, no compression) =============================== */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
export function zip(files: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = []; const central: Buffer[] = []; let off = 0
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/[\\:*?"<>|]/g, '_')); const crc = crc32(f.data)
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28)
    parts.push(h, name, f.data)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42)
    central.push(c, name); off += 30 + name.length + f.data.length
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, e])
}

/* =============================== routes =============================== */
const zItem = z.object({ description: z.string().trim().min(2).max(160), category: z.enum(ITEM_CATEGORIES).default('other'), qty: z.number().int().min(1).max(10000).default(1), valueUsd: z.number().min(0).max(1_000_000).default(0), piece: z.number().int().min(1).max(999).nullable().optional() })
const zTemplate = z.object({ origin: z.string().min(2).max(80), destination: z.string().length(2), mode: z.enum(['ocean', 'air', 'either']), cargo: z.string().min(2).max(40), quantity: z.number().int().min(1).max(1000), description: z.string().max(400).default(''), pickup: z.boolean().default(false), delivery: z.boolean().default(false), insurance: z.boolean().default(false), preferredShipperId: z.string().max(60).nullable().optional(), consignee: z.record(z.string(), z.unknown()).nullable().optional() })
const itemOut = (i: Row, destination: string) => ({ id: i.id, piece: i.piece, description: i.description, category: i.category, qty: Number(i.qty), valueUsd: num(i.value_usd), flag: checkItem(i.description, destination) })

export function mountCustomerHub(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const customer = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'customer') throw new HttpError(403, 'Customer accounts only.'); return u }

  /* ---------- 1 · spending ---------- */
  r.get('/me/spending', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const inv = await myInvoices(db, u.id)
    // Money paid through Ntemtem checkout counts too, for shipments the shipper never raised an invoice on.
    const invoiced = new Set(inv.map((i) => i.shipment_id).filter(Boolean))
    const { rows: paid } = await db.query<Row>(`select p.shipment_id, p.amount_usd as total, coalesce(p.paid_at, p.created_at) as issued_at, sh.name as shipper_name, s.destination, s.cargo from escrow_payments p join shippers sh on sh.id = p.shipper_id left join shipments s on s.id = p.shipment_id
      where p.user_id = $1 and p.status in ('held','released','paid_out','direct')`, [u.id])
    for (const p of paid) if (!p.shipment_id || !invoiced.has(p.shipment_id)) inv.push({ ...p, balance: 0 })
    const years = [...new Set(inv.map((i) => Number(D(i.issued_at)!.slice(0, 4))))].sort((a, b) => b - a)
    const year = Number(req.query.year) || years[0] || new Date().getFullYear()
    const yr = inv.filter((i) => D(i.issued_at)!.startsWith(String(year)))
    const prev = inv.filter((i) => D(i.issued_at)!.startsWith(String(year - 1)))
    const sum = (xs: Row[]) => Math.round(xs.reduce((a, i) => a + num(i.total), 0))
    const group = (key: (i: Row) => string, label: (k: string) => string) => { const m = new Map<string, number>(); for (const i of yr) { const k = key(i); m.set(k, (m.get(k) ?? 0) + num(i.total)) } return [...m].map(([k, v]) => ({ key: k, label: label(k), amount: Math.round(v) })).sort((a, b) => b.amount - a.amount) }
    const months = Array.from({ length: 12 }, (_, m) => ({ start: `${year}-${String(m + 1).padStart(2, '0')}-01`, spent: Math.round(yr.filter((i) => Number(D(i.issued_at)!.slice(5, 7)) === m + 1).reduce((a, i) => a + num(i.total), 0)) }))
    // per unit, from shipments with a quantity
    const { rows: sh } = await db.query<Row>(`select s.id, s.cargo, s.booking, r.quantity, s.created_at from shipments s left join requests r on r.id = s.request_id where s.user_id = $1 and s.cancelled_at is null`, [u.id])
    const qty = new Map(sh.map((s) => [s.id, Math.max(1, num(J(s.booking)?.quantity) || num(s.quantity) || 1)]))
    const units = new Map<string, { spent: number; units: number; n: number }>()
    for (const i of yr) if (i.shipment_id && i.cargo) { const x = units.get(i.cargo) ?? { spent: 0, units: 0, n: 0 }; x.spent += num(i.total); x.units += qty.get(i.shipment_id) ?? 1; x.n++; units.set(i.cargo, x) }
    // savings: accepted price vs the median of the other quotes on the same request
    const { rows: rq } = await db.query<Row>(`select r.id, r.created_at, (select price from quotes q where q.request_id = r.id and q.status = 'accepted') as won, array(select price from quotes q where q.request_id = r.id and q.status <> 'accepted') as others from requests r where r.user_id = $1 and r.status = 'booked'`, [u.id])
    let saved = 0, compared = 0
    for (const x of rq) { if (!D(x.created_at)!.startsWith(String(year)) || x.won == null) continue; const o = (Array.isArray(x.others) ? x.others : []).map(num).filter((v: number) => v > 0); const m = median(o); if (m != null && m > num(x.won)) { saved += m - num(x.won); compared++ } }
    res.json({
      year, years: years.length ? years : [year], total: sum(yr), prevTotal: sum(prev), shipments: new Set(yr.map((i) => i.shipment_id).filter(Boolean)).size, invoices: yr.filter((i) => i.id).length,
      outstanding: Math.round(inv.reduce((a, i) => a + i.balance, 0)), saved: Math.round(saved), comparedBookings: compared,
      byDestination: group((i) => i.destination ?? 'other', (k) => (k === 'other' ? 'Other' : dest(k))), byShipper: group((i) => i.shipper_name, (k) => k), months,
      perUnit: [...units].map(([cargo, x]) => ({ cargo, avg: Math.round(x.spent / Math.max(1, x.units)), units: x.units, shipments: x.n })).sort((a, b) => b.units - a.units),
    })
  }))
  r.get('/me/statement', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : null; const year = Number(req.query.year) || new Date().getFullYear()
    const key = month ?? String(year)
    const inv = (await myInvoices(db, u.id)).filter((i) => D(i.issued_at)!.startsWith(key)).reverse()
    const { rows: [me] } = await db.query<Row>('select name, email, company_name, tax_id, billing_address from users where id = $1', [u.id])
    const { rows: po } = await db.query<Row>(`select s.id, r.po_number from shipments s join requests r on r.id = s.request_id where s.user_id = $1 and r.po_number <> ''`, [u.id]); const poOf = new Map(po.map((x) => [x.id, x.po_number]))
    if (req.query.format === 'csv') {
      res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="ntemtem-statement-${key}.csv"`)
      return res.send(['Date,Invoice,Shipper,Shipment,PO,Destination,Total,Paid,Balance', ...inv.map((i) => [D(i.issued_at), i.number, i.shipper_name, i.shipment_ref ?? '', poOf.get(i.shipment_id) ?? '', i.destination ? dest(i.destination) : '', num(i.total), num(i.paid), i.balance].map(csvCell).join(','))].join('\n'))
    }
    const tot = inv.reduce((a, i) => a + num(i.total), 0), paid = inv.reduce((a, i) => a + num(i.paid), 0)
    res.set('Content-Type', 'text/html')
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Statement ${key}</title><style>body{font:14px system-ui,sans-serif;color:#14213D;margin:40px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right}h1{margin:0}.muted{color:#5B6578}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right">Print / save as PDF</button><h1>Statement — ${esc(key)}</h1><p class="muted">Ntemtem · generated ${new Date().toDateString()}</p>
<p><b>${esc(me?.company_name || me?.name || '')}</b>${me?.company_name ? `<br>Attn: ${esc(me.name)}` : ''}<br>${esc(me?.email ?? '')}${me?.billing_address ? `<br>${esc(me.billing_address).replace(/\n/g, '<br>')}` : ''}${me?.tax_id ? `<br>Tax ID: ${esc(me.tax_id)}` : ''}</p>
<table><thead><tr><th>Date</th><th>Invoice</th><th>Shipper</th><th>Shipment</th><th>PO</th><th class="n">Total</th><th class="n">Paid</th><th class="n">Balance</th></tr></thead><tbody>
${inv.map((i) => `<tr><td>${D(i.issued_at)}</td><td>${esc(i.number)}</td><td>${esc(i.shipper_name)}</td><td>${esc(i.shipment_ref ?? '')}</td><td>${esc(poOf.get(i.shipment_id) ?? '')}</td><td class="n">${money(num(i.total))}</td><td class="n">${money(num(i.paid))}</td><td class="n">${money(i.balance)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No invoices in this period.</td></tr>'}
</tbody><tfoot><tr><th colspan="5">Totals</th><th class="n">${money(tot)}</th><th class="n">${money(paid)}</th><th class="n">${money(tot - paid)}</th></tr></tfoot></table></body></html>`)
  }))

  /* ---------- 2 · balance, pay all, instalments ---------- */
  r.get('/me/balance', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const inv = await myInvoices(db, u.id); const open = inv.filter((i) => i.balance > 0)
    const today = Date.now()
    const { rows: hist } = await db.query<Row>(`select p.amount, p.method, p.at, i.number, sh.name as shipper_name from payments p join invoices i on i.id = p.invoice_id join clients c on c.id = i.client_id join shippers sh on sh.id = i.shipper_id where c.user_id = $1 order by p.at desc limit 50`, [u.id])
    const { getSettings, stripeMode } = await import('./payments'); const cfg = await getSettings(db)
    res.set('Cache-Control', 'no-store')
    res.json({
      total: Math.round(open.reduce((a, i) => a + i.balance, 0) * 100) / 100, overdue: Math.round(open.filter((i) => i.due_at && ms(D(i.due_at)) < today).reduce((a, i) => a + i.balance, 0) * 100) / 100,
      credit: await creditBalance(db, u.id), online: cfg.enabled && stripeMode() !== 'off',
      invoices: open.map((i) => ({ id: i.id, number: i.number, shipper: i.shipper_name, shipmentRef: i.shipment_ref, total: num(i.total), paid: num(i.paid), balance: i.balance, dueAt: D(i.due_at), overdue: !!i.due_at && ms(D(i.due_at)) < today, plan: J(i.plan), payToken: i.pay_token ?? null })),
      history: hist.map((h) => ({ amount: num(h.amount), method: h.method, at: D(h.at), number: h.number, shipper: h.shipper_name })),
    })
  }))
  const zPay = z.object({ items: z.array(z.object({ invoiceId: z.string().max(60), amountUsd: z.number().min(1).max(1_000_000) })).min(1).max(20), useCredit: z.boolean().default(true) })
  r.post('/me/pay', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const b = zPay.parse(req.body)
    const { getSettings, stripeMode, stripe } = await import('./payments'); const cfg = await getSettings(db)
    if (!cfg.enabled || stripeMode() === 'off') throw new HttpError(409, 'Online payment isn’t available right now — pay your shipper directly.')
    const mine = new Map((await myInvoices(db, u.id)).map((i) => [i.id, i]))
    const rows: { inv: Row; amount: number }[] = []
    for (const it of b.items) { const inv = mine.get(it.invoiceId); if (!inv) throw new HttpError(404, 'Invoice not found.'); if (inv.balance <= 0) throw new HttpError(409, `${inv.number} is already paid.`); if (it.amountUsd > inv.balance + 0.01) throw new HttpError(400, `${inv.number} only has ${money(inv.balance)} left.`); if (it.amountUsd < Math.min(20, inv.balance)) throw new HttpError(400, 'Pay at least $20 at a time.'); rows.push({ inv, amount: Math.round(it.amountUsd * 100) / 100 }) }
    const credit = b.useCredit ? Math.min(await creditBalance(db, u.id), rows.reduce((a, x) => a + x.amount, 0) - 1) : 0
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const group = 'grp_' + uid()
    let left = credit
    const line = (x: { inv: Row; amount: number }) => { const off = Math.min(left, x.amount - 0.5); left -= off; return Math.round((x.amount - off) * 100) }
    const params: Record<string, unknown> = { mode: 'payment', client_reference_id: group, customer_email: u.email, success_url: `${base}/dashboard?tab=money&session={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/dashboard?tab=money&paid=cancel`, 'metadata[group]': group }
    rows.forEach((x, k) => { params[`line_items[${k}][quantity]`] = 1; params[`line_items[${k}][price_data][currency]`] = 'usd'; params[`line_items[${k}][price_data][unit_amount]`] = line(x); params[`line_items[${k}][price_data][product_data][name]`] = `${x.inv.number} — ${x.inv.shipper_name}${x.amount < x.inv.balance ? ' (part payment)' : ''}` })
    const session = await stripe<Row>('/checkout/sessions', params)
    for (const x of rows) await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,invoice_id,items,amount_usd,status,provider,provider_session_id) values ($1,$2,$3,$4,$5,$6,$7,'pending','stripe',$8)`, ['esc_' + uid(), x.inv.shipment_id ?? null, x.inv.shipper_id, u.id, x.inv.id, JSON.stringify([{ kind: 'invoice', label: `Invoice ${x.inv.number}`, amountUsd: x.amount }]), x.amount, session.id])
    if (credit > 0) await db.query(`update credits set used_ref = $2 where user_id = $1 and used_at is null`, [u.id, `pending:${session.id}`])
    res.status(201).json({ url: session.url, sessionId: session.id, charged: Math.round((rows.reduce((a, x) => a + x.amount, 0) - credit) * 100) / 100, credit })
  }))
  r.post('/me/pay/verify', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const sid = String(req.body?.session ?? '')
    const { stripe, markPaid, stripeMode } = await import('./payments'); if (!sid || stripeMode() === 'off') throw new HttpError(400, 'Nothing to verify.')
    const session = await stripe<Row>(`/checkout/sessions/${encodeURIComponent(sid)}`)
    const { rows } = await db.query<Row>(`select * from escrow_payments where provider_session_id = $1 and user_id = $2`, [sid, u.id])
    let paid = 0
    if (session.payment_status === 'paid') for (const p of rows) { if (p.status === 'pending') await markPaid(db, p, { intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, method: 'card' }); paid += num(p.amount_usd) }
    if (session.payment_status === 'paid') await db.query(`update credits set used_at = now(), used_ref = $2 where user_id = $1 and used_ref = $3`, [u.id, sid, `pending:${sid}`])
    else await db.query(`update credits set used_ref = null where user_id = $1 and used_ref = $2`, [u.id, `pending:${sid}`])
    res.json({ paid: session.payment_status === 'paid', amount: paid, invoices: rows.length })
  }))
  r.post('/me/invoices/:id/plan', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const parts = z.object({ parts: z.number().int().min(2).max(4) }).parse(req.body).parts
    const inv = (await myInvoices(db, u.id)).find((i) => i.id === req.params.id); if (!inv) throw new HttpError(404, 'Invoice not found.')
    if (inv.balance < 40) throw new HttpError(400, 'Instalments are for balances over $40.')
    const last = inv.due_at && ms(D(inv.due_at)) > Date.now() + 7 * DAY ? ms(D(inv.due_at)) : Date.now() + 45 * DAY
    const step = (last - Date.now()) / parts; const each = Math.floor((inv.balance / parts) * 100) / 100
    const plan = { createdAt: new Date().toISOString(), parts: Array.from({ length: parts }, (_, k) => ({ due: new Date(Date.now() + step * (k + 1)).toISOString().slice(0, 10), amount: k === parts - 1 ? Math.round((inv.balance - each * (parts - 1)) * 100) / 100 : each })) }
    await db.query('update invoices set plan = $2 where id = $1', [inv.id, JSON.stringify(plan)])
    await notifyShipperStaff(db, inv.shipper_id, { kind: 'payment', title: `${inv.number}: client is paying in ${parts} instalments`, body: plan.parts.map((p) => `${money(p.amount)} by ${p.due}`).join(' · '), link: `/dashboard/invoices/${inv.id}` }, ['owner', 'finance'])
    res.json({ plan })
  }))
  r.delete('/me/invoices/:id/plan', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const inv = (await myInvoices(db, u.id)).find((i) => i.id === req.params.id); if (!inv) throw new HttpError(404, 'Invoice not found.'); await db.query('update invoices set plan = null where id = $1', [inv.id]); res.json({ ok: true }) }))

  /* ---------- 3 · calendar ---------- */
  r.get('/me/calendar', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30)); const until = Date.now() + days * DAY; const from = Date.now() - DAY
    const ev: { date: string; kind: string; title: string; body: string; link: string }[] = []
    const add = (date: unknown, kind: string, title: string, body: string, link: string) => { const t = ms(D(date)); if (t >= from && t <= until) ev.push({ date: D(date)!, kind, title, body, link }) }
    const { rows: pk } = await db.query<Row>(`select p.pickup_date, p.window_start, p.window_end, p.status, s.ref, s.id from pickup_requests p join shipments s on s.id = p.shipment_id where s.user_id = $1 and p.status in ('requested','confirmed')`, [u.id])
    for (const p of pk) add(p.pickup_date, 'pickup', `Pickup ${p.ref}`, `${p.window_start}–${p.window_end} · ${p.status}`, `/dashboard?tab=shipments&s=${p.id}`)
    const { rows: sh } = await db.query<Row>(`select s.id, s.ref, s.status, s.eta, s.destination, s.handover, c.cutoff_date, c.etd from shipments s left join containers c on c.id = s.container_id where s.user_id = $1 and s.status <> 'delivered' and s.cancelled_at is null`, [u.id])
    for (const s of sh) {
      if (s.eta) add(s.eta, 'arrival', `${s.ref} arrives in ${dest(s.destination)}`, statusLabels[s.status as ShipmentStatus] ?? s.status, `/dashboard?tab=shipments&s=${s.id}`)
      if (s.cutoff_date && ['booked', 'picked_up'].includes(s.status)) add(s.cutoff_date, 'cutoff', `Container cutoff for ${s.ref}`, 'Goods must be at the warehouse by now to make this sailing.', `/dashboard?tab=shipments&s=${s.id}`)
      if (s.status === 'ready_for_collection') add(new Date(), 'collection', `${s.ref} is ready to collect`, 'Your recipient needs the 6-digit code and a photo ID.', `/dashboard?tab=shipments&s=${s.id}`)
    }
    for (const i of (await myInvoices(db, u.id)).filter((x) => x.balance > 0)) {
      const plan = J(i.plan); if (plan?.parts?.length) { let cum = 0; for (const [k, p] of plan.parts.entries()) { cum += num(p.amount); if (num(i.paid) < cum - 0.5) add(p.due, 'payment', `Instalment ${k + 1}: ${money(num(p.amount))} — ${i.number}`, i.shipper_name, '/dashboard?tab=money') } }
      else if (i.due_at) add(i.due_at, 'payment', `${money(i.balance)} due — ${i.number}`, i.shipper_name, '/dashboard?tab=money')
    }
    const { rows: gs } = await db.query<Row>(`select g.title, g.closes_at, g.departs_at, sp.status from groupage_spots sp join groupages g on g.id = sp.groupage_id where sp.user_id = $1 and sp.status not in ('cancelled')`, [u.id])
    for (const g of gs) { add(g.closes_at, 'cutoff', `Shared space closes: ${g.title}`, 'Drop off or be ready for pickup before this date.', '/dashboard?tab=groupage'); add(g.departs_at, 'departure', `Departs: ${g.title}`, '', '/dashboard?tab=groupage') }
    const { rows: rp } = await db.query<Row>(`select id, name, next_on from repeat_plans where user_id = $1 and active`, [u.id])
    for (const p of rp) add(p.next_on, 'repeat', `Repeat: ${p.name}`, 'Tap to post the request with the same details.', `/dashboard?tab=plans&repeat=${p.id}`)
    ev.sort((a, b) => a.date.localeCompare(b.date))
    res.json({ days, events: ev })
  }))

  /* ---------- 4 · timeline ---------- */
  r.get('/me/shipments/:id/timeline', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const { s } = await ownShipment(db, u, String(req.params.id), HttpError)
    const { rows: ev } = await db.query<Row>('select status, at, place, note from shipment_events where shipment_id = $1 order by at', [s.id])
    const etaChanges = ev.filter((e) => /^New arrival date/.test(e.note ?? '')).map((e) => { const m = String(e.note).match(/New arrival date (.+?)(?: \(was (.+?)\))? — (.+)\.?$/); return { at: ISO(e.at), to: m?.[1] ?? null, from: m?.[2] ?? null, reason: m?.[3]?.replace(/\.$/, '') ?? '' } })
    const slip = s.eta_original && s.eta ? Math.round((ms(D(s.eta)) - ms(D(s.eta_original))) / DAY) : 0
    res.json({ next: nextStep(s), eta: D(s.eta), etaOriginal: D(s.eta_original), slipDays: slip, etaChanges })
  }))

  /* ---------- 5 · packing list ---------- */
  r.get('/items/restricted', wrap(async (req, res) => { const d0 = String(req.query.destination ?? 'GH'); res.json({ destination: d0, rules: [...(BY_DEST[d0] ?? []), ...COMMON].map((x) => ({ level: x.level, note: x.note })) }) }))
  r.get('/shipments/:id/items', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const { s, office } = await ownShipment(db, u, String(req.params.id), HttpError)
    const { rows } = await db.query<Row>('select * from shipment_items where shipment_id = $1 order by piece nulls last, created_at', [s.id])
    const items = rows.map((i) => itemOut(i, s.destination))
    res.json({ items, totalValueUsd: Math.round(items.reduce((a, i) => a + i.valueUsd * i.qty, 0)), flags: items.filter((i) => i.flag).length, canEdit: office || ['booked', 'picked_up'].includes(s.status), categories: ITEM_CATEGORIES })
  }))
  r.post('/shipments/:id/items', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const { s, office } = await ownShipment(db, u, String(req.params.id), HttpError)
    if (!office && !['booked', 'picked_up'].includes(s.status)) throw new HttpError(409, 'The packing list is locked once goods leave the warehouse — message your shipper to change it.')
    const list = z.array(zItem).min(1).max(100).parse(Array.isArray(req.body?.items) ? req.body.items : [req.body])
    const { rows: [c] } = await db.query<Row>('select count(*)::int as n from shipment_items where shipment_id = $1', [s.id]); if (Number(c.n) + list.length > 300) throw new HttpError(409, 'Up to 300 lines per shipment.')
    for (const b of list) await db.query('insert into shipment_items (id,shipment_id,piece,description,category,qty,value_usd,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['it_' + uid(), s.id, b.piece ?? null, b.description, b.category, b.qty, b.valueUsd, u.actingBy?.name ?? u.name])
    const booking = await syncItemTotals(db, s.id)
    const flagged = list.map((b) => ({ d: b.description, f: checkItem(b.description, s.destination) })).filter((x) => x.f?.level === 'banned')
    if (!office && flagged.length) await notifyShipperStaff(db, s.shipper_id, { kind: 'document', title: `${s.ref}: packing list has a prohibited item`, body: flagged.map((x) => `“${x.d}” — ${x.f!.note}`).join(' '), link: `/dashboard/shipments?q=${s.ref}&b=all` }, ['owner', 'dispatcher'])
    res.status(201).json({ ok: true, declaredValueUsd: booking.declaredValueUsd, itemsValueUsd: booking.itemsValueUsd, flagged: flagged.length })
  }))
  r.patch('/shipment-items/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows: [it] } = await db.query<Row>('select * from shipment_items where id = $1', [req.params.id]); if (!it) throw new HttpError(404, 'Item not found.')
    const { s, office } = await ownShipment(db, u, it.shipment_id, HttpError); if (!office && !['booked', 'picked_up'].includes(s.status)) throw new HttpError(409, 'The packing list is locked.')
    const b = zItem.partial().parse(req.body)
    await db.query('update shipment_items set description = coalesce($2, description), category = coalesce($3, category), qty = coalesce($4, qty), value_usd = coalesce($5, value_usd), piece = coalesce($6, piece) where id = $1', [it.id, b.description ?? null, b.category ?? null, b.qty ?? null, b.valueUsd ?? null, b.piece ?? null])
    await syncItemTotals(db, s.id); res.json({ ok: true })
  }))
  r.delete('/shipment-items/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows: [it] } = await db.query<Row>('select * from shipment_items where id = $1', [req.params.id]); if (!it) throw new HttpError(404, 'Item not found.')
    const { s, office } = await ownShipment(db, u, it.shipment_id, HttpError); if (!office && !['booked', 'picked_up'].includes(s.status)) throw new HttpError(409, 'The packing list is locked.')
    await db.query('delete from shipment_items where id = $1', [it.id]); await syncItemTotals(db, s.id); res.json({ ok: true })
  }))

  /* ---------- 6 · documents wallet ---------- */
  const myDocs = async (db: Db, userId: string) => (await db.query<Row>(`select d.id, d.kind, d.title, d.filename, d.mime, d.size, d.source, d.share_token, d.created_at, s.ref, s.id as shipment_id, sh.name as shipper_name from documents d join shipments s on s.id = d.shipment_id join shippers sh on sh.id = d.shipper_id where s.user_id = $1 and d.visibility = 'shared' order by d.created_at desc`, [userId])).rows
  r.get('/me/documents', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const docs = await myDocs(db, u.id); const inv = await myInvoices(db, u.id)
    res.json({ documents: docs.map((x) => ({ id: x.id, kind: x.kind, title: x.title, filename: x.filename, mime: x.mime, size: Number(x.size ?? 0), generated: x.source === 'generated', createdAt: ISO(x.created_at), shipmentRef: x.ref, shipmentId: x.shipment_id, shipper: x.shipper_name })), invoices: inv.map((i) => ({ id: i.id, number: i.number, shipper: i.shipper_name, shipmentRef: i.shipment_ref, total: num(i.total), balance: i.balance, issuedAt: D(i.issued_at), payToken: i.pay_token ?? null })) })
  }))
  r.get('/me/documents.zip', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const docs = await myDocs(db, u.id); const files: { name: string; data: Buffer }[] = []; const links: string[] = []
    for (const x of docs) {
      if (x.source === 'generated' || !x.filename) {
        let token = x.share_token; if (!token) { token = randomBytes(12).toString('base64url'); await db.query('update documents set share_token = $2 where id = $1', [x.id, token]) }
        links.push(`<li>${esc(x.ref)} · ${esc(x.title)} — <a href="${appUrl()}/doc/${token}">open</a></li>`)
      } else {
        const { rows: [f] } = await db.query<Row>('select data from documents where id = $1', [x.id]); const b64 = String(f?.data ?? '').replace(/^data:[^,]*,/, '')
        if (b64) files.push({ name: `${x.ref}/${x.filename}`, data: Buffer.from(b64, 'base64') })
      }
    }
    const inv = await myInvoices(db, u.id)
    const index = `<!doctype html><meta charset="utf-8"><title>Your Ntemtem documents</title><body style="font:14px system-ui;margin:32px"><h1>Your Ntemtem documents</h1><p>Downloaded ${new Date().toDateString()}.</p><h2>Generated documents</h2><ul>${links.join('') || '<li>None</li>'}</ul><h2>Invoices</h2><ul>${inv.map((i) => `<li>${esc(i.number)} · ${esc(i.shipper_name)} · ${money(num(i.total))}${i.pay_token ? ` — <a href="${appUrl()}/pay/${i.pay_token}">view</a>` : ''}</li>`).join('') || '<li>None</li>'}</ul></body>`
    files.unshift({ name: 'index.html', data: Buffer.from(index) })
    res.set('Content-Type', 'application/zip'); res.set('Content-Disposition', 'attachment; filename="ntemtem-documents.zip"'); res.send(zip(files))
  }))

  /* ---------- 7 · share with family ---------- */
  r.get('/me/shipments/:id/family', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const { s } = await ownShipment(db, u, String(req.params.id), HttpError)
    const { ensureReceiverToken, receiverUrl } = await import('./recipient'); const token = await ensureReceiverToken(db, s); const link = receiverUrl(token)
    const { consigneeOf } = await import('./recipient'); const c = (await consigneeOf(db, s)) as Row | null
    const { rows: [rc] } = await db.query<Row>('select name, note, all_good, created_at from recipient_receipts where shipment_id = $1 order by created_at desc limit 1', [s.id])
    const { rows: [sh] } = await db.query<Row>('select name from shippers where id = $1', [s.shipper_id])
    const code = s.status === 'ready_for_collection' ? s.collection_code ?? null : null
    const text = `Hi${c?.name ? ` ${String(c.name).split(' ')[0]}` : ''}, I’m sending you a shipment with ${sh?.name ?? 'Ntemtem'} (${s.ref}). Follow it here: ${link}${code ? `\nIt’s ready to collect — your code is ${code}. Bring a photo ID.` : ''}`
    const phone = c?.phone ? (normalisePhone(c.phone, s.destination) ?? c.phone) : null
    res.json({ link, code, recipient: c ? { name: c.name, phone } : null, text, whatsapp: `https://wa.me/${phone ? String(phone).replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`, receipt: rc ? { name: rc.name, note: rc.note, allGood: !!rc.all_good, at: ISO(rc.created_at) } : null })
  }))

  /* ---------- 8 · duty ---------- */
  r.get('/me/shipments/:id/duty', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const { s } = await ownShipment(db, u, String(req.params.id), HttpError)
    const { rows: items } = await db.query<Row>('select * from shipment_items where shipment_id = $1', [s.id])
    const { rows: [inv] } = await db.query<Row>(`select coalesce(sum(total),0)::float as t from invoices where shipment_id = $1 and status not in ('void','draft')`, [s.id])
    const value = items.length ? items.reduce((a, i) => a + num(i.value_usd) * num(i.qty), 0) : num(J(s.booking)?.declaredValueUsd)
    const confirmed = J(s.duty)?.confirmed ?? null
    res.json({ estimate: await dutyPreview(db, { destination: s.destination, cargo: s.cargo, valueUsd: value, freightUsd: num(inv?.t), items }), confirmed, valueUsd: Math.round(value), supported: ['GH', 'NG'].includes(s.destination) })
  }))
  r.post('/me/duty-preview', wrap(async (req, res) => {
    const db = await getDb(); await requireUser(db, req)
    const b = z.object({ destination: z.string().length(2), cargo: z.string().max(40), valueUsd: z.number().min(0).max(5_000_000), freightUsd: z.number().min(0).max(1_000_000).default(0) }).parse(req.body)
    res.json({ estimate: await dutyPreview(db, b) })
  }))

  /* ---------- 9 · favourites ---------- */
  r.get('/me/favorites', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const { rows } = await db.query<Row>(`select f.shipper_id, f.at, s.name, s.rating, s.reviews, s.verified, s.initials, s.hue, s.destinations, (select count(*) from shipments x where x.shipper_id = s.id and x.user_id = $1)::int as shipments, (select max(created_at) from shipments x where x.shipper_id = s.id and x.user_id = $1) as last_at from favorites f join shippers s on s.id = f.shipper_id where f.user_id = $1 order by f.at desc`, [u.id])
    const { rows: past } = await db.query<Row>(`select s.id, s.name, count(*)::int as n, max(x.created_at) as last_at from shipments x join shippers s on s.id = x.shipper_id where x.user_id = $1 and x.cancelled_at is null group by s.id, s.name order by n desc limit 6`, [u.id])
    res.json({ favorites: rows.map((x) => ({ shipperId: x.shipper_id, name: x.name, rating: Number(x.rating), reviews: x.reviews, verified: !!x.verified, initials: x.initials, hue: x.hue, destinations: J(x.destinations), shipments: x.shipments, lastAt: ISO(x.last_at) })), usedBefore: past.filter((p) => !rows.some((f) => f.shipper_id === p.id)).map((p) => ({ shipperId: p.id, name: p.name, shipments: p.n, lastAt: ISO(p.last_at) })) })
  }))
  r.put('/me/favorites/:shipperId', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const { rows } = await db.query('select 1 from shippers where id = $1', [req.params.shipperId]); if (!rows[0]) throw new HttpError(404, 'Shipper not found.'); await db.query('insert into favorites (user_id,shipper_id) values ($1,$2) on conflict do nothing', [u.id, req.params.shipperId]); res.json({ ok: true }) }))
  r.delete('/me/favorites/:shipperId', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); await db.query('delete from favorites where user_id = $1 and shipper_id = $2', [u.id, req.params.shipperId]); res.json({ ok: true }) }))

  /* ---------- 10 · repeat shipments ---------- */
  const repOut = (p: Row) => ({ id: p.id, name: p.name, everyDays: p.every_days, nextOn: D(p.next_on), template: J(p.template), active: !!p.active, lastRequestId: p.last_request_id })
  r.get('/me/repeats', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const { rows } = await db.query<Row>('select * from repeat_plans where user_id = $1 order by next_on', [u.id]); res.json({ repeats: rows.map(repOut) }) }))
  r.post('/me/repeats', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const b = z.object({ name: z.string().trim().min(2).max(60), everyDays: z.number().int().min(7).max(365), nextOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fromRequestId: z.string().max(60).optional(), template: zTemplate.optional() }).parse(req.body)
    let t = b.template
    if (b.fromRequestId) { const { rows: [rq] } = await db.query<Row>('select * from requests where id = $1 and user_id = $2', [b.fromRequestId, u.id]); if (!rq) throw new HttpError(404, 'Request not found.'); const won = (await db.query<Row>(`select shipper_id from quotes where request_id = $1 and status = 'accepted'`, [rq.id])).rows[0]; t = { origin: rq.origin, destination: rq.destination, mode: rq.mode, cargo: rq.cargo, quantity: rq.quantity, description: rq.description, pickup: rq.pickup, delivery: rq.delivery, insurance: rq.insurance, preferredShipperId: won?.shipper_id ?? rq.preferred_shipper_id ?? null, consignee: J(rq.consignee) } }
    if (!t) throw new HttpError(400, 'Pick a past request or give the details.')
    const { rows: [n] } = await db.query<Row>('select count(*)::int as n from repeat_plans where user_id = $1 and active', [u.id]); if (Number(n.n) >= 10) throw new HttpError(409, 'Up to 10 repeat plans.')
    const id = 'rp_' + uid(); await db.query('insert into repeat_plans (id,user_id,name,every_days,next_on,template) values ($1,$2,$3,$4,$5,$6)', [id, u.id, b.name, b.everyDays, b.nextOn, JSON.stringify(t)])
    const { rows } = await db.query<Row>('select * from repeat_plans where id = $1', [id]); res.status(201).json({ repeat: repOut(rows[0]) })
  }))
  r.patch('/me/repeats/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const b = z.object({ name: z.string().trim().min(2).max(60).optional(), everyDays: z.number().int().min(7).max(365).optional(), nextOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), active: z.boolean().optional() }).parse(req.body)
    const { rows } = await db.query<Row>('update repeat_plans set name = coalesce($3, name), every_days = coalesce($4, every_days), next_on = coalesce($5::date, next_on), active = coalesce($6, active) where id = $1 and user_id = $2 returning *', [req.params.id, u.id, b.name ?? null, b.everyDays ?? null, b.nextOn ?? null, b.active ?? null])
    if (!rows[0]) throw new HttpError(404, 'Plan not found.'); res.json({ repeat: repOut(rows[0]) })
  }))
  r.delete('/me/repeats/:id', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); await db.query('delete from repeat_plans where id = $1 and user_id = $2', [req.params.id, u.id]); res.json({ ok: true }) }))
  r.post('/me/repeats/:id/post', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const { rows: [p] } = await db.query<Row>('select * from repeat_plans where id = $1 and user_id = $2', [req.params.id, u.id]); if (!p) throw new HttpError(404, 'Plan not found.')
    const t = J(p.template); const { rows: [me] } = await db.query<Row>('select name, email from users where id = $1', [u.id])
    const { rows: [lastPhone] } = await db.query<Row>('select contact_phone from requests where user_id = $1 order by created_at desc limit 1', [u.id])
    const ready = new Date(Math.max(Date.now() + 2 * DAY, ms(D(p.next_on)))).toISOString().slice(0, 10)
    // Post through the normal request route so matching, instant quotes and alerts all run.
    const r0 = await fetch(`http://127.0.0.1:${req.socket.localPort}/api/requests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: String(req.headers.cookie ?? '') }, body: JSON.stringify({ ...t, quantity: Number(t.quantity) || 1, readyDate: ready, contact: { name: me.name, email: me.email, phone: lastPhone?.contact_phone || '+10000000000' }, ...(t.preferredShipperId ? { preferredShipperId: t.preferredShipperId, source: 'picked' } : {}), consignee: t.consignee ?? undefined }) })
    const j = await r0.json().catch(() => ({})) as Row
    if (!r0.ok) throw new HttpError(r0.status, j.error ?? 'Could not post the request.')
    await db.query('update repeat_plans set last_request_id = $2, next_on = next_on + every_days, last_reminded_on = null where id = $1', [p.id, j.request?.id ?? null])
    res.status(201).json({ request: j.request })
  }))

  /* ---------- 11 · alerts ---------- */
  const alertOut = (a: Row) => ({ id: a.id, kind: a.kind, origin: a.origin, destination: a.destination, mode: a.mode, cargo: a.cargo, thresholdUsd: a.threshold_usd == null ? null : num(a.threshold_usd), active: !!a.active, lastValue: a.last_value == null ? null : num(a.last_value), lastSentAt: ISO(a.last_sent_at) })
  r.get('/me/alerts', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const { rows } = await db.query<Row>('select * from alerts where user_id = $1 order by created_at desc', [u.id]); res.json({ alerts: rows.map(alertOut) }) }))
  r.post('/me/alerts', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const b = z.object({ kind: z.enum(['price', 'groupage', 'cutoff']), origin: z.string().max(80).default(''), destination: z.string().length(2), mode: z.enum(['ocean', 'air']).default('ocean'), cargo: z.string().max(40).default(''), thresholdUsd: z.number().min(1).max(1_000_000).nullable().optional() }).parse(req.body)
    const { rows: [n] } = await db.query<Row>('select count(*)::int as n from alerts where user_id = $1', [u.id]); if (Number(n.n) >= 20) throw new HttpError(409, 'Up to 20 alerts.')
    const id = 'al_' + uid(); await db.query('insert into alerts (id,user_id,kind,origin,destination,mode,cargo,threshold_usd) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, u.id, b.kind, b.origin, b.destination, b.mode, b.cargo, b.thresholdUsd ?? null])
    const { rows } = await db.query<Row>('select * from alerts where id = $1', [id]); res.status(201).json({ alert: alertOut(rows[0]) })
  }))
  r.delete('/me/alerts/:id', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); await db.query('delete from alerts where id = $1 and user_id = $2', [req.params.id, u.id]); res.json({ ok: true }) }))

  /* ---------- 12 · inbox & shipment messages ---------- */
  r.get('/me/inbox', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const { rows: pre } = await db.query<Row>(`select m.request_id, m.shipper_id, r.ref, sh.name as shipper_name, max(m.created_at) as last_at, count(*) filter (where m.author_role = 'shipper' and m.read_at is null)::int as unread, (array_agg(m.body order by m.created_at desc))[1] as last_body from request_messages m join requests r on r.id = m.request_id join shippers sh on sh.id = m.shipper_id where r.user_id = $1 group by m.request_id, m.shipper_id, r.ref, sh.name`, [u.id])
    const { rows: post } = await db.query<Row>(`select m.shipment_id, s.ref, sh.name as shipper_name, max(m.created_at) as last_at, count(*) filter (where m.author_role = 'office' and not m.read_by_customer)::int as unread, (array_agg(m.body order by m.created_at desc))[1] as last_body from shipment_messages m join shipments s on s.id = m.shipment_id join shippers sh on sh.id = s.shipper_id where s.user_id = $1 group by m.shipment_id, s.ref, sh.name`, [u.id])
    const threads = [...pre.map((x) => ({ kind: 'request' as const, id: `${x.request_id}:${x.shipper_id}`, requestId: x.request_id, shipperId: x.shipper_id, ref: x.ref, shipper: x.shipper_name, lastAt: ISO(x.last_at), unread: x.unread, last: String(x.last_body ?? '').slice(0, 140) })), ...post.map((x) => ({ kind: 'shipment' as const, id: x.shipment_id, shipmentId: x.shipment_id, ref: x.ref, shipper: x.shipper_name, lastAt: ISO(x.last_at), unread: x.unread, last: String(x.last_body ?? '').slice(0, 140) }))].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
    res.json({ threads, unread: threads.reduce((a, t) => a + t.unread, 0) })
  }))
  r.get('/shipments/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const { s, office } = await ownShipment(db, u, String(req.params.id), HttpError)
    const { rows } = await db.query<Row>('select * from shipment_messages where shipment_id = $1 order by created_at', [s.id])
    await db.query(`update shipment_messages set ${office ? 'read_by_office' : 'read_by_customer'} = true where shipment_id = $1 and author_role = $2`, [s.id, office ? 'customer' : 'office'])
    res.json({ messages: rows.map((m) => ({ id: m.id, role: m.author_role, author: m.author_name, body: m.body, photo: m.photo ?? null, at: ISO(m.created_at), mine: (m.author_role === 'office') === office })) })
  }))
  r.post('/shipments/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const { s, office } = await ownShipment(db, u, String(req.params.id), HttpError)
    const b = z.object({ body: z.string().trim().min(1).max(2000), photo: z.string().max(2_800_000).regex(/^data:image\/(png|jpe?g|webp);base64,/).optional() }).parse(req.body)
    const id = 'sm_' + uid(); const name = office ? `${u.name} · ${u.company ?? 'Shipper'}` : u.actingBy?.name ?? u.name
    await db.query('insert into shipment_messages (id,shipment_id,author_role,author_name,body,photo) values ($1,$2,$3,$4,$5,$6)', [id, s.id, office ? 'office' : 'customer', name, b.body, b.photo ?? null])
    if (office && s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `Message about ${s.ref}`, body: b.body.slice(0, 200), link: `/dashboard?tab=inbox&s=${s.id}`, dedupe: `sm:${id}` })
    if (!office) await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.customer} wrote about ${s.ref}`, body: b.body.slice(0, 200), link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `sm:${id}` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json({ id })
  }))

  /* ---------- 13 · issues ---------- */
  r.get('/me/issues', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const { rows } = await db.query<Row>(`select d.*, s.ref, sh.name as shipper_name from disputes d join shipments s on s.id = d.shipment_id join shippers sh on sh.id = d.shipper_id where s.user_id = $1 order by (d.status = 'open') desc, d.updated_at desc`, [u.id])
    const { DISPUTE_REASONS } = await import('./reviews')
    res.json({ issues: rows.map((x) => ({ id: x.id, shipmentId: x.shipment_id, ref: x.ref, shipper: x.shipper_name, reason: x.reason, reasonLabel: (DISPUTE_REASONS as Record<string, string>)[x.reason] ?? x.reason, status: x.status, description: x.description, amountClaimedUsd: x.amount_claimed_usd == null ? null : num(x.amount_claimed_usd), messages: J(x.messages) ?? [], photos: J(x.photos) ?? [], resolution: J(x.resolution), createdAt: ISO(x.created_at), updatedAt: ISO(x.updated_at) })) })
  }))

  /* ---------- 14 · notification channels ---------- */
  r.get('/me/notify-prefs', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows: [p] } = await db.query<Row>('select * from notification_prefs where user_id = $1', [u.id])
    const { kindsFor, kindLabels } = await import('./notify')
    res.json({ email: p ? !!p.email : true, muted: J(p?.muted) ?? [], phone: p?.phone ?? '', textChannel: p?.text_channel ?? 'off', textKinds: J(p?.text_kinds) ?? [], quietStart: p?.quiet_start ?? null, quietEnd: p?.quiet_end ?? null, tzOffset: p?.tz_offset ?? 0, kinds: kindsFor(u.role).map((k) => ({ key: k, label: kindLabels[k] })) })
  }))
  r.put('/me/notify-prefs', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const b = z.object({ email: z.boolean(), muted: z.array(z.string().max(40)).max(30), phone: z.string().trim().max(30), textChannel: z.enum(['off', 'sms', 'whatsapp']), textKinds: z.array(z.string().max(40)).max(30), quietStart: z.number().int().min(0).max(23).nullable(), quietEnd: z.number().int().min(0).max(23).nullable(), tzOffset: z.number().int().min(-720).max(840) }).parse(req.body)
    if (b.textChannel !== 'off' && !/\d{7,}/.test(b.phone.replace(/\D/g, ''))) throw new HttpError(400, 'Add a mobile number for text alerts.')
    await db.query(`insert into notification_prefs (user_id,email,muted,phone,text_channel,text_kinds,quiet_start,quiet_end,tz_offset,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) on conflict (user_id) do update set email = $2, muted = $3, phone = $4, text_channel = $5, text_kinds = $6, quiet_start = $7, quiet_end = $8, tz_offset = $9, updated_at = now()`, [u.id, b.email, JSON.stringify(b.muted), b.phone, b.textChannel, JSON.stringify(b.textKinds), b.quietStart, b.quietEnd, b.tzOffset])
    res.json({ ok: true })
  }))

  /* ---------- 15 · referrals ---------- */
  r.get('/me/referral', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const code = await codeFor(db, u.id)
    const { rows: refs } = await db.query<Row>(`select u.name, u.created_at, exists (select 1 from credits c where c.source_user_id = u.id and c.reason = 'referral') as earned from users u where u.referred_by = $1 order by u.created_at desc`, [u.id])
    const { rows: cr } = await db.query<Row>('select amount_usd, reason, used_at, created_at from credits where user_id = $1 order by created_at desc', [u.id])
    res.json({ code, link: `${appUrl()}/signup?ref=${code}`, creditUsd: CREDIT_USD(), available: await creditBalance(db, u.id), referred: refs.map((x) => ({ name: String(x.name).split(' ')[0], joinedAt: ISO(x.created_at), earned: !!x.earned })), credits: cr.map((c) => ({ amount: num(c.amount_usd), reason: c.reason, usedAt: ISO(c.used_at), at: ISO(c.created_at) })) })
  }))

  /* ---------- 16 · household / business accounts ---------- */
  r.get('/me/accounts', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'customer') throw new HttpError(403, 'Customer accounts only.')
    const self = u.actingBy?.id ?? u.id
    const { rows: mine } = await db.query<Row>(`select am.*, m.name as member_name from account_members am left join users m on m.id = am.member_id where am.owner_id = $1 order by am.created_at`, [u.actingBy ? u.id : self])
    const { rows: shared } = await db.query<Row>(`select am.owner_id, o.name, o.company_name, am.role from account_members am join users o on o.id = am.owner_id where am.member_id = $1 and am.status = 'active'`, [self])
    res.json({ actingAs: u.actingBy ? { id: u.id, name: u.name } : null, me: u.actingBy ?? { id: u.id, name: u.name, email: u.email }, members: u.actingBy ? [] : mine.map((m) => ({ id: m.id, email: m.email, name: m.member_name ?? null, role: m.role, status: m.status })), shared: shared.map((s) => ({ ownerId: s.owner_id, name: s.company_name || s.name, role: s.role })) })
  }))
  r.post('/me/members', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); if (u.actingBy) throw new HttpError(403, 'Only the account owner can invite people.')
    const b = z.object({ email: z.string().trim().email(), role: z.enum(['member', 'admin']).default('member') }).parse(req.body); const email = b.email.toLowerCase()
    if (email === u.email.toLowerCase()) throw new HttpError(400, 'That’s you.')
    const { rows: [n] } = await db.query<Row>('select count(*)::int as n from account_members where owner_id = $1', [u.id]); if (Number(n.n) >= 10) throw new HttpError(409, 'Up to 10 people per account.')
    const { rows: dup } = await db.query('select 1 from account_members where owner_id = $1 and email = $2', [u.id, email]); if (dup.length) throw new HttpError(409, 'Already invited.')
    const token = randomBytes(18).toString('base64url'); const { rows: [ex] } = await db.query<Row>(`select id from users where email = $1 and role = 'customer'`, [email])
    await db.query('insert into account_members (id,owner_id,member_id,email,role,token,status) values ($1,$2,$3,$4,$5,$6,$7)', ['am_' + uid(), u.id, null, email, b.role, token, 'invited'])
    const link = `${appUrl()}/dashboard?tab=account&invite=${token}`
    await sendEmail(email, `${u.name} invited you to their Ntemtem account`, emailTemplate({ title: `Join ${u.name}’s Ntemtem account`, body: `${esc(u.name)} added you so you can book, pay and track their shipments. ${ex ? 'Sign in and accept the invite.' : 'Create a free account with this email, then accept the invite.'}`, link, cta: 'Accept invite' })).catch(() => {})
    if (ex) await notify(db, { userId: ex.id, kind: 'system', title: `${u.name} invited you to their account`, body: 'Accept it to book and track shipments on their behalf.', link: `/dashboard?tab=account&invite=${token}` })
    res.status(201).json({ ok: true, link })
  }))
  r.delete('/me/members/:id', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); if (u.actingBy) throw new HttpError(403, 'Only the account owner can remove people.'); await db.query('delete from account_members where id = $1 and owner_id = $2', [req.params.id, u.id]); res.json({ ok: true }) }))
  r.post('/me/accounts/accept', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const self = u.actingBy ?? { id: u.id, email: u.email }
    const { rows: [inv] } = await db.query<Row>(`select * from account_members where token = $1 and status = 'invited'`, [String(req.body?.token ?? '')]); if (!inv) throw new HttpError(404, 'This invite isn’t valid any more.')
    if (inv.email !== self.email.toLowerCase()) throw new HttpError(403, `This invite is for ${inv.email}. Sign in with that email.`)
    await db.query(`update account_members set member_id = $2, status = 'active', token = null where id = $1`, [inv.id, self.id])
    res.json({ ok: true, ownerId: inv.owner_id })
  }))
  r.post('/me/accounts/switch', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const self = u.actingBy?.id ?? u.id; const owner = req.body?.ownerId ? String(req.body.ownerId) : null
    if (owner) { const { rows } = await db.query(`select 1 from account_members where owner_id = $1 and member_id = $2 and status = 'active'`, [owner, self]); if (!rows.length) throw new HttpError(403, 'You’re not a member of that account.') }
    await db.query('update sessions set acting_as = $2 where id = $1', [req.cookies?.ss_session ?? '', owner])
    res.json({ ok: true })
  }))
  r.get('/me/business', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const { rows: [b] } = await db.query<Row>('select company_name, tax_id, billing_address, po_required from users where id = $1', [u.id]); res.json({ companyName: b?.company_name ?? '', taxId: b?.tax_id ?? '', billingAddress: b?.billing_address ?? '', poRequired: !!b?.po_required }) }))
  r.put('/me/business', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); if (u.actingBy) throw new HttpError(403, 'Only the account owner can change this.')
    const b = z.object({ companyName: z.string().trim().max(120), taxId: z.string().trim().max(40), billingAddress: z.string().trim().max(400), poRequired: z.boolean() }).parse(req.body)
    await db.query('update users set company_name = $2, tax_id = $3, billing_address = $4, po_required = $5 where id = $1', [u.id, b.companyName, b.taxId, b.billingAddress, b.poRequired])
    if (b.companyName) await db.query(`update clients set company = $2 where user_id = $1 and company = ''`, [u.id, b.companyName])
    res.json({ ok: true })
  }))
}
