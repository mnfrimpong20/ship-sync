import { api } from './store'
import type { ShipmentStatus } from './data'

export interface Kpi { value: number | null; prev?: number; delta?: number | null; hint: string }
export interface WeekPoint { week: string; quotes: number; won: number; booked: number; invoiced: number }
export interface AttentionItem { kind: 'lead' | 'shipment' | 'invoice' | 'run' | 'followup' | 'vehicle' | 'profile'; severity: 'critical' | 'warning' | 'info'; title: string; body: string; to: string; at?: string | null }
export interface Overview {
  period: { from: string; to: string }
  kpis: { leads: Kpi; quotes: Kpi; winRate: Kpi; response: Kpi; active: Kpi; delivered: Kpi; invoiced: Kpi; collected: Kpi; outstanding: Kpi; clients: Kpi }
  series: WeekPoint[]
  lanes: { code: string; name: string; n: number; share: number }[]
  byStatus: { status: ShipmentStatus; label: string; n: number }[]
  pipeline: { leads: number; quoted: number; won: number }
  ops: { runsToday: { id: string; name: string; kind: 'pickup' | 'delivery'; status: string; driver: string | null; stops: number; pending: number }[]; vehicles: { total: number; available: number; onRun: number; maintenance: number }; team: { active: number; drivers: number; invited: number }; followupsDue: number }
  attention: AttentionItem[]
  leads: { id: string; ref: string; origin: string; destination: string; mode: string; cargo: string; contact: string; createdAt: string; competing: number }[]
  activity: { id: string; type: string; body: string; at: string; clientName: string; clientId: string }[]
}
export const insightsApi = { overview: () => api<Overview>('/shipper/overview') }
