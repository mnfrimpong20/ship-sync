/**
 * Demo operation for Atlantic Bridge Logistics (ops@atlanticbridge.demo, password `shipsync`), so every
 * screen can be tested from a second shipper account: clients with receivers in GH, NG and TG, four
 * containers at different stages, ~26 shipments covering every status (ocean and air, delivery and
 * collection, delayed, cancelled, one with no receiver), invoices in every state, two customs-broker
 * jobs, staff logins for each role, vans and today's runs. Dates are relative to the day it runs.
 * Runs once (marker: shipment ab_s_01). Turn off with DEMO_ATLANTIC=false.
 */
import { randomBytes, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Db } from './db'

type Row = Record<string, any>
const SID = 'atlantic-bridge'
const DAY = 86400000
const at = (d: number) => new Date(Date.now() + d * DAY)
const day = (d: number) => at(d).toISOString().slice(0, 10)

const CLIENTS = [
  { id: 'ab_cl_1', name: 'Kwaku Ofori', company: 'Ofori Provisions', email: 'kwaku@oforiprovisions.example.com', phone: '+1 973 555 0121', city: 'Newark, NJ', tags: ['repeat', 'barrels'], notes: 'Ships 4–6 barrels every month to his mother in Kumasi. Pays by Zelle on pickup day.',
    rx: [['ab_cs_1a', 'Akosua Ofori', '+233 24 410 2201', 'Asafo, near the market', 'Kumasi', 'GH', 'Mother', true], ['ab_cs_1b', 'Kwasi Ofori', '+233 20 410 2202', 'Dansoman Estates', 'Accra', 'GH', 'Brother', false]] },
  { id: 'ab_cl_2', name: 'Grace Adeyemi', company: '', email: 'grace.adeyemi@example.com', phone: '+1 718 555 0134', city: 'Brooklyn, NY', tags: ['vehicles', 'nigeria'], notes: 'Sends cars and spare parts to her brother in Lekki. Wants WhatsApp updates.',
    rx: [['ab_cs_2a', 'Tunde Adeyemi', '+234 803 555 0145', '12 Admiralty Way, Lekki Phase 1', 'Lagos', 'NG', 'Brother', true]] },
  { id: 'ab_cl_3', name: 'Mawuli Agbeko', company: '', email: 'mawuli.a@example.com', phone: '+1 215 555 0156', city: 'Philadelphia, PA', tags: ['togo'], notes: 'Boxes to Lomé twice a year.',
    rx: [['ab_cs_3a', 'Edem Agbeko', '+228 90 55 01 67', 'Bè Kpota, près du marché', 'Lomé', 'TG', 'Father', true]] },
  { id: 'ab_cl_4', name: 'Rev. Daniel Asamoah', company: 'Harlem Ghanaian Community Church', email: 'office@harlemgcc.example.org', phone: '+1 212 555 0178', city: 'New York, NY', tags: ['church', 'charity'], notes: 'Mission boxes and barrels for a sister church in Takoradi. Invoices go to the church office.',
    rx: [['ab_cs_4a', 'Rev. Samuel Tetteh', '+233 26 555 0189', 'Market Circle, beside the Methodist school', 'Takoradi', 'GH', 'Pastor', true]] },
  { id: 'ab_cl_5', name: 'Joseph Mensah', company: 'Mensah Motors', email: 'joe@mensahmotors.example.com', phone: '+1 201 555 0190', city: 'Jersey City, NJ', tags: ['vehicles', 'wholesale', 'containers'], notes: 'Dealer. 1–2 cars a month plus a 20ft of parts each quarter. Net 30.',
    rx: [['ab_cs_5a', 'Kojo Mensah', '+233 24 555 0211', 'Community 9, near the lorry station', 'Tema', 'GH', 'Business partner', true], ['ab_cs_5b', 'Ama Mensah', '+233 20 555 0212', 'East Legon, American House', 'Accra', 'GH', 'Wife', false]] },
  { id: 'ab_cl_6', name: 'Ifeoma Nwosu', company: '', email: 'ifeoma.n@example.com', phone: '+1 973 555 0223', city: 'Newark, NJ', tags: ['air', 'nigeria'], notes: 'Usually air freight — medicines and electronics for family in Abuja.',
    rx: [['ab_cs_6a', 'Chidi Nwosu', '+234 805 555 0234', 'Plot 4, Gwarinpa Estate', 'Abuja', 'NG', 'Son', true]] },
  { id: 'ab_cl_7', name: 'Esi Arthur', company: '', email: 'esi.arthur@example.com', phone: '+1 347 555 0245', city: 'Bronx, NY', tags: ['new'], notes: 'New client — still needs to give us a receiver in Ghana.', rx: [] },
  { id: 'ab_cl_8', name: 'Linda Owusu', company: 'Bright Horizons Foundation', email: 'linda@brighthorizons.example.org', phone: '+1 267 555 0256', city: 'Philadelphia, PA', tags: ['charity', 'pallets'], notes: 'Books, laptops and school furniture for schools in the Central Region.',
    rx: [['ab_cs_8a', 'Mr. Francis Quansah', '+233 24 555 0267', 'Aggrey Memorial School, Cape Coast', 'Cape Coast', 'GH', 'Headmaster', true]] },
] as const

