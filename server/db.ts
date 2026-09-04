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
  await ensureAdmins(db)
  await seedClientDemo(db)
  await seedOpsDemo(db)
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
alter table users add column if not exists is_admin boolean not null default false;
create table if not exists clients (
  id text primary key,
  shipper_id text not null references shippers(id) on delete cascade,
  user_id text references users(id),
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  city text not null default '',
  tags jsonb not null default '[]',
  notes text not null default '',
  source text not null default 'manual',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipper_id, user_id)
);
create table if not exists client_consignees (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  name text not null,
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default 'GH',
  relationship text not null default '',
  is_default boolean not null default false
);
create table if not exists client_activities (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  shipper_id text not null,
  type text not null,
  body text not null default '',
  at timestamptz not null default now(),
  due_at timestamptz,
  done boolean not null default false,
  created_by text
);
create table if not exists invoices (
  id text primary key,
  shipper_id text not null references shippers(id) on delete cascade,
  client_id text not null references clients(id) on delete cascade,
  shipment_id text references shipments(id) on delete set null,
  number text not null,
  status text not null default 'draft',
  currency text not null default 'USD',
  items jsonb not null default '[]',
  subtotal int not null default 0,
  tax int not null default 0,
  total int not null default 0,
  issued_at date not null default current_date,
  due_at date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (shipper_id, number)
);
create table if not exists payments (
  id text primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  amount int not null,
  method text not null default 'bank',
  at date not null default current_date,
  note text not null default ''
);
create table if not exists staff (
  id text primary key,
  shipper_id text not null references shippers(id) on delete cascade,
  user_id text references users(id),
  name text not null,
  email text not null,
  phone text not null default '',
  role text not null default 'agent',
  status text not null default 'invited',
  base text not null default 'origin',
  city text not null default '',
  invite_token text,
  created_at timestamptz not null default now(),
  unique (shipper_id, email)
);
create table if not exists vehicles (
  id text primary key,
  shipper_id text not null references shippers(id) on delete cascade,
  name text not null,
  type text not null default 'van',
  plate text not null default '',
  capacity_kg int,
  capacity_note text not null default '',
  base text not null default 'origin',
  city text not null default '',
  country text not null default '',
  status text not null default 'available',
  driver_id text references staff(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists runs (
  id text primary key,
  shipper_id text not null references shippers(id) on delete cascade,
  name text not null,
  kind text not null default 'delivery',
  run_date date not null,
  driver_id text references staff(id) on delete set null,
  vehicle_id text references vehicles(id) on delete set null,
  start_label text not null default '',
  start_lat double precision,
  start_lon double precision,
  status text not null default 'planned',
  distance_km real,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists run_stops (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  seq int not null default 0,
  shipment_id text references shipments(id) on delete set null,
  label text not null,
  address text not null default '',
  lat double precision,
  lon double precision,
  contact text not null default '',
  phone text not null default '',
  status text not null default 'pending',
  done_at timestamptz,
  note text not null default ''
);
create table if not exists geocache (
  q text primary key,
  lat double precision,
  lon double precision,
  label text,
  at timestamptz not null default now()
);
create index if not exists idx_staff_shipper on staff(shipper_id);
create index if not exists idx_staff_user on staff(user_id);
create index if not exists idx_runs_shipper on runs(shipper_id);
create index if not exists idx_stops_run on run_stops(run_id);
alter table shipments add column if not exists client_id text references clients(id);
alter table shipments add column if not exists consignee_id text;
create index if not exists idx_clients_shipper on clients(shipper_id);
create index if not exists idx_activities_client on client_activities(client_id);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_shipments_client on shipments(client_id);
alter table shippers add column if not exists verified_at timestamptz;
alter table shippers add column if not exists verified_by text;
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

/** Admin accounts: the demo admin (password `shipsync`) plus any emails in ADMIN_EMAILS. Idempotent, runs on every boot. */
async function ensureAdmins(d: Db) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10)
  await d.query(`insert into users (id,email,name,password_hash,role,shipper_id,is_admin) values ('u_admin','admin@shipsync.demo','Ship Sync Admin',$1,'customer',null,true) on conflict (email) do update set is_admin = true`, [hash])
  const extra = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (extra.length) await d.query('update users set is_admin = true where email = any($1::text[])', [extra])
}

/** A sample offline client for the Gold Coast demo shipper so the client workspace has something to show. Idempotent. */
async function seedClientDemo(d: Db) {
  const { rows } = await d.query<{ n: string }>(`select count(*)::text as n from clients where shipper_id = 'gold-coast-freight' and source = 'manual'`)
  if (Number(rows[0].n) > 0) return
  const cid = 'cl_demo_kofi'
  await d.query(`insert into clients (id,shipper_id,name,company,email,phone,whatsapp,city,tags,notes,source) values ($1,'gold-coast-freight','Kofi Mensah','Mensah Auto Parts','kofi@mensahparts.com','+1 713 555 0188','+1 713 555 0188','Houston, TX','["repeat","vehicles","wholesale"]','Ships 1–2 vehicles a quarter plus spare parts. Prefers WhatsApp. Pays by bank transfer, usually within a week.','manual')`, [cid])
  await d.query(`insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,is_default) values ('cs_demo_1',$1,'Yaw Mensah','+233 24 555 0190','Plot 14, Spintex Road','Accra','GH','Brother',true), ('cs_demo_2',$1,'Adwoa Mensah','+233 20 555 0177','Adum, near Kejetia','Kumasi','GH','Sister',false)`, [cid])
  const now = Date.now()
  const acts: [string, string, string, number, number | null][] = [
    ['ac_demo_1', 'call', 'Called about the Q4 vehicle shipment — wants a 2018 RAV4 collected from a dealer in Katy, TX. Sending quote Monday.', -6, null],
    ['ac_demo_2', 'note', 'Consignee in Accra is his brother Yaw; Kumasi deliveries go to Adwoa.', -5, null],
    ['ac_demo_3', 'reminder', 'Follow up on RAV4 quote', -1, 2],
  ]
  for (const [id, type, body, days, due] of acts) await d.query(`insert into client_activities (id,client_id,shipper_id,type,body,at,due_at) values ($1,$2,'gold-coast-freight',$3,$4,$5,$6)`, [id, cid, type, body, new Date(now + days * 86400000), due == null ? null : new Date(now + due * 86400000)])
  await d.query(`insert into invoices (id,shipper_id,client_id,number,status,items,subtotal,tax,total,issued_at,due_at,notes) values ('inv_demo_1','gold-coast-freight',$1,'INV-2026-0001','sent','[{"description":"RoRo ocean freight, Houston → Tema (2017 Honda Accord)","qty":1,"unit":1450},{"description":"Port handling & documentation, Tema","qty":1,"unit":220}]',1670,0,1670,$2,$3,'Duty and destination charges payable by consignee at Tema.')`, [cid, dateOnly(addDays(-12)), dateOnly(addDays(18))])
  await d.query(`insert into payments (id,invoice_id,amount,method,at,note) values ('pay_demo_1','inv_demo_1',800,'bank',$1,'Deposit')`, [dateOnly(addDays(-9))])
}

/** Every shipper user is the owner of their company's staff list; plus a small demo team + fleet for Gold Coast. Idempotent. */
async function seedOpsDemo(d: Db) {
  const { rows: owners } = await d.query<{ id: string; name: string; email: string; shipper_id: string }>(`select u.id, u.name, u.email, u.shipper_id from users u where u.role = 'shipper' and u.shipper_id is not null and not exists (select 1 from staff s where s.user_id = u.id)`)
  for (const u of owners) await d.query(`insert into staff (id,shipper_id,user_id,name,email,role,status,base) values ($1,$2,$3,$4,$5,'owner','active','origin') on conflict (shipper_id, email) do nothing`, ['st_' + uid(), u.shipper_id, u.id, u.name, u.email])
  const { rows } = await d.query<{ n: string }>(`select count(*)::text as n from vehicles where shipper_id = 'gold-coast-freight'`)
  if (Number(rows[0].n) > 0) return
  // Demo drivers get real logins (password `shipsync`) so the driver view can be tried.
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10)
  await d.query(`insert into users (id,email,name,password_hash,role,shipper_id) values ('u_demo_kwesi','kwesi@goldcoast.demo','Kwesi Appiah',$1,'shipper','gold-coast-freight'), ('u_demo_efua','efua@goldcoast.demo','Efua Danso',$1,'shipper','gold-coast-freight') on conflict (email) do nothing`, [hash])
  await d.query(`insert into staff (id,shipper_id,user_id,name,email,phone,role,status,base,city) values
    ('st_demo_kwesi','gold-coast-freight','u_demo_kwesi','Kwesi Appiah','kwesi@goldcoast.demo','+1 713 555 0142','driver','active','origin','Houston, TX'),
    ('st_demo_efua','gold-coast-freight','u_demo_efua','Efua Danso','efua@goldcoast.demo','+233 24 555 0133','driver','active','destination','Accra'),
    ('st_demo_yaa','gold-coast-freight',null,'Yaa Boakye','yaa@goldcoast.demo','+1 713 555 0161','dispatcher','invited','origin','Houston, TX')
    on conflict (shipper_id, email) do nothing`)
  // Two Gold Coast shipments that are ready for a pickup run and a delivery run.
  await d.query(`insert into shipments (id,ref,shipper_id,user_id,client_id,consignee_id,mode,origin,destination,cargo,description,status,eta,customer) values
    ('s_demo_pick','SS-7HQ2ZN','gold-coast-freight',null,'cl_demo_kofi','cs_demo_1','ocean','Katy, TX','GH','pallets','2 pallets of brake parts and filters — collect from dealer in Katy','booked',$1,'Kofi Mensah'),
    ('s_demo_deliv','SS-3PWK8E','gold-coast-freight',null,'cl_demo_kofi','cs_demo_1','ocean','Houston, TX','GH','barrels','3 barrels — household goods for Yaw','arrived',$2,'Kofi Mensah')
    on conflict (id) do nothing`, [dateOnly(addDays(38)), dateOnly(addDays(1))])
  await d.query(`insert into shipment_events (shipment_id,status,at,place,note) values
    ('s_demo_pick','booked',$1,'Katy, TX','Booking confirmed. Pickup to be scheduled.'),
    ('s_demo_deliv','booked',$2,'Houston, TX','Booking confirmed.'), ('s_demo_deliv','picked_up',$3,'Houston, TX','Collected.'), ('s_demo_deliv','at_origin_port',$4,'Port of Houston','Consolidated.'), ('s_demo_deliv','in_transit',$5,'Atlantic Ocean','Sailed on Grande Africa.'), ('s_demo_deliv','arrived',$6,'Tema','Discharged at Tema; cleared customs.')`,
    [addDays(-2), addDays(-40), addDays(-37), addDays(-33), addDays(-30), addDays(-1)])
  await d.query(`update staff set invite_token = $1 where id = 'st_demo_yaa' and invite_token is null`, ['demo-invite-' + uid()])
  await d.query(`insert into vehicles (id,shipper_id,name,type,plate,capacity_kg,base,city,country,status,driver_id,notes) values
    ('vh_demo_1','gold-coast-freight','Box truck 1','box_truck','TX 4KR-882',3500,'origin','Houston, TX','US','available','st_demo_kwesi','26ft box truck with liftgate — barrels and pallets.'),
    ('vh_demo_2','gold-coast-freight','Accra van','van','GR 4521-22',1200,'destination','Accra','GH','available','st_demo_efua','Sprinter van for Accra & Tema deliveries.'),
    ('vh_demo_3','gold-coast-freight','Kumasi pickup','pickup','AS 1188-21',900,'destination','Kumasi','GH','maintenance',null,'Brake service due.')`)
}
