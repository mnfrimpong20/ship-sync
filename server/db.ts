import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { sampleShipments, shippers as seedShippers } from '../src/lib/data'

/** Minimal query interface satisfied by both `pg` and PGlite. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  kind: 'postgres' | 'pglite'
}

let db: Db | null = null

export async function getDb(): Promise<Db> {
  if (db) return db
  const url = process.env.DATABASE_URL
  if (url) {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } })
    db = { kind: 'postgres', query: (sql, params) => pool.query(sql, params as never[]) as never }
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = process.env.PGLITE_DIR || './data/pglite'
    mkdirSync(dir, { recursive: true })
    const lite = await PGlite.create(dir)
    db = { kind: 'pglite', query: (sql, params) => lite.query(sql, params as never[]) as never }
  }
  await migrate(db)
  await seed(db)
  return db
}

export const uid = () => randomBytes(6).toString('hex')
export const makeRef = () => 'SS-' + randomBytes(4).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(0, 6)

const schema = `
create table if not exists users (
  id text primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('customer','shipper')),
  shipper_id text,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists shippers (
  id text primary key,
  name text not null,
  tagline text not null default '',
  hq text not null default '',
  founded int not null,
  modes jsonb not null default '[]',
  destinations jsonb not null default '[]',
  origins jsonb not null default '[]',
  cargo jsonb not null default '[]',
  rating real not null default 0,
  reviews int not null default 0,
  verified boolean not null default false,
  response_hours int not null default 24,
  on_time int not null default 0,
  services jsonb not null default '[]',
  about text not null default '',
  price_index int not null default 2,
  plan text not null default 'starter',
  initials text not null,
  hue text not null default '#E3B54A',
  demo boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists requests (
  id text primary key,
  ref text unique not null,
  user_id text not null references users(id),
  created_at timestamptz not null default now(),
  origin text not null,
  destination text not null,
  mode text not null,
  cargo text not null,
  quantity int not null default 1,
  weight_kg int,
  description text not null default '',
  pickup boolean not null default false,
  delivery boolean not null default false,
  insurance boolean not null default false,
  ready_date date not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  status text not null default 'open'
);
create table if not exists quotes (
  id text primary key,
  request_id text not null references requests(id) on delete cascade,
  shipper_id text not null references shippers(id),
  price int not null,
  currency text not null default 'USD',
  transit_days int not null,
  valid_until date not null,
  notes text not null default '',
  includes jsonb not null default '[]',
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  unique (request_id, shipper_id)
);
create table if not exists shipments (
  id text primary key,
  ref text unique not null,
  request_id text references requests(id),
  shipper_id text not null references shippers(id),
  user_id text references users(id),
  mode text not null,
  origin text not null,
  destination text not null,
  cargo text not null,
  description text not null default '',
  status text not null default 'booked',
  eta date not null,
  customer text not null,
  created_at timestamptz not null default now()
);
create table if not exists shipment_events (
  id serial primary key,
  shipment_id text not null references shipments(id) on delete cascade,
  status text not null,
  at timestamptz not null default now(),
  place text not null,
  note text
);
create table if not exists vessel_positions (
  mmsi text primary key,
  name text,
  lat double precision not null,
  lon double precision not null,
  sog real,
  cog real,
  heading real,
  at timestamptz not null,
  updated timestamptz not null default now()
);
alter table shipments add column if not exists vessel_name text;
alter table shipments add column if not exists mmsi text;
alter table shipments add column if not exists flight text;
alter table shipments add column if not exists departed_at timestamptz;
create index if not exists idx_requests_user on requests(user_id);
create index if not exists idx_quotes_request on quotes(request_id);
create index if not exists idx_shipments_user on shipments(user_id);
create index if not exists idx_shipments_shipper on shipments(shipper_id);
create index if not exists idx_events_shipment on shipment_events(shipment_id);
`

async function migrate(d: Db) {
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) await d.query(stmt)
}

const DEMO_PASSWORD = 'shipsync'
const addDays = (n: number) => new Date(Date.now() + n * 86400000)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

async function seed(d: Db) {
  const { rows } = await d.query<{ n: string }>('select count(*)::text as n from shippers')
  if (Number(rows[0].n) > 0) return
  console.log('[db] seeding demo data')

  for (const s of seedShippers) {
    await d.query(
      `insert into shippers (id,name,tagline,hq,founded,modes,destinations,origins,cargo,rating,reviews,verified,response_hours,on_time,services,about,price_index,plan,initials,hue,demo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true)`,
      [s.id, s.name, s.tagline, s.hq, s.founded, JSON.stringify(s.modes), JSON.stringify(s.destinations), JSON.stringify(s.origins), JSON.stringify(s.cargo), s.rating, s.reviews, s.verified, s.responseHours, s.onTime, JSON.stringify(s.services), s.about, s.priceIndex, s.plan, s.initials, s.hue],
    )
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const users = [
    { id: 'u_demo', email: 'demo@shipsync.demo', name: 'Abena Owusu', role: 'customer', shipper: null },
    { id: 'u_ama', email: 'ama.l@example.com', name: 'Ama Lawson', role: 'customer', shipper: null },
    { id: 'u_chidi', email: 'chidi.o@example.com', name: 'Chidi Okafor', role: 'customer', shipper: null },
    { id: 'u_ab', email: 'ops@atlanticbridge.demo', name: 'Kwame Asante', role: 'shipper', shipper: 'atlantic-bridge' },
    { id: 'u_gc', email: 'ops@goldcoast.demo', name: 'Nana Boateng', role: 'shipper', shipper: 'gold-coast-freight' },
  ]
  for (const u of users) await d.query('insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,$5,$6)', [u.id, u.email, u.name, hash, u.role, u.shipper])

  const reqs = [
    { id: 'r1', ref: 'SS-QT7A2M', user: 'u_demo', days: -3, origin: 'New York, NY', dest: 'GH', mode: 'ocean', cargo: 'barrels', qty: 4, wt: 380, desc: '4 sealed barrels — clothing, provisions, small appliances. Deliver to Kumasi.', pickup: true, delivery: true, ins: true, ready: 7, name: 'Abena Owusu', email: 'demo@shipsync.demo', phone: '+1 917 555 0142' },
    { id: 'r2', ref: 'SS-QX2P9L', user: 'u_ama', days: -1, origin: 'Newark, NJ', dest: 'TG', mode: 'ocean', cargo: 'boxes', qty: 9, wt: 210, desc: '9 boxes of clothing and school supplies for a church in Lomé. Flexible on sailing date.', pickup: true, delivery: false, ins: false, ready: 10, name: 'Ama Lawson', email: 'ama.l@example.com', phone: '+1 973 555 0177' },
    { id: 'r3', ref: 'SS-MV4H7C', user: 'u_chidi', days: -0.3, origin: 'Philadelphia, PA', dest: 'NG', mode: 'either', cargo: 'pallets', qty: 2, wt: 640, desc: '2 pallets of restaurant equipment (fryer, prep tables). Needs delivery to Lekki, Lagos.', pickup: true, delivery: true, ins: true, ready: 5, name: 'Chidi Okafor', email: 'chidi.o@example.com', phone: '+1 215 555 0133' },
  ]
  for (const r of reqs) {
    await d.query(
      `insert into requests (id,ref,user_id,created_at,origin,destination,mode,cargo,quantity,weight_kg,description,pickup,delivery,insurance,ready_date,contact_name,contact_email,contact_phone)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [r.id, r.ref, r.user, addDays(r.days), r.origin, r.dest, r.mode, r.cargo, r.qty, r.wt, r.desc, r.pickup, r.delivery, r.ins, dateOnly(addDays(r.ready)), r.name, r.email, r.phone],
    )
  }
  const quotes = [
    { id: 'q1', req: 'r1', shipper: 'atlantic-bridge', price: 640, days: 34, valid: 10, notes: 'Sails Friday. Door delivery to Kumasi included; duty paid by consignee.', inc: ['Pickup', 'Ocean freight', 'Door delivery Kumasi', 'Insurance'], sent: -2 },
    { id: 'q2', req: 'r1', shipper: 'gold-coast-freight', price: 590, days: 36, valid: 14, notes: 'Pickup from NYC via partner truck. Kumasi delivery by our own van.', inc: ['Pickup', 'Ocean freight', 'Door delivery Kumasi'], sent: -1 },
    { id: 'q3', req: 'r3', shipper: 'naija-direct', price: 1180, days: 31, valid: 12, notes: 'Monthly ocean sailing; Lekki delivery by our Lagos team. Air option available on request.', inc: ['Pickup', 'Ocean freight', 'Door delivery', 'All-risk insurance'], sent: -0.1 },
  ]
  for (const q of quotes) {
    await d.query('insert into quotes (id,request_id,shipper_id,price,transit_days,valid_until,notes,includes,sent_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [q.id, q.req, q.shipper, q.price, q.days, dateOnly(addDays(q.valid)), q.notes, JSON.stringify(q.inc), addDays(q.sent)])
  }

  const transit: Record<string, { vessel?: string; flight?: string }> = { s1: { vessel: 'MSC Alessia' }, s2: { flight: 'BAW75' }, s3: { vessel: 'Grande Africa' } }
  for (const s of sampleShipments) {
    const dep = s.events.find((e) => e.status === 'in_transit')?.at ?? null
    await d.query('insert into shipments (id,ref,shipper_id,user_id,mode,origin,destination,cargo,description,status,eta,customer,vessel_name,flight,departed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [s.id, s.ref, s.shipperId, 'u_demo', s.mode, s.origin, s.destination, s.cargo, s.description, s.status, s.eta, s.customer, transit[s.id]?.vessel ?? null, transit[s.id]?.flight ?? null, dep])
    for (const e of s.events) await d.query('insert into shipment_events (shipment_id,status,at,place,note) values ($1,$2,$3,$4,$5)', [s.id, e.status, e.at, e.place, e.note ?? null])
  }
}
