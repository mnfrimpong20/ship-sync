import { api } from './store'

export interface AutopilotSettings {
  unpaidReminders: boolean; reprice: 'off' | 'review' | 'auto'; repriceThresholdPct: number
  containerFill: boolean; autoLoadDays: number; fillTargetPct: number
  pickupPlanning: boolean; planHour: number; timezone: string; dayStart: string; maxStopsPerRun: number; textWindows: boolean
  quoteFollowUp: 'off' | 'remind' | 'auto'; followUpHours: number; followUpMessage: string
  paperwork: boolean; destinationCharges: 'off' | 'draft' | 'send'; assistant: boolean
}
export interface LogLine { id: string; kind: string; title: string; body: string; link: string; ref: string; at: string | null }
export interface Adjustment { id: string; shipmentId: string; oldUsd: number; newUsd: number; diffUsd: number; reason: string; status: 'proposed' | 'sent' | 'approved' | 'declined' | 'withdrawn'; createdAt: string | null; decidedAt: string | null; decidedBy: string }
export type Trigger = 'shipment.booked' | 'shipment.status' | 'shipment.measured' | 'container.stage' | 'invoice.overdue' | 'request.received'
export type Field = 'destination' | 'origin' | 'mode' | 'cargo' | 'status' | 'receiverCity' | 'customer' | 'valueUsd' | 'pieces' | 'diffPct' | 'containerStage' | 'overdueDays' | 'amountUsd'
export type Op = 'is' | 'is_not' | 'contains' | 'at_least' | 'at_most'
export type RuleAction =
  | { type: 'notify_team'; roles: string[]; message: string } | { type: 'message_customer'; message: string } | { type: 'assign_partner'; partnerId: string; services: string[] }
  | { type: 'receiver_charge'; amount: number; currency: string; reason: string; send: boolean } | { type: 'set_handover'; handover: 'delivery' | 'collection' } | { type: 'add_note'; note: string }
  | { type: 'make_document'; kind: 'packing_list' | 'commercial_invoice' | 'bill_of_lading' | 'export_instructions' }
export interface Rule { id: string; name: string; trigger: Trigger; status: string; conditions: { field: Field; op: Op; value: string }[]; actions: RuleAction[]; active: boolean; runs: number; lastRunAt: string | null; createdAt: string | null }
export type RuleInput = Omit<Rule, 'id' | 'runs' | 'lastRunAt' | 'createdAt'>
export interface Conversation { id: string; phone: string; name: string; lastAt: string | null; lastIntent: string; handedOff: boolean; unread: number; preview: string }
export interface ChatMessage { id: string; direction: 'in' | 'out'; body: string; intent: string; via: string; by: string; at: string | null }

export const autopilotApi = {
  get: () => api<{ settings: AutopilotSettings; log: LogLine[]; week: Record<string, number>; texting: boolean }>('/autopilot'),
  save: (s: Partial<AutopilotSettings>) => api<{ settings: AutopilotSettings }>('/autopilot', { method: 'PUT', json: s }).then((r) => r.settings),
  planPickups: (date: string) => api<{ runs: number; stops: number; texted: number }>('/autopilot/plan-pickups', { json: { date, notify: true } }),
  adjustments: (shipmentId: string) => api<{ adjustments: Adjustment[]; canEdit: boolean }>(`/shipments/${shipmentId}/adjustments`),
  adjust: (shipmentId: string, id: string, action: 'send' | 'withdraw' | 'approve' | 'decline', newUsd?: number) => api<{ adjustments: Adjustment[] }>(`/shipments/${shipmentId}/adjustments/${id}/${action}`, { json: newUsd ? { newUsd } : {} }).then((r) => r.adjustments),
  rules: () => api<{ rules: Rule[] }>('/rules').then((r) => r.rules),
  saveRule: (r: RuleInput, id?: string) => api<{ rule: Rule }>(id ? `/rules/${id}` : '/rules', { method: id ? 'PUT' : 'POST', json: r }).then((x) => x.rule),
  deleteRule: (id: string) => api<{ ok: true }>(`/rules/${id}`, { method: 'DELETE' }),
  testRule: (rule: RuleInput, shipmentRef: string) => api<{ matches: boolean; checks: { field: Field; op: Op; value: string; actual: string | number | null; pass: boolean }[]; would: string[] }>('/rules/test', { json: { rule, shipmentRef } }),
  conversations: () => api<{ conversations: Conversation[]; ai: boolean; inbound: { twilio: boolean; meta: boolean } }>('/assistant/conversations'),
  conversation: (id: string) => api<{ conversation: Conversation; messages: ChatMessage[] }>(`/assistant/conversations/${id}`),
  reply: (id: string, body: string, handBack: boolean) => api<{ ok: true; sent: boolean }>(`/assistant/conversations/${id}/reply`, { json: { body, handBack } }),
  simulate: (phone: string, text: string) => api<{ text: string; intent: string; handoff: boolean; via: 'ai' | 'rules' }>('/assistant/simulate', { json: { phone, text } }),
}
