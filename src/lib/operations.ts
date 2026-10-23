import { api } from './store'
import type { ShipmentStatus } from './data'

export type OpsRange = '30d' | '90d' | 'ytd' | '12m' | 'all'
export const rangeLabels: Record<OpsRange, string> = { '30d': 'Last 30 days', '90d': 'Last 90 days', ytd: 'Year to date', '12m': 'Last 12 months', all: 'All time' }
export interface OpsKpi { value: number; prev: number; delta: number | null }
export interface Operations {
  range: OpsRange; from: string; bucket: 'week' | 'month'
  kpis: { money: OpsKpi | null; shipments: OpsKpi; third: OpsKpi; rating: { value: number | null; count: number } | null; onTheWay: number }
  series: { start: string; shipments: number; usd: number }[]
  statuses: { key: string; label: string; n: number }[]
  activity: { shipmentId: string; ref: string; customer?: string; status: ShipmentStatus; label: string; at: string; place: string; note: string }[]
  actions: { key: string; tone: 'critical' | 'warning' | 'info'; title: string; body: string; link: string; n: number }[]
}
export const operationsApi = {
  shipper: (range: OpsRange) => api<Operations>(`/shipper/operations?range=${range}`),
  customer: (range: OpsRange) => api<Operations>(`/me/operations?range=${range}`),
}
