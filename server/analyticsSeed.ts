/**
 * Demo history for the analytics page: a year of Gold Coast Freight requests, competing quotes,
 * delivered shipments (with stage-by-stage events), invoices, payments, reviews, disputes and
 * past runs. Deterministic (seeded PRNG) and idempotent (ids start with `ra_`). Everything is
 * terminal — delivered, lost, expired or cancelled — so no sweep acts on it and no live board
 * gains open work. Turn off with DEMO_HISTORY=false.
 */
import type { Db } from './db'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

type Val = string | number | boolean | null | Date
const DAY = 86400000

function prng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

async function bulk(db: Db, table: string, cols: string[], rows: Val[][]) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200); const params: Val[] = []
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}` }).join(',')})`).join(',')
    await db.query(`insert into ${table} (${cols.join(',')}) values ${values} on conflict do nothing`, params)
  }
}

const CLIENTS = ['Akua Boateng', 'Kwame Asante', 'Yaa Serwaa', 'Kofi Adomako', 'Esi Quaye', 'Nana Ama Ofori', 'Kojo Mensah', 'Abena Darko', 'Yaw Amponsah', 'Efia Kumi', 'Kwabena Asare', 'Adwoa Pokuaa', 'Kwesi Boakye', 'Ama Agyeman', 'Fiifi Coleman', 'Afua Sarpong', 'Kweku Annan', 'Akosua Dapaah', 'Selorm Agbeko', 'Delali Mensah', 'Ekow Arthur', 'Naa Okailey', 'Osei Tutu Ventures', 'Accra Fresh Foods', 'Ridge Clinic Supplies', 'Volta Build Co']
const ORIGINS: [string, number][] = [['Houston, TX', 0.42], ['Atlanta, GA', 0.2], ['Dallas, TX', 0.16], ['Chicago, IL', 0.12], ['Newark, NJ', 0.1]]
const CARGO: { k: string; w: number; base: [number, number]; kg: [number, number]; desc: string }[] = [
  { k: 'barrels', w: 0.36, base: [160, 200], kg: [90, 140], desc: 'barrels — clothing and provisions' },
  { k: 'boxes', w: 0.2, base: [70, 95], kg: [20, 35], desc: 'boxes — household goods' },
  { k: 'vehicle', w: 0.16, base: [1350, 1750], kg: [1300, 2100], desc: 'vehicle, RoRo to Tema' },
  { k: 'pallets', w: 0.14, base: [380, 470], kg: [250, 450], desc: 'pallets — trade goods' },
  { k: 'container20', w: 0.09, base: [3500, 4200], kg: [6000, 12000], desc: '20ft container' },
  { k: 'container40', w: 0.05, base: [5800, 6700], kg: [10000, 20000], desc: '40ft container' },
]
const RIVALS = ['palm-coast-shipping', 'atlantic-bridge', 'manchester-maritime', 'tema-tide', 'accra-parcel-co', 'kumasi-kargo', 'euro-africa-roro']
const SID = 'gold-coast-freight'

