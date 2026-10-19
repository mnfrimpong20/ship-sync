/* Ntemtem service worker — phone/desktop notifications. No offline caching: pages always come fresh from the server. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'Ntemtem', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Ntemtem', { body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/icon-512.png', badge: '/apple-touch-icon.png', data: { url: d.url || '/' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { await c.focus(); if ('navigate' in c) return c.navigate(url) ; return } }
    return self.clients.openWindow(url)
  })())
})
