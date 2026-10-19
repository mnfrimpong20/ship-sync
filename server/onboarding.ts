/**
 * Shipper onboarding — the guided first run for a new shipping company, and the verification documents behind it.
 *   GET  /shipper/onboarding                 the checklist with each step's done state, computed from real data
 *   POST /shipper/onboarding/dismiss          hide the card once they're done with it
 *   GET  /company-docs                        owner/dispatcher: the company's verification documents
 *   POST /company-docs                        upload one (business registration, freight licence, insurance, ID) ≤ 4 MB
 *   DELETE /company-docs/:id                  remove one that hasn't been accepted
 *   GET  /company-docs/:id/file               the file back (owner/dispatcher of that company, or admin)
 *   POST /shipper/verification/request        "we're ready — please review"; pings admins
 *   GET  /admin/shippers/:id/company-docs     admin: documents for one shipper
 *   POST /admin/company-docs/:id/review       admin: accept / reject with a note; owner is told
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import { notify, notifyShipperStaff } from './notify'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)

export const DOC_KINDS = ['business_registration', 'freight_licence', 'insurance_certificate', 'owner_id', 'other'] as const
export type CompanyDocKind = (typeof DOC_KINDS)[number]
export const DOC_LABELS: Record<CompanyDocKind, string> = { business_registration: 'Business registration', freight_licence: 'Freight licence / NVOCC-OTI / IATA', insurance_certificate: 'Cargo or liability insurance certificate', owner_id: 'Owner or director ID', other: 'Other supporting document' }
/** What verification needs at minimum. The licence is strongly recommended but some small forwarders operate under a partner's licence. */
const REQUIRED: CompanyDocKind[] = ['business_registration', 'insurance_certificate']

const zDoc = z.object({ kind: z.enum(DOC_KINDS), title: z.string().trim().min(1).max(120), mime: z.string().regex(/^(image\/(png|jpeg|webp)|application\/pdf)$/), data: z.string().min(10).max(5_600_000), note: z.string().trim().max(300).default('') })
const zReview = z.object({ status: z.enum(['accepted', 'rejected']), note: z.string().trim().max(500).default('') })

const docOut = (d: Row) => ({ id: d.id, shipperId: d.shipper_id, kind: d.kind as CompanyDocKind, label: DOC_LABELS[d.kind as CompanyDocKind] ?? d.kind, title: d.title, mime: d.mime, size: Number(d.size), note: d.note ?? '', status: d.status as 'submitted' | 'accepted' | 'rejected', reviewNote: d.review_note ?? '', reviewedAt: ISO(d.reviewed_at), reviewedBy: d.reviewed_by ?? null, uploadedBy: d.uploaded_by, createdAt: ISO(d.created_at), url: `/api/company-docs/${d.id}/file` })

export interface OnboardingStep { id: string; title: string; detail: string; to: string; done: boolean; optional?: boolean; cta: string }

