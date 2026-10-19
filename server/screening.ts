/**
 * Sanctions screening against the US Treasury OFAC SDN list (Specially Designated Nationals).
 *
 *   The list is downloaded daily (SANCTIONS_LIST_URL, default the official sdn.csv; SANCTIONS_LIST_FILE reads a
 *   local copy instead) into `sanctions_entries`. New requests (sender + receiver), shipper companies, and
 *   shipments booked from a request are checked. A possible match puts a hold: the request can still be
 *   quoted, but it can't be booked until Ntemtem reviews the match (Admin → Screening) and clears it.
 *   Matching is deliberately simple (normalised name tokens, all of an entry's name words present) so it errs
 *   towards review; the reviewer decides.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const LIST_URL = () => process.env.SANCTIONS_LIST_URL?.trim() || 'https://www.treasury.gov/ofac/downloads/sdn.csv'
const STOP = new Set(['the', 'of', 'and', 'co', 'ltd', 'limited', 'llc', 'inc', 'company', 'sa', 'de', 'al', 'el', 'bin', 'ibn'])
export const normName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s: string) => normName(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t))

/** Minimal CSV line parser (quoted fields, commas inside quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  out.push(cur); return out
}
/** Download (or read) the SDN list and replace the table. SDN rows: ent_num, name, type, program, … ("-0-" = empty). */
export async function refreshSanctionsList(db: Db): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const file = process.env.SANCTIONS_LIST_FILE?.trim()
    let text: string
    if (file) text = await readFile(file, 'utf8')
    else { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30_000); const res = await fetch(LIST_URL(), { signal: ctl.signal, headers: { 'user-agent': 'Ntemtem screening (+https://ntemtem.com)' } }); clearTimeout(t); if (!res.ok) throw new Error(`List download failed (${res.status})`); text = await res.text() }
    const rows = text.split(/\r?\n/).filter(Boolean).map(parseCsvLine).filter((r) => r.length >= 4 && r[1] && r[1] !== '-0-')
    if (rows.length < 5 && !file) throw new Error('The list looked empty.')
    await db.query('delete from sanctions_entries')
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400); const vals: unknown[] = []
      const ph = chunk.map((r, k) => { vals.push(r[0], r[1], normName(r[1]), r[2] === '-0-' ? '' : r[2], r[3] === '-0-' ? '' : r[3]); const o = k * 5; return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})` }).join(',')
      await db.query(`insert into sanctions_entries (uid,name,name_norm,kind,program) values ${ph} on conflict (uid) do nothing`, vals)
    }
    await db.query(`insert into settings (id,value,updated_at) values ('sanctions',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify({ count: rows.length, refreshedAt: new Date().toISOString(), source: file ? 'file' : LIST_URL() })])
    entriesCache = null
    return { ok: true, count: rows.length }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.query(`insert into settings (id,value,updated_at) values ('sanctions_error',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify({ error, at: new Date().toISOString() })]).catch(() => {})
    return { ok: false, count: 0, error }
  }
}
let entriesCache: { at: number; list: { name: string; program: string; uid: string; toks: string[] }[] } | null = null
async function entries(db: Db) {
  if (entriesCache && Date.now() - entriesCache.at < 10 * 60_000) return entriesCache.list
  const { rows } = await db.query<Row>('select uid, name, name_norm, program from sanctions_entries')
  entriesCache = { at: Date.now(), list: rows.map((r) => ({ uid: r.uid, name: r.name, program: r.program, toks: String(r.name_norm).split(' ').filter((t: string) => t.length > 1 && !STOP.has(t)) })) }
  return entriesCache.list
}
/** Possible matches for a name: every word of an entry's name appears in the screened name (entries need ≥2 words). */
export async function screenName(db: Db, name: string) {
  const t = new Set(tokens(name)); if (t.size < 2) return []
  const hits = (await entries(db)).filter((e) => e.toks.length >= 2 && e.toks.every((x) => t.has(x))).map((e) => ({ uid: e.uid, matched: e.name, program: e.program, score: Math.round((e.toks.length / Math.max(t.size, e.toks.length)) * 100) / 100 }))
  return hits.slice(0, 5)
}
/** Screen a subject's names; record open hits; returns true when something needs review. */
export async function screenSubject(db: Db, subject: { type: 'request' | 'shipper' | 'shipment'; id: string; names: { role: string; name: string }[] }) {
  let held = false
  for (const n of subject.names) {
    if (!n.name?.trim()) continue
    for (const h of await screenName(db, n.name)) {
      held = true
      await db.query(`insert into screening_hits (id,subject_type,subject_id,role,name,matched_name,matched_uid,program,score) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (subject_type, subject_id, role, matched_uid) do nothing`, ['scr_' + uid(), subject.type, subject.id, n.role, n.name, h.matched, h.uid, h.program, h.score])
    }
  }
  if (held) {
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'system', title: 'Sanctions screening: possible match to review', body: `${subject.type} ${subject.id} — ${subject.names.map((n) => n.name).join(', ')}`, link: '/admin?view=screening', dedupe: `scr:${subject.type}:${subject.id}` })
  }
  return held
}
/** Open (unreviewed) or confirmed hits block booking. */
export async function screeningHold(db: Db, type: 'request' | 'shipper', id: string) {
  const { rows } = await db.query<Row>(`select status from screening_hits where subject_type = $1 and subject_id = $2 and status in ('open','confirmed') limit 1`, [type, id])
  return rows[0]?.status as 'open' | 'confirmed' | undefined
}

export function startScreeningSweeps(getDb: () => Promise<Db>) {
  const run = async () => { const db = await getDb(); const r = await refreshSanctionsList(db); if (!r.ok) console.warn('[screening] list refresh failed:', r.error) }
  setTimeout(() => { void run() }, 45_000)
  setInterval(() => { void run() }, 24 * 3600_000).unref?.()
}

export function mountScreening(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d
  r.get('/admin/screening', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select * from screening_hits order by (status = 'open') desc, created_at desc limit 300`)
    const { rows: st } = await db.query<Row>(`select id, value, updated_at from settings where id in ('sanctions','sanctions_error')`)
    const meta = Object.fromEntries(st.map((x) => [x.id, typeof x.value === 'string' ? JSON.parse(x.value) : x.value]))
    res.set('Cache-Control', 'no-store')
    res.json({ list: meta.sanctions ?? null, lastError: meta.sanctions_error ?? null, hits: rows.map((h) => ({ id: h.id, subjectType: h.subject_type, subjectId: h.subject_id, role: h.role, name: h.name, matched: h.matched_name, program: h.program, score: Number(h.score), status: h.status, note: h.note, reviewedBy: h.reviewed_by, reviewedAt: ISO(h.reviewed_at), createdAt: ISO(h.created_at) })) })
  }))
  r.post('/admin/screening/refresh', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json(await refreshSanctionsList(db)) }))
  r.post('/admin/screening/check', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = z.object({ name: z.string().trim().min(2).max(160) }).parse(req.body)
    res.json({ matches: await screenName(db, b.name) })
  }))
  r.patch('/admin/screening/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireAdmin(db, req)
    const b = z.object({ status: z.enum(['cleared', 'confirmed']), note: z.string().trim().min(3, 'Add a short note for the record.').max(500) }).parse(req.body)
    const { rows } = await db.query<Row>(`update screening_hits set status = $2, note = $3, reviewed_by = $4, reviewed_at = now() where id = $1 returning *`, [String(req.params.id), b.status, b.note, u.name])
    if (!rows[0]) throw new HttpError(404, 'Not found.')
    res.json({ ok: true })
  }))
}
