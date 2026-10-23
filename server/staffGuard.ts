/**
 * One place that decides which shipping-company staff may call which API.
 *
 * Owners (and dispatchers, unless an area is taken away from them) pass straight through.
 * Everyone else is checked here before any route runs:
 *  - Drivers are deny-by-default: only the calls their runs app, pay/time/HR pages and scanning make.
 *  - Office roles (finance, warehouse, agent) are checked against the same areas as their menu (`can`).
 *
 * Routes keep their own checks (company ownership, run ownership…); this is the role layer on top.
 * STAFF_GUARD=observe logs what would be refused without refusing it (for tuning); STAFF_GUARD=off disables it.
 */
import type { NextFunction, Request, Response } from 'express'
import type { ApiUser, Area } from './api'

type Need = (u: ApiUser, can: (a: Area) => boolean) => boolean
interface Rule { m?: RegExp; p: RegExp; need: Need; why: string }

export const isDriver = (r?: string) => r === 'pickup_driver' || r === 'delivery_driver' || r === 'driver'
const any = (...a: Area[]): Need => (_u, can) => a.some(can)
const owner: Need = (u) => (u.staffRole ?? 'owner') === 'owner'
const manager: Need = (u) => ['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')
const WRITE = /^(POST|PUT|PATCH|DELETE)$/

/** What a driver's phone actually calls. Anything else is refused. */
const DRIVER_ALLOW: RegExp[] = [
  /^\/auth(\/|$)/, /^\/me(\/|$)/, /^\/notifications(\/|$)/, /^\/announcements(\/|$)/, /^\/features(\/|$)/, /^\/push(\/|$)/,
  /^\/team\/me$/, /^\/shipper\/prefs$/, /^\/shippers$/, /^\/meta\//, /^\/clients\/reminders\/due$/, /^\/recipient\/settings$/, /^\/my\/invoices$/,
  /^\/runs\/(mine|dispatch)$/, /^\/runs\/[^/]+(\/(stops(\/[^/]+(\/(on-way|outside|details))?)?|late|reorder-from|summary|position))?$/,
  /^\/shifts(\/|$)/, /^\/drivers\/me(\/|$)/, /^\/drivers\/(cash|expenses(\/read)?|rota|training|stats|hr\/settings)$/,
  /^\/drivers\/payslips\/[^/]+(\/query)?$/, /^\/drivers\/me\/leave\/[^/]+$/,
  /^\/scans(\/|$)/, /^\/costs\/categories$/, /^\/vehicles$/, /^\/geocode$/,
  /^\/shipments$/, /^\/requests$/, // answered with only their own work (see api.ts)
  /^\/shipments\/[^/]+\/(collect|checkin|pieces|pickup|documents|items|recipient|advance|pod|collection-code\/resend|measure|vehicle(\/checklist)?)$/,
  /^\/documents\/[^/]+(\/file)?$/, /^\/labels(\/|$)/,
]

/** Office roles: the area (or role) each part of the API needs. First match wins. */
const RULES: Rule[] = [
  // the company's public face
  { m: WRITE, p: /^\/shippers\/me(\/|$)/, need: any('brand'), why: 'Only the owner or dispatcher can change the company profile.' },
  // money in and out
  { m: WRITE, p: /^\/clients\/[^/]+\/invoices$/, need: any('collections', 'payments'), why: 'Invoices are for owners, dispatchers and finance.' },
  { m: WRITE, p: /^\/invoices(\/|$)/, need: any('collections', 'payments'), why: 'Invoices are for owners, dispatchers and finance.' },
  { p: /^\/invoices\/[^/]+$/, need: any('collections', 'payments', 'clients'), why: 'Invoices are for owners, dispatchers, finance and sales.' },
  { m: WRITE, p: /^\/shipments\/[^/]+\/payment\/(record|checkout|refund)$/, need: any('payments', 'collections'), why: 'Recording payments is for owners, dispatchers and finance.' },
  { m: WRITE, p: /^\/shipments\/[^/]+\/receiver-charges(\/|$)/, need: any('payments', 'collections', 'warehouse'), why: 'Charges are for the office.' },
  { p: /^\/collections(\/|$)/, need: any('collections'), why: 'Collections are for owners, dispatchers and finance.' },
  { p: /^\/billing\/cancel$/, need: owner, why: 'Only the owner can cancel the plan.' },
  // the client book and marketing to it (follow-up reminders answer empty for roles without it — see clients.ts)
  { m: /^GET$/, p: /^\/clients\/reminders\/due$/, need: () => true, why: '' },
  { p: /^\/clients(\/|$)/, need: any('clients'), why: 'The client book is for owners, dispatchers, finance and sales.' },
  { p: /^\/campaigns(\/|$)/, need: any('clients', 'leads'), why: 'Campaigns are for owners, dispatchers and sales.' },
  { m: WRITE, p: /^\/requests\/[^/]+\/quotes$/, need: any('leads'), why: 'Quoting is for owners, dispatchers and sales.' },
  { p: /^\/quote-templates(\/|$)/, need: any('leads'), why: 'Quote templates are for owners, dispatchers and sales.' },
  // company numbers
  { p: /^\/shipper\/(analytics|lanes|weekly-report)$/, need: any('analytics'), why: 'Analytics aren’t part of this role.' },
  // operations that hand out work
  { p: /^\/runs\/candidates$/, need: manager, why: 'Planning runs is for owners and dispatchers.' },
  { m: WRITE, p: /^\/warehouse(\/|$)/, need: any('warehouse'), why: 'Warehouse changes are for warehouse staff.' },
  { p: /^\/team$/, need: any('team'), why: 'The team list isn’t part of this role.' },
]

export function staffGuard(deps: { resolve: (req: Request) => Promise<ApiUser | null>; can: (u: ApiUser, a: Area) => boolean }) {
  const mode = (process.env.STAFF_GUARD ?? 'on').toLowerCase()
  return async (req: Request, res: Response, next: NextFunction) => {
    if (mode === 'off') return next()
    let u: ApiUser | null = null
    try { u = await deps.resolve(req) } catch { return next() }
    if (!u || u.role !== 'shipper' || !u.shipperId) return next()
    const role = u.staffRole ?? 'owner'
    if (role === 'owner') return next()
    const path = req.path.replace(/\/+$/, '') || '/'
    let why = ''
    if (isDriver(role)) { if (!DRIVER_ALLOW.some((x) => x.test(path))) why = 'Drivers use the runs app — ask the office for this.' }
    else { const rule = RULES.find((x) => (!x.m || x.m.test(req.method)) && x.p.test(path)); if (rule && !rule.need(u, (a) => deps.can(u!, a))) why = rule.why }
    if (!why) return next()
    if (mode === 'observe') { console.log(`[staff-guard] would refuse ${role} ${req.method} ${path}`); return next() }
    res.status(403).json({ error: why })
  }
}
