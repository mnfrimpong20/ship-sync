/**
 * Team & HR demo: HR files, papers, shifts, past payslips, time off and rota for the office and
 * warehouse staff of Gold Coast Freight and the whole Atlantic Bridge team (office + both drivers),
 * so Team & HR and "My pay & time" have something real to show. Dates are relative to the day it runs.
 * Runs once per company (marker: teamDemoSeeded in driver_hr_settings). Off with DEMO_TEAM_HR=false.
 */
import { randomBytes } from 'node:crypto'
import { uid, type Db } from './db'
import { hrSettings, periodFor } from './driverHr'
import { PNG_CARD } from './driverHr2'

type Row = Record<string, any>
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const r2 = (n: number) => Math.round(n * 100) / 100
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const wkday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()

interface Doc { kind: string; title: string; exp?: number | null; status: 'checked' | 'pending' | 'rejected'; note?: string; color?: string }
interface PersonSeed {
  id: string; pay: Row; employment: 'employee' | 'contractor'; country: string; startAgo: number; leaveDays: number
  emergency: Row; payout: Row; expiries?: Record<string, number>; status?: 'active' | 'onboarding'; driver?: boolean; licence?: Row
  docs: Doc[]
  /** Work pattern: start hour (UTC), length in hours, and whether Saturdays are worked. */
  hours?: { start: number; len: number; sat?: boolean }
  /** Fixed lines for the last three payslips (oldest first is i=1). */
  slip?: (i: number) => Row[]
  currency: string; payMethod: string
  rota?: { start: string; end: string; sat?: boolean }
}

