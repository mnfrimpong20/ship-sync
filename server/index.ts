import express from 'express'
import cookieParser from 'cookie-parser'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRouter } from './api'
import { getDb } from './db'
import { ais, startAirSweep } from './live'
import { startCarrierSync } from './containers'
import { startNotifySweeps } from './notify'
import { startRecipientSweeps } from './recipient'
import { stripeWebhook } from './payments'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProd = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5000)

async function main() {
  const db = await getDb() // connect, migrate, seed before accepting traffic
  ais.start(db).catch((e) => console.error('[ais]', e))
  startAirSweep()
  startCarrierSync(getDb)
  startNotifySweeps(getDb)
  startRecipientSweeps(getDb)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(compression()) // /api/live/region carries thousands of vessels; gzip cuts it ~8x
  app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => { stripeWebhook(getDb)(req, res).catch((e) => { console.error('[stripe webhook]', e); res.status(500).json({ error: 'Webhook failed.' }) }) }) // raw body: Stripe signatures are computed over the exact bytes
  app.use(express.json({ limit: '10mb' })) // document uploads and POD photos travel as base64 in JSON
  app.use(cookieParser())
  app.use('/api', apiRouter())

  if (isProd) {
    const dist = path.join(root, 'dist')
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.get('*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  } else {
    const { createServer } = await import('vite')
    const vite = await createServer({ root, server: { middlewareMode: true, host: true, allowedHosts: true }, appType: 'spa' })
    app.use(vite.middlewares)
  }

  app.listen(port, '0.0.0.0', () => console.log(`[ship-sync] ${isProd ? 'production' : 'dev'} server on http://0.0.0.0:${port}`))
}

main().catch((e) => { console.error(e); process.exit(1) })
