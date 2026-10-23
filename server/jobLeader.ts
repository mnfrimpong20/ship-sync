/**
 * Background jobs (reminders, overdue chasing, billing, ETA checks…) must run in exactly one server process.
 * Whoever holds the lease in `job_leader` runs them; it renews every minute. If that process stops, another one
 * takes over within ~3 minutes. RUN_JOBS=off disables background jobs in a process altogether.
 *
 * Usage: whenLeader(getDb, () => startSomethingSweeps(getDb)) — runs once, as soon as this process leads.
 */
import { randomBytes } from 'node:crypto'
import type { Db } from './db'

const me = `${process.pid}-${randomBytes(4).toString('hex')}`
const queue: (() => unknown)[] = []
let leader = false
let ticking = false
const disabled = () => /^(off|0|false|no)$/i.test(process.env.RUN_JOBS ?? '')

async function claim(db: Db): Promise<boolean> {
  await db.query(`create table if not exists job_leader (id text primary key, holder text not null, until timestamptz not null)`)
  const { rows } = await db.query<{ holder: string }>(
    `insert into job_leader (id, holder, until) values ('main', $1, now() + interval '3 minutes')
     on conflict (id) do update set holder = excluded.holder, until = excluded.until
     where job_leader.until < now() or job_leader.holder = excluded.holder
     returning holder`, [me])
  return rows[0]?.holder === me
}

function start(getDb: () => Promise<Db>) {
  if (ticking) return; ticking = true
  if (disabled()) { console.log('[jobs] RUN_JOBS=off — background jobs disabled in this process'); return }
  const tick = async () => {
    try {
      const now = await claim(await getDb())
      if (now && !leader) { leader = true; console.log('[jobs] this process runs the background jobs'); for (const fn of queue.splice(0)) await Promise.resolve(fn()).catch((e) => console.error('[jobs] start failed', e)) }
      if (!now && leader) console.warn('[jobs] another process took the job lease — restart this one to stop its timers')
    } catch (e) { console.error('[jobs] lease check failed', e) }
  }
  void tick(); setInterval(() => void tick(), 60_000).unref?.()
}

/** Run `fn` once this process is the job leader (immediately if it already is). */
export function whenLeader(getDb: () => Promise<Db>, fn: () => unknown) {
  if (disabled()) { start(getDb); return }
  if (leader) { void Promise.resolve(fn()).catch((e) => console.error('[jobs] start failed', e)); return }
  queue.push(fn); start(getDb)
}
