/**
 * WhatsApp assistant — answers the messages people send to Ntemtem's WhatsApp number.
 *
 *   Who: the sender is matched by phone to customers (request contact / client record) and receivers (consignee).
 *   What it can do on its own, always from live data (never made up):
 *     "where is my package" / a reference  → status, ETA and the tracking link of their shipments
 *     "how much do I owe"                  → what's due and the pay link
 *     "I want to send 3 barrels to Kumasi" → a quote link pre-filled with what they said
 *     "agent" / anything it can't handle   → hands over: the shipper's team (or Ntemtem support) answers in the inbox
 *   Replies in French for francophone numbers or messages. With ANTHROPIC_API_KEY set, Claude reads free-form
 *   messages to pick the intent and pull out booking details (ASSISTANT_MODEL, default claude-haiku-5-5); without
 *   it, keyword rules do the same job less flexibly. Facts in replies always come from the database.
 *
 *   Inbound: Twilio  POST /api/assistant/twilio (form-encoded, X-Twilio-Signature checked with TWILIO_AUTH_TOKEN,
 *                    reply as TwiML) · Meta WhatsApp Cloud GET/POST /api/assistant/meta (WHATSAPP_VERIFY_TOKEN,
 *                    X-Hub-Signature-256 with WHATSAPP_APP_SECRET, reply through sendText).
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notifyShipperStaff } from './notify'
import { sendText } from './sms'
import { logAuto } from './autopilot'
import { countryByCode, statusLabels, type ShipmentStatus } from '../src/lib/data'
import { STATUS_FR } from '../src/lib/receiverText'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const app = () => (process.env.APP_URL || 'https://ntemtem.com').replace(/\/$/, '')
const digits = (p: string) => String(p ?? '').replace(/\D/g, '')
const tail = (p: string) => digits(p).slice(-9)
type Lang = 'en' | 'fr'
const FR_PREFIX = ['228', '225', '221', '229', '237', '226', '223', '224', '241', '242', '243', '227', '235', '236', '261', '509', '33', '32']
const langFor = (phone: string, text: string): Lang => (FR_PREFIX.some((p) => digits(phone).startsWith(p)) || /\b(bonjour|bonsoir|colis|où|combien|merci|envoyer|svp|payer)\b/i.test(text) ? 'fr' : 'en')

export type Intent = 'greeting' | 'status' | 'payment' | 'booking' | 'human' | 'thanks' | 'other'
export interface Booking { origin?: string; destination?: string; cargo?: string; quantity?: number; notes?: string }
const DEST: [RegExp, string][] = [[/ghana|accra|kumasi|tema|takoradi|tamale|cape coast|koforidua|ho\b|sunyani/i, 'GH'], [/nigeria|lagos|abuja|ibadan|port harcourt|enugu|kano/i, 'NG'], [/togo|lom[eé]/i, 'TG'], [/ivoire|ivory|abidjan/i, 'CI'], [/s[eé]n[eé]gal|dakar/i, 'SN'], [/liberia|monrovia/i, 'LR'], [/sierra leone|freetown/i, 'SL'], [/b[eé]nin|cotonou/i, 'BJ'], [/cameroun|cameroon|douala|yaound/i, 'CM'], [/kenya|nairobi|mombasa/i, 'KE']]
const CARGO: [RegExp, string][] = [[/barrel|drum|f[uû]t/i, 'barrels'], [/box|carton|bo[iî]te|colis/i, 'boxes'], [/pallet|palette/i, 'pallets'], [/\bcar\b|vehicle|truck|suv|voiture|v[eé]hicule/i, 'vehicle'], [/20 ?ft|20'|twenty/i, 'container20'], [/40 ?ft|40'|forty|container|conteneur/i, 'container40']]
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 }

/** Keyword understanding — the fallback when no AI key is set. */
export function readMessage(text: string): { intent: Intent; ref?: string; booking?: Booking } {
  const t = text.trim(); const ref = /\b((?:NT|SS)-[A-Z0-9]{5,8})\b/i.exec(t)?.[1]?.toUpperCase()
  if (/\b(agent|human|person|someone|call me|speak to|parler|quelqu'un|conseiller)\b/i.test(t)) return { intent: 'human', ref }
  if (/\b(owe|pay|payment|balance|invoice|due|payer|paiement|facture|combien je dois)\b/i.test(t)) return { intent: 'payment', ref }
  if (ref || /\b(where|track|status|arriv|when|eta|reached|landed|o[uù] est|suivi|statut|quand)\b/i.test(t)) return { intent: 'status', ref }
  if (/\b(send|ship|quote|price|cost|how much|book|envoyer|exp[eé]dier|devis|prix|tarif)\b/i.test(t) || CARGO.some(([re]) => re.test(t)) && DEST.some(([re]) => re.test(t))) {
    const qm = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|un|une|deux|trois|quatre|cinq)\s+(?:x\s+)?(?:big |large |small )?(barrels?|drums?|boxes|box|cartons?|pallets?|cars?|vehicles?|containers?|f[uû]ts?|colis|bo[iî]tes?|voitures?|conteneurs?)/i.exec(t)
    const from = /\bfrom\s+([A-Za-z .'-]{3,30}?)(?:\s+to\b|[,.]|$)|\bde\s+([A-Za-zé .'-]{3,30}?)(?:\s+(?:à|a|vers)\b|[,.]|$)/i.exec(t)
    return { intent: 'booking', booking: { quantity: qm ? Number(qm[1]) || NUM[qm[1].toLowerCase()] || undefined : undefined, cargo: CARGO.find(([re]) => re.test(t))?.[1], destination: DEST.find(([re]) => re.test(t))?.[1], origin: (from?.[1] ?? from?.[2])?.trim(), notes: t.slice(0, 200) } }
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|bonjour|bonsoir|salut|akwaaba|menu|start)\b/i.test(t)) return { intent: 'greeting' }
  if (/\b(thanks|thank you|merci|medaase)\b/i.test(t)) return { intent: 'thanks' }
  return { intent: 'other' }
}
/** Claude, when configured: intent + booking details as JSON. Returns null on any problem (keywords take over). */
async function readWithClaude(text: string): Promise<{ intent: Intent; ref?: string; booking?: Booking } | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim(); if (!key) return null
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch((process.env.ANTHROPIC_API_URL?.trim() || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({
      model: process.env.ASSISTANT_MODEL?.trim() || 'claude-haiku-5-5', max_tokens: 300,
      system: 'You read WhatsApp messages sent to Ntemtem, a marketplace for shipping barrels, boxes, cars and containers from the US, UK, Canada and Europe to West Africa. Reply with ONLY a JSON object: {"intent":"greeting|status|payment|booking|human|thanks|other","ref":"NT-XXXXXX or null","booking":{"origin":"city, state or null","destination":"ISO2 country code or null","cargo":"barrels|boxes|pallets|vehicle|container20|container40|null","quantity":number or null,"notes":"short summary or null"}}. status = asking where a shipment is; payment = asking what they owe or how to pay; booking = wants to send something or get a price; human = wants a person. Never invent a reference.',
      messages: [{ role: 'user', content: text.slice(0, 1500) }],
    }) })
    if (!r.ok) return null
    const j = await r.json() as { content?: { type: string; text?: string }[] }
    const raw = j.content?.find((c) => c.type === 'text')?.text ?? ''; const m = /\{[\s\S]*\}/.exec(raw); if (!m) return null
    const o = JSON.parse(m[0]) as { intent?: string; ref?: string | null; booking?: Record<string, unknown> | null }
    const intent = (['greeting', 'status', 'payment', 'booking', 'human', 'thanks', 'other'].includes(String(o.intent)) ? o.intent : 'other') as Intent
    const b = o.booking ?? {}
    return { intent, ref: typeof o.ref === 'string' && /^(NT|SS)-[A-Z0-9]{5,8}$/i.test(o.ref) ? o.ref.toUpperCase() : undefined, booking: intent === 'booking' ? { origin: typeof b.origin === 'string' ? b.origin.slice(0, 60) : undefined, destination: typeof b.destination === 'string' && /^[A-Z]{2}$/.test(b.destination) ? b.destination : undefined, cargo: typeof b.cargo === 'string' ? b.cargo : undefined, quantity: Number(b.quantity) > 0 ? Math.min(200, Number(b.quantity)) : undefined, notes: typeof b.notes === 'string' ? b.notes.slice(0, 200) : undefined } : undefined }
  } catch { return null } finally { clearTimeout(timer) }
}

