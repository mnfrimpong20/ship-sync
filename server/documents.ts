/**
 * Documents vault — one folder per shipment.
 *
 * Two kinds of document live here:
 *   uploads    a file the shipper or customer attached (PDF, image, scan of a passport, a supplier invoice…)
 *   generated  a document the platform builds from what it already knows — packing list, commercial invoice,
 *              proof of delivery — stored as a JSON payload and rendered by the client as a printable page.
 * Files are kept as base64 in the `documents.data` column (fine for a few MB per file; swap for object
 * storage when volume grows — only `data` would move).
 *
 * Visibility: `shipper` (office only) or `shared` (the customer sees it too). Anyone with a share link
 * (`/doc/<token>`) can open a document without signing in; links can be revoked.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { cargoLabel, countryByCode, type CargoType } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

export const DOC_KINDS = ['packing_list', 'commercial_invoice', 'bill_of_lading', 'customs', 'proof_of_delivery', 'identity', 'insurance', 'receipt', 'photo', 'export_instructions', 'other'] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const docKindLabels: Record<DocKind, string> = {
  packing_list: 'Packing list', commercial_invoice: 'Commercial invoice', bill_of_lading: 'Bill of lading / AWB', customs: 'Customs form', proof_of_delivery: 'Proof of delivery',
  identity: 'ID document', insurance: 'Insurance certificate', receipt: 'Payment receipt', photo: 'Photo', export_instructions: 'Shipper’s letter of instruction', other: 'Other',
}
const GENERATED: DocKind[] = ['packing_list', 'commercial_invoice', 'bill_of_lading', 'export_instructions', 'proof_of_delivery']
export type GenKind = 'packing_list' | 'commercial_invoice' | 'bill_of_lading' | 'export_instructions' | 'proof_of_delivery'
const MAX_BYTES = 6 * 1024 * 1024
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

/** Metadata only — the file body is fetched separately so lists stay light. */
export const docOut = (d: Row) => ({
  id: d.id, shipmentId: d.shipment_id, kind: d.kind as DocKind, title: d.title, filename: d.filename ?? '', mime: d.mime ?? '', size: Number(d.size ?? 0),
  source: d.source as 'upload' | 'generated', visibility: d.visibility as 'shipper' | 'shared', uploadedBy: d.uploaded_by ?? '', uploadedByRole: d.uploaded_by_role ?? '',
  shareToken: d.share_token ?? null, createdAt: ISO(d.created_at), updatedAt: ISO(d.updated_at), hasFile: Boolean(d.has_file), hasPayload: Boolean(d.has_payload),
})

