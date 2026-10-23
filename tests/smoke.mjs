// Smoke test: `npm test`. Boots the real server twice on fresh temporary databases (demo data on, then off — the
// published-app setting) and checks the protections that matter most. Needs a build first for page checks (npm run build).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
let failed = 0
const ok = (cond, name, extra = '') => { console.log(`${cond ? '  ✓' : '  ✗'} ${name}${!cond && extra ? ` — ${extra}` : ''}`); if (!cond) failed++ }

async function boot(port, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ntemtem-smoke-'))
  const p = spawn('npx', ['tsx', 'server/index.ts'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), PGLITE_DIR: dir, DATABASE_URL: '', SMS_PROVIDER: 'log', RUN_JOBS: 'off', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; p.stdout.on('data', (d) => { log += d }); p.stderr.on('data', (d) => { log += d })
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return { stop: () => { p.kill(); rmSync(dir, { recursive: true, force: true }) }, log: () => log } } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)) }
  p.kill(); throw new Error(`server did not start:\n${log.slice(-2000)}`)
}
const B = (port) => `http://localhost:${port}/api`
async function login(port, email, password = 'shipsync') { const r = await fetch(`${B(port)}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') } }
const get = (port, p, cookie = '') => fetch(`${B(port)}${p}`, { headers: { cookie } })
const post = (port, p, body, cookie = '') => fetch(`${B(port)}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })

console.log('Demo data ON (workspace)')
let s = await boot(5191, { DEMO_DATA: 'on' })
try {
  const home = await fetch('http://localhost:5191/')
  ok(!!home.headers.get('content-security-policy'), 'security headers on pages')
  ok(home.headers.get('x-frame-options') === 'SAMEORIGIN', 'pages cannot be framed by other sites')
  const nf = await get(5191, '/no-such-thing'); ok(nf.status === 404 && /json/.test(nf.headers.get('content-type') ?? ''), 'unknown /api path → JSON 404')
  ok((await get(5191, '/admin/shippers')).status === 401, 'admin API needs sign-in')
  const drv = await login(5191, 'driver@atlanticbridge.demo'); ok(drv.status === 200, 'demo driver can sign in (demo on)')
  ok((await get(5191, '/clients', drv.cookie)).status === 403, 'driver cannot read the client book')
  ok((await fetch(`${B(5191)}/shippers/me`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: drv.cookie }, body: '{}' })).status === 403, 'driver cannot edit the company profile')
  const wh = await login(5191, 'warehouse@atlanticbridge.demo'); const ov = await (await get(5191, '/shipper/overview', wh.cookie)).json()
  ok(ov.kpis && ov.kpis.invoiced === null, 'warehouse does not see revenue')
  const bad = await post(5191, '/broker-applications', { name: 'X', licenceFile: 'data:image/png;base64,"><img src=x onerror=alert(1)>' }); ok(bad.status === 400, 'upload with markup after the prefix is refused')
  const tr = await (await get(5191, '/track/SS-AB1037M')).json(); ok(!!tr.shipment && /^\S+( \S\.)?$/.test(tr.shipment.customer ?? ''), 'public tracking shows only first name + initial', tr.shipment?.customer)
  // A different email each time, so only the per-address limit (30 / 15 min) can stop it — and a fake header mustn't help.
  const spoof = []; for (let i = 0; i < 34; i++) spoof.push((await fetch(`${B(5191)}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.9.${i}, 203.0.113.7` /* attacker's fake entry, then the address Replit's proxy appends */ }, body: JSON.stringify({ email: `nobody${i}@example.com`, password: 'wrong' }) })).status)
  ok(spoof.includes(429), 'rate limit not bypassed by a fake X-Forwarded-For', spoof.join(','))
} finally { s.stop() }

console.log('Demo data OFF (published app)')
s = await boot(5192, { DEMO_DATA: 'off' })
try {
  ok((await login(5192, 'admin@shipsync.demo')).status === 401, 'demo admin cannot sign in')
  const sh = await (await get(5192, '/shippers')).json(); ok(Array.isArray(sh.shippers) && sh.shippers.length === 0, 'no demo shippers in the public directory', String(sh.shippers?.length))
  const cfg = await (await get(5192, '/site/config')).json(); ok(cfg.demoHidden === true && !cfg.paymentsLive, 'demo hints hidden, escrow not promised without payments')
  const dest = await (await get(5192, '/meta/destinations')).json().catch(() => null); ok(!!dest && JSON.stringify(dest).includes('GH'), 'destination countries still seeded')
} finally { s.stop() }

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
