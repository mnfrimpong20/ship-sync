import { api } from './store'
import type { CargoType } from './data'

export type JobStep = 'requested' | 'accepted' | 'documents' | 'assessed' | 'duty_paid' | 'released' | 'done'
export type JobStatus = JobStep | 'cancelled' | 'declined'
export interface Broker {
  id: string; name: string; company: string; country: string; countryName: string; ports: string[]; licenceNo: string; licenceAuthority: string; phone: string; whatsapp: string; email: string; about: string; specialties: string[]
  fees: Partial<Record<CargoType, number>>; dutyAdvance: boolean; rating: number; reviews: number; verified: boolean; responseHours: number; initials: string; hue: string; active: boolean; jobs: number; feeUsd?: number
}
export interface BrokerJob {
  id: string; shipmentId: string; shipmentRef?: string; customer?: string; destination?: string; cargo?: string; shipperId: string; shipperName?: string
  broker: { id: string; name: string; company: string; phone: string; whatsapp: string; email: string; initials: string; hue: string; verified: boolean }
  status: JobStatus; feeUsd: number; dutyLocal: number | null; dutyCurrency: string | null; reference: string; notes: string; bookedBy: string; bookedByRole: string
  timeline: { at: string; status: string; note: string; by: string }[]; createdAt: string | null; updatedAt: string | null
}
export interface StepInput { status: JobStatus; note?: string; dutyLocal?: number; dutyCurrency?: string; reference?: string; feeUsd?: number }
export const jobStepLabels: Record<JobStatus, string> = { requested: 'Requested', accepted: 'Accepted by broker', documents: 'Documents lodged', assessed: 'Assessed by customs', duty_paid: 'Duty paid', released: 'Released from port', done: 'Cleared & handed over', cancelled: 'Cancelled', declined: 'Declined by broker' }
export const JOB_STEPS: JobStep[] = ['requested', 'accepted', 'documents', 'assessed', 'duty_paid', 'released', 'done']
export type BrokerInput = Omit<Broker, 'id' | 'countryName' | 'rating' | 'reviews' | 'initials' | 'hue' | 'jobs' | 'feeUsd'>

export const brokersApi = {
  profile: (id: string) => api<{ broker: Broker; stats: { jobs: number; done: number; open: number; avgClearDays: number | null; byCargo: { cargo: string; n: number }[] }; others: Broker[] }>(`/brokers/${id}`),
  list: (destination?: string) => api<{ brokers: Broker[] }>(`/brokers${destination ? `?destination=${destination}` : ''}`).then((r) => r.brokers),
  forShipment: (id: string) => api<{ job: BrokerJob | null; brokers: Broker[]; supported: boolean; canBook: boolean; canManage: boolean; steps: { id: JobStep; label: string }[] }>(`/shipments/${id}/customs`),
  book: (id: string, brokerId: string, note: string) => api<{ job: BrokerJob; portalLink: string }>(`/shipments/${id}/customs`, { json: { brokerId, note } }),
  link: (jobId: string) => api<{ portalLink: string }>(`/customs/jobs/${jobId}/link`).then((r) => r.portalLink),
  step: (jobId: string, b: StepInput) => api<{ job: BrokerJob }>(`/customs/jobs/${jobId}/step`, { json: b }).then((r) => r.job),
  jobs: () => api<{ jobs: BrokerJob[] }>('/customs/jobs').then((r) => r.jobs),
  portal: (token: string) => api<{ job: BrokerJob; shipment: { ref: string; customer: string; destination: string; cargo: string; cargoLabel: string; status: string; pieces: number; consignee: { name: string; phone: string; address: string; city: string } | null; vehicle: { vin: string; label: string; engineL: number | null; body: string; valueUsd: number | null } | null; container: { number: string; vessel: string; eta: string | null } | null }; documents: { id: string; kind: string; title: string; link: string | null }[]; steps: { id: JobStep; label: string }[] }>(`/broker/${token}`),
  portalStep: (token: string, b: StepInput) => api<{ job: BrokerJob }>(`/broker/${token}/step`, { json: b }).then((r) => r.job),
  admin: () => api<{ brokers: Broker[] }>('/admin/brokers').then((r) => r.brokers),
  create: (b: BrokerInput) => api<{ broker: Broker }>('/admin/brokers', { json: b }).then((r) => r.broker),
  update: (id: string, b: Partial<BrokerInput>) => api<{ broker: Broker }>(`/admin/brokers/${id}`, { method: 'PATCH', json: b }).then((r) => r.broker),
}

/* ---- joining the broker network ---- */
export interface BrokerApplicationInput { company: string; name: string; email: string; phone: string; whatsapp: string; country: string; ports: string[]; licenceNo: string; licenceAuthority: string; licenceExpires: string | null; specialties: string[]; about: string; fees: Record<string, number>; dutyAdvance: boolean; licenceFile: string | null; website?: string }
export interface BrokerApplication extends Omit<BrokerApplicationInput, 'licenceFile' | 'website'> { id: string; hasLicenceFile: boolean; status: 'pending' | 'approved' | 'rejected'; reason: string; brokerId: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string }
export interface BrokerAccess { name: string; email: string; role: string; status: string; lastSeenAt: string | null }
export const networkApi = {
  apply: (b: BrokerApplicationInput) => api('/broker-applications', { json: b }),
  applications: () => api<{ applications: BrokerApplication[] }>('/admin/broker-applications').then((r) => r.applications),
  licence: (id: string) => api<{ dataUrl: string }>(`/admin/broker-applications/${id}/licence`).then((r) => r.dataUrl),
  approve: (id: string, verified: boolean) => api<{ ok: true; brokerId: string; link: string }>(`/admin/broker-applications/${id}/approve`, { json: { verified } }),
  reject: (id: string, reason: string) => api(`/admin/broker-applications/${id}/reject`, { json: { reason } }),
  access: () => api<{ access: Record<string, BrokerAccess[]> }>('/admin/broker-access').then((r) => r.access),
  invite: (brokerId: string, b: { name: string; email: string; phone?: string }) => api<{ ok: true; link: string }>(`/admin/brokers/${brokerId}/invite`, { json: b }),
}