const T = {
  en: {
    menu: (n: string) => `Hi${n ? ` ${n}` : ''}, this is Ntemtem. I can:\n• tell you where your shipment is (send the reference, e.g. NT-AB12CD)\n• tell you what you owe and how to pay\n• get you quotes — tell me what you're sending and where\nType "agent" anytime to reach a person.`,
    none: 'I couldn’t find a shipment linked to this number. Send your reference (it starts with NT-), or track it here:',
    status: (ref: string, st: string, extra: string) => `${ref}: ${st}${extra}`,
    eta: (d: string) => ` — expected around ${d}`, track: 'Follow it here:', more: (n: number) => `…and ${n} more on your dashboard.`,
    owe: (lines: string) => `Here’s what’s due:\n${lines}\nPay securely here (the money is held until your goods are on their way):`, owesNothing: 'Nothing is due right now. 👍',
    quote: (what: string) => `Great — ${what}. Tap here to get prices from verified shippers (takes 2 minutes):`, quoteAsk: 'Happy to help. Tell me what you’re sending (e.g. 3 barrels or a car), from which city, and to which city in Africa — or start here:',
    human: (who: string) => `Thanks — I’ve passed this to ${who}. Someone will reply here shortly (usually within a few working hours).`,
    thanks: 'You’re welcome! Message me anytime.', other: 'Sorry, I didn’t catch that. Send a reference to track (NT-…), "pay" for what you owe, tell me what you want to ship, or "agent" for a person.',
    team: 'the Ntemtem team',
  },
  fr: {
    menu: (n: string) => `Bonjour${n ? ` ${n}` : ''}, ici Ntemtem. Je peux :\n• vous dire où est votre colis (envoyez la référence, ex. NT-AB12CD)\n• vous dire ce qui reste à payer\n• vous obtenir des devis — dites-moi ce que vous envoyez et où\nÉcrivez « conseiller » pour parler à une personne.`,
    none: 'Je ne trouve pas d’envoi lié à ce numéro. Envoyez votre référence (elle commence par NT-), ou suivez-le ici :',
    status: (ref: string, st: string, extra: string) => `${ref} : ${st}${extra}`,
    eta: (d: string) => ` — arrivée prévue vers le ${d}`, track: 'Suivi :', more: (n: number) => `…et ${n} autre(s) sur votre tableau de bord.`,
    owe: (lines: string) => `Voici ce qui reste à payer :\n${lines}\nPayez en toute sécurité ici :`, owesNothing: 'Rien à payer pour le moment. 👍',
    quote: (what: string) => `Parfait — ${what}. Obtenez des prix de transporteurs vérifiés ici :`, quoteAsk: 'Avec plaisir. Dites-moi ce que vous envoyez (ex. 3 fûts ou une voiture), de quelle ville et vers quelle ville — ou commencez ici :',
    human: (who: string) => `Merci — je transmets à ${who}. Quelqu’un vous répondra ici rapidement.`,
    thanks: 'Avec plaisir ! Écrivez-moi à tout moment.', other: 'Désolé, je n’ai pas compris. Envoyez une référence (NT-…), « payer », ce que vous voulez envoyer, ou « conseiller ».',
    team: 'l’équipe Ntemtem',
  },
}

