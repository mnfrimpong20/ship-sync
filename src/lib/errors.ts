/** Browser-side crash reporting → POST /api/site/client-error (admin sees it under System). Deduped, capped at 5 per page load. */
let sent = 0
const seen = new Set<string>()
export function reportClientError(message: string, stack?: string) {
  const key = message.slice(0, 200)
  if (sent >= 5 || seen.has(key) || /ResizeObserver loop|Script error\.?$/.test(message)) return
  seen.add(key); sent += 1
  try { fetch('/api/site/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: message.slice(0, 1000), stack: stack?.slice(0, 6000), route: location.hash.slice(1) || '/' }), keepalive: true }).catch(() => {}) } catch { /* ignore */ }
}
export function installErrorReporting() {
  window.addEventListener('error', (e) => reportClientError(e.message || 'Unknown error', e.error instanceof Error ? e.error.stack : undefined))
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; reportClientError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined) })
}