/** Everything a packing list / invoice / POD needs, gathered once. */
export async function shipmentContext(db: Db, s: Row) {
  const { rows: shipper } = await db.query<Row>('select name, hq, tagline from shippers where id = $1', [s.shipper_id])
  const { rows: client } = s.client_id ? await db.query<Row>('select * from clients where id = $1', [s.client_id]) : { rows: [] as Row[] }
  const { rows: cons } = s.consignee_id ? await db.query<Row>('select * from client_consignees where id = $1', [s.consignee_id]) : s.client_id ? await db.query<Row>('select * from client_consignees where client_id = $1 and is_default order by id limit 1', [s.client_id]) : { rows: [] as Row[] }
  const { rows: req } = s.request_id ? await db.query<Row>('select * from requests where id = $1', [s.request_id]) : { rows: [] as Row[] }
  const { rows: pieces } = await db.query<Row>('select seq, label_code, status, last_scan_at, last_scan_place from pieces where shipment_id = $1 order by seq', [s.id])
  const { rows: container } = s.container_id ? await db.query<Row>('select ref, number, seal, vessel_name, voyage, origin_port, destination_port, etd, eta from containers where id = $1', [s.container_id]) : { rows: [] as Row[] }
  const { rows: quote } = s.request_id ? await db.query<Row>(`select price, currency, includes from quotes where request_id = $1 and status = 'accepted' limit 1`, [s.request_id]) : { rows: [] as Row[] }
  const { rows: invoice } = await db.query<Row>(`select number, items, subtotal, tax, total, currency, issued_at, due_at from invoices where shipment_id = $1 and status <> 'void' order by created_at desc limit 1`, [s.id])
  const { rows: pod } = await db.query<Row>(`select at, place, by_name, received_by, photo, signature, note from scans where shipment_id = $1 and kind = 'delivery' order by (photo is not null) desc, (signature is not null) desc, at desc limit 1`, [s.id])
  const { rows: delivered } = await db.query<Row>(`select count(*)::int as n from pieces where shipment_id = $1 and status = 'delivered'`, [s.id])
  const dest = countryByCode(s.destination)
  return {
    shipment: { ref: s.ref, mode: s.mode, origin: s.origin, destination: s.destination, destinationName: dest?.name ?? s.destination, cargo: s.cargo, cargoLabel: cargoLabel(s.cargo as CargoType), description: s.description, status: s.status, eta: ISO(s.eta)?.slice(0, 10), createdAt: ISO(s.created_at), vesselName: s.vessel_name ?? '', customer: s.customer },
    shipper: { name: shipper[0]?.name ?? '', hq: shipper[0]?.hq ?? '', tagline: shipper[0]?.tagline ?? '' },
    sender: client[0] ? { name: client[0].name, company: client[0].company, email: client[0].email, phone: client[0].phone || client[0].whatsapp, city: client[0].city } : { name: s.customer, company: '', email: req[0]?.contact_email ?? '', phone: req[0]?.contact_phone ?? '', city: s.origin },
    receiver: cons[0] ? { name: cons[0].name, phone: cons[0].phone, address: cons[0].address, city: cons[0].city, country: cons[0].country } : null,
    request: req[0] ? { quantity: Number(req[0].quantity), weightKg: req[0].weight_kg == null ? null : Number(req[0].weight_kg), pickup: req[0].pickup, delivery: req[0].delivery, insurance: req[0].insurance } : s.booking ? (() => { const b = typeof s.booking === 'string' ? JSON.parse(s.booking) : s.booking; return { quantity: Number(b.quantity ?? 1), weightKg: b.weightKg ?? null, pickup: false, delivery: s.handover === 'delivery', insurance: false, dims: b.dims ?? '', declaredValueUsd: b.declaredValueUsd ?? null } })() : null,
    pieces: pieces.map((p) => ({ seq: Number(p.seq), code: p.label_code, status: p.status, lastScanAt: ISO(p.last_scan_at), lastScanPlace: p.last_scan_place })),
    container: container[0] ? { ref: container[0].ref, number: container[0].number, seal: container[0].seal, vesselName: container[0].vessel_name, voyage: container[0].voyage, originPort: container[0].origin_port, destinationPort: container[0].destination_port, etd: ISO(container[0].etd)?.slice(0, 10) ?? null, eta: ISO(container[0].eta)?.slice(0, 10) ?? null } : null,
    quote: quote[0] ? { price: Number(quote[0].price), currency: quote[0].currency, includes: typeof quote[0].includes === 'string' ? JSON.parse(quote[0].includes) : quote[0].includes } : null,
    invoice: invoice[0] ? { number: invoice[0].number, items: typeof invoice[0].items === 'string' ? JSON.parse(invoice[0].items) : invoice[0].items, subtotal: Number(invoice[0].subtotal), tax: Number(invoice[0].tax), total: Number(invoice[0].total), currency: invoice[0].currency, issuedAt: ISO(invoice[0].issued_at)?.slice(0, 10), dueAt: ISO(invoice[0].due_at)?.slice(0, 10) ?? null } : null,
    pod: pod[0] ? { at: ISO(pod[0].at), place: pod[0].place, by: pod[0].by_name, receivedBy: pod[0].received_by || '', photo: pod[0].photo || null, signature: pod[0].signature || null, note: pod[0].note || '', piecesDelivered: delivered[0]?.n ?? 0, piecesTotal: pieces.length } : null,
  }
}
export type ShipmentContext = Awaited<ReturnType<typeof shipmentContext>>

