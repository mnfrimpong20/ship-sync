import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, ExternalLink, Eye, EyeOff, FileText, Image as ImageIcon, Link2, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { documentsApi, docKindLabels, fileToBase64, fmtBytes, shareUrl, type DocKind, type ShipDoc } from '../lib/documents'
import { Confirm } from './board'
import { fmtDateTime } from './ui'

const UPLOAD_KINDS: DocKind[] = ['bill_of_lading', 'customs', 'commercial_invoice', 'packing_list', 'identity', 'insurance', 'photo', 'other']

/** The document vault for one shipment — used in the shipper's Shipments board and the customer's dashboard. */
export function DocumentsPanel({ shipmentId, shipmentRef, onCount }: { shipmentId: string; shipmentRef: string; onCount?: (n: number) => void }) {
  const [docs, setDocs] = useState<ShipDoc[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [generators, setGenerators] = useState<{ kind: DocKind; label: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ kind: DocKind; title: string; visibility: 'shipper' | 'shared'; file: File | null }>({ kind: 'other', title: '', visibility: 'shared', file: null })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [deleting, setDeleting] = useState<ShipDoc | null>(null)
  const [copied, setCopied] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => documentsApi.list(shipmentId).then((r) => { setDocs(r.documents); setCanManage(r.canManage); setGenerators(r.generators); onCount?.(r.documents.length) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load documents.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) }, [toast])

  const pick = (f: File | null) => setForm((x) => ({ ...x, file: f, title: x.title || (f ? f.name.replace(/\.[^.]+$/, '') : ''), kind: f && f.type.startsWith('image/') && x.kind === 'other' ? 'photo' : x.kind }))
  const upload = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.file) return
    setBusy('upload'); setError('')
    try {
      const { data, mime, size } = await fileToBase64(form.file)
      if (size > 6 * 1024 * 1024) throw new Error('Files up to 6 MB only.')
      const d = await documentsApi.upload(shipmentId, { kind: form.kind, title: form.title.trim() || form.file.name, filename: form.file.name, mime, data, visibility: form.visibility })
      setDocs((l) => [d, ...(l ?? [])]); onCount?.((docs?.length ?? 0) + 1)
      setAdding(false); setForm({ kind: 'other', title: '', visibility: 'shared', file: null }); if (fileRef.current) fileRef.current.value = ''
      setToast(`${d.title} added.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.') } finally { setBusy('') }
  }
  const generate = async (kind: DocKind) => {
    setBusy(kind); setError('')
    try { const r = await documentsApi.generate(shipmentId, kind as 'packing_list'); await load(); setToast(`${r.document.title} ${r.regenerated ? 'updated' : 'created'}.`) } catch (err) { setError(err instanceof Error ? err.message : 'Could not generate.') } finally { setBusy('') }
  }
  const toggleVis = async (d: ShipDoc) => { setBusy(d.id); try { const u = await documentsApi.update(d.id, { visibility: d.visibility === 'shared' ? 'shipper' : 'shared' }); setDocs((l) => (l ?? []).map((x) => (x.id === d.id ? u : x))); setToast(u.visibility === 'shared' ? 'Now visible to the customer.' : 'Hidden from the customer.') } catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy('') } }
  const share = async (d: ShipDoc) => {
    setBusy(d.id)
    try {
      const u = d.shareToken ? await documentsApi.unshare(d.id) : await documentsApi.share(d.id)
      setDocs((l) => (l ?? []).map((x) => (x.id === d.id ? u : x)))
      if (u.shareToken) { try { await navigator.clipboard.writeText(shareUrl(u.shareToken)); setCopied(u.id); setTimeout(() => setCopied(''), 2000) } catch { /* clipboard blocked */ } setToast('Share link created and copied.') } else setToast('Share link revoked.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not share.') } finally { setBusy('') }
  }
  const copy = async (d: ShipDoc) => { if (!d.shareToken) return; try { await navigator.clipboard.writeText(shareUrl(d.shareToken)); setCopied(d.id); setTimeout(() => setCopied(''), 2000) } catch { /* ignore */ } }
  const remove = async (d: ShipDoc) => { setBusy(d.id); try { await documentsApi.remove(d.id); setDocs((l) => (l ?? []).filter((x) => x.id !== d.id)); onCount?.(Math.max(0, (docs?.length ?? 1) - 1)); setToast('Document deleted.') } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete.') } finally { setBusy(''); setDeleting(null) } }

  const icon = (d: ShipDoc) => d.mime.startsWith('image/') || d.kind === 'photo' ? <ImageIcon size={16} /> : d.source === 'generated' ? <Sparkles size={16} /> : <FileText size={16} />

  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="documents-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Documents{docs ? ` · ${docs.length}` : ''}</p>
        <div className="flex flex-wrap gap-1.5">
          {canManage && generators.map((g) => <button key={g.kind} onClick={() => generate(g.kind)} disabled={Boolean(busy)} className="btn-ghost !min-h-8 !px-2.5 text-xs disabled:opacity-60">{busy === g.kind ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />} {g.label}</button>)}
          <button onClick={() => { setAdding((a) => !a); setError('') }} className="btn-gold !min-h-8 !px-2.5 text-xs"><Plus size={12} aria-hidden="true" /> Upload</button>
        </div>
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {adding && (
        <form onSubmit={upload} className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-[1fr_auto]" aria-label="Upload a document">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="sm:col-span-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-3 py-2.5 text-sm hover:border-gold">
              <Upload size={16} className="shrink-0 text-gold-deep" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{form.file ? `${form.file.name} · ${fmtBytes(form.file.size)}` : 'Choose a PDF, image or scan (up to 6 MB)'}</span>
              <input ref={fileRef} type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="doc-file" />
            </label>
            <input aria-label="Title" className="input-dark !min-h-9 text-sm sm:col-span-1" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select aria-label="Type" className="input-dark !min-h-9 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DocKind })}>{UPLOAD_KINDS.map((k) => <option key={k} value={k}>{docKindLabels[k]}</option>)}</select>
            {canManage ? <select aria-label="Visibility" className="input-dark !min-h-9 text-sm" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as 'shared' | 'shipper' })}><option value="shared">Customer can see it</option><option value="shipper">Office only</option></select> : <p className="self-center text-xs text-text-muted">Your shipper will see it.</p>}
          </div>
          <div className="flex items-end gap-2"><button type="button" onClick={() => setAdding(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={!form.file || busy === 'upload'} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">{busy === 'upload' ? 'Uploading…' : 'Add'}</button></div>
        </form>
      )}
      <ul className="mt-3 divide-y divide-border/70">
        {docs === null && !error && <li className="py-3 text-sm text-text-muted">Loading…</li>}
        {docs && docs.length === 0 && <li className="py-4 text-sm text-text-muted">{canManage ? 'Nothing here yet. Generate a packing list or commercial invoice, or upload the line’s bill of lading and customs forms.' : 'No documents shared on this shipment yet.'}</li>}
        {docs?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2.5" data-testid="doc-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-gold-deep" aria-hidden="true">{icon(d)}</span>
            <div className="min-w-0 flex-1">
              <Link to={`/dashboard/documents/${d.id}`} className="block truncate text-sm font-semibold hover:underline">{d.title}</Link>
              <p className="truncate text-[11px] text-text-muted">{docKindLabels[d.kind]}{d.source === 'generated' ? ' · generated' : d.size ? ` · ${fmtBytes(d.size)}` : ''}{d.uploadedBy ? ` · ${d.uploadedBy}` : ''}{d.updatedAt ? ` · ${fmtDateTime(d.updatedAt)}` : ''}{canManage ? (d.visibility === 'shared' ? ' · customer can see' : ' · office only') : ''}{d.shareToken ? ' · link on' : ''}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Link to={`/dashboard/documents/${d.id}`} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label={`Open ${d.title}`}><ExternalLink size={14} /></Link>
              {canManage && <button onClick={() => toggleVis(d)} disabled={busy === d.id} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label={d.visibility === 'shared' ? 'Hide from customer' : 'Show to customer'} title={d.visibility === 'shared' ? 'Customer can see this' : 'Office only'}>{d.visibility === 'shared' ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
              {canManage && (d.shareToken ? <button onClick={() => copy(d)} className={`grid h-8 w-8 place-items-center rounded-md focus-ring ${copied === d.id ? 'text-teal' : 'text-gold-deep hover:bg-surface-2'}`} aria-label="Copy share link" title="Copy share link">{copied === d.id ? <Check size={14} /> : <Copy size={14} />}</button> : null)}
              {canManage && <button onClick={() => share(d)} disabled={busy === d.id} className={`grid h-8 w-8 place-items-center rounded-md focus-ring ${d.shareToken ? 'text-gold-deep hover:bg-surface-2' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`} aria-label={d.shareToken ? 'Revoke share link' : 'Create share link'} title={d.shareToken ? 'Link is live — click to revoke' : 'Create a share link'}><Link2 size={14} /></button>}
              {(canManage || d.uploadedByRole === 'customer') && <button onClick={() => setDeleting(d)} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-danger focus-ring" aria-label={`Delete ${d.title}`}><Trash2 size={14} /></button>}
            </div>
          </li>
        ))}
      </ul>
      {deleting && <Confirm title={`Delete ${deleting.title}?`} body={<p>It will be removed from {shipmentRef}{deleting.shareToken ? ' and its share link will stop working' : ''}. This cannot be undone.</p>} confirmLabel="Delete document" busy={busy === deleting.id} onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)} />}
    </div>
  )
}
