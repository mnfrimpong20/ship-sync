import { api } from './store'

export type PartnerService = 'clearing' | 'devanning' | 'warehouse' | 'delivery' | 'collection' | 'vehicles'
export const serviceLabels: Record<PartnerService, string> = { clearing: 'Customs clearing', devanning: 'Unstuffing', warehouse: 'Storage', delivery: 'Door delivery', collection: 'Collection point', vehicles: 'Vehicle release' }
export interface DestPartner { id: string; name: string; country: string; cities: string[]; services: PartnerService[]; contactName: string; phone: string; whatsapp: string; email: string; about: string; ratesNote: string; verified: boolean; active: boolean; demo: boolean; rating: number | null; ratingCount: number; jobs: number }
export interface Assignment { id: string; partnerId: string; partnerName: string; containerId: string; containerRef: string; shipper: string; services: PartnerService[]; note: string; status: 'requested' | 'accepted' | 'declined' | 'done'; stars: number | null; review: string; createdAt: string | null; respondedAt: string | null }
export type PartnerInput = Omit<DestPartner, 'id' | 'demo' | 'rating' | 'ratingCount' | 'jobs'>

export const partnersApi = {
  directory: (country?: string) => api<{ partners: DestPartner[] }>(`/destination-partners${country ? `?country=${country}` : ''}`).then((r) => r.partners),
  forContainer: (id: string) => api<{ assignments: Assignment[] }>(`/containers/${id}/ntemtem-partner`).then((r) => r.assignments),
  assign: (id: string, b: { partnerId: string; services: PartnerService[]; note: string }) => api<{ assignment: { id: string }; link: { url: string; path: string } }>(`/containers/${id}/ntemtem-partner`, { json: b }),
  rate: (id: string, stars: number, review: string) => api<{ ok: true }>(`/partner-assignments/${id}/rate`, { json: { stars, review } }),
  admin: () => api<{ partners: DestPartner[]; assignments: Assignment[] }>('/admin/partners'),
  create: (b: PartnerInput) => api<{ id: string }>('/admin/partners', { json: b }),
  update: (id: string, b: PartnerInput) => api<{ ok: true }>(`/admin/partners/${id}`, { method: 'PUT', json: b }),
  setStatus: (id: string, status: 'accepted' | 'declined' | 'done') => api<{ ok: true }>(`/admin/partner-assignments/${id}`, { method: 'PATCH', json: { status } }),
}