const CONTAINERS = [
  // id, ref, number, size, line, booking, seal, vessel, mmsi, voyage, dest, port, cutoff, etd, eta, status, notes, created, events
  { id: 'ab_cn_1', ref: 'CN-AB-101', number: 'MSCU4410238', size: '40hc', line: 'MSC', booking: 'MSCUNWK8812', seal: 'AB-77120', vessel: 'MSC Tema Star', mmsi: '636092514', voyage: 'TS612A', dest: 'GH', port: 'Tema', cutoff: -15, etd: -12, eta: 9, status: 'sailed', notes: 'Weekly Friday consolidation — barrels and a container of parts.', created: -22,
    ev: [['booked', -22, 'Newark, NJ', 'Booked 40HC with MSC.'], ['loading', -18, 'Atlantic Bridge warehouse, Newark', 'Loading started.'], ['gated_in', -14, 'Port Newark', 'Gate-in, seal AB-77120.'], ['sailed', -12, 'Port Newark', 'Sailed on MSC Tema Star.']] },
  { id: 'ab_cn_2', ref: 'CN-AB-098', number: 'MAEU7781320', size: '40ft', line: 'Maersk', booking: 'MAEU5521093', seal: 'AB-76988', vessel: 'Maersk Lagos', mmsi: '219018275', voyage: 'ML221', dest: 'GH', port: 'Tema', cutoff: -45, etd: -41, eta: -3, status: 'customs', notes: 'Discharged at Tema. Vehicle and barrels with Osei Clearing.', created: -50,
    ev: [['booked', -50, 'Newark, NJ', 'Booked 40ft with Maersk.'], ['loading', -46, 'Atlantic Bridge warehouse, Newark', ''], ['gated_in', -43, 'Port Newark', 'Gate-in, seal AB-76988.'], ['sailed', -41, 'Port Newark', 'Sailed on Maersk Lagos.'], ['arrived', -3, 'Tema', 'Discharged at Tema.'], ['customs', -2, 'Tema', 'Declarations lodged by Osei Clearing.']] },
  { id: 'ab_cn_3', ref: 'CN-AB-102', number: 'CMAU6620117', size: '40hc', line: 'CMA CGM', booking: 'CMAUNWK2290', seal: 'AB-77301', vessel: '', mmsi: '', voyage: '', dest: 'GH', port: 'Tema', cutoff: -1, etd: 2, eta: 34, status: 'gated_in', notes: 'At Port Newark, sails this week. Vehicle and pallets.', created: -9,
    ev: [['booked', -9, 'Newark, NJ', 'Booked 40HC with CMA CGM.'], ['loading', -5, 'Atlantic Bridge warehouse, Newark', ''], ['gated_in', -1, 'Port Newark', 'Gate-in, seal AB-77301.']] },
  { id: 'ab_cn_4', ref: 'CN-AB-103', number: '', size: '40ft', line: 'MSC', booking: 'MSCUNWK9034', seal: '', vessel: '', mmsi: '', voyage: '', dest: 'GH', port: 'Tema', cutoff: 6, etd: 9, eta: 41, status: 'loading', notes: 'Next Friday sailing — still taking barrels and boxes.', created: -4,
    ev: [['booked', -4, 'Newark, NJ', 'Booked 40ft with MSC.'], ['loading', -1, 'Atlantic Bridge warehouse, Newark', 'First barrels in.']] },
] as const

type St = 'booked' | 'picked_up' | 'at_origin_port' | 'in_transit' | 'arrived' | 'customs' | 'ready_for_collection' | 'out_for_delivery' | 'delivered'
const FLOW: St[] = ['booked', 'picked_up', 'at_origin_port', 'in_transit', 'arrived', 'customs', 'ready_for_collection', 'out_for_delivery', 'delivered']
interface Ship { n: number; status: St; mode: 'ocean' | 'air'; client: string; rx: string | null; cargo: string; desc: string; origin: string; dest: 'GH' | 'NG' | 'TG'; created: number; eta: number; cn?: string; vessel?: [string, string]; flight?: string; collect?: boolean; user?: string; delayed?: number; cancelled?: string; kg?: number; price: number; inv?: 'paid' | 'deposit' | 'sent' | 'overdue' | 'draft' | 'none' }