/** The checklist, computed from what the company has actually filled in. Never stored, so it can't drift. */
export async function onboardingFor(db: Db, shipperId: string) {
  const { rows: sh } = await db.query<Row>('select * from shippers where id = $1', [shipperId]); const s = sh[0]
  if (!s) return null
  const arr = (v: unknown) => (J(v) ?? []) as string[]
  const { rows: rc } = await db.query<Row>('select count(*)::int as n from rate_cards where shipper_id = $1 and active', [shipperId])
  const { rows: q } = await db.query<Row>('select count(*)::int as n from quotes where shipper_id = $1', [shipperId])
  const { rows: docs } = await db.query<Row>('select kind, status from company_documents where shipper_id = $1', [shipperId])
  const { rows: st } = await db.query<Row>(`select count(*)::int as n from staff where shipper_id = $1 and role <> 'owner'`, [shipperId])
  const hasKind = (k: CompanyDocKind) => docs.some((d) => d.kind === k && d.status !== 'rejected')
  const payout = J(s.payout_details) as Row | null
  const profileDone = s.tagline.trim().length >= 10 && s.about.trim().length >= 60 && s.hq.trim().length > 0
  const lanesDone = arr(s.origins).length > 0 && arr(s.destinations).length > 0 && arr(s.modes).length > 0 && arr(s.cargo).length > 0
  const docsDone = REQUIRED.every(hasKind)
  const requested = !!s.verification_requested_at
  const steps: OnboardingStep[] = [
    { id: 'profile', title: 'Tell customers who you are', detail: profileDone ? `"${s.tagline}"` : 'A one-line tagline, a short description (a few sentences) and your head office. This is what customers read before they pick you.', to: '/dashboard/shipper?view=profile', done: profileDone, cta: 'Edit profile' },
    { id: 'lanes', title: 'Set your lanes', detail: lanesDone ? `${arr(s.origins).length} origin${arr(s.origins).length === 1 ? '' : 's'} → ${arr(s.destinations).length} destination${arr(s.destinations).length === 1 ? '' : 's'} · ${arr(s.modes).join(' + ')} · ${arr(s.cargo).length} cargo types` : 'Where you collect from, where you deliver to, air or ocean, and what cargo you take. Matching only sends you requests on these lanes.', to: '/dashboard/shipper?view=profile', done: lanesDone, cta: 'Set lanes' },
    { id: 'rates', title: 'Add a rate card', detail: rc[0].n > 0 ? `${rc[0].n} active rate card${rc[0].n === 1 ? '' : 's'}` : 'Your price per barrel, box, vehicle or container on a lane. Rate cards pre-fill quotes and can auto-reply to new requests while you sleep.', to: '/dashboard/rates', done: rc[0].n > 0, cta: 'Add rates' },
    { id: 'docs', title: 'Upload your documents', detail: docsDone ? `${docs.length} document${docs.length === 1 ? '' : 's'} on file` : 'Business registration and an insurance certificate (a freight licence helps). We check them before granting the verified badge.', to: '/dashboard/verification', done: docsDone, cta: 'Upload' },
    { id: 'verify', title: 'Get verified', detail: s.verified ? 'You have the verified badge — you rank higher in matching.' : requested ? 'Requested — our team is reviewing. Usually one business day.' : 'Once your documents are up, ask for review. Verified shippers rank higher and win more quotes.', to: '/dashboard/verification', done: !!s.verified, cta: requested ? 'See status' : 'Request review' },
    { id: 'quote', title: 'Send your first quote', detail: q[0].n > 0 ? `${q[0].n} quote${q[0].n === 1 ? '' : 's'} sent` : 'Open requests on your lanes are waiting in Requests. A quote takes a minute; customers see your response time.', to: '/dashboard/leads', done: q[0].n > 0, cta: 'Open requests' },
    { id: 'team', title: 'Invite your team', detail: st[0].n > 0 ? `${st[0].n} teammate${st[0].n === 1 ? '' : 's'}` : 'Dispatchers, drivers, warehouse and finance staff each get their own view. Optional.', to: '/dashboard/team', done: st[0].n > 0, optional: true, cta: 'Invite' },
    { id: 'payout', title: 'Add payout details', detail: payout && Object.keys(payout).length > 0 ? 'Bank details on file' : 'Where escrow releases should be paid. Optional until your first paid booking.', to: '/dashboard/payments', done: !!(payout && Object.keys(payout).length > 0), optional: true, cta: 'Add bank' },
  ]
  const core = steps.filter((x) => !x.optional)
  const doneCore = core.filter((x) => x.done).length
  return { steps, progress: Math.round((doneCore / core.length) * 100), doneCore, totalCore: core.length, complete: doneCore === core.length, dismissed: !!s.onboarding_dismissed_at, verified: !!s.verified, verificationRequestedAt: ISO(s.verification_requested_at), companyName: s.name }
}