/** Everything linked to this phone number: shipments as sender or receiver. */
async function whoIs(db: Db, phone: string) {
  const t = tail(phone); if (t.length < 7) return { name: '', userId: null as string | null, shipments: [] as Row[] }
  const { rows } = await db.query<Row>(`select distinct on (s.id) s.*, sh.name as shipper_name, case when cc.id is not null then 'receiver' else 'sender' end as role, coalesce(r.contact_name, cl.name, cc.name) as person
    from shipments s join shippers sh on sh.id = s.shipper_id
    left join requests r on r.id = s.request_id and right(regexp_replace(r.contact_phone, '\\D', '', 'g'), 9) = $1
    left join clients cl on cl.id = s.client_id and (right(regexp_replace(cl.phone, '\\D', '', 'g'), 9) = $1 or right(regexp_replace(coalesce(cl.whatsapp,''), '\\D', '', 'g'), 9) = $1)
    left join client_consignees cc on cc.id = s.consignee_id and right(regexp_replace(cc.phone, '\\D', '', 'g'), 9) = $1
    where s.cancelled_at is null and (r.id is not null or cl.id is not null or cc.id is not null) order by s.id, s.created_at desc`, [t])
  rows.sort((a, b) => Number(a.status === 'delivered') - Number(b.status === 'delivered') || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return { name: String(rows[0]?.person ?? '').split(' ')[0], userId: rows.find((x) => x.role === 'sender')?.user_id ?? null, shipments: rows }
}

export interface Reply { text: string; intent: Intent; handoff: boolean; shipperId: string | null; via: 'ai' | 'rules' }
export async function answer(db: Db, phone: string, text: string): Promise<Reply> {
  const lang = langFor(phone, text); const t = T[lang]
  const who = await whoIs(db, phone)
  const read = (await readWithClaude(text)) ?? null
  const kw = readMessage(text)
  const r = read && read.intent !== 'other' ? { ...read, ref: read.ref ?? kw.ref, booking: read.booking ?? kw.booking } : kw
  const via: Reply['via'] = read && read.intent !== 'other' ? 'ai' : 'rules'
  const shipperId = (r.ref ? who.shipments.find((s) => s.ref === r.ref)?.shipper_id : null) ?? who.shipments[0]?.shipper_id ?? null
  const fmtD = (d: unknown) => new Date(String(ISO(d)).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' })
  const label = (st: string) => (lang === 'fr' ? STATUS_FR[st] ?? st : statusLabels[st as ShipmentStatus] ?? st)
  // A shipper can switch the assistant off for their customers: hand straight to a person.
  if (shipperId) { const { autopilotOf } = await import('./autopilot'); const cfg = await autopilotOf(db, shipperId); if (!cfg.assistant && r.intent !== 'greeting') return { text: t.human(who.shipments[0]?.shipper_name ?? t.team), intent: 'human', handoff: true, shipperId, via } }
  switch (r.intent) {
    case 'greeting': return { text: t.menu(who.name), intent: r.intent, handoff: false, shipperId, via }
    case 'thanks': return { text: t.thanks, intent: r.intent, handoff: false, shipperId, via }
    case 'status': {
      let list = r.ref ? who.shipments.filter((s) => s.ref === r.ref) : who.shipments.filter((s) => s.status !== 'delivered').slice(0, 3)
      if (r.ref && !list.length) { const { rows } = await db.query<Row>('select * from shipments where ref = $1 and cancelled_at is null', [r.ref]); list = rows } // a reference is enough to track publicly
      if (!list.length) return { text: `${t.none} ${app()}/track`, intent: r.intent, handoff: false, shipperId, via }
      const lines = list.map((s) => t.status(s.ref, label(s.status), s.eta && s.status !== 'delivered' ? t.eta(fmtD(s.eta)) : '') + `\n${t.track} ${app()}/track?ref=${s.ref}`)
      const rest = r.ref ? 0 : who.shipments.filter((s) => s.status !== 'delivered').length - list.length
      return { text: lines.join('\n\n') + (rest > 0 ? `\n${t.more(rest)}` : ''), intent: r.intent, handoff: false, shipperId: list[0].shipper_id, via }
    }
    case 'payment': {
      const mine = who.shipments.filter((s) => s.role === 'sender' && s.status !== 'delivered')
      if (!mine.length) return { text: `${t.none} ${app()}/track`, intent: r.intent, handoff: false, shipperId, via }
      const { amountDue } = await import('./payments'); const lines: string[] = []
      for (const s of mine.slice(0, 5)) { const due = await amountDue(db, s); const { rows } = await db.query<Row>(`select coalesce(sum(amount_usd),0)::float as n from escrow_payments where shipment_id = $1 and status in ('held','released','direct')`, [s.id]); const owed = Math.round((due.amountUsd - Number(rows[0].n)) * 100) / 100; if (owed > 0) lines.push(`• ${s.ref}: $${owed.toLocaleString('en-US')}`) }
      return { text: lines.length ? `${t.owe(lines.join('\n'))} ${app()}/dashboard?tab=money` : t.owesNothing, intent: r.intent, handoff: false, shipperId, via }
    }
    case 'booking': {
      const b = r.booking ?? {}
      const p = new URLSearchParams(); if (b.destination) p.set('destination', b.destination); if (b.origin) p.set('origin', b.origin); if (b.cargo) p.set('cargo', b.cargo); if (b.quantity) p.set('qty', String(b.quantity)); if (b.notes) p.set('note', b.notes); p.set('phone', phone); p.set('source', 'whatsapp')
      const what = [b.quantity && b.cargo ? `${b.quantity} ${b.cargo === 'vehicle' ? (lang === 'fr' ? 'véhicule(s)' : b.quantity > 1 ? 'vehicles' : 'vehicle') : b.cargo}` : b.cargo, b.origin ? `${lang === 'fr' ? 'de' : 'from'} ${b.origin}` : '', b.destination ? `${lang === 'fr' ? 'vers' : 'to'} ${countryByCode(b.destination)?.name ?? b.destination}` : ''].filter(Boolean).join(' ')
      return { text: `${what ? t.quote(what) : t.quoteAsk} ${app()}/quote?${p}`, intent: r.intent, handoff: false, shipperId, via }
    }
    case 'human': return { text: t.human(who.shipments[0]?.shipper_name ?? t.team), intent: r.intent, handoff: true, shipperId, via }
    default: return { text: t.other, intent: 'other', handoff: false, shipperId, via }
  }
}

/** Store the exchange, hand over when needed. Returns the reply text (or null when a person has taken over). */
export async function handleInbound(db: Db, phone: string, text: string, profileName = '') {
  const e164 = '+' + digits(phone)
  const { rows: rc } = await db.query<Row>(`select count(*)::int as n from assistant_messages m join assistant_conversations c on c.id = m.conversation_id where c.phone = $1 and m.direction = 'in' and m.created_at > now() - interval '1 hour'`, [e164])
  if (Number(rc[0].n) > 40) return null // flood guard
  let { rows: [conv] } = await db.query<Row>('select * from assistant_conversations where phone = $1', [e164])
  if (!conv) { const id = 'ac_' + uid(); await db.query('insert into assistant_conversations (id,phone,name) values ($1,$2,$3)', [id, e164, profileName.slice(0, 80)]); conv = (await db.query<Row>('select * from assistant_conversations where id = $1', [id])).rows[0] }
  await db.query(`insert into assistant_messages (id,conversation_id,direction,body) values ($1,$2,'in',$3)`, ['am_' + uid(), conv.id, text.slice(0, 2000)])
  // A person is handling it (handed over in the last 12 h): stay quiet, ping the team.
  if (conv.handed_off_at && Date.now() - new Date(conv.handed_off_at).getTime() < 12 * 3600_000 && !/^(menu|bot|assistant)$/i.test(text.trim())) {
    await db.query('update assistant_conversations set last_at = now(), unread = unread + 1 where id = $1', [conv.id])
    if (conv.shipper_id) await notifyShipperStaff(db, conv.shipper_id, { kind: 'system', title: `WhatsApp from ${conv.name || e164}`, body: text.slice(0, 200), link: `/dashboard/autopilot?tab=assistant&c=${conv.id}`, dedupe: `acm:${conv.id}:${Date.now()}` }, ['owner', 'dispatcher', 'agent'])
    return null
  }
  const r = await answer(db, e164, text)
  await db.query(`insert into assistant_messages (id,conversation_id,direction,body,intent,via) values ($1,$2,'out',$3,$4,$5)`, ['am_' + uid(), conv.id, r.text, r.intent, r.via])
  await db.query(`update assistant_conversations set last_at = now(), shipper_id = coalesce($2, shipper_id), last_intent = $3, handed_off_at = case when $4 then now() else handed_off_at end, unread = case when $4 then unread + 1 else unread end, name = coalesce(nullif(name,''), $5) where id = $1`, [conv.id, r.shipperId, r.intent, r.handoff, profileName.slice(0, 80)])
  if (r.handoff) {
    if (r.shipperId) {
      await notifyShipperStaff(db, r.shipperId, { kind: 'system', title: `${conv.name || e164} wants a person on WhatsApp`, body: text.slice(0, 200), link: `/dashboard/autopilot?tab=assistant&c=${conv.id}`, dedupe: `aho:${conv.id}:${Date.now()}` }, ['owner', 'dispatcher', 'agent'])
      await logAuto(db, r.shipperId, 'assistant', `Handed a WhatsApp chat to your team (${conv.name || e164})`, { body: text.slice(0, 200), link: `/dashboard/autopilot?tab=assistant&c=${conv.id}` })
    } else { const { ticketFromContact } = await import('./support'); await ticketFromContact(db, { name: conv.name || e164, email: '', topic: 'other', message: `WhatsApp ${e164}: ${text}`, contactId: conv.id }).catch(() => {}) }
  } else if (r.shipperId && r.intent !== 'other') await logAuto(db, r.shipperId, 'assistant', `Answered a WhatsApp ${r.intent === 'status' ? 'tracking' : r.intent} question (${conv.name || e164})`, { body: r.text.slice(0, 300), link: `/dashboard/autopilot?tab=assistant&c=${conv.id}` })
  return r.text
}

/* ---------------- inbound webhooks (mounted before express.json in index.ts) ---------------- */
function twilioOk(req: Request, params: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!token) return process.env.NODE_ENV !== 'production' || process.env.ASSISTANT_ALLOW_UNSIGNED === '1'
  const sig = String(req.header('x-twilio-signature') ?? '')
  const url = (process.env.ASSISTANT_PUBLIC_URL?.trim() || `${app()}/api/assistant/twilio`)
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  const want = createHmac('sha1', token).update(data).digest('base64')
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want))
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function twilioInbound(getDb: () => Promise<Db>) {
  return async (req: Request, res: Response) => {
    const p = (req.body ?? {}) as Record<string, string>
    if (!twilioOk(req, p)) return res.status(403).send('Bad signature')
    const from = String(p.From ?? '').replace(/^whatsapp:/, ''); const body = String(p.Body ?? '').trim()
    res.type('text/xml')
    if (!from || !body) return res.send('<Response/>')
    const reply = await handleInbound(await getDb(), from, body, String(p.ProfileName ?? ''))
    res.send(reply ? `<Response><Message>${xml(reply)}</Message></Response>` : '<Response/>')
  }
}
export function metaVerify(req: Request, res: Response) {
  const want = process.env.WHATSAPP_VERIFY_TOKEN?.trim()
  if (want && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === want) return res.send(String(req.query['hub.challenge'] ?? ''))
  res.status(403).send('Forbidden')
}
export function metaInbound(getDb: () => Promise<Db>) {
  return async (req: Request, res: Response) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))
    const secret = process.env.WHATSAPP_APP_SECRET?.trim()
    if (secret) { const sig = String(req.header('x-hub-signature-256') ?? ''); const want = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'); if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(403).send('Bad signature') }
    else if (process.env.NODE_ENV === 'production' && process.env.ASSISTANT_ALLOW_UNSIGNED !== '1') return res.status(403).send('Not configured')
    res.sendStatus(200) // Meta wants a quick 200; answer after
    let j: Row; try { j = JSON.parse(raw.toString()) } catch { return }
    const db = await getDb()
    for (const e of j.entry ?? []) for (const ch of e.changes ?? []) {
      const v = ch.value ?? {}; const names = Object.fromEntries((v.contacts ?? []).map((c: Row) => [c.wa_id, c.profile?.name ?? '']))
      for (const m of v.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? ''; if (!text) continue
        const reply = await handleInbound(db, m.from, text, names[m.from] ?? '').catch((er) => { console.error('[assistant]', er); return null })
        if (reply) await sendText('+' + digits(m.from), reply, 'whatsapp').catch((er) => console.error('[assistant] reply', er))
      }
    }
  }
}