async function seedCompany(db: Db, shipperId: string, approver: string, people: PersonSeed[], extras: (ctx: { t: string; cur: { start: string; end: string } }) => Promise<void>) {
  const { rows: mk } = await db.query<Row>(`select settings from driver_hr_settings where shipper_id = $1`, [shipperId])
  if ((mk[0]?.settings && (typeof mk[0].settings === 'string' ? JSON.parse(mk[0].settings) : mk[0].settings).teamDemoSeeded)) return
  const { rows: have } = await db.query<Row>(`select id, name from staff where shipper_id = $1 and id = any($2::text[])`, [shipperId, people.map((p) => p.id)])
  const name = new Map(have.map((x) => [x.id, x.name as string])); const list = people.filter((p) => name.has(p.id)); if (!list.length) return
  const st = await hrSettings(db, shipperId); const t = today(); const cur = periodFor(st, t)

  for (const p of list) {
    const nm = name.get(p.id)!
    await db.query(`update staff set pay = $2 where id = $1 and (pay is null or pay = '{}'::jsonb)`, [p.id, JSON.stringify(p.pay)])
    const exp: Record<string, string> = {}; for (const [k, d] of Object.entries(p.expiries ?? {})) exp[k] = addDays(t, d)
    await db.query(`insert into driver_profiles (staff_id, shipper_id, employment, country, start_date, licence, emergency, payout, expiries, status, contract_signed_at, contract_name, training, leave_days, badge_token) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      on conflict (staff_id) do update set employment = excluded.employment, country = excluded.country, start_date = excluded.start_date, licence = excluded.licence, emergency = excluded.emergency, payout = excluded.payout, expiries = excluded.expiries, status = excluded.status, contract_signed_at = coalesce(driver_profiles.contract_signed_at, excluded.contract_signed_at), contract_name = coalesce(nullif(driver_profiles.contract_name, ''), excluded.contract_name), training = coalesce(driver_profiles.training, excluded.training), leave_days = excluded.leave_days`,
      [p.id, shipperId, p.employment, p.country, addDays(t, -p.startAgo), JSON.stringify(p.licence ?? {}), JSON.stringify(p.emergency), JSON.stringify(p.payout), JSON.stringify(exp), p.status ?? 'active',
        p.driver && p.status !== 'onboarding' ? new Date(Date.now() - (p.startAgo - 2) * 86400000) : null, p.driver ? `${nm} (v1)` : '', p.driver ? JSON.stringify({ score: 88, tries: 1, passedAt: new Date(Date.now() - (p.startAgo - 3) * 86400000).toISOString() }) : null, p.leaveDays, randomBytes(12).toString('base64url')])
    for (const d of p.docs) {
      const im = PNG_CARD(d.title, d.color ?? '#1d4e89')
      await db.query(`insert into driver_docs (id,staff_id,shipper_id,kind,title,data,mime,expires_on,uploaded_by,side,status,review_note,reviewed_by,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,$11,$12, now() - interval '12 days')`,
        ['dd_' + uid(), p.id, shipperId, d.kind, d.title, im.data, im.mime, d.exp == null ? null : addDays(t, d.exp), d.status === 'pending' ? nm : approver, d.status, d.note ?? '', d.status === 'pending' ? '' : approver])
    }
    // Shifts for the last four weeks (office: Mon–Fri; warehouse also some Saturdays), with a lunch break.
    if (p.hours) for (let i = 1; i <= 26; i++) {
      const dd = addDays(t, -i); const w = wkday(dd); if (w === 0 || (w === 6 && !(p.hours.sat && i % 2))) continue
      const start = new Date(`${dd}T${String(p.hours.start).padStart(2, '0')}:${i % 3 ? '00' : '12'}:00Z`); const end = new Date(start.getTime() + (p.hours.len + (i % 4 === 0 ? 1 : 0)) * 3600000)
      const br = [{ start: new Date(start.getTime() + 4 * 3600000).toISOString(), end: new Date(start.getTime() + 4.5 * 3600000).toISOString() }]
      await db.query('insert into shifts (id,shipper_id,staff_id,start_at,end_at,breaks) values ($1,$2,$3,$4,$5,$6)', ['sh_' + uid(), shipperId, p.id, start.toISOString(), end.toISOString(), JSON.stringify(br)])
    }
    // Rota for the next two weeks.
    if (p.rota) for (let n = 0; n < 14; n++) {
      const dd = addDays(t, n); const w = wkday(dd); const kind = w === 0 || (w === 6 && !p.rota.sat) ? 'off' : 'work'
      await db.query(`insert into rota (id,shipper_id,staff_id,day,kind,start_time,end_time,note) values ($1,$2,$3,$4,$5,$6,$7,'') on conflict (staff_id, day) do nothing`, ['ro_' + uid(), shipperId, p.id, dd, kind, kind === 'work' ? p.rota.start : '', kind === 'work' ? p.rota.end : ''])
    }
  }

  // The last three pay periods: two paid, the latest approved and waiting to be paid.
  const per = async (start: string) => { const end = addDays(start, st.periodDays - 1); const { rows } = await db.query<Row>(`insert into pay_periods (id,shipper_id,start_date,end_date,status,locked_by,locked_at) values ($1,$2,$3,$4,'locked',$5,$6) on conflict (shipper_id, start_date) do update set status = 'locked' returning *`, ['pp_' + uid(), shipperId, start, end, approver, `${end}T18:00:00Z`]); return rows[0] }
  const periods = [3, 2, 1].map((n) => addDays(cur.start, -n * st.periodDays))
  let i = 0
  for (const ps of periods) {
    i++; const pp = await per(ps); const endD = DATE(pp.end_date)!; const last = i === 3
    for (const p of list) {
      if (!p.slip || p.status === 'onboarding') continue
      const lines = p.slip(i); const gross = r2(lines.filter((l) => l.kind === 'earning' || l.kind === 'bonus').reduce((n, l) => n + l.amount, 0)); const reimb = r2(lines.filter((l) => l.kind === 'reimbursement').reduce((n, l) => n + l.amount, 0)); const ded = r2(-lines.filter((l) => l.kind === 'deduction').reduce((n, l) => n + l.amount, 0))
      const hrs = lines.filter((l) => /^Hours|^Overtime/.test(l.label)).reduce((n, l) => n + (l.qty ?? 0), 0)
      await db.query(`insert into payslips (id,period_id,shipper_id,staff_id,lines,gross,reimbursed,deducted,net,currency,status,approved_by,approved_at,paid_at,paid_method,paid_ref,stats) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict (period_id, staff_id) do nothing`,
        ['ps_' + uid(), pp.id, shipperId, p.id, JSON.stringify(lines), gross, reimb, ded, r2(gross + reimb - ded), p.currency, last ? 'approved' : 'paid', approver, `${addDays(endD, 1)}T15:00:00Z`, last ? null : `${addDays(endD, st.payDayOffset)}T16:00:00Z`, last ? '' : p.payMethod, last ? '' : `${p.payMethod === 'momo' ? 'MM' : 'ACH'}${70310 + i * 7}`, JSON.stringify({ hours: r2(hrs), stops: 0, runs: 0 })])
    }
  }
  // Shifts and stops before this period count as paid, so the current period starts clean.
  const ids = list.map((p) => p.id)
  await db.query(`update shifts set paid_slip = 'demo' where staff_id = any($1::text[]) and start_at::date < $2::date and paid_slip is null`, [ids, cur.start])
  await db.query(`update run_stops st set paid_slip = 'demo' from runs r where r.id = st.run_id and r.driver_id = any($1::text[]) and st.status = 'done' and st.done_at::date < $2::date and st.paid_slip is null`, [ids, cur.start])
  await db.query(`update runs set paid_slip = 'demo' where driver_id = any($1::text[]) and run_date < $2::date and paid_slip is null`, [ids, cur.start])
  await extras({ t, cur })
  await db.query(`insert into driver_hr_settings (shipper_id, settings) values ($1, $2) on conflict (shipper_id) do update set settings = driver_hr_settings.settings || $2::jsonb`, [shipperId, JSON.stringify({ teamDemoSeeded: true })])
}