export function mountOnboarding(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.'); return u as ApiUser & { shipperId: string } }
  const anyStaff = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shipper accounts only.'); return u as ApiUser & { shipperId: string } }
  const admins = async (db: Db) => (await db.query<Row>('select id from users where is_admin')).rows.map((x) => String(x.id))

  r.get('/shipper/onboarding', wrap(async (req, res) => { const db = await getDb(); const u = await anyStaff(db, req); res.set('Cache-Control', 'no-store'); res.json(await onboardingFor(db, u.shipperId)) }))
  r.post('/shipper/onboarding/dismiss', wrap(async (req, res) => { const db = await getDb(); const u = await office(db, req); await db.query('update shippers set onboarding_dismissed_at = now() where id = $1', [u.shipperId]); res.json({ ok: true }) }))
  r.post('/shipper/onboarding/restore', wrap(async (req, res) => { const db = await getDb(); const u = await office(db, req); await db.query('update shippers set onboarding_dismissed_at = null where id = $1', [u.shipperId]); res.json({ ok: true }) }))

  r.get('/company-docs', wrap(async (req, res) => {
    const db = await getDb(); const u = await anyStaff(db, req)
    const { rows } = await db.query<Row>('select * from company_documents where shipper_id = $1 order by created_at desc', [u.shipperId])
    const { rows: sh } = await db.query<Row>('select verified, verification_requested_at, verification_note from shippers where id = $1', [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ documents: rows.map(docOut), kinds: DOC_KINDS.map((k) => ({ id: k, label: DOC_LABELS[k], required: REQUIRED.includes(k) })), verified: !!sh[0]?.verified, requestedAt: ISO(sh[0]?.verification_requested_at), note: sh[0]?.verification_note ?? '' })
  }))
  r.post('/company-docs', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zDoc.parse(req.body)
    const data = b.data.replace(/^data:[^;]+;base64,/, ''); const size = Math.floor((data.length * 3) / 4)
    if (size > 4_000_000) throw new HttpError(413, 'Keep documents under 4 MB.')
    const { rows: c } = await db.query<Row>('select count(*)::int as n from company_documents where shipper_id = $1', [u.shipperId])
    if (Number(c[0].n) >= 12) throw new HttpError(429, 'Document limit reached — remove one you no longer need.')
    const id = 'cd_' + uid()
    await db.query(`insert into company_documents (id,shipper_id,kind,title,mime,size,data,note,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, u.shipperId, b.kind, b.title, b.mime, size, data, b.note, u.name])
    const { rows } = await db.query<Row>('select * from company_documents where id = $1', [id])
    res.status(201).json({ document: docOut(rows[0]) })
  }))
  r.delete('/company-docs/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>('select status from company_documents where id = $1 and shipper_id = $2', [req.params.id, u.shipperId])
    if (!rows[0]) throw new HttpError(404, 'Document not found.')
    if (rows[0].status === 'accepted') throw new HttpError(409, 'Accepted documents can’t be removed — upload a newer version instead.')
    await db.query('delete from company_documents where id = $1', [req.params.id]); res.json({ ok: true })
  }))
  r.get('/company-docs/:id/file', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from company_documents where id = $1', [req.params.id]); const f = rows[0]
    if (!f) throw new HttpError(404, 'Document not found.')
    if (!u.admin && !(u.role === 'shipper' && u.shipperId === f.shipper_id)) throw new HttpError(403, 'Not yours.')
    res.set('Content-Type', f.mime); res.set('Cache-Control', 'private, no-store'); res.set('Content-Disposition', `inline; filename="${String(f.title).replace(/[^\w.-]+/g, '_')}${f.mime === 'application/pdf' ? '.pdf' : f.mime === 'image/png' ? '.png' : f.mime === 'image/webp' ? '.webp' : '.jpg'}"`)
    res.send(Buffer.from(f.data, 'base64'))
  }))
  r.post('/shipper/verification/request', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const ob = await onboardingFor(db, u.shipperId); if (!ob) throw new HttpError(404, 'Company not found.')
    if (ob.verified) throw new HttpError(409, 'You are already verified.')
    const docsStep = ob.steps.find((s) => s.id === 'docs')!
    if (!docsStep.done) throw new HttpError(409, 'Upload your business registration and insurance certificate first.')
    await db.query('update shippers set verification_requested_at = now(), verification_note = $2 where id = $1', [u.shipperId, ''])
    { const { rows: sn } = await db.query<Row>('select name from shippers where id = $1', [u.shipperId]); await (await import('./screening')).screenSubject(db, { type: 'shipper', id: u.shipperId!, names: [{ role: 'company', name: sn[0]?.name ?? '' }, { role: 'owner', name: u.name }] }).catch(() => {}) }
    for (const id of await admins(db)) await notify(db, { userId: id, kind: 'system', title: `${ob.companyName} asked to be verified`, body: `${u.name} says their profile and documents are ready. Review them under Admin → Shippers.`, link: '/admin?view=shippers', dedupe: `verify-req:${u.shipperId}:${Date.now().toString().slice(0, -5)}` })
    res.json({ ok: true, requestedAt: new Date().toISOString() })
  }))

  /* ---- admin ---- */
  r.get('/admin/shippers/:id/company-docs', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>('select * from company_documents where shipper_id = $1 order by created_at desc', [req.params.id])
    const ob = await onboardingFor(db, String(req.params.id))
    res.json({ documents: rows.map(docOut), onboarding: ob ? { progress: ob.progress, steps: ob.steps.map((s) => ({ id: s.id, title: s.title, done: s.done, optional: !!s.optional })), requestedAt: ob.verificationRequestedAt } : null })
  }))
  r.post('/admin/company-docs/:id/review', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const b = zReview.parse(req.body)
    const { rows } = await db.query<Row>('select * from company_documents where id = $1', [req.params.id]); const f = rows[0]
    if (!f) throw new HttpError(404, 'Document not found.')
    await db.query('update company_documents set status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4 where id = $1', [f.id, b.status, b.note, admin.name])
    if (b.status === 'rejected') await notifyShipperStaff(db, f.shipper_id, { kind: 'system', title: `${DOC_LABELS[f.kind as CompanyDocKind]} needs another look`, body: b.note || 'Please upload a clearer or more recent copy.', link: '/dashboard/verification', dedupe: `cd:${f.id}:rej` }, ['owner', 'dispatcher'])
    const { rows: out } = await db.query<Row>('select * from company_documents where id = $1', [f.id])
    res.json({ document: docOut(out[0]) })
  }))
}

/** Hook for the existing verify route: when an admin grants the badge, clear the request and tell the company. Called from api.ts. */
export async function onVerified(db: Db, shipperId: string, verified: boolean, note = '') {
  await db.query('update shippers set verification_note = $2 where id = $1', [shipperId, note])
  if (verified) await notifyShipperStaff(db, shipperId, { kind: 'system', title: 'You’re verified ✓', body: 'Your company now carries the verified badge and ranks higher in matching. Thanks for sending your documents.', link: '/dashboard/shipper', dedupe: `verified:${shipperId}` }, ['owner', 'dispatcher'])
  else if (note) await notifyShipperStaff(db, shipperId, { kind: 'system', title: 'Verification not granted yet', body: note, link: '/dashboard/verification', dedupe: `verify-no:${shipperId}:${Date.now().toString().slice(0, -5)}` }, ['owner', 'dispatcher'])
}
