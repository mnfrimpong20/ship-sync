import { api } from './store'

/** What this browser can do: 'unsupported' (old browser, or iPhone Safari outside the Home Screen app), 'denied', 'off', 'on'. */
export type PushState = 'unsupported' | 'ios-home-screen' | 'denied' | 'off' | 'on'
const b64ToBytes = (b64: string) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)) }
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIos() && !standalone() ? 'ios-home-screen' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}
export async function enablePush(): Promise<PushState> {
  const perm = await Notification.requestPermission(); if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js')); await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('/push/key')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
  await api('/push/subscribe', { json: sub.toJSON() })
  return 'on'
}
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription()
  if (sub) { await api('/push/unsubscribe', { json: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe().catch(() => {}) }
  return 'off'
}
export const testPush = () => api<{ ok: true; sent: number }>('/push/test', { json: {} })