/** Build the payload a generated document renders from. Throws when the shipment isn't ready for it. */
async function buildPayload(db: Db, s: Row, kind: DocKind, HttpError: Deps['HttpError']) {
  const ctx = await shipmentContext(db, s)
  if (kind === 'proof_of_delivery' && !ctx.pod && s.status !== 'delivered') throw new HttpError(409, 'No delivery has been recorded for this shipment yet. Scan the pieces at handover first.')
  const number = (prefix: string) => `${prefix}-${s.ref.replace(/^(SS|NT)-/, '')}`
  const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
  let extra: Record<string, unknown> = {}
  if (kind === 'bill_of_lading' || kind === 'export_instructions') {
    const { measureView } = await import('./measure'); const m = await measureView(db, s)
    const { rows: c } = s.container_id ? await db.query<Row>('select ref, number, seal, size, line, booking_ref, vessel_name, voyage, origin_port, destination_port, etd from containers where id = $1', [s.container_id]) : { rows: [] as Row[] }
    const { rows: rq } = s.request_id ? await db.query<Row>('select declaration, declared_value_usd, description from requests where id = $1', [s.request_id]) : { rows: [] as Row[] }
    const exp = J(s.export_compliance)
    if (kind === 'export_instructions' && !exp?.applies) throw new HttpError(409, 'A letter of instruction is only for shipments leaving the United States.')
    extra = { measured: { totals: m.totals, pieces: m.pieces.map((p) => ({ seq: p.seq, code: p.labelCode, weightKg: p.weightKg, dims: p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm` : '' })) }, booking: c[0] ? { containerRef: c[0].ref, number: c[0].number, seal: c[0].seal, size: c[0].size, line: c[0].line, bookingRef: c[0].booking_ref, vesselName: c[0].vessel_name, voyage: c[0].voyage, pol: c[0].origin_port, pod: c[0].destination_port, etd: ISO(c[0].etd)?.slice(0, 10) ?? null } : null, export: exp, declaration: J(rq[0]?.declaration), declaredValueUsd: rq[0]?.declared_value_usd == null ? (exp?.valueUsd ?? null) : Number(rq[0].declared_value_usd) }
  }
  return { ...ctx, ...extra, generatedAt: new Date().toISOString(), number: kind === 'packing_list' ? number('PL') : kind === 'commercial_invoice' ? number('CI') : kind === 'bill_of_lading' ? number('HBL') : kind === 'export_instructions' ? number('SLI') : number('POD') }
}

const zUpload = z.object({
  kind: z.enum(DOC_KINDS).default('other'),
  title: z.string().trim().min(1).max(120),
  filename: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(100),
  data: z.string().min(1), // base64 (no data: prefix)
  visibility: z.enum(['shipper', 'shared']).default('shared'),
})
const zPatch = z.object({ title: z.string().trim().min(1).max(120).optional(), kind: z.enum(DOC_KINDS).optional(), visibility: z.enum(['shipper', 'shared']).optional() })
const zGenerate = z.object({ kind: z.enum(['packing_list', 'commercial_invoice', 'bill_of_lading', 'export_instructions', 'proof_of_delivery']), visibility: z.enum(['shipper', 'shared']).default('shared') })
const META = `id, shipment_id, kind, title, filename, mime, size, source, visibility, uploaded_by, uploaded_by_role, share_token, created_at, updated_at, (data is not null) as has_file, (payload is not null) as has_payload`

/** Build (or rebuild) a generated document from the shipment's data. Used by the office button and by booking automation. */
export async function generateDocument(db: Db, s: Row, kind: GenKind, visibility: 'shipper' | 'shared', by: string, HttpError: Deps['HttpError'] = class extends Error { status: number; constructor(st: number, m: string) { super(m); this.status = st } }) {
  const payload = await buildPayload(db, s, kind, HttpError)
  const title = `${docKindLabels[kind]} ${payload.number}`
  // Regenerating replaces the previous generated copy of the same kind.
  const { rows: old } = await db.query<Row>(`select id from documents where shipment_id = $1 and kind = $2 and source = 'generated'`, [s.id, kind])
  const id = old[0]?.id ?? 'doc_' + uid()
  if (old[0]) await db.query(`update documents set title = $2, payload = $3, visibility = $4, uploaded_by = $5, updated_at = now() where id = $1`, [id, title, JSON.stringify(payload), visibility, by])
  else await db.query(`insert into documents (id,shipment_id,shipper_id,kind,title,filename,mime,size,payload,source,visibility,uploaded_by,uploaded_by_role) values ($1,$2,$3,$4,$5,'','',0,$6,'generated',$7,$8,'shipper')`, [id, s.id, s.shipper_id, kind, title, JSON.stringify(payload), visibility, by])
  if (s.user_id && visibility === 'shared' && !old[0]) await notify(db, { userId: s.user_id, kind: 'document', title: `${docKindLabels[kind]} ready for ${s.ref}`, body: `${payload.shipper.name} issued ${title}. Open the shipment to view, print or download it.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `doc:${id}` })
  return { id, old: Boolean(old[0]) }
}

export function mountDocuments(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  /** The shipment, and whether this user may see / manage its documents. Customers see only shared ones and may upload their own. */
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId])
    const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && !isDriverRole(u.staffRole)
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office }
  }
  const docById = async (db: Db, id: string) => {
    const { rows } = await db.query<Row>(`select ${META} from documents where id = $1`, [id])
    if (!rows[0]) throw new HttpError(404, 'Document not found.')
    return rows[0]
  }

  r.get('/shipments/:id/documents', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    const { rows } = await db.query<Row>(`select ${META} from documents where shipment_id = $1 ${office ? '' : `and visibility = 'shared'`} order by created_at desc`, [s.id])
    res.json({ documents: rows.map(docOut), canManage: office, generators: office ? GENERATED.map((k) => ({ kind: k, label: docKindLabels[k] })) : [] })
  }))

  r.post('/shipments/:id/documents', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office } = await access(db, req, String(req.params.id))
    const b = zUpload.parse(req.body)
    const size = Buffer.from(b.data, 'base64').length
    if (size > MAX_BYTES) throw new HttpError(413, 'Files up to 6 MB only. Compress the PDF or photo and try again.')
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b.data.slice(0, 2000))) throw new HttpError(400, 'Send the file as base64 without the data: prefix.')
    const id = 'doc_' + uid()
    await db.query(`insert into documents (id,shipment_id,shipper_id,kind,title,filename,mime,size,data,source,visibility,uploaded_by,uploaded_by_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'upload',$10,$11,$12)`,
      [id, s.id, s.shipper_id, b.kind, b.title, b.filename, b.mime, size, b.data, office ? b.visibility : 'shared', u.name, office ? 'shipper' : 'customer'])
    // Tell the other side.
    if (office) { if (s.user_id && b.visibility === 'shared') await notify(db, { userId: s.user_id, kind: 'document', title: `New document on ${s.ref}: ${b.title}`, body: `${docKindLabels[b.kind]} added by ${u.name}. Open the shipment to view or download it.`, link: `/dashboard?tab=shipments&s=${s.id}` }) }
    else await notifyShipperStaff(db, s.shipper_id, { kind: 'document', title: `${u.name} added a document to ${s.ref}`, body: `${docKindLabels[b.kind]}: ${b.title}.`, link: `/dashboard/shipments?q=${s.ref}&b=all` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json({ document: docOut(await docById(db, id)) })
  }))

  r.post('/shipments/:id/documents/generate', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office } = await access(db, req, String(req.params.id))
    if (!office) throw new HttpError(403, 'Only the shipper can generate documents.')
    const b = zGenerate.parse(req.body)
    const { id, old } = await generateDocument(db, s, b.kind, b.visibility, u.name, HttpError)
    res.status(old ? 200 : 201).json({ document: docOut(await docById(db, id)), regenerated: old })
  }))

  /** Full document (file as data URL, or the payload) for the viewer. */
  r.get('/documents/:id', wrap(async (req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>('select * from documents where id = $1', [req.params.id])
    const doc = rows[0]; if (!doc) throw new HttpError(404, 'Document not found.')
    const { office } = await access(db, req, doc.shipment_id)
    if (!office && doc.visibility !== 'shared') throw new HttpError(403, 'This document is not shared with you.')
    res.set('Cache-Control', 'private, no-store')
    res.json({ document: docOut({ ...doc, has_file: doc.data != null, has_payload: doc.payload != null }), dataUrl: doc.data ? `data:${doc.mime};base64,${doc.data}` : null, payload: doc.payload ? (typeof doc.payload === 'string' ? JSON.parse(doc.payload) : doc.payload) : null, canManage: office })
  }))
  r.patch('/documents/:id', wrap(async (req, res) => {
    const db = await getDb(); const doc = await docById(db, String(req.params.id))
    const { office, u } = await access(db, req, doc.shipment_id)
    if (!office && !(doc.uploaded_by_role === 'customer' && u.role === 'customer')) throw new HttpError(403, 'Only the shipper can change this document.')
    const b = zPatch.parse(req.body)
    await db.query(`update documents set title = coalesce($2, title), kind = coalesce($3, kind), visibility = coalesce($4, visibility), updated_at = now() where id = $1`, [doc.id, b.title ?? null, b.kind ?? null, office ? b.visibility ?? null : null])
    res.json({ document: docOut(await docById(db, doc.id)) })
  }))
  r.delete('/documents/:id', wrap(async (req, res) => {
    const db = await getDb(); const doc = await docById(db, String(req.params.id))
    const { office, u } = await access(db, req, doc.shipment_id)
    if (!office && !(doc.uploaded_by_role === 'customer' && u.role === 'customer')) throw new HttpError(403, 'Only the shipper can delete this document.')
    await db.query('delete from documents where id = $1', [doc.id])
    res.json({ ok: true })
  }))
  /** Share link on / off. */
  r.post('/documents/:id/share', wrap(async (req, res) => {
    const db = await getDb(); const doc = await docById(db, String(req.params.id))
    const { office } = await access(db, req, doc.shipment_id)
    if (!office) throw new HttpError(403, 'Only the shipper can share documents.')
    const token = doc.share_token || randomBytes(18).toString('base64url')
    await db.query('update documents set share_token = $2, updated_at = now() where id = $1', [doc.id, token])
    res.json({ document: docOut(await docById(db, doc.id)) })
  }))
  r.delete('/documents/:id/share', wrap(async (req, res) => {
    const db = await getDb(); const doc = await docById(db, String(req.params.id))
    const { office } = await access(db, req, doc.shipment_id)
    if (!office) throw new HttpError(403, 'Only the shipper can revoke a share link.')
    await db.query('update documents set share_token = null, updated_at = now() where id = $1', [doc.id])
    res.json({ document: docOut(await docById(db, doc.id)) })
  }))
  /** Public: open a shared document by its link. */
  r.get('/docs/:token', wrap(async (req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>('select * from documents where share_token = $1', [req.params.token])
    const doc = rows[0]; if (!doc) throw new HttpError(404, 'This link is not valid any more.')
    const { rows: ship } = await db.query<Row>('select ref, origin, destination, customer from shipments where id = $1', [doc.shipment_id])
    res.set('Cache-Control', 'no-store')
    res.json({ document: docOut({ ...doc, has_file: doc.data != null, has_payload: doc.payload != null, share_token: null }), dataUrl: doc.data ? `data:${doc.mime};base64,${doc.data}` : null, payload: doc.payload ? (typeof doc.payload === 'string' ? JSON.parse(doc.payload) : doc.payload) : null, shipment: ship[0] ? { ref: ship[0].ref, origin: ship[0].origin, destination: ship[0].destination } : null })
  }))
}

/** Document counts per shipment for list views. */
export async function documentCounts(db: Db, shipmentIds: string[], sharedOnly: boolean) {
  if (!shipmentIds.length) return {} as Record<string, number>
  const { rows } = await db.query<Row>(`select shipment_id, count(*)::int as n from documents where shipment_id = any($1::text[]) ${sharedOnly ? `and visibility = 'shared'` : ''} group by shipment_id`, [shipmentIds])
  return Object.fromEntries(rows.map((r) => [r.shipment_id, Number(r.n)])) as Record<string, number>
}
