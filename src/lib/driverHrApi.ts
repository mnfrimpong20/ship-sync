import { api } from './store'

export interface HrSettings { periodDays: 7 | 14; periodAnchor: string; overtimeAfter: number; overtimeRate: number; weekendRate: number; holidayRate: number; holidays: string[]; warnShiftHours: number; maxShiftHours: number; bonusOnTime: { pct: number; amount: number }; bonusNoDamage: number; showLeaderboard: boolean; threshold1099: number; leaveDays: number; trainingVideos: { title: string; url: string }[] }
export interface PayLine { label: string; kind: 'earning' | 'bonus' | 'reimbursement' | 'deduction'; qty?: number; rate?: number; amount: number; ref?: string }
export interface Payslip { id: string; periodId: string; staffId: string; name?: string; start: string; end: string; lines: PayLine[]; gross: number; reimbursed: number; deducted: number; net: number; currency: string; status: 'draft' | 'approved' | 'paid'; approvedBy: string; approvedAt: string | null; paidAt: string | null; paidMethod: string; paidRef: string; stats: { stops?: number; runs?: number; hours?: number; overtime?: number; onTimePct?: number | null; incidents?: number; final?: boolean }; company?: string }
export interface SlipCalc { lines: PayLine[]; gross: number; reimbursed: number; deducted: number; net: number; currency: string; stats: Payslip['stats'] }
export interface Adjustment { id: string; name?: string; staffId?: string; kind: string; amount: number; currency: string; note: string; installments: number; remaining: number; applied?: number; by?: string; at?: string }
export interface ExpenseRow { id: string; name: string; staffId: string; kind: string; amount: number; currency: string; amountUsd: number; note: string; photo: string | null; status: 'pending' | 'approved' | 'rejected' | 'reimbursed'; paidBy: 'driver' | 'company'; payslipId: string | null; at: string }
export interface CheckItem { key: string; label: string; done: boolean }
export interface Person {
  staffId: string; name: string; role: string; phone: string; email: string; staffStatus: string; employment: 'employee' | 'contractor'; country: string; startDate: string | null; status: 'onboarding' | 'active' | 'offboarded'; trialUntil: string | null
  licence: { class?: string; last4?: string; state?: string }; emergency: { name?: string; phone?: string; relation?: string }; payout: { method?: string; momo?: string; zelle?: string; bankName?: string; bankLast4?: string }; expiries: Record<string, string>
  contractSignedAt: string | null; contractName: string; training: { score: number; tries: number; passedAt: string | null } | null; offboarding: Record<string, unknown> | null
  leave: { allowance: number; used: number; left: number }; checklist: CheckItem[]; docs: { id: string; kind: string; title: string; mime: string; expiresOn: string | null; uploadedBy: string; at: string; status: 'pending' | 'checked' | 'rejected'; reviewNote: string; reviewedBy: string; side: string }[]
  expiringSoon: { kind: string; label: string; date: string; expired: boolean }[]; pay: StaffPay; owed?: number; docCount?: number; isDriver?: boolean
}
export interface StaffPay { perStop?: number; perRun?: number; perHour?: number; monthly?: number; currency?: string }
export interface Leave { id: string; staffId: string; name?: string; swapName?: string; kind: 'vacation' | 'sick' | 'personal' | 'swap'; start: string; end: string; swapWith: string | null; note: string; status: 'pending' | 'approved' | 'declined'; decidedBy: string; decisionNote?: string; at: string }
export interface Rota { from: string; days: number; staff: { id: string; name: string; role: string }[]; entries: { staffId: string; day: string; kind: 'work' | 'off' | 'leave'; start: string; end: string; note: string }[]; leave: { staffId: string; start: string; end: string; kind: string }[]; runs: { id: string; name: string; day: string; staffId: string; kind: string }[] }
export interface Week { week: string; stops: number; done: number; onTimePct: number | null; firstTryPct: number | null; incidents: number; rating: number | null; cashOkPct: number | null }
export interface Analytics {
  weeks: string[]; showLeaderboard: boolean; leaderboard: { staffId: string; name: string; score: number }[]
  scorecards: { staffId: string; name: string; role: string; done: number; stops: number; onTimePct: number | null; firstTryPct: number | null; incidents: number; rating: number | null; ratings: number; cashOkPct: number | null; series: Week[] }[]
  runs: { id: string; name: string; date: string; kind: string; driver: string | null; vehicle: string | null; stops: number; done: number; km: number; payCost: number; expenses: number; cost: number; perStop: number | null; perKm: number | null; revenue: number; costPct: number | null }[]
  areas: { area: string; stops: number; cost: number; revenue: number; perStop: number | null }[]
  fleet: { id: string; name: string; plate: string; status: string; odometer: number | null; km30: number | null; fuelUsd30: number; fuelPerKm: number | null; checkIssues30: number; serviceEveryKm: number | null; lastServiceKm: number | null; lastServiceAt: string | null; nextServiceKm: number | null; serviceDue: boolean }[]
}
export interface PayDetail { stops: { label: string; address: string; doneAt: string; run: string; kind: string; holiday: boolean; weekend: boolean }[]; shifts: { start: string; end: string; breaks: number; hours: number; edited: boolean }[] }
export interface PayQuery { id: string; payslipId: string | null; staffId: string; name?: string; line: string; note: string; status: 'open' | 'answered'; answer: string; answeredBy: string; answeredAt: string | null; at: string }
export interface AdvanceReq { id: string; staffId: string; name?: string; amount: number; currency: string; reason: string; installments: number; status: 'pending' | 'approved' | 'declined'; decidedBy: string; note: string; at: string }
export interface PaySummary { period: { start: string; end: string }; closesIn: number; payDay: string; currency: string; today: { stops: number; runs: number; hours: number; earned: number }; history: { start: string; end: string; net: number; currency: string; status: string }[]; year: { currency: string; gross: number; reimbursed: number; net: number }[] }
export interface Badge { name: string; role: string; company: string; photo: string | null; licenceClass: string; licenceExpires: string | null; active: boolean; papersOk: boolean; expired: string[]; since: string | null }
export interface TrainingQ { q: string; options: string[]; why: string }

