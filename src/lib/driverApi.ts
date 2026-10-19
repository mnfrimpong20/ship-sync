import { api } from './store'

/* Everything the driver tools talk to (server/driverOps.ts). */
export interface StopPiece { id: string; seq: number; labelCode: string; sticker: string | null; weightKg: number | null; loaded: boolean; dropped: boolean }
export interface StopDetails {
  kind: 'pickup' | 'delivery'
  code: { required: boolean; verified: boolean }
  shipment?: { id: string; ref: string; cargo: string; description: string; mode: string; destination: string }
  pieces?: StopPiece[]
  supplies?: { id: string; name: string; qty: number; status: string; unitUsd: number }[]
  suppliesDrop?: { lines: string[]; by: string; at: string } | null
  catalog?: { id: string; name: string; priceUsd: number; kind: string }[]
  charges?: { id: string; amount: number; currency: string; reason: string; status: 'due' | 'paid' }[]
  documents?: { id: string; kind: string; title: string; createdAt: string }[]
  adjustments?: { id: string; oldUsd: number; newUsd: number; reason: string; status: string }[]
  payLink?: string | null
  vehicle?: { year?: number; make?: string; model?: string; vin?: string; color?: string; titleStatus?: string }
  vehicleReport?: { by: string; at: string; signerName: string; photoCount: number; mileage?: number; damage?: string } | null
  receiver?: { name: string; phone: string; address: string; city: string; gps: string; lat: number | null; lng: number | null }
}
export interface RunPieces { stops: { stopId: string; seq: number; label: string; ref: string; status: string; pieces: { id: string; seq: number; labelCode: string; loaded: boolean; dropped: boolean }[] }[] }
export interface RunMessage { id: string; stopId: string | null; from: string; side: 'driver' | 'office'; body: string; audio: string | null; at: string }
export interface Shift { id: string; start: string; end: string | null; onBreak: boolean; breaks: { start: string; end?: string }[]; hours: number }
export interface ShiftView { current: Shift | null; week: number; shifts: Shift[] }
export interface DriverStat { staffId: string; name: string; role: string; runs: number; stops: number; done: number; skipped: number; completionPct: number | null; onTimePct: number | null; perDay: number; reasons: Record<string, number>; hours: number; pay: { perStop?: number; perRun?: number; perHour?: number; currency?: string }; earned: number }
export interface Incident { id: string; kind: string; description: string; photos: string[]; by: string; ref: string | null; runId: string | null; runName: string | null; claim: boolean; status: 'open' | 'closed'; at: string }
export interface DriverPos { staffId: string; name: string; role: string; runId: string; runName: string; kind: string; pending: number; lat: number; lon: number; at: string }
export interface Expense { id: string; name: string; kind: string; amount: number; currency: string; amountUsd: number; hasPhoto: boolean; photo?: string; note: string; runId: string | null; at: string }

