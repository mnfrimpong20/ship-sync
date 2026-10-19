import { api } from './store'

export type DocKind = 'packing_list' | 'commercial_invoice' | 'bill_of_lading' | 'customs' | 'proof_of_delivery' | 'identity' | 'insurance' | 'receipt' | 'photo' | 'export_instructions' | 'other'
export const docKindLabels: Record<DocKind, string> = {
  packing_list: 'Packing list', commercial_invoice: 'Commercial invoice', bill_of_lading: 'Bill of lading / AWB', customs: 'Customs form', proof_of_delivery: 'Proof of delivery',
  identity: 'ID document', insurance: 'Insurance certificate', receipt: 'Payment receipt', photo: 'Photo', other: 'Other', export_instructions: 'Shipper’s letter of instruction' }
export interface ShipDoc {
  id: string; shipmentId: string; kind: DocKind; title: string; filename: string; mime: string; size: number
  source: 'upload' | 'generated'; visibility: 'shipper' | 'shared'; uploadedBy: string; uploadedByRole: 'shipper' | 'customer' | ''
  shareToken: string | null; createdAt: string | null; updatedAt: string | null; hasFile: boolean; hasPayload: boolean
}
export interface DocPayload {
  number: string; generatedAt: string
  measured?: { totals: { pieces: number; measured: number; actualKg: number; cbm: number; chargeableKg: number }; pieces: { seq: number; code: string; weightKg: number | null; dims: string }[] }
  booking?: { containerRef: string; number: string; seal: string; size: string; line: string; bookingRef: string; vesselName: string; voyage: string; pol: string; pod: string; etd: string | null } | null
  export?: { applies: boolean; required: boolean; itn: string; exemption: string; valueUsd: number | null; vehicle: boolean } | null
  declaration?: { accepted: boolean; includes: string[]; at: string } | null
  declaredValueUsd?: number | null
  shipment: { ref: string; mode: 'air' | 'ocean'; origin: string; destination: string; destinationName: string; cargo: string; cargoLabel: string; description: string; status: string; eta: string | null; createdAt: string | null; vesselName: string; customer: string }
  shipper: { name: string; hq: string; tagline: string }
  sender: { name: string; company: string; email: string; phone: string; city: string }
  receiver: { name: string; phone: string; address: string; city: string; country: string } | null
  request: { quantity: number; weightKg: number | null; pickup: boolean; delivery: boolean; insurance: boolean } | null
  pieces: { seq: number; code: string; status: string; lastScanAt: string | null; lastScanPlace: string }[]
  container: { ref: string; number: string; seal: string; vesselName: string; voyage: string; originPort: string; destinationPort: string; etd: string | null; eta: string | null } | null
  quote: { price: number; currency: string; includes: string[] } | null
  invoice: { number: string; items: { description: string; qty: number; unit: number }[]; subtotal: number; tax: number; total: number; currency: string; issuedAt: string | null; dueAt: string | null } | null
  pod: { at: string | null; place: string; by: string; receivedBy: string; photo: string | null; signature?: string | null; note: string; piecesDelivered: number; piecesTotal: number } | null
}
export interface DocFull { document: ShipDoc; dataUrl: string | null; payload: DocPayload | null; canManage?: boolean; shipment?: { ref: string; origin: string; destination: string } | null }

export const documentsApi = {
  list: (shipmentId: string) => api<{ documents: ShipDoc[]; canManage: boolean; generators: { kind: DocKind; label: string }[] }>(`/shipments/${shipmentId}/documents`),
  upload: (shipmentId: string, d: { kind: DocKind; title: string; filename: string; mime: string; data: string; visibility: 'shipper' | 'shared' }) => api<{ document: ShipDoc }>(`/shipments/${shipmentId}/documents`, { json: d }).then((r) => r.document),
  generate: (shipmentId: string, kind: 'packing_list' | 'commercial_invoice' | 'proof_of_delivery', visibility: 'shipper' | 'shared' = 'shared') => api<{ document: ShipDoc; regenerated: boolean }>(`/shipments/${shipmentId}/documents/generate`, { json: { kind, visibility } }),
  get: (id: string) => api<DocFull>(`/documents/${id}`),
  update: (id: string, p: Partial<Pick<ShipDoc, 'title' | 'kind' | 'visibility'>>) => api<{ document: ShipDoc }>(`/documents/${id}`, { method: 'PATCH', json: p }).then((r) => r.document),
  remove: (id: string) => api<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' }),
  share: (id: string) => api<{ document: ShipDoc }>(`/documents/${id}/share`, { json: {} }).then((r) => r.document),
  unshare: (id: string) => api<{ document: ShipDoc }>(`/documents/${id}/share`, { method: 'DELETE' }).then((r) => r.document),
  shared: (token: string) => api<DocFull>(`/docs/${encodeURIComponent(token)}`),
}

export const shareUrl = (token: string) => `${location.origin}/doc/${token}`
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Read a File as base64 (no data: prefix). Photos larger than ~1.5 MB are downscaled first so a phone snap doesn't blow the 6 MB cap. */
export async function fileToBase64(file: File): Promise<{ data: string; mime: string; size: number }> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.size > 1.5 * 1024 * 1024) {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height))
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      const dataUrl = c.toDataURL('image/jpeg', 0.85)
      const data = dataUrl.split(',')[1]
      return { data, mime: 'image/jpeg', size: Math.floor((data.length * 3) / 4) }
    } finally { URL.revokeObjectURL(url) }
  }
  const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file) })
  return { data, mime: file.type || 'application/octet-stream', size: file.size }
}