const SHIPS: Ship[] = [
  // waiting to be collected from the customer
  { n: 1, status: 'booked', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1a', cargo: 'barrels', desc: '5 barrels — rice, oil, clothing and toiletries for Kumasi', origin: 'Newark, NJ', dest: 'GH', created: -1, eta: 40, kg: 480, price: 650, inv: 'none' },
  { n: 2, status: 'booked', mode: 'ocean', client: 'ab_cl_2', rx: 'ab_cs_2a', cargo: 'vehicle', desc: '2018 Toyota Sienna — title cleared, keys with owner', origin: 'Brooklyn, NY', dest: 'NG', created: -3, eta: 44, kg: 2000, price: 1850, inv: 'draft' },
  { n: 3, status: 'booked', mode: 'air', client: 'ab_cl_4', rx: 'ab_cs_4a', cargo: 'boxes', desc: '3 boxes — hymn books and choir robes (urgent for Easter)', origin: 'New York, NY', dest: 'GH', created: -0.4, eta: 6, kg: 64, price: 420, inv: 'sent' },
  { n: 4, status: 'booked', mode: 'ocean', client: 'ab_cl_7', rx: null, cargo: 'barrels', desc: '2 barrels — dry food and shoes (receiver not given yet)', origin: 'Bronx, NY', dest: 'GH', created: -2, eta: 41, kg: 190, price: 280, inv: 'none' },
  // collected, waiting for / loading into a container
  { n: 5, status: 'picked_up', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1b', cargo: 'barrels', desc: '3 barrels — household goods for Accra', origin: 'Newark, NJ', dest: 'GH', created: -6, eta: 41, cn: 'ab_cn_4', kg: 290, price: 390, inv: 'deposit' },
  { n: 6, status: 'picked_up', mode: 'ocean', client: 'ab_cl_3', rx: 'ab_cs_3a', cargo: 'boxes', desc: '8 boxes — clothing, kitchenware and a sewing machine', origin: 'Philadelphia, PA', dest: 'TG', created: -5, eta: 45, kg: 170, price: 360, inv: 'sent' },
  // at Port Newark
  { n: 7, status: 'at_origin_port', mode: 'ocean', client: 'ab_cl_8', rx: 'ab_cs_8a', cargo: 'pallets', desc: '3 pallets — textbooks, 20 laptops, school desks', origin: 'Philadelphia, PA', dest: 'GH', created: -12, eta: 34, cn: 'ab_cn_3', kg: 780, price: 1350, inv: 'paid' },
  { n: 8, status: 'at_origin_port', mode: 'ocean', client: 'ab_cl_5', rx: 'ab_cs_5a', cargo: 'vehicle', desc: '2020 Honda Accord EX — clean title', origin: 'Jersey City, NJ', dest: 'GH', created: -10, eta: 34, cn: 'ab_cn_3', kg: 1500, price: 1650, inv: 'deposit' },
  // on the water / in the air
  { n: 9, status: 'in_transit', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1a', cargo: 'barrels', desc: '6 barrels — provisions for Kumasi', origin: 'Newark, NJ', dest: 'GH', created: -20, eta: 9, cn: 'ab_cn_1', kg: 560, price: 780, inv: 'paid' },
  { n: 10, status: 'in_transit', mode: 'ocean', client: 'ab_cl_5', rx: 'ab_cs_5a', cargo: 'container20', desc: '20ft container — auto parts and tyres (shipper load & count)', origin: 'Jersey City, NJ', dest: 'GH', created: -19, eta: 9, cn: 'ab_cn_1', kg: 9800, price: 4100, inv: 'deposit' },
  { n: 11, status: 'in_transit', mode: 'air', client: 'ab_cl_6', rx: 'ab_cs_6a', cargo: 'boxes', desc: '2 boxes — prescription medicines and a laptop', origin: 'Newark, NJ', dest: 'NG', created: -3, eta: 2, flight: 'ET509', kg: 38, price: 310, inv: 'paid' },
  { n: 12, status: 'in_transit', mode: 'ocean', client: 'ab_cl_8', rx: 'ab_cs_8a', cargo: 'boxes', desc: '15 boxes — library books (delayed: transhipment in Algeciras)', origin: 'Philadelphia, PA', dest: 'GH', created: -38, eta: 6, vessel: ['Grande Dakar', '247321600'], delayed: 11, kg: 300, price: 560, inv: 'overdue' },
  // arrived and clearing
  { n: 13, status: 'arrived', mode: 'ocean', client: 'ab_cl_4', rx: 'ab_cs_4a', cargo: 'barrels', desc: '4 barrels — mission supplies for Takoradi', origin: 'New York, NY', dest: 'GH', created: -48, eta: -3, cn: 'ab_cn_2', kg: 380, price: 560, inv: 'overdue' },
  { n: 14, status: 'customs', mode: 'ocean', client: 'ab_cl_5', rx: 'ab_cs_5b', cargo: 'vehicle', desc: '2017 Lexus RX 350 — with Osei Clearing at Tema', origin: 'Jersey City, NJ', dest: 'GH', created: -49, eta: -3, cn: 'ab_cn_2', kg: 1950, price: 1750, inv: 'sent' },
  { n: 15, status: 'customs', mode: 'ocean', client: 'ab_cl_2', rx: 'ab_cs_2a', cargo: 'pallets', desc: '2 pallets — generator and solar batteries', origin: 'Brooklyn, NY', dest: 'NG', created: -44, eta: -4, vessel: ['Grande Nigeria', '247298400'], kg: 640, price: 1280, inv: 'paid' },
  { n: 16, status: 'customs', mode: 'air', client: 'ab_cl_7', rx: null, cargo: 'boxes', desc: '1 box — phones and accessories (no receiver on file)', origin: 'Bronx, NY', dest: 'GH', created: -6, eta: -1, flight: 'DL156', kg: 18, price: 190, inv: 'sent' },
  // ready at the destination
  { n: 17, status: 'ready_for_collection', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1a', cargo: 'barrels', desc: '4 barrels — collection at the Kumasi depot', origin: 'Newark, NJ', dest: 'GH', created: -52, eta: -7, collect: true, vessel: ['Maersk Lagos', '219018275'], kg: 370, price: 520, inv: 'paid' },
  { n: 18, status: 'ready_for_collection', mode: 'ocean', client: 'ab_cl_3', rx: 'ab_cs_3a', cargo: 'boxes', desc: '6 boxes — collection at the Lomé agent', origin: 'Philadelphia, PA', dest: 'TG', created: -50, eta: -6, collect: true, vessel: ['Grande Togo', '247301200'], kg: 130, price: 300, inv: 'sent' },
  { n: 19, status: 'out_for_delivery', mode: 'ocean', client: 'ab_cl_8', rx: 'ab_cs_8a', cargo: 'pallets', desc: '2 pallets — school desks for Cape Coast', origin: 'Philadelphia, PA', dest: 'GH', created: -55, eta: -6, vessel: ['Maersk Lagos', '219018275'], kg: 520, price: 980, inv: 'paid' },
  { n: 20, status: 'out_for_delivery', mode: 'air', client: 'ab_cl_6', rx: 'ab_cs_6a', cargo: 'boxes', desc: '3 boxes — baby things and clothing', origin: 'Newark, NJ', dest: 'NG', created: -8, eta: -1, flight: 'ET509', kg: 41, price: 330, inv: 'paid' },
  // done
  { n: 21, status: 'delivered', mode: 'ocean', client: 'ab_cl_5', rx: 'ab_cs_5a', cargo: 'vehicle', desc: '2016 Toyota Camry SE', origin: 'Jersey City, NJ', dest: 'GH', created: -78, eta: -36, vessel: ['MSC Tema Star', '636092514'], kg: 1450, price: 1600, inv: 'paid' },
  { n: 22, status: 'delivered', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1a', cargo: 'barrels', desc: '5 barrels — Christmas provisions', origin: 'Newark, NJ', dest: 'GH', created: -70, eta: -28, vessel: ['Maersk Lagos', '219018275'], kg: 470, price: 650, inv: 'paid' },
  { n: 23, status: 'delivered', mode: 'air', client: 'ab_cl_2', rx: 'ab_cs_2a', cargo: 'boxes', desc: '2 boxes — car parts (sensors and a starter motor)', origin: 'Brooklyn, NY', dest: 'NG', created: -21, eta: -15, flight: 'ET509', kg: 26, price: 260, inv: 'paid' },
  { n: 24, status: 'delivered', mode: 'ocean', client: 'ab_cl_3', rx: 'ab_cs_3a', cargo: 'barrels', desc: '3 barrels — for the family in Lomé', origin: 'Philadelphia, PA', dest: 'TG', created: -90, eta: -48, vessel: ['Grande Togo', '247301200'], kg: 280, price: 420, inv: 'paid' },
  // cancelled
  { n: 25, status: 'booked', mode: 'ocean', client: 'ab_cl_7', rx: null, cargo: 'vehicle', desc: '2015 Nissan Altima — customer sold the car before pickup', origin: 'Bronx, NY', dest: 'GH', created: -16, eta: 25, cancelled: 'Customer sold the car before pickup.', kg: 1400, price: 1500, inv: 'none' },
  // two for the demo customer account, so the customer side shows Atlantic Bridge too
  { n: 26, status: 'in_transit', mode: 'ocean', client: 'ab_cl_1', rx: 'ab_cs_1a', cargo: 'barrels', desc: '2 barrels — Abena’s gifts for Kumasi (via Atlantic Bridge)', origin: 'Newark, NJ', dest: 'GH', created: -18, eta: 9, cn: 'ab_cn_1', user: 'u_demo', kg: 180, price: 290, inv: 'paid' },
  { n: 27, status: 'booked', mode: 'air', client: 'ab_cl_6', rx: 'ab_cs_6a', cargo: 'boxes', desc: '1 box — documents and a phone, air to Abuja', origin: 'Newark, NJ', dest: 'NG', created: -0.2, eta: 5, user: 'u_demo', kg: 9, price: 140, inv: 'sent' },
]

/** When each stage happened, spread between booking and now (or the ETA for the destination stages). */
function stageDates(s: Ship): Record<St, number> {
  const air = s.mode === 'air'; const c = s.created
  const d: Partial<Record<St, number>> = { booked: c }
  const dep = air ? c + 1.5 : c + 8
  d.picked_up = c + (air ? 0.4 : 2); d.at_origin_port = c + (air ? 0.9 : 5); d.in_transit = dep
  const arr = s.status === 'in_transit' ? s.eta : Math.min(s.eta, -0.5)
  d.arrived = arr; d.customs = arr + (air ? 0.2 : 1); d.ready_for_collection = arr + (air ? 0.6 : 3); d.out_for_delivery = arr + (air ? 0.7 : 3.5); d.delivered = arr + (air ? 0.9 : 4)
  // keep everything in the past and in order
  let last = -Infinity; const idx = FLOW.indexOf(s.status)
  for (const st of FLOW.slice(0, idx + 1)) { let v = Math.min(d[st]!, -0.05 * (idx - FLOW.indexOf(st))); if (v <= last) v = last + 0.05; d[st] = v; last = v }
  return d as Record<St, number>
}
function place(s: Ship, st: St) {
  const port = { GH: s.mode === 'air' ? 'Kotoka Airport, Accra' : 'Tema', NG: s.mode === 'air' ? (s.rx === 'ab_cs_6a' ? 'Nnamdi Azikiwe Airport, Abuja' : 'Murtala Muhammed Airport, Lagos') : 'Apapa, Lagos', TG: s.mode === 'air' ? 'Lomé Airport' : 'Port of Lomé' }[s.dest]
  const rxs: readonly (readonly unknown[])[] = CLIENTS.flatMap((c) => c.rx as readonly (readonly unknown[])[])
  const city = (rxs.find((r) => r[0] === s.rx)?.[4] as string | undefined) ?? port
  return { booked: s.origin, picked_up: 'Atlantic Bridge warehouse, Newark', at_origin_port: s.mode === 'air' ? 'Newark Liberty Airport (EWR)' : 'Port Newark', in_transit: s.mode === 'air' ? 'In flight' : 'Atlantic Ocean', arrived: port, customs: port, ready_for_collection: s.collect ? `${city} depot` : port, out_for_delivery: city, delivered: city }[st]
}
const NOTE: Partial<Record<St, string>> = { booked: 'Booking confirmed.', picked_up: 'Collected and checked in at the warehouse.', at_origin_port: 'Delivered to the port for loading.', in_transit: 'Departed.', arrived: 'Arrived at destination.', customs: 'With customs for clearance.', ready_for_collection: 'Ready — collection code sent to the receiver.', out_for_delivery: 'On the van for delivery today.', delivered: 'Delivered and signed for.' }

export async function seedAtlanticBridgeDemo(db: Db) {
  if (process.env.DEMO_ATLANTIC === 'false') return
  const { rows: sh } = await db.query(`select 1 from shippers where id = $1`, [SID]); if (!sh[0]) return
  const { rows: done } = await db.query(`select 1 from shipments where id = 'ab_s_01'`); if (done[0]) return
  const { rows: u } = await db.query<Row>(`select id from users where id = any($1::text[])`, [['u_ab', 'u_demo']]); const users = new Set(u.map((x) => x.id))

  /* staff logins + vans */
  const hash = await bcrypt.hash('shipsync', 10)
  const STAFF = [['ab_st_disp', 'u_ab_disp', 'Abigail Tetteh', 'dispatch@atlanticbridge.demo', '+1 973 555 0301', 'dispatcher', 'origin', 'Newark, NJ'], ['ab_st_fin', 'u_ab_fin', 'Samuel Ansah', 'finance@atlanticbridge.demo', '+1 973 555 0302', 'finance', 'origin', 'Newark, NJ'], ['ab_st_wh', 'u_ab_wh', 'Peter Danquah', 'warehouse@atlanticbridge.demo', '+1 973 555 0303', 'warehouse', 'origin', 'Newark, NJ'], ['ab_st_pick', 'u_ab_pick', 'Kofi Boateng', 'driver@atlanticbridge.demo', '+1 973 555 0304', 'pickup_driver', 'origin', 'Newark, NJ'], ['ab_st_del', 'u_ab_del', 'Yaw Owusu', 'tema.driver@atlanticbridge.demo', '+233 24 555 0305', 'delivery_driver', 'destination', 'Accra']]
  for (const [sid, uid, name, email, phone, role, base, city] of STAFF) {
    await db.query(`insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,'shipper',$5) on conflict (email) do nothing`, [uid, email, name, hash, SID])
    await db.query(`insert into staff (id,shipper_id,user_id,name,email,phone,role,status,base,city) values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9) on conflict (shipper_id, email) do nothing`, [sid, SID, uid, name, email, phone, role, base, city])
  }
  await db.query(`insert into vehicles (id,shipper_id,name,type,plate,capacity_kg,base,city,country,status,driver_id,notes) values
    ('ab_vh_1',$1,'Newark box truck','box_truck','NJ AB-4471',4000,'origin','Newark, NJ','US','on_run','ab_st_pick','24ft with liftgate — barrels, pallets, appliances.'),
    ('ab_vh_2',$1,'Tema delivery van','van','GT 2210-23',1300,'destination','Tema','GH','available','ab_st_del','Sprinter for Tema, Accra and Kasoa drops.'),
    ('ab_vh_3',$1,'Car trailer','trailer','NJ TR-0912',3500,'origin','Newark, NJ','US','available',null,'Two-car trailer for dealer pickups.')
    on conflict (id) do nothing`, [SID])

  /* clients + receivers */
  for (const c of CLIENTS) {
    await db.query(`insert into clients (id,shipper_id,name,company,email,phone,whatsapp,city,tags,notes,source,created_at) values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'manual',$10) on conflict (id) do nothing`, [c.id, SID, c.name, c.company, c.email, c.phone, c.city, JSON.stringify(c.tags), c.notes, at(-120)])
    for (const [id, name, phone, address, city, country, rel, def] of c.rx) await db.query(`insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`, [id, c.id, name, phone, address, city, country, rel, def])
  }

  /* containers */
  for (const c of CONTAINERS) {
    await db.query(`insert into containers (id,shipper_id,ref,number,size,line,booking_ref,seal,vessel_name,mmsi,voyage,origin_port,destination,destination_port,cutoff_date,etd,eta,status,notes,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Port Newark',$12,$13,$14,$15,$16,$17,$18,$19) on conflict (id) do nothing`,
      [c.id, SID, c.ref, c.number, c.size, c.line, c.booking, c.seal, c.vessel, c.mmsi, c.voyage, c.dest, c.port, day(c.cutoff), day(c.etd), day(c.eta), c.status, c.notes, at(c.created)])
    for (const [st, d, pl, note] of c.ev) await db.query(`insert into container_events (container_id,status,at,place,note,by_name) values ($1,$2,$3,$4,$5,'Kwame Asante')`, [c.id, st, at(d), pl, note])
  }

  /* shipments, events and invoices */
  let invNo = 40
  for (const s of SHIPS) {
    const id = `ab_s_${String(s.n).padStart(2, '0')}`; const ref = `SS-AB${String(1000 + s.n * 37).slice(-4)}${'KMPQRTWXYZ'[s.n % 10]}`
    const client = CLIENTS.find((c) => c.id === s.client)!
    const cn = s.cn ? CONTAINERS.find((c) => c.id === s.cn) : undefined
    const dates = stageDates(s); const idx = FLOW.indexOf(s.status)
    const vessel = cn?.vessel || s.vessel?.[0] || null; const mmsi = cn?.mmsi || s.vessel?.[1] || null
    const eta = day(s.eta); const etaOrig = s.delayed ? day(s.eta - s.delayed) : null
    await db.query(`insert into shipments (id,ref,shipper_id,user_id,client_id,consignee_id,mode,origin,destination,cargo,description,status,eta,eta_original,customer,vessel_name,mmsi,flight,departed_at,container_id,handover,ready_at,collection_code,delivered_at,cancelled_at,cancel_reason,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) on conflict (id) do nothing`,
      [id, ref, SID, s.user && users.has(s.user) ? s.user : null, s.client, s.rx, s.mode, s.origin, s.dest, s.cargo, s.desc, s.status, eta, etaOrig, client.name, s.mode === 'ocean' && idx >= 3 ? vessel : null, s.mode === 'ocean' && idx >= 3 ? mmsi : null, s.mode === 'air' ? s.flight ?? null : null, idx >= 3 ? at(dates.in_transit) : null, s.cn ?? null, s.collect ? 'collection' : 'delivery',
        idx >= 6 ? at(dates.ready_for_collection) : null, s.collect && s.status === 'ready_for_collection' ? String(randomInt(100000, 1000000)) : null, s.status === 'delivered' ? at(dates.delivered) : null, s.cancelled ? at(s.created + 3) : null, s.cancelled ?? null, at(s.created)])
    for (const st of FLOW.slice(0, idx + 1)) {
      if (s.collect && st === 'out_for_delivery') continue
      if (!s.collect && st === 'ready_for_collection') continue
      let note = NOTE[st] ?? ''
      if (st === 'in_transit') note = s.mode === 'air' ? `Departed on ${s.flight}.` : `Sailed on ${vessel ?? 'the vessel'}.`
      if (st === 'picked_up' && cn) note = `Collected; going into ${cn.ref}.`
      if (st === 'in_transit' && s.delayed) note += ` Transhipment delay in Algeciras — new ETA ${eta}.`
      await db.query(`insert into shipment_events (shipment_id,status,at,place,note) values ($1,$2,$3,$4,$5)`, [id, st, at(dates[st]), place(s, st), note])
    }
    if (s.cancelled) await db.query(`insert into shipment_events (shipment_id,status,at,place,note) values ($1,'booked',$2,$3,$4)`, [id, at(s.created + 3), s.origin, `Cancelled: ${s.cancelled}`])

    // invoice
    if (s.inv && s.inv !== 'none') {
      invNo++; const iid = `ab_inv_${s.n}`; const issued = s.created + 0.5; const due = s.inv === 'overdue' ? -9 : issued + 30
      const items = [{ description: `${s.mode === 'air' ? 'Air' : 'Ocean'} freight, ${s.origin} → ${({ GH: 'Ghana', NG: 'Nigeria', TG: 'Togo' })[s.dest]} (${s.desc.split(' — ')[0]})`, qty: 1, unit: Math.round(s.price * 0.88) }, { description: s.collect ? 'Destination handling & depot storage (7 days)' : 'Pickup, handling & door delivery', qty: 1, unit: s.price - Math.round(s.price * 0.88) }]
      const status = s.inv === 'paid' ? 'paid' : s.inv === 'draft' ? 'draft' : 'sent'
      await db.query(`insert into invoices (id,shipper_id,client_id,shipment_id,number,status,items,subtotal,tax,total,issued_at,due_at,notes,sent_at) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9,$10,$11,$12) on conflict (id) do nothing`,
        [iid, SID, s.client, id, `AB-2026-${String(invNo).padStart(4, '0')}`, status, JSON.stringify(items), s.price, day(issued), day(due), s.dest === 'GH' ? 'Duty and port charges at Tema are paid by the receiver.' : '', status === 'draft' ? null : at(issued)])
      if (s.inv === 'paid') await db.query(`insert into payments (id,invoice_id,amount,method,at,note) values ($1,$2,$3,$4,$5,'Paid in full') on conflict (id) do nothing`, [`ab_pay_${s.n}`, iid, s.price, s.n % 3 ? 'bank' : 'zelle', day(issued + 2)])
      if (s.inv === 'deposit') await db.query(`insert into payments (id,invoice_id,amount,method,at,note) values ($1,$2,$3,'bank',$4,'Deposit') on conflict (id) do nothing`, [`ab_pay_${s.n}`, iid, Math.round(s.price * 0.5), day(issued + 1)])
    }
  }

  /* customs brokers on two clearing shipments */
  const brokers = (await db.query<Row>(`select id from brokers where id = any($1::text[])`, [['brk_tema_1', 'brk_lag_1']])).rows.map((b) => b.id)
  const job = async (jid: string, ship: string, broker: string, status: string, fee: number, duty: [number, string] | null, ref: string, tl: [string, number, string, string][]) => {
    if (!brokers.includes(broker)) return
    await db.query(`insert into broker_jobs (id,shipment_id,broker_id,shipper_id,booked_by,booked_by_role,status,fee_usd,duty_local,duty_currency,reference,notes,token,timeline,port,created_at,updated_at) values ($1,$2,$3,$4,'Kwame Asante','shipper',$5,$6,$7,$8,$9,'',$10,$11,$12,$13,$14) on conflict (id) do nothing`,
      [jid, ship, broker, SID, status, fee, duty?.[0] ?? null, duty?.[1] ?? null, ref, randomBytes(18).toString('base64url'), JSON.stringify(tl.map(([st, d, by, note]) => ({ at: at(d).toISOString(), status: st, by, note }))), broker === 'brk_lag_1' ? 'Apapa' : 'Tema', at(tl[0][1]), at(tl[tl.length - 1][1])])
  }
  await job('ab_bj_1', 'ab_s_14', 'brk_tema_1', 'assessed', 260, [21850, 'GHS'], 'ICUMS-40221-26', [['requested', -4, 'Kwame Asante', 'Lexus RX 350 from CN-AB-098.'], ['accepted', -3.8, 'Kwabena Osei', ''], ['documents', -2, 'Kwabena Osei', 'Declaration lodged.'], ['assessed', -0.6, 'Kwabena Osei', 'Duty assessed — receiver to pay before release.']])
  await job('ab_bj_2', 'ab_s_15', 'brk_lag_1', 'documents', 320, null, 'NCS-PAAR-7713', [['requested', -4, 'Kwame Asante', 'Generator + batteries, Form M attached.'], ['accepted', -3.5, 'Chinedu Okafor', ''], ['documents', -1.5, 'Chinedu Okafor', 'PAAR submitted.']])

  /* today's runs */
  await db.query(`insert into runs (id,shipper_id,name,kind,run_date,driver_id,vehicle_id,start_label,start_lat,start_lon,status,distance_km,notes,created_at) values
    ('ab_run_1',$1,'NJ & NYC pickups','pickup',$2,'ab_st_pick','ab_vh_1','Atlantic Bridge warehouse, Newark',40.7357,-74.1724,'in_progress',58.4,'Sienna needs the car trailer — collect last.',$4),
    ('ab_run_2',$1,'Tema & Accra deliveries','delivery',$2,'ab_st_del','ab_vh_2','Tema depot',5.6698,-0.0166,'planned',41.0,'Call each receiver the evening before.',$4),
    ('ab_run_3',$1,'Brooklyn & Bronx pickups','pickup',$3,'ab_st_pick','ab_vh_1','Atlantic Bridge warehouse, Newark',40.7357,-74.1724,'done',47.5,'',$5)
    on conflict (id) do nothing`, [SID, day(0), day(-7), at(-1), at(-8)])
  await db.query(`insert into run_stops (id,run_id,seq,shipment_id,label,address,lat,lon,contact,phone,status,done_at) values
    ('ab_stp_1','ab_run_1',0,null,'Walk-in — Ofori Provisions, 2 pallets of stock','214 Ferry St, Newark, NJ',40.7259,-74.1563,'Kwaku Ofori','+1 973 555 0121','done',$1),
    ('ab_stp_1b','ab_run_1',1,'ab_s_01','Kwaku Ofori — 5 barrels','214 Ferry St, Newark, NJ',40.7259,-74.1563,'Kwaku Ofori','+1 973 555 0121','pending',null),
    ('ab_stp_2','ab_run_1',2,'ab_s_04','Esi Arthur — 2 barrels','880 Grand Concourse, Bronx, NY',40.8264,-73.9227,'Esi Arthur','+1 347 555 0245','pending',null),
    ('ab_stp_3','ab_run_1',3,'ab_s_02','Grace Adeyemi — 2018 Toyota Sienna','455 Eastern Pkwy, Brooklyn, NY',40.6712,-73.9496,'Grace Adeyemi','+1 718 555 0134','pending',null),
    ('ab_stp_4','ab_run_2',0,'ab_s_19','Bright Horizons — 2 pallets (Cape Coast)','Aggrey Memorial School, Cape Coast',5.1053,-1.2466,'Mr. Francis Quansah','+233 24 555 0267','pending',null),
    ('ab_stp_5','ab_run_3',0,'ab_s_05','Kwaku Ofori — 3 barrels','214 Ferry St, Newark, NJ',40.7259,-74.1563,'Kwaku Ofori','+1 973 555 0121','done',$2),
    ('ab_stp_6','ab_run_3',1,'ab_s_06','Mawuli Agbeko — 8 boxes','5120 Baltimore Ave, Philadelphia, PA',39.9476,-75.2265,'Mawuli Agbeko','+1 215 555 0156','done',$2)
    on conflict (id) do nothing`, [at(-0.1), at(-7)])
  console.log(`[demo] Atlantic Bridge: ${SHIPS.length} shipments, ${CONTAINERS.length} containers, ${CLIENTS.length} clients, ${STAFF.length} staff logins`)
}

/**
 * Payments & payouts for the Atlantic Bridge demo: card payments in escrow (held, released, paid out,
 * refunded, one still at checkout), payments recorded as paid directly, two paid payouts, one payout
 * waiting for Ntemtem, and a payout bank account. Runs once (marker: esc_ab_01), after the shipments.
 */
export async function seedAtlanticPaymentsDemo(db: Db) {
  if (process.env.DEMO_ATLANTIC === 'false') return
  const { rows: ok } = await db.query(`select 1 from shipments where id = 'ab_s_01'`); if (!ok[0]) return
  const { rows: done } = await db.query(`select 1 from escrow_payments where id = 'esc_ab_01'`); if (done[0]) return
  const { getSettings } = await import('./payments'); const cfg = await getSettings(db)
  const r2 = (n: number) => Math.round(n * 100) / 100
  const { rows: ships } = await db.query<Row>(`select id, ref, origin, destination, mode, user_id, description from shipments where shipper_id = $1 and id like 'ab_s_%'`, [SID])
  const S = new Map(ships.map((s) => [s.id, s]))
  // n, shipment, amount, status, paid (days ago), released (days ago), payout, method, extra
  const P: [number, string, number, string, number, number | null, string | null, string, Record<string, string>?][] = [
    [1, 'ab_s_21', 1600, 'paid_out', 74, 70, 'po_ab_1', 'card'],
    [2, 'ab_s_22', 650, 'paid_out', 66, 62, 'po_ab_1', 'card'],
    [3, 'ab_s_24', 420, 'paid_out', 86, 82, 'po_ab_1', 'card'],
    [4, 'ab_s_19', 980, 'paid_out', 52, 47, 'po_ab_2', 'card'],
    [5, 'ab_s_17', 520, 'paid_out', 50, 44, 'po_ab_2', 'card'],
    [6, 'ab_s_23', 260, 'paid_out', 20, 18, 'po_ab_2', 'card'],
    [7, 'ab_s_15', 1280, 'released', 42, 36, 'po_ab_3', 'card'],
    [8, 'ab_s_20', 330, 'released', 7, 5.5, 'po_ab_3', 'card'],
    [9, 'ab_s_09', 780, 'released', 19, 12, null, 'card'],
    [10, 'ab_s_26', 290, 'released', 17, 12, null, 'card'],
    [11, 'ab_s_11', 310, 'released', 3, 1.5, null, 'card'],
    [12, 'ab_s_07', 1350, 'held', 11, null, null, 'card'],
    [13, 'ab_s_27', 140, 'held', 0.1, null, null, 'card'],
    [14, 'ab_s_06', 360, 'held', 4, null, null, 'card'],
    [15, 'ab_s_10', 2050, 'direct', 18, null, null, 'bank', { recorded_by: 'Samuel Ansah', note: 'Deposit by wire — Mensah Motors' }],
    [16, 'ab_s_05', 195, 'direct', 5, null, null, 'cash', { recorded_by: 'Peter Danquah', note: 'Cash at the warehouse on drop-off' }],
    [17, 'ab_s_14', 875, 'direct', 47, null, null, 'mobile_money', { recorded_by: 'Samuel Ansah', note: 'MoMo from Ama Mensah in Accra' }],
    [18, 'ab_s_25', 300, 'refunded', 15, null, null, 'card', { refund_reason: 'Customer sold the car before pickup — booking deposit refunded in full.' }],
    [19, 'ab_s_03', 420, 'pending', 0.3, null, null, 'card'],
  ]
  const ago = (d: number) => new Date(Date.now() - d * DAY)
  for (const [n, sid, amount, status, paid, rel, po, method, x] of P) {
    const s = S.get(sid); if (!s) continue
    const direct = status === 'direct'; const fee = direct || status === 'pending' || status === 'refunded' ? 0 : r2(amount * cfg.takeRatePct)
    const items = [{ description: `${s.mode === 'air' ? 'Air' : 'Ocean'} freight ${s.origin} → ${s.destination} — ${s.ref}`, amountUsd: amount, kind: 'freight' }]
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,fee_usd,net_usd,status,provider,method,paid_at,released_at,release_reason,refunded_at,refund_reason,payout_id,recorded_by,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) on conflict (id) do nothing`,
      [`esc_ab_${String(n).padStart(2, '0')}`, sid, SID, s.user_id, JSON.stringify(direct && x?.note ? [{ ...items[0], description: `${items[0].description} · ${x.note}` }] : items), amount, fee, r2(amount - fee), status, direct ? 'manual' : 'stripe', status === 'pending' ? null : method,
        status === 'pending' ? null : ago(paid), rel != null ? ago(rel) : null, rel != null ? 'status:in_transit' : null, status === 'refunded' ? ago(paid - 2) : null, x?.refund_reason ?? null, po, x?.recorded_by ?? null, ago(paid + 0.02)])
  }
  const net = (po: string) => r2(P.filter((p) => p[6] === po).reduce((t, p) => t + p[2] - r2(p[2] * cfg.takeRatePct), 0))
  const bank = { bankName: 'TD Bank', accountName: 'Atlantic Bridge Logistics LLC', accountNumber: '····8203', routing: '····0260', country: 'US', mobileMoney: '' }
  await db.query(`update shippers set payout_details = $2 where id = $1 and (payout_details is null or payout_details = '{}'::jsonb)`, [SID, JSON.stringify({ ...bank, accountNumber: '4471028203', routing: '031201360' })])
  await db.query(`insert into payouts (id,shipper_id,amount_usd,status,method,details,reference,note,requested_by,requested_at,paid_at,paid_by) values
    ('po_ab_1',$1,$2,'paid','bank',$5,'ACH 55102-AB','','Kwame Asante',$6,$7,'Ntemtem'),
    ('po_ab_2',$1,$3,'paid','bank',$5,'ACH 61877-AB','','Samuel Ansah',$8,$9,'Ntemtem'),
    ('po_ab_3',$1,$4,'requested','bank',$5,'','Before the Friday container payment, please.','Kwame Asante',$10,null,null)
    on conflict (id) do nothing`, [SID, net('po_ab_1'), net('po_ab_2'), net('po_ab_3'), JSON.stringify(bank), ago(60), ago(58), ago(16), ago(14), ago(0.6)])
  console.log('[demo] Atlantic Bridge: payments and payouts added')
}