const R = (id: string) => `/runs/${id}`
const S = (id: string, sid: string) => `/runs/${id}/stops/${sid}`
export const driverApi = {
  details: (id: string, sid: string) => api<StopDetails>(`${S(id, sid)}/details`),
  setPieces: (id: string, sid: string, count: number) => api<{ pieces: StopPiece[] }>(`${S(id, sid)}/pieces`, { json: { count } }),
  sticker: (id: string, sid: string, pid: string, code: string) => api(`${S(id, sid)}/pieces/${pid}/sticker`, { json: { code } }),
  supplies: (id: string, sid: string, body: { dropped?: string[]; sell?: { supplyId: string; qty: number } }) => api(`${S(id, sid)}/supplies`, { json: body }),
  vehicleReport: (id: string, sid: string, body: unknown) => api<{ ok: true; flags: string[] }>(`${S(id, sid)}/vehicle-report`, { json: body }),
  approvePrice: (id: string, sid: string, body: { adjustmentId: string; signerName: string; signature: string; decision: 'approve' | 'decline' }) => api(`${S(id, sid)}/approve-price`, { json: body }),
  pin: (id: string, sid: string, lat: number, lon: number) => api(`${S(id, sid)}/pin`, { json: { lat, lon } }),
  payCharge: (id: string, sid: string, cid: string, method: 'cash' | 'momo_direct', phone = '') => api(`${S(id, sid)}/charges/${cid}`, { json: { method, phone } }),
  runPieces: (id: string) => api<RunPieces>(`${R(id)}/pieces`),
  scanPiece: (id: string, code: string, kind: 'load' | 'drop') => api<{ ok: true; already: boolean; piece: { labelCode: string; seq: number; ref: string }; stop: string } & RunPieces>(`${R(id)}/pieces/scan`, { json: { code, kind } }),
  vehicleCheck: (id: string, body: { items: Record<string, 'ok' | 'issue'>; notes: string; odometer?: number; photo?: string; safe: boolean }) => api<{ ok: true; issues: string[] }>(`${R(id)}/vehicle-check`, { json: body }),
  position: (id: string, lat: number, lon: number, accuracy?: number) => api<{ ok: boolean; near?: string[] }>(`${R(id)}/position`, { json: { lat, lon, accuracy } }),
  positions: () => api<{ drivers: DriverPos[] }>('/runs/positions'),
  incident: (id: string, body: { stopId?: string; kind: string; description: string; photos: string[] }) => api<{ ok: true; id: string; claim: boolean }>(`${R(id)}/incidents`, { json: body }),
  incidents: () => api<{ incidents: Incident[] }>('/drivers/incidents'),
  closeIncident: (iid: string, status: 'open' | 'closed') => api(`/drivers/incidents/${iid}`, { method: 'PATCH', json: { status } }),
  messages: (id: string) => api<{ messages: RunMessage[] }>(`${R(id)}/messages`),
  send: (id: string, body: { stopId?: string; body?: string; audio?: string }) => api<{ message: RunMessage }>(`${R(id)}/messages`, { json: body }),
  allMessages: () => api<{ messages: (RunMessage & { runId: string; runName: string; stopLabel: string | null; unread: boolean })[] }>('/drivers/messages'),
  expense: (body: { runId?: string; kind: string; amount: number; currency: string; photo?: string; note: string }) => api<{ ok: true; amountUsd: number }>('/drivers/expenses', { json: body }),
  expenses: () => api<{ expenses: Expense[] }>('/drivers/expenses'),
  shift: () => api<ShiftView>('/shifts/me'),
  clock: (action: 'in' | 'break' | 'resume' | 'out') => api<ShiftView>('/shifts/clock', { json: { action } }),
  shifts: () => api<{ shifts: (Shift & { name: string; staffId: string })[] }>('/drivers/shifts'),
  myCash: () => api<{ due: number; stops: { stopId: string; label: string; runName: string; amountUsd: number }[]; handovers: { id: string; expected: number; received: number; at: string; by: string; note: string }[] }>('/drivers/cash'),
  cash: () => api<{ drivers: { staffId: string; name: string; due: number; stops: { stopId: string; label: string; runName: string; amountUsd: number }[] }[]; handovers: { id: string; name: string; expected: number; received: number; diff: number; at: string; by: string; note: string }[] }>('/drivers/cash'),
  handover: (staffId: string, received: number, note: string) => api<{ ok: true; expected: number; received: number; diff: number }>(`/drivers/${staffId}/cash`, { json: { received, note } }),
  stats: (days = 30) => api<{ days: number; drivers: DriverStat[] }>(`/drivers/stats?days=${days}`),
  setPay: (staffId: string, pay: { perStop: number; perRun: number; perHour: number; currency: string }) => api(`/drivers/${staffId}/pay`, { method: 'PUT', json: pay }),
}

/** Read text aloud (next stop, etc.). Uses the phone's own voice; silently does nothing where unsupported. */
export function speak(text: string, lang = 'en') {
  try { const s = window.speechSynthesis; if (!s) return false; s.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'fr' ? 'fr-FR' : 'en-US'; u.rate = 0.95; s.speak(u); return true } catch { return false }
}
