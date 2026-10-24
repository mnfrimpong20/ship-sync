import express from 'express'
import cookieParser from 'cookie-parser'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRouter } from './api'
import { mountSeo, mountSeoFiles } from './seo'
import { getDb } from './db'
import { ais, startAirSweep } from './live'
import { startCarrierSync } from './containers'
import { startNotifySweeps } from './notify'
import { startRecipientSweeps } from './recipient'
import { stripeWebhook } from './payments'
import { startCollectionSweeps } from './collections'
import { startScheduleSweeps } from './booking'
import { startSourcingSweeps } from './sourcing'
import { startFlowSweeps } from './flow'
import { slugForHost } from './brand'
import { startExportSchedule } from './system'
import { uploadGuard } from './uploadGuard'
import { securityHeaders } from './securityHeaders'
import { whenLeader } from './jobLeader'
import { demoDataEnabled } from './db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProd = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5000)

async function main() {
  const db = await getDb() // connect, migrate, seed before accepting traffic
  // Background jobs run in one process only (see jobLeader.ts) — never twice, never silently not at all.
  // Live vessel positions feed this process's own live map and tracking — every process needs it, so it isn't a "job".
  ais.start(db).catch((e) => console.error('[ais]', e))
  startAirSweep() // same for live flights on the map
  whenLeader(getDb, async () => {
  startCarrierSync(getDb)
  startNotifySweeps(getDb)
  startRecipientSweeps(getDb)
  startCollectionSweeps(getDb)
  startScheduleSweeps(getDb)
  startSourcingSweeps(getDb)
  startFlowSweeps(getDb)
  ;(await import('./screening')).startScreeningSweeps(getDb)
  ;(await import('./lineBooking')).startBookingSweeps(getDb)
  ;(await import('./quickbooks')).startQuickBooksSweeps(getDb)
  ;(await import('./autopilot')).startAutopilotSweeps(getDb)
  ;(await import('./driverHr')).startDriverHrSweeps(getDb)
  startExportSchedule(getDb)
  })
  // A shipment in a container takes the container's ETA. Bring any that drifted (loaded before this rule) into line, quietly; the old date is kept as eta_original.
  void getDb().then((db) => db.query(`update shipments s set eta_original = coalesce(s.eta_original, s.eta), eta = c.eta from containers c where s.container_id = c.id and c.eta is not null and s.eta is distinct from c.eta and s.status <> 'delivered' and s.cancelled_at is null`)).catch((e) => console.error('[containers] eta align', e))
  if (demoDataEnabled()) {
  // Atlantic Bridge demo runs after the broker demo so that seed doesn't pick up its shipments.
  void getDb().then(async (db) => { await (await import('./brokerPortal')).seedBrokerPortalDemo(db).catch((e) => console.error('[broker] demo seed', e)); const ab = await import('./atlanticDemo'); await ab.seedAtlanticBridgeDemo(db); await ab.seedAtlanticPaymentsDemo(db); await ab.seedAtlanticOpsDemo(db).catch((e) => console.error('[atlantic] ops demo', e)); await (await import('./teamHrDemo')).seedTeamHrDemo(db) }).catch((e) => console.error('[atlantic] demo seed', e))
  // Demo quotes from before ship dates existed get one, so customers can compare by ship and arrival dates. Only fills empty ones on demo shippers.
  void getDb().then((db) => db.query(`update quotes q set ships_on = current_date + (3 + abs(hashtext(q.id)) % 16) where q.ships_on is null and q.status = 'sent' and exists (select 1 from shippers s where s.id = q.shipper_id and s.demo)`)).catch((e) => console.error('[quotes] ship-date backfill', e))
  void getDb().then(async (db) => (await import('./driverHr2')).seedDriverHrDemo(db)).catch((e) => console.error('[driver-hr] demo seed', e))
  }
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders) // CSP, no framing (except /embed), nosniff, HSTS on https
  // How many proxies sit in front of the app (Replit: usually 1). If the admin System page shows the same address for
  // everyone, raise TRUST_PROXY_HOPS. Rate limits key on the address this produces (req.ip).
  app.set('trust proxy', Math.max(0, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 0))
  app.use(compression()) // /api/live/region carries thousands of vessels; gzip cuts it ~8x
  app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => { stripeWebhook(getDb)(req, res).catch((e) => { console.error('[stripe webhook]', e); res.status(500).json({ error: 'Webhook failed.' }) }) }) // raw body: Stripe signatures are computed over the exact bytes
  app.post('/api/paystack/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => { void import('./momo').then((m) => m.paystackWebhook(getDb)(req, res)).catch((e) => { console.error('[paystack webhook]', e); res.status(500).json({ error: 'Webhook failed.' }) }) })
  app.post('/api/assistant/twilio', express.urlencoded({ extended: false, limit: '200kb' }), (req, res) => { void import('./assistant').then((m) => m.twilioInbound(getDb)(req, res)).catch((e) => { console.error('[assistant] twilio', e); res.status(500).end() }) })
  app.get('/api/assistant/meta', (req, res) => { void import('./assistant').then((m) => m.metaVerify(req, res)) })
  app.post('/api/assistant/meta', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => { void import('./assistant').then((m) => m.metaInbound(getDb)(req, res)).catch((e) => { console.error('[assistant] meta', e); if (!res.headersSent) res.status(500).end() }) })
  app.use(express.json({ limit: '10mb' })) // document uploads and POD photos travel as base64 in JSON
  app.use('/api', uploadGuard) // …so every one of them is checked here first (complete data URL, allowed type)
  app.use(cookieParser())
  app.use('/api', apiRouter())
  // Anything else under /api is a typo or a stale client — answer in JSON, never with the website's HTML.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found.' }) })
  // White-label custom domains: a shipper's own host lands on their branded page.
  app.get('/', async (req, res, next) => { try { const slug = await slugForHost(await getDb(), req.headers.host); if (slug && !req.url.includes('#')) return res.redirect(302, `/t/${slug}`) } catch { /* ignore */ } next() })

  mountSeoFiles(app, getDb)
  if (isProd) {
    const dist = path.join(root, 'dist')
    // Built JS/CSS have the content hash in their names, so they never change — browsers keep them for a year.
    app.use('/assets', express.static(path.join(dist, 'assets'), { index: false, immutable: true, maxAge: '365d' }))
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    mountSeo(app, getDb, dist)
  } else {
    const { createServer } = await import('vite')
    const vite = await createServer({ root, server: { middlewareMode: true, host: true, allowedHosts: true }, appType: 'spa' })
    app.use(vite.middlewares)
  }

  app.listen(port, '0.0.0.0', () => console.log(`[ship-sync] ${isProd ? 'production' : 'dev'} server on http://0.0.0.0:${port}`))
}

main().catch((e) => { console.error(e); process.exit(1) })