/* ---------------- the team's inbox ---------------- */
const convOut = (c: Row) => ({ id: c.id, phone: c.phone, name: c.name, lastAt: ISO(c.last_at), lastIntent: c.last_intent ?? '', handedOff: !!c.handed_off_at && Date.now() - new Date(c.handed_off_at).getTime() < 12 * 3600_000, unread: Number(c.unread ?? 0), preview: c.preview ?? '' })
export function mountAssistant(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staff = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (!(u.role === 'shipper' && u.shipperId && u.staffRole !== 'driver') && !u.admin) throw new HttpError(403, 'Office staff only.'); return u }
  const scope = (u: ApiUser) => (u.role === 'shipper' && u.shipperId ? { sql: 'where c.shipper_id = $1', args: [u.shipperId] } : { sql: '', args: [] as string[] })
  r.get('/assistant/conversations', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const s = scope(u)
    const { rows } = await db.query<Row>(`select c.*, (select body from assistant_messages m where m.conversation_id = c.id order by created_at desc limit 1) as preview from assistant_conversations c ${s.sql} order by c.last_at desc limit 100`, s.args)
    res.set('Cache-Control', 'no-store')
    res.json({ conversations: rows.map(convOut), ai: !!process.env.ANTHROPIC_API_KEY?.trim(), inbound: { twilio: !!process.env.TWILIO_AUTH_TOKEN?.trim(), meta: !!process.env.WHATSAPP_VERIFY_TOKEN?.trim() } })
  }))
  const own = async (db: Db, u: ApiUser, id: string) => { const { rows } = await db.query<Row>('select * from assistant_conversations where id = $1', [id]); const c = rows[0]; if (!c || (u.role === 'shipper' && c.shipper_id !== u.shipperId)) throw new HttpError(404, 'Conversation not found.'); return c }
  r.get('/assistant/conversations/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const c = await own(db, u, String(req.params.id))
    await db.query('update assistant_conversations set unread = 0 where id = $1', [c.id])
    const { rows } = await db.query<Row>('select * from assistant_messages where conversation_id = $1 order by created_at asc limit 200', [c.id])
    res.set('Cache-Control', 'no-store'); res.json({ conversation: convOut(c), messages: rows.map((m) => ({ id: m.id, direction: m.direction, body: m.body, intent: m.intent ?? '', via: m.via ?? '', by: m.by_name ?? '', at: ISO(m.created_at) })) })
  }))
  r.post('/assistant/conversations/:id/reply', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const c = await own(db, u, String(req.params.id))
    const b = z.object({ body: z.string().trim().min(1).max(1500), handBack: z.boolean().default(false) }).parse(req.body)
    let sent = true; await sendText(c.phone, b.body, 'whatsapp').catch(() => { sent = false })
    await db.query(`insert into assistant_messages (id,conversation_id,direction,body,by_name,via) values ($1,$2,'out',$3,$4,'person')`, ['am_' + uid(), c.id, b.body, u.name])
    await db.query(`update assistant_conversations set last_at = now(), handed_off_at = case when $2 then null else coalesce(handed_off_at, now()) end where id = $1`, [c.id, b.handBack])
    res.status(201).json({ ok: true, sent })
  }))
  /** "Try it": what the assistant would answer, without sending or storing anything. */
  r.post('/assistant/simulate', wrap(async (req, res) => {
    const db = await getDb(); await staff(db, req)
    const b = z.object({ phone: z.string().trim().min(7).max(20), text: z.string().trim().min(1).max(500) }).parse(req.body)
    res.json(await answer(db, '+' + digits(b.phone), b.text))
  }))
}