export const hrApi = {
  settings: () => api<{ settings: HrSettings }>('/drivers/hr/settings').then((r) => r.settings),
  saveSettings: (s: Partial<HrSettings>) => api<{ settings: HrSettings }>('/drivers/hr/settings', { method: 'PUT', json: s }).then((r) => r.settings),
  people: () => api<{ people: Person[] }>('/drivers/people').then((r) => r.people),
  person: (id: string) => api<{ person: Person; notes: { id: string; kind: string; body: string; by: string; at: string }[] | null; adjustments: Adjustment[] }>(`/drivers/people/${id}`),
  savePerson: (id: string, b: Partial<Person> & { leaveDays?: number }) => api<{ person: Person }>(`/drivers/people/${id}`, { method: 'PUT', json: b }),
  addDoc: (id: string | 'me', b: { kind: string; title: string; dataUrl: string; expiresOn?: string | null; side?: '' | 'front' | 'back' }) => api(id === 'me' ? '/drivers/me/docs' : `/drivers/people/${id}/docs`, { json: b }),
  doc: (id: string) => api<{ title: string; kind: string; dataUrl: string }>(`/drivers/docs/${id}`),
  delDoc: (id: string) => api(`/drivers/docs/${id}`, { method: 'DELETE' }),
  addNote: (id: string, kind: string, body: string) => api(`/drivers/people/${id}/notes`, { json: { kind, body } }),
  delNote: (id: string) => api(`/drivers/notes/${id}`, { method: 'DELETE' }),
  offboard: (id: string, b: { lastDay: string; reason: string; returned: { equipment: boolean; fuelCard: boolean; keys: boolean; uniform: boolean }; finalPay: boolean }) => api<{ ok: true; payslipId: string | null; unreturned: string[] }>(`/drivers/people/${id}/offboard`, { json: b }),
  adjust: (id: string, b: { kind: string; amount: number; currency: string; note: string; installments: number }) => api(`/drivers/people/${id}/adjustments`, { json: b }),
  delAdjust: (id: string) => api(`/drivers/adjustments/${id}`, { method: 'DELETE' }),
  decideExpense: (id: string, status: 'approved' | 'rejected', paidBy?: 'driver' | 'company', note = '') => api(`/drivers/expenses/${id}/decide`, { json: { status, paidBy, note } }),
  pay: () => api<{ settings: HrSettings; current: { start: string; end: string }; preview: (SlipCalc & { staffId: string; name: string; role?: string; pay?: StaffPay })[]; periods: { id: string; start: string; end: string; status: string; lockedBy: string; slips: number; paid: number; total: number }[]; payslips: Payslip[]; expenses: ExpenseRow[]; adjustments: Adjustment[] }>('/drivers/pay'),
  close: (start: string) => api<{ ok: true; periodId: string; payslips: number }>('/drivers/pay/close', { json: { start } }),
  approveAll: (periodId: string) => api<{ ok: true; approved: number }>(`/drivers/pay/periods/${periodId}/approve-all`, { json: {} }),
  slip: (id: string) => api<{ payslip: Payslip; employment: string; payout: Person['payout'] }>(`/drivers/payslips/${id}`),
  approve: (id: string) => api<{ payslip: Payslip }>(`/drivers/payslips/${id}/approve`, { json: {} }),
  recalc: (id: string) => api<{ payslip: Payslip }>(`/drivers/payslips/${id}/recalc`, { json: {} }),
  paid: (id: string, method: string, ref: string) => api<{ payslip: Payslip }>(`/drivers/payslips/${id}/paid`, { json: { method, ref } }),
  editShift: (id: string, start: string, end: string | null, reason: string) => api(`/drivers/shifts/${id}`, { method: 'PATCH', json: { start, end, reason } }),
  rota: (from: string, days = 7) => api<Rota>(`/drivers/rota?from=${from}&days=${days}`),
  setRota: (b: { staffId: string; day: string; kind: 'work' | 'off' | 'leave' | 'clear'; start?: string; end?: string; note?: string }) => api('/drivers/rota', { method: 'PUT', json: b }),
  leave: () => api<{ requests: Leave[] }>('/drivers/leave').then((r) => r.requests),
  decideLeave: (id: string, status: 'approved' | 'declined', note = '') => api<{ ok: true; clashes: { id: string; name: string; day: string }[] }>(`/drivers/leave/${id}/decide`, { json: { status, note } }),
  availability: (date: string) => api<{ day: string; away: Record<string, string> }>(`/drivers/availability?date=${date}`).then((r) => r.away),
  analytics: (weeks = 12) => api<Analytics>(`/drivers/analytics?weeks=${weeks}`),
  service: (vehicleId: string, b: { everyKm: number | null; lastKm: number | null; lastAt: string | null }) => api(`/drivers/fleet/${vehicleId}/service`, { method: 'PUT', json: b }),
  // driver's own
  me: () => api<{ person: Person; settings: { trainingVideos: { title: string; url: string }[] }; company: string }>('/drivers/me/profile'),
  saveMe: (b: { emergency?: Person['emergency']; payout?: Person['payout']; licence?: Person['licence'] }) => api<{ person: Person }>('/drivers/me/profile', { method: 'PUT', json: b }),
  training: () => api<{ questions: TrainingQ[]; passMark: number }>('/drivers/training'),
  sendTraining: (answers: number[]) => api<{ score: number; passed: boolean; wrong: number[] }>('/drivers/me/training', { json: { answers } }),
  sign: (name: string, signature: string, version: string) => api('/drivers/me/contract', { json: { name, signature, version } }),
  myPay: () => api<{ current: SlipCalc & { start: string; end: string }; payslips: Payslip[]; owed: number; adjustments: Adjustment[]; expenses: { id: string; kind: string; amount: number; currency: string; note: string; status: string; at: string }[] }>('/drivers/me/pay'),
  myLeave: () => api<{ balance: { allowance: number; used: number; left: number }; requests: Leave[]; mates: { id: string; name: string }[] }>('/drivers/me/leave'),
  askLeave: (b: { kind: string; start: string; end: string; swapWith?: string; note: string }) => api('/drivers/me/leave', { json: b }),
  myRank: () => api<{ show: boolean; rank?: number | null; of?: number }>('/drivers/me/rank'),
  slipDetail: (id: string) => api<PayDetail>(id === 'current' ? '/drivers/me/pay/detail' : `/drivers/payslips/${id}/detail`),
  paySummary: () => api<PaySummary>('/drivers/me/pay/summary'),
  askQuery: (payslipId: string, line: string, note: string) => api(`/drivers/payslips/${payslipId}/query`, { json: { line, note } }),
  myQueries: () => api<{ queries: PayQuery[] }>('/drivers/me/queries').then((r) => r.queries),
  queries: () => api<{ queries: PayQuery[] }>('/drivers/queries').then((r) => r.queries),
  answer: (id: string, answer: string) => api(`/drivers/queries/${id}/answer`, { json: { answer } }),
  askAdvance: (b: { amount: number; currency: string; reason: string; installments: number }) => api('/drivers/me/advance', { json: b }),
  myAdvances: () => api<{ requests: AdvanceReq[] }>('/drivers/me/advances').then((r) => r.requests),
  advances: () => api<{ requests: AdvanceReq[] }>('/drivers/advance-requests').then((r) => r.requests),
  decideAdvance: (id: string, status: 'approved' | 'declined', note = '') => api(`/drivers/advance-requests/${id}/decide`, { json: { status, note } }),
  cancelLeave: (id: string) => api(`/drivers/me/leave/${id}`, { method: 'DELETE' }),
  reviewDoc: (id: string, status: 'checked' | 'rejected', note = '') => api(`/drivers/docs/${id}/review`, { json: { status, note } }),
  setPhoto: (dataUrl: string) => api('/drivers/me/photo', { json: { dataUrl } }),
  badge: () => api<{ badge: Badge; verifyUrl: string }>('/drivers/me/badge'),
  verify: (token: string) => api<{ name: string; role: string; company: string; photo: string | null; valid: boolean; active: boolean; papersOk: boolean; checkedAt: string }>(`/verify-driver/${encodeURIComponent(token)}`),
  rate: (ref: string, stars: number, note: string) => api(`/track/${encodeURIComponent(ref)}/rate`, { json: { stars, note } }),
}

export const money = (n: number, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n}` } }
export const ADJ_LABEL: Record<string, string> = { bonus: 'Bonus', advance: 'Advance', deduction: 'Deduction', shortfall: 'Cash shortfall', damage: 'Damage', fuel_card: 'Fuel card' }
export const LEAVE_LABEL: Record<string, string> = { vacation: 'Holiday', sick: 'Sick', personal: 'Personal', swap: 'Shift swap' }
