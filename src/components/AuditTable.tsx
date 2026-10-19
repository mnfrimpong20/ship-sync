import { useEffect, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { adminConsoleApi, auditCsvUrl, platformApi, type AuditEntry } from '../lib/platform'
import { fmtDateTime } from './ui'
import { NoData } from './Charts'

const ROLES = ['', 'admin', 'owner', 'dispatcher', 'agent', 'finance', 'warehouse', 'driver', 'customer', 'system']
/** Searchable audit log. `admin` shows every company; otherwise the caller's company only. */
export function AuditTable({ admin }: { admin: boolean }) {
  const [q, setQ] = useState({ q: '', role: '', from: '', to: '', viewAs: '' }); const [typed, setTyped] = useState('')
  const [rows, setRows] = useState<AuditEntry[] | null>(null); const [more, setMore] = useState(false); const [open, setOpen] = useState<string | null>(null); const [err, setErr] = useState('')
  const load = (offset = 0) => (admin ? adminConsoleApi.audit({ ...q, limit: 50, offset }) : platformApi.teamAudit({ ...q, limit: 50, offset })).then((r) => { setRows((x) => (offset ? [...(x ?? []), ...r.entries] : r.entries)); setMore(r.more) }).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { if (typed !== q.q) setQ({ ...q, q: typed }) }, 300); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const cls = 'input-dark !min-h-10 !w-auto text-sm'
  return (
    <div data-testid="audit">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative"><span className="sr-only">Search</span><Search size={14} className="absolute left-3 top-3 text-text-muted" aria-hidden="true" /><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search action, person, id…" className={`${cls} !pl-8`} data-testid="audit-search" /></label>
        <select value={q.role} onChange={(e) => setQ({ ...q, role: e.target.value })} className={cls} aria-label="Role" data-testid="audit-role">{ROLES.map((r) => <option key={r} value={r}>{r ? r[0].toUpperCase() + r.slice(1) : 'Everyone'}</option>)}</select>
        <input type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} className={cls} aria-label="From" />
        <input type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} className={cls} aria-label="To" />
        {admin && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={q.viewAs === '1'} onChange={(e) => setQ({ ...q, viewAs: e.target.checked ? '1' : '' })} /> During “View as”</label>}
        <a href={auditCsvUrl(q, admin)} className="btn-ghost !min-h-10 text-sm" data-testid="audit-csv"><Download size={14} aria-hidden="true" /> CSV</a>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {!rows ? <NoData>Loading…</NoData> : !rows.length ? <NoData>Nothing matches.</NoData> : (
        <div className="-mx-5 overflow-x-auto px-5"><table className="w-full min-w-[40rem] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="px-2 py-2">When</th><th className="px-2 py-2">Who</th>{admin && <th className="px-2 py-2">Company</th>}<th className="px-2 py-2">What</th><th className="px-2 py-2">Where</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} className="cursor-pointer border-b border-border/60 align-top hover:bg-surface-2/50" onClick={() => setOpen(open === e.id ? null : e.id)} data-testid="audit-row">
              <td className="whitespace-nowrap px-2 py-2 text-text-muted">{fmtDateTime(e.at)}</td>
              <td className="px-2 py-2"><b>{e.actor}</b><span className="block text-xs text-text-muted">{e.role}{e.viewAsBy ? ` · viewed as by ${e.viewAsBy}` : ''}</span></td>
              {admin && <td className="px-2 py-2 text-text-muted">{e.shipperName ?? '—'}</td>}
              <td className="px-2 py-2">{e.action}{open === e.id && e.data != null && <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap rounded bg-surface-2/70 p-2 text-xs">{JSON.stringify(e.data, null, 2)}</pre>}</td>
              <td className="px-2 py-2 font-mono text-xs text-text-muted">{e.method} {e.path}{e.ip ? <span className="block">{e.ip}</span> : null}</td>
            </tr>
          ))}</tbody></table></div>
      )}
      {more && <button type="button" onClick={() => load(rows?.length ?? 0)} className="mt-3 text-sm text-text-muted hover:text-text focus-ring">Load more</button>}
    </div>
  )
}