export async function seedAnalyticsDemo(db: Db) {
  if (process.env.DEMO_HISTORY === 'false') return
  const { rows: ex } = await db.query<{ n: string }>(`select count(*)::text as n from requests where id like 'ra_%'`)
  if (Number(ex[0].n) > 0) return
  const { rows: sh } = await db.query<{ id: string }>(`select id from shippers where id = any($1)`, [[SID, ...RIVALS]])
  const have = new Set(sh.map((s) => s.id)); if (!have.has(SID)) return
  const rivals = RIVALS.filter((r) => have.has(r))
  const rnd = prng(20261014)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const weighted = <T,>(xs: [T, number][]) => { let x = rnd(); for (const [v, w] of xs) { if ((x -= w) <= 0) return v } return xs[xs.length - 1][0] }
  const between = (a: number, b: number) => a + rnd() * (b - a)
  const int = (a: number, b: number) => Math.round(between(a, b))
  const now = Date.now()
  const at = (t: number) => new Date(t)
  const d10 = (t: number) => new Date(t).toISOString().slice(0, 10)

  // users + clients (some repeat often: weight by index)
  const users: Val[][] = []; const clients: Val[][] = []
  const noLogin = bcrypt.hashSync(randomBytes(18).toString('hex'), 8) // demo-only people; nobody knows this password
  CLIENTS.forEach((name, i) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}@example.com`
    users.push([`u_ra_${i}`, email, name, noLogin, 'customer', at(now - 400 * DAY)])
    clients.push([`cl_ra_${i}`, SID, `u_ra_${i}`, name, i >= 22 ? name : '', email, `+1 555 01${String(10 + i).padStart(2, '0')}`, pick(['Houston, TX', 'Atlanta, GA', 'Dallas, TX', 'Chicago, IL', 'Newark, NJ']), i < 6 ? '["vip"]' : '[]', 'marketplace', 'active', at(now - int(200, 380) * DAY)])
  })
  await bulk(db, 'users', ['id', 'email', 'name', 'password_hash', 'role', 'created_at'], users)
  await bulk(db, 'clients', ['id', 'shipper_id', 'user_id', 'name', 'company', 'email', 'phone', 'city', 'tags', 'source', 'status', 'created_at'], clients)
  const clientWeights: [number, number][] = CLIENTS.map((_, i) => [i, i < 6 ? 0.09 : 0.46 / (CLIENTS.length - 6)])

  const R: Val[][] = []; const Q: Val[][] = []; const S: Val[][] = []; const E: Val[][] = []; const I: Val[][] = []; const P: Val[][] = []; const V: Val[][] = []; const D: Val[][] = []
  let n = 0
  for (let day = 365; day >= 48; day--) {
    // growth: ~1.6 requests/week a year ago → ~4.5/week now, quieter in Jan, busier Nov–Dec
    const t0 = now - day * DAY; const month = new Date(t0).getUTCMonth()
    const season = month === 0 ? 0.6 : month >= 10 ? 1.35 : 1
    const rate = Math.min(0.95, (0.32 + (0.55 * (365 - day)) / 365) * season)
    if (rnd() > rate) continue
    n++
    const id = `ra_${n}`; const ci = weighted(clientWeights); const name = CLIENTS[ci]
    const origin = weighted(ORIGINS); const cargo = weighted(CARGO.map((c) => [c, c.w] as [typeof c, number]))
    const qty = cargo.k.startsWith('container') || cargo.k === 'vehicle' ? 1 : int(2, cargo.k === 'boxes' ? 14 : 8)
    const market = Math.round(between(cargo.base[0], cargo.base[1]) * qty * (origin.startsWith('Houston') ? 0.95 : origin.startsWith('Chicago') || origin.startsWith('Newark') ? 1.12 : 1))
    const kg = Math.round(between(cargo.kg[0], cargo.kg[1]) * qty)
    const created = t0 + int(7, 21) * 3600000
    const pickup = rnd() < 0.7; const delivery = rnd() < 0.55; const insurance = rnd() < 0.25
    const source = rnd() < 0.12 ? 'link' : rnd() < 0.06 ? 'branded' : 'marketplace'
    const weekend = [0, 6].includes(new Date(created).getUTCDay())

    // competing quotes
    const nRivals = source === 'marketplace' ? int(1, 3) : 0
    const offers: { shipper: string; price: number; transit: number; hours: number; kind: string }[] = []
    for (const rv of [...rivals].sort(() => rnd() - 0.5).slice(0, nRivals)) offers.push({ shipper: rv, price: Math.round(market * between(0.86, 1.18)), transit: int(42, 55), hours: between(0.5, 30), kind: rnd() < 0.2 ? 'estimate' : 'firm' })
    // Gold Coast: quotes 84% (100% on its own link), slower on weekends; Houston/Dallas priced sharper
    const quotes = source !== 'marketplace' || rnd() < 0.84
    let mine: (typeof offers)[number] | null = null
    if (quotes) {
      const hours = weekend ? between(6, 40) : rnd() < 0.55 ? between(0.2, 2) : rnd() < 0.7 ? between(2, 8) : between(8, 30)
      const sharp = origin.startsWith('Houston') || origin.startsWith('Dallas') ? between(0.88, 1.04) : between(0.98, 1.16)
      mine = { shipper: SID, price: Math.round(market * (cargo.k === 'vehicle' ? sharp + 0.04 : sharp)), transit: cargo.k === 'vehicle' ? int(52, 58) : int(47, 52), hours, kind: rnd() < 0.22 ? 'estimate' : 'firm' }
      offers.push(mine)
    }
    // who wins: price rank, speed and firmness; some requests never book
    let winner: string | null = null
    if (offers.length && rnd() < (source === 'marketplace' ? 0.78 : 0.9)) {
      const minP = Math.min(...offers.map((o) => o.price))
      const score = (o: (typeof offers)[number]) => (minP / o.price) ** 6 * (o.hours < 2 ? 1.5 : o.hours < 8 ? 1.1 : o.hours < 24 ? 0.8 : 0.5) * (o.kind === 'firm' ? 1.15 : 0.8) * (o.shipper === SID && source !== 'marketplace' ? 3 : 1) * between(0.6, 1.4)
      winner = offers.reduce((b, o) => (score(o) > score(b) ? o : b)).shipper
    }
    const cancelled = !winner && rnd() < 0.3
    const status = winner ? 'booked' : cancelled ? 'cancelled' : 'expired'
    const ready = created + int(3, 14) * DAY
    R.push([id, `SS-A${String(n).padStart(4, '0')}`, `u_ra_${ci}`, at(created), origin, 'GH', 'ocean', cargo.k, qty, kg, `${qty} ${cargo.desc}`, pickup, delivery, insurance, d10(ready), name, String(users[ci][1]), String(clients[ci][6]), status, source, source === 'marketplace' ? null : SID, at(ready + 14 * DAY), cancelled ? at(created + int(2, 9) * DAY) : null, cancelled ? pick(['Shipping later in the year', 'Found space with family', 'Too expensive', '']) : ''])
    offers.forEach((o, k) => {
      const qs = winner === o.shipper ? 'accepted' : winner ? 'declined' : 'expired'
      Q.push([`raq_${n}_${k}`, id, o.shipper, o.price, o.transit, d10(created + 14 * DAY), 'Weekly sailing to Tema.', JSON.stringify(['Ocean freight', ...(pickup ? ['Pickup'] : []), ...(delivery && rnd() < 0.8 ? ['Door delivery'] : []), ...(insurance ? ['Insurance'] : [])]), qs, at(created + o.hours * 3600000), o.kind, 'ocean'])
    })
    if (winner !== SID || !mine) continue

    // the shipment, stage by stage
    const sid = `ras_${n}`; const booked = created + mine.hours * 3600000 + between(2, 40) * 3600000
    const stages: [string, number][] = [['picked_up', between(1, 5)], ['at_origin_port', between(1.5, 5)], ['in_transit', between(1, 8)], ['arrived', between(24, 31)], ['customs', between(0.5, 2.5)], [delivery ? 'out_for_delivery' : 'ready_for_collection', cargo.k === 'vehicle' ? between(4, 12) : between(1.5, 6)], ['delivered', between(0.2, 3)]]
    if (cargo.k.startsWith('container')) stages[0][1] = between(3, 8)
    // the most recent wins are squeezed so every seeded shipment is already delivered
    const span = stages.reduce((a, x) => a + x[1], 0); const room = (now - 1.5 * DAY - booked) / DAY
    if (span > room) for (const x of stages) x[1] *= room / span
    let t = booked; E.push([sid, 'booked', at(t), origin])
    const cancelShip = rnd() < 0.025
    for (const [st, days] of stages) {
      t += days * DAY; if (cancelShip && st === 'at_origin_port') break
      E.push([sid, st, at(t), st === 'in_transit' ? 'Atlantic Ocean' : ['arrived', 'customs'].includes(st) ? 'Tema' : st === 'picked_up' || st === 'at_origin_port' ? origin : 'Accra'])
    }
    const etaOrig = booked + mine.transit * DAY
    S.push([sid, `SS-R${String(n).padStart(4, '0')}`, id, SID, `u_ra_${ci}`, 'ocean', origin, 'GH', cargo.k, `${qty} ${cargo.desc}`, cancelShip ? 'booked' : 'delivered', d10(etaOrig), name, `cl_ra_${ci}`, at(booked), d10(etaOrig), cancelShip ? null : at(t), cancelShip ? at(booked + 3 * DAY) : null, cancelShip ? 'Client changed plans' : '', delivery ? 'delivery' : 'collection', JSON.stringify({ quantity: qty, weightKg: kg, quoteKind: mine.kind })])
    if (cancelShip) continue

    // invoice + payments
    const lines = [{ description: `Ocean freight, ${origin} → Tema (${qty} ${cargo.k})`, qty: 1, unit: Math.round(mine.price * (pickup ? 0.9 : 1) * (delivery ? 0.93 : 1)) }]
    if (pickup) lines.push({ description: 'Pickup', qty: 1, unit: Math.round(mine.price * 0.06) })
    if (delivery) lines.push({ description: 'Door delivery', qty: 1, unit: Math.round(mine.price * 0.05) })
    if (insurance) lines.push({ description: 'Cargo insurance', qty: 1, unit: Math.round(mine.price * 0.025) })
    if (rnd() < 0.12) lines.push({ description: 'Storage at destination', qty: int(3, 9), unit: 5 })
    const total = lines.reduce((a, l) => a + l.qty * l.unit, 0)
    const issued = booked + DAY; const due = issued + 30 * DAY
    const payDays = rnd() < 0.08 ? null : weighted([[between(0, 4), 0.35], [between(5, 25), 0.4], [between(26, 50), 0.18], [between(51, 90), 0.07]])
    const paidAt = payDays == null ? null : issued + payDays * DAY
    const fullyPaid = paidAt != null && paidAt < now
    const iid = `rai_${n}`
    I.push([iid, SID, `cl_ra_${ci}`, sid, `INV-A${String(n).padStart(4, '0')}`, fullyPaid ? 'paid' : 'sent', JSON.stringify(lines), total, 0, total, d10(issued), d10(due), null, at(now)])
    if (fullyPaid) {
      if (rnd() < 0.25) { const part = Math.round(total * 0.5); P.push([`rap_${n}_a`, iid, part, 'bank', d10(issued + Math.max(0, payDays! - 10) * DAY), 'Deposit']); P.push([`rap_${n}_b`, iid, total - part, pick(['bank', 'card', 'zelle']), d10(paidAt!), 'Balance']) }
      else P.push([`rap_${n}`, iid, total, pick(['bank', 'card', 'zelle', 'cash']), d10(paidAt!), 'Paid in full'])
    }

    // review (more likely when late — people complain), rating follows delay
    const lateDays = (t - etaOrig) / DAY
    if (rnd() < 0.62) {
      const rating = lateDays > 7 ? weighted([[3, 0.5], [2, 0.2], [4, 0.3]]) : lateDays > 0 ? weighted([[4, 0.6], [5, 0.25], [3, 0.15]]) : weighted([[5, 0.72], [4, 0.25], [3, 0.03]])
      const tags = rating >= 4 ? [pick(['On time', 'Great communication', 'Careful handling', 'Good value', 'Easy pickup'])] : [pick(['Late', 'Hard to reach', 'Late', 'Damaged items'])]
      V.push([`rav_${n}`, sid, SID, `u_ra_${ci}`, rating, JSON.stringify(tags), rating >= 4 ? 'Everything arrived and the team kept us informed.' : 'Took longer than promised and updates were slow.', at(t + int(1, 6) * DAY)])
      if (rating <= 2 && rnd() < 0.6) D.push([`rad_${n}`, sid, SID, `u_ra_${ci}`, name, 'customer', pick(['delay', 'damage']), 'Raised after delivery.', Math.round(total * 0.1), 'resolved', at(t + 3 * DAY), at(t + 12 * DAY)])
    }
  }
  await bulk(db, 'requests', ['id', 'ref', 'user_id', 'created_at', 'origin', 'destination', 'mode', 'cargo', 'quantity', 'weight_kg', 'description', 'pickup', 'delivery', 'insurance', 'ready_date', 'contact_name', 'contact_email', 'contact_phone', 'status', 'source', 'preferred_shipper_id', 'expires_at', 'cancelled_at', 'cancel_reason'], R)
  await bulk(db, 'quotes', ['id', 'request_id', 'shipper_id', 'price', 'transit_days', 'valid_until', 'notes', 'includes', 'status', 'sent_at', 'kind', 'mode'], Q)
  await bulk(db, 'shipments', ['id', 'ref', 'request_id', 'shipper_id', 'user_id', 'mode', 'origin', 'destination', 'cargo', 'description', 'status', 'eta', 'customer', 'client_id', 'created_at', 'eta_original', 'delivered_at', 'cancelled_at', 'cancel_reason', 'handover', 'booking'], S)
  const shipIds = new Set(S.map((s) => s[0]))
  await bulk(db, 'shipment_events', ['shipment_id', 'status', 'at', 'place'], E.filter((e) => shipIds.has(e[0])))
  await bulk(db, 'invoices', ['id', 'shipper_id', 'client_id', 'shipment_id', 'number', 'status', 'items', 'subtotal', 'tax', 'total', 'issued_at', 'due_at', 'sent_at', 'overdue_notified_at'], I)
  await bulk(db, 'payments', ['id', 'invoice_id', 'amount', 'method', 'at', 'note'], P)
  await bulk(db, 'reviews', ['id', 'shipment_id', 'shipper_id', 'user_id', 'rating', 'tags', 'body', 'created_at'], V)
  await bulk(db, 'disputes', ['id', 'shipment_id', 'shipper_id', 'user_id', 'opened_by', 'opened_by_role', 'reason', 'description', 'amount_claimed_usd', 'status', 'created_at', 'updated_at'], D)

  // past pickup runs: two drivers, a few failed stops
  const runs: Val[][] = []; const stops: Val[][] = []
  for (let w = 1; w <= 40; w++) {
    for (const [driver, vehicle, kind, label] of [['st_demo_kwesi', 'vh_demo_1', 'pickup', 'Houston pickups'], ['st_demo_efua', 'vh_demo_2', 'delivery', 'Accra & Tema deliveries']] as const) {
      if (rnd() < 0.2) continue
      const date = now - (w * 7 - int(0, 4)) * DAY; const rid = `rar_${w}_${kind}`; const nStops = int(3, 9)
      runs.push([rid, SID, `${label} — wk ${w}`, kind, d10(date), driver, vehicle, kind === 'pickup' ? 'Gold Coast yard, Houston' : 'Tema warehouse', 'done', Math.round(between(8, 14) * nStops * 10) / 10, at(date - DAY)])
      for (let k = 0; k < nStops; k++) { const ok = rnd() < (driver === 'st_demo_kwesi' ? 0.95 : 0.87); stops.push([`${rid}_${k}`, rid, k, `Stop ${k + 1}`, ok ? 'done' : 'skipped', ok ? at(date + (9 + k) * 3600000) : null, ok ? '' : pick(['Nobody home', 'Wrong address', 'Customer asked to reschedule'])]) }
    }
  }
  const { rows: staff } = await db.query<{ id: string }>(`select id from staff where id in ('st_demo_kwesi','st_demo_efua')`)
  const ok = new Set(staff.map((s) => s.id))
  const keep = runs.filter((r) => ok.has(String(r[5]))); const keepIds = new Set(keep.map((r) => r[0]))
  await bulk(db, 'runs', ['id', 'shipper_id', 'name', 'kind', 'run_date', 'driver_id', 'vehicle_id', 'start_label', 'status', 'distance_km', 'created_at'], keep)
  await bulk(db, 'run_stops', ['id', 'run_id', 'seq', 'label', 'status', 'done_at', 'note'], stops.filter((s) => keepIds.has(s[1])))
  console.log(`[seed] analytics demo history: ${R.length} requests, ${S.length} shipments, ${I.length} invoices, ${V.length} reviews, ${keep.length} runs`)
}
