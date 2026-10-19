import { api } from './store'

export const RESTRICTED: [string, string][] = [
  ['batteries', 'Lithium batteries or power banks (loose or in devices)'],
  ['aerosols', 'Perfume, aerosols, nail polish or other flammable liquids'],
  ['food', 'Food, drinks or spices'],
  ['medicine', 'Medicines or supplements'],
  ['electronics', 'Used phones, laptops or other electronics'],
  ['cash', 'Cash, gold or jewellery over US$10,000 in value'],
]
export const restrictedLabel = (k: string) => RESTRICTED.find(([x]) => x === k)?.[1] ?? k
export const PROHIBITED = ['Firearms, ammunition, weapon parts', 'Explosives, fireworks, gas cylinders', 'Illegal drugs', 'Counterfeit or pirated goods', 'Live animals or plants', 'Anything banned at the destination']

export interface ExportState {
  applies: boolean; required: boolean; reasons: string[]; valueUsd: number | null; vehicle: boolean
  itn: string; exemption: string; filedBy: string; filedAt: string | null; titleOk: boolean | null; titleStep: string | null; cleared: string; note: string
}
export interface ExportView { export: ExportState; canEdit: boolean; exemptions: { code: string; label: string }[]; threshold: number }
export interface ScreeningHit { id: string; subjectType: 'request' | 'shipper' | 'shipment'; subjectId: string; role: string; name: string; matched: string; program: string; score: number; status: 'open' | 'cleared' | 'confirmed'; note: string; reviewedBy: string | null; reviewedAt: string | null; createdAt: string }
export interface ScreeningView { list: { count: number; refreshedAt: string; source: string } | null; lastError: { error: string; at: string } | null; hits: ScreeningHit[] }
export interface TaxSettings { enabled: boolean; rates: Record<string, number>; taxShipping: boolean; taxRentals: boolean }

export const complianceApi = {
  exportFor: (shipmentId: string) => api<ExportView>(`/shipments/${shipmentId}/export`),
  saveExport: (shipmentId: string, b: { itn: string; exemption: string; valueUsd?: number | null; note: string }) => api<ExportView>(`/shipments/${shipmentId}/export`, { method: 'PUT', json: b }),
  screening: () => api<ScreeningView>('/admin/screening'),
  refreshList: () => api<{ ok: boolean; count: number; error?: string }>('/admin/screening/refresh', { json: {} }),
  checkName: (name: string) => api<{ matches: { matched: string; program: string; score: number }[] }>('/admin/screening/check', { json: { name } }),
  review: (id: string, status: 'cleared' | 'confirmed', note: string) => api<{ ok: true }>(`/admin/screening/${id}`, { method: 'PATCH', json: { status, note } }),
  tax: () => api<{ tax: TaxSettings }>('/admin/supplies/tax').then((r) => r.tax),
  saveTax: (t: TaxSettings) => api<{ tax: TaxSettings }>('/admin/supplies/tax', { method: 'PUT', json: t }).then((r) => r.tax),
  taxRate: (state: string, country = 'US') => api<{ rate: number }>(`/supplies/tax-rate?state=${encodeURIComponent(state)}&country=${encodeURIComponent(country)}`).then((r) => r.rate),
}
