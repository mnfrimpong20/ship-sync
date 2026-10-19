/**
 * Phone and desktop notifications (Web Push). Anyone signed in can turn them on per device; every in-app
 * notification (see notify.ts) is then also pushed to that person's devices, respecting what they muted.
 *
 *   Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and VAPID_SUBJECT, a mailto: or https: contact). Without them a
 *   key pair is generated once and kept in `settings`, so push works out of the box. Changing keys means
 *   everyone re-subscribes. Dead subscriptions (404/410 from the push service) are removed.
 *   On iPhone, push works once the site is added to the Home Screen (iOS 16.4+).
 */
import type { Request, Response, NextFunction, Router } from 'express'
import webpush from 'web-push'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

let keys: { publicKey: string; privateKey: string } | null = null
async function vapid(db: Db) {
  if (keys) return keys
  const pub = process.env.VAPID_PUBLIC_KEY?.trim(), priv = process.env.VAPID_PRIVATE_KEY?.trim()
  if (pub && priv) keys = { publicKey: pub, privateKey: priv }
  else {
    const { rows } = await db.query<Row>(`select value from settings where id = 'vapid'`)
    const v = rows[0] ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : null
    if (v?.publicKey && v?.privateKey) keys = v
    else { keys = webpush.generateVAPIDKeys(); await db.query(`insert into settings (id,value,updated_at) values ('vapid',$1,now()) on conflict (id) do nothing`, [JSON.stringify(keys)]); const { rows: again } = await db.query<Row>(`select value from settings where id = 'vapid'`); keys = typeof again[0].value === 'string' ? JSON.parse(again[0].value) : again[0].value }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || 'mailto:support@ntemtem.com', keys!.publicKey, keys!.privateKey)
  return keys!
}

/** Push one notification to all of a user's devices. Never throws. */
export async function pushToUser(db: Db, userId: string, n: { title: string; body?: string; link?: string; tag?: string }) {
  try {
    const { rows } = await db.query<Row>('select * from push_subscriptions where user_id = $1', [userId]); if (!rows.length) return 0
    await vapid(db)
    const payload = JSON.stringify({ title: n.title.slice(0, 120), body: (n.body ?? '').slice(0, 240), url: n.link || '/', tag: n.tag })
    let sent = 0
    await Promise.all(rows.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'normal' }); sent++; await db.query('update push_subscriptions set last_ok_at = now(), failures = 0 where id = $1', [s.id]) }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await db.query('delete from push_subscriptions where id = $1', [s.id]); else await db.query('update push_subscriptions set failures = failures + 1 where id = $1', [s.id]); if (code !== 404 && code !== 410) console.error('[push]', code, (e as Error).message) }
    }))
    return sent
  } catch (e) { console.error('[push]', e); return 0 }
}

const zSub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }) })

export function mountPush(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  r.get('/push/key', wrap(async (_req, res) => { const db = await getDb(); res.set('Cache-Control', 'public, max-age=3600'); res.json({ publicKey: (await vapid(db)).publicKey }) }))
  r.get('/push/status', wrap(async (req, res) => { const db = await getDb(); const u = await requireUser(db, req); const { rows } = await db.query<Row>('select endpoint, created_at, ua from push_subscriptions where user_id = $1 order by created_at desc', [u.id]); res.set('Cache-Control', 'no-store'); res.json({ devices: rows.map((x) => ({ endpoint: x.endpoint, ua: x.ua, createdAt: x.created_at })) }) }))
  r.post('/push/subscribe', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const b = zSub.parse(req.body)
    const { rows } = await db.query<Row>('select count(*)::int as n from push_subscriptions where user_id = $1', [u.id]); if (Number(rows[0].n) >= 10) await db.query(`delete from push_subscriptions where id in (select id from push_subscriptions where user_id = $1 order by coalesce(last_ok_at, created_at) asc limit 1)`, [u.id])
    await db.query(`insert into push_subscriptions (id,user_id,endpoint,p256dh,auth,ua) values ($1,$2,$3,$4,$5,$6) on conflict (endpoint) do update set user_id = $2, p256dh = $4, auth = $5, ua = $6, failures = 0`, ['ps_' + uid(), u.id, b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers['user-agent'] ?? '').slice(0, 200)])
    res.status(201).json({ ok: true })
  }))
  r.post('/push/unsubscribe', wrap(async (req, res) => { const db = await getDb(); const u = await requireUser(db, req); const b = z.object({ endpoint: z.string().max(1000) }).parse(req.body); await db.query('delete from push_subscriptions where endpoint = $1 and user_id = $2', [b.endpoint, u.id]); res.json({ ok: true }) }))
  r.post('/push/test', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const sent = await pushToUser(db, u.id, { title: 'Ntemtem notifications are on', body: 'You’ll get updates about quotes, payments and shipments here.', link: '/notifications', tag: 'test' })
    if (!sent) throw new HttpError(409, 'No device is subscribed on this account yet.')
    res.json({ ok: true, sent })
  }))
}
