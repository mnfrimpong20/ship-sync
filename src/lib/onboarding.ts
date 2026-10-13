import { api } from './store'

export interface OnboardingStep { id: string; title: string; detail: string; to: string; done: boolean; optional?: boolean; cta: string }
export interface Onboarding { steps: OnboardingStep[]; progress: number; doneCore: number; totalCore: number; complete: boolean; dismissed: boolean; verified: boolean; verificationRequestedAt: string | null; companyName: string }
export type CompanyDocKind = 'business_registration' | 'freight_licence' | 'insurance_certificate' | 'owner_id' | 'other'
export interface CompanyDoc { id: string; shipperId: string; kind: CompanyDocKind; label: string; title: string; mime: string; size: number; note: string; status: 'submitted' | 'accepted' | 'rejected'; reviewNote: string; reviewedAt: string | null; reviewedBy: string | null; uploadedBy: string; createdAt: string; url: string }
export interface DocsPayload { documents: CompanyDoc[]; kinds: { id: CompanyDocKind; label: string; required: boolean }[]; verified: boolean; requestedAt: string | null; note: string }

export const onboardingApi = {
  get: () => api<Onboarding>('/shipper/onboarding'),
  dismiss: () => api<{ ok: true }>('/shipper/onboarding/dismiss', { json: {} }),
  restore: () => api<{ ok: true }>('/shipper/onboarding/restore', { json: {} }),
  docs: () => api<DocsPayload>('/company-docs'),
  upload: (b: { kind: CompanyDocKind; title: string; mime: string; data: string; note?: string }) => api<{ document: CompanyDoc }>('/company-docs', { json: b }).then((r) => r.document),
  remove: (id: string) => api<{ ok: true }>(`/company-docs/${id}`, { method: 'DELETE' }),
  requestVerification: () => api<{ ok: true; requestedAt: string }>('/shipper/verification/request', { json: {} }),
  adminDocs: (shipperId: string) => api<{ documents: CompanyDoc[]; onboarding: { progress: number; steps: { id: string; title: string; done: boolean; optional: boolean }[]; requestedAt: string | null } | null }>(`/admin/shippers/${shipperId}/company-docs`),
  review: (id: string, status: 'accepted' | 'rejected', note: string) => api<{ document: CompanyDoc }>(`/admin/company-docs/${id}/review`, { json: { status, note } }).then((r) => r.document),
}