const salary = (monthly: number, days: number) => r2((monthly * 12 / 365) * days)

export async function seedTeamHrDemo(db: Db) {
  if (process.env.DEMO_TEAM_HR === 'false') return
  const leave = (shipperId: string, staff: string, kind: string, from: string, to: string, note: string, status: string, by = '') => db.query(`insert into leave_requests (id,shipper_id,staff_id,kind,start_date,end_date,note,status,decided_by,decided_at,at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - interval '2 days')`, ['lv_' + uid(), shipperId, staff, kind, from, to, note, status, by, status === 'pending' ? null : new Date(Date.now() - 86400000)])
  const expense = (shipperId: string, staff: string, kind: string, amount: number, cur: string, usd: number, note: string, status: string, days: number) => db.query(`insert into driver_expenses (id,shipper_id,staff_id,kind,amount,currency,amount_usd,note,status,paid_by,at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'driver', now() - ($10 || ' days')::interval)`, ['dx_' + uid(), shipperId, staff, kind, amount, cur, usd, note, status, String(days)])

  /* ---------------- Gold Coast Freight: finance, warehouse and a new dispatcher ---------------- */
  const gc = 'gold-coast-freight'; const gcDays = (await hrSettings(db, gc)).periodDays
  await seedCompany(db, gc, 'Nana Boateng', [
    { id: 'st_demo_ama', pay: { monthly: 4200, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 640, leaveDays: 18, currency: 'USD', payMethod: 'bank',
      emergency: { name: 'Kwabena Serwaa', phone: '+1 713 555 0175', relation: 'Husband' }, payout: { method: 'bank', bankName: 'Chase', bankLast4: '2210' },
      docs: [{ kind: 'contract', title: 'Employment contract — Finance', status: 'checked', color: '#14213D' }, { kind: 'id', title: 'Texas driver’s licence (ID)', status: 'checked', color: '#2b3a55' }, { kind: 'tax', title: 'W-4 2026', status: 'checked', color: '#0a6842' }],
      hours: { start: 14, len: 8.5 }, rota: { start: '09:00', end: '17:30' },
      slip: () => [{ label: 'Salary (USD 4,200 a month)', kind: 'earning', qty: 1, rate: salary(4200, gcDays), amount: salary(4200, gcDays) }] },
    { id: 'st_demo_kojo', pay: { perHour: 19, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 380, leaveDays: 15, currency: 'USD', payMethod: 'zelle',
      emergency: { name: 'Adjoa Antwi', phone: '+1 832 555 0148', relation: 'Sister' }, payout: { method: 'zelle', zelle: 'kojo.antwi@example.com' }, expiries: { permit: 26 },
      docs: [{ kind: 'contract', title: 'Employment contract — Warehouse', status: 'checked', color: '#14213D' }, { kind: 'id', title: 'Green card', status: 'checked', color: '#0b6b5a' }, { kind: 'certificate', title: 'Forklift certificate (OSHA)', exp: 26, status: 'checked', color: '#8a5a00' }, { kind: 'tax', title: 'W-4 2026', status: 'pending', color: '#0a6842' }],
      hours: { start: 12, len: 9, sat: true }, rota: { start: '07:00', end: '16:00', sat: true },
      slip: (i) => [{ label: 'Hours', kind: 'earning', qty: 40, rate: 19, amount: 760 }, ...(i !== 2 ? [{ label: 'Overtime (over 40 h a week)', kind: 'earning', qty: 4 + i, rate: 28.5, amount: (4 + i) * 28.5 }] : []), ...(i === 3 ? [{ label: 'Weekend hours (extra)', kind: 'earning', qty: 5, rate: 0, amount: 0 }] : []), ...(i === 1 ? [{ label: 'Expense: work boots', kind: 'reimbursement', amount: 89 }] : [])].filter((l) => l.amount !== 0) },
    { id: 'st_demo_yaa', pay: { monthly: 3800, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 4, leaveDays: 15, currency: 'USD', payMethod: 'bank', status: 'onboarding',
      emergency: {}, payout: {}, docs: [{ kind: 'contract', title: 'Offer letter — Dispatcher', status: 'pending', color: '#14213D' }] },
  ], async ({ t }) => {
    await leave(gc, 'st_demo_ama', 'vacation', addDays(t, 16), addDays(t, 20), 'Family wedding in Accra', 'pending')
    await leave(gc, 'st_demo_kojo', 'sick', addDays(t, -6), addDays(t, -6), 'Flu', 'approved', 'Nana Boateng')
    await expense(gc, 'st_demo_ama', 'other', 46.8, 'USD', 46.8, 'Printer toner for invoices', 'pending', 1)
    await db.query(`insert into payslip_queries (id,shipper_id,staff_id,line,note,status,at) values ($1,$2,'st_demo_kojo','Overtime (over 40 h a week)','I worked two Saturdays last period but only see one in my overtime.','open', now() - interval '20 hours')`, ['pq_' + uid(), gc])
  })

  /* ---------------- Atlantic Bridge: office, warehouse and both drivers ---------------- */
  const ab = 'atlantic-bridge'; const abDays = (await hrSettings(db, ab)).periodDays
  await seedCompany(db, ab, 'Samuel Ansah', [
    { id: 'ab_st_disp', pay: { monthly: 4000, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 900, leaveDays: 20, currency: 'USD', payMethod: 'bank',
      emergency: { name: 'Daniel Tetteh', phone: '+1 973 555 0311', relation: 'Husband' }, payout: { method: 'bank', bankName: 'TD Bank', bankLast4: '4417' },
      docs: [{ kind: 'contract', title: 'Employment contract — Dispatcher', status: 'checked', color: '#14213D' }, { kind: 'id', title: 'NJ driver’s licence (ID)', status: 'checked', color: '#2b3a55' }, { kind: 'tax', title: 'W-4 2026', status: 'checked', color: '#0a6842' }],
      hours: { start: 13, len: 9 }, rota: { start: '08:00', end: '17:00' },
      slip: () => [{ label: 'Salary (USD 4,000 a month)', kind: 'earning', qty: 1, rate: salary(4000, abDays), amount: salary(4000, abDays) }] },
    { id: 'ab_st_fin', pay: { monthly: 4500, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 520, leaveDays: 20, currency: 'USD', payMethod: 'bank', expiries: { permit: 18 },
      emergency: { name: 'Grace Ansah', phone: '+1 973 555 0322', relation: 'Wife' }, payout: { method: 'bank', bankName: 'Bank of America', bankLast4: '9031' },
      docs: [{ kind: 'contract', title: 'Employment contract — Finance', status: 'checked', color: '#14213D' }, { kind: 'id', title: 'Ghana passport', status: 'checked', color: '#a3361d' }, { kind: 'right_to_work', title: 'Employment authorization (EAD)', exp: 18, status: 'checked', color: '#6b4fa0' }, { kind: 'tax', title: 'W-4 2026', status: 'checked', color: '#0a6842' }],
      hours: { start: 13, len: 8.5 }, rota: { start: '08:30', end: '17:00' },
      slip: () => [{ label: 'Salary (USD 4,500 a month)', kind: 'earning', qty: 1, rate: salary(4500, abDays), amount: salary(4500, abDays) }] },
    { id: 'ab_st_wh', pay: { perHour: 18, currency: 'USD' }, employment: 'employee', country: 'US', startAgo: 210, leaveDays: 12, currency: 'USD', payMethod: 'zelle',
      emergency: { name: 'Esi Danquah', phone: '+1 862 555 0333', relation: 'Mother' }, payout: { method: 'zelle', zelle: 'peter.d@example.com' },
      docs: [{ kind: 'contract', title: 'Employment contract — Warehouse', status: 'checked', color: '#14213D' }, { kind: 'id', title: 'NJ ID card', status: 'rejected', note: 'The back is cut off — please upload the whole card.', color: '#2b3a55' }],
      hours: { start: 11, len: 9, sat: true }, rota: { start: '07:00', end: '16:00', sat: true },
      slip: (i) => [{ label: 'Hours', kind: 'earning', qty: 40, rate: 18, amount: 720 }, { label: 'Overtime (over 40 h a week)', kind: 'earning', qty: 3 + i, rate: 27, amount: (3 + i) * 27 }, ...(i >= 2 ? [{ label: 'Advance repayment — rent deposit', kind: 'deduction', amount: -100 }] : [])] },
    { id: 'ab_st_pick', driver: true, pay: { perStop: 11, perRun: 25, perHour: 14, currency: 'USD' }, employment: 'contractor', country: 'US', startAgo: 450, leaveDays: 15, currency: 'USD', payMethod: 'zelle',
      licence: { class: 'CDL-B', last4: '7781', state: 'New Jersey' }, expiries: { licence: 310, medical: 45, insurance: 160 },
      emergency: { name: 'Abena Boateng', phone: '+1 973 555 0344', relation: 'Wife' }, payout: { method: 'zelle', zelle: 'kofi.boateng@example.com' },
      docs: [{ kind: 'licence', title: 'NJ CDL — front', exp: 310, status: 'checked', color: '#1d4e89' }, { kind: 'id', title: 'US passport card', status: 'checked', color: '#2b3a55' }, { kind: 'medical', title: 'DOT medical card', exp: 45, status: 'checked', color: '#0a6842' }, { kind: 'insurance', title: 'Occupational accident policy', exp: 160, status: 'pending', color: '#6b4fa0' }],
      hours: { start: 12, len: 9.5, sat: true }, rota: { start: '07:30', end: '17:00', sat: true },
      slip: (i) => [{ label: 'Stops completed', kind: 'earning', qty: 34 + i * 3, rate: 11, amount: (34 + i * 3) * 11 }, { label: 'Runs', kind: 'earning', qty: 6, rate: 25, amount: 150 }, { label: 'Hours', kind: 'earning', qty: 39, rate: 14, amount: 546 }, { label: 'Expense: tolls — NJ Turnpike', kind: 'reimbursement', amount: 31.5 + i }] },
    { id: 'ab_st_del', driver: true, pay: { perStop: 40, perRun: 55, currency: 'GHS' }, employment: 'employee', country: 'GH', startAgo: 260, leaveDays: 20, currency: 'GHS', payMethod: 'momo',
      licence: { class: 'C', last4: '5520', state: 'DVLA Ghana' }, expiries: { licence: 520, permit: 75 },
      emergency: { name: 'Akosua Owusu', phone: '+233 20 555 0355', relation: 'Wife' }, payout: { method: 'momo', momo: '+233 24 555 0305' },
      docs: [{ kind: 'licence', title: 'DVLA licence — front', exp: 520, status: 'checked', color: '#a3361d' }, { kind: 'id', title: 'Ghana Card', status: 'checked', color: '#0b6b5a' }, { kind: 'permit', title: 'Commercial driving permit', exp: 75, status: 'checked', color: '#8a5a00' }],
      hours: { start: 7, len: 9 }, rota: { start: '07:00', end: '16:00' },
      slip: (i) => [{ label: 'Stops completed', kind: 'earning', qty: 26 + i * 2, rate: 40, amount: (26 + i * 2) * 40 }, { label: 'Runs', kind: 'earning', qty: 5, rate: 55, amount: 275 }, ...(i === 2 ? [{ label: 'Bonus — perfect week', kind: 'bonus', amount: 200 }] : []), { label: 'Expense: fuel — Shell, Tema', kind: 'reimbursement', amount: 310 }] },
  ], async ({ t }) => {
    await leave(ab, 'ab_st_disp', 'personal', addDays(t, 3), addDays(t, 3), 'Son’s school meeting — back by noon', 'pending')
    await leave(ab, 'ab_st_fin', 'vacation', addDays(t, 24), addDays(t, 31), 'Christmas in Kumasi', 'approved', 'Kwame Asante')
    await leave(ab, 'ab_st_pick', 'swap', addDays(t, 5), addDays(t, 5), 'Swapping Saturday with Peter — agreed', 'pending')
    await db.query(`update leave_requests set swap_with = 'ab_st_wh' where shipper_id = $1 and staff_id = 'ab_st_pick' and kind = 'swap'`, [ab])
    await db.query(`insert into pay_adjustments (id,shipper_id,staff_id,kind,amount,currency,note,installments,remaining,created_by,applied,at) values ($1,$2,'ab_st_wh','advance',300,'USD','Rent deposit',3,100,'Samuel Ansah','[{"amount":-100},{"amount":-100}]',now() - interval '20 days')`, ['pa_' + uid(), ab])
    await db.query(`insert into advance_requests (id,shipper_id,staff_id,amount,currency,reason,installments,status,at) values ($1,$2,'ab_st_del',800,'GHS','School fees for my daughter',2,'pending',now() - interval '5 hours')`, ['ar_' + uid(), ab])
    await expense(ab, 'ab_st_wh', 'other', 64, 'USD', 64, 'Pallet wrap and tape (warehouse ran out)', 'pending', 2)
    await expense(ab, 'ab_st_del', 'fuel', 420, 'GHS', 38.2, 'Goil, Spintex Road', 'approved', 4)
    // Peter is on shift now; Kofi is clocked in for today's pickup run.
    for (const sid of ['ab_st_wh', 'ab_st_pick']) await db.query(`insert into shifts (id,shipper_id,staff_id,start_at) values ($1,$2,$3,$4)`, ['sh_' + uid(), ab, sid, new Date(Date.now() - (sid === 'ab_st_wh' ? 3 : 2) * 3600000).toISOString()])
  })
  console.log('[demo] Team & HR demo added')
}
