import type { Payslip, Person } from './driverHrApi'

const fmt = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n.toFixed(2)}` } }
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** A one-page payslip PDF (for a bank, landlord or visa letter). */
export async function payslipPdf(s: Payslip, employment: string, payout: Person['payout']): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' }); const W = 595; let y = 56
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(s.company ?? 'Payslip', 48, y)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.text(`PAYSLIP${s.stats.final ? ' · FINAL' : ''}`, W - 48, y - 14, { align: 'right' })
  doc.setTextColor(20); doc.setFontSize(11)
  doc.text(s.name ?? '', W - 48, y, { align: 'right' }); y += 16
  doc.setTextColor(110); doc.text(`${employment === 'employee' ? 'Employee' : 'Contractor'} · ${day(s.start)} – ${day(s.end)}`, W - 48, y, { align: 'right' }); doc.setTextColor(20)
  y += 22; doc.setDrawColor(200); doc.line(48, y, W - 48, y); y += 22
  const st = s.stats; doc.setFontSize(10)
  ;[['Stops', String(st.stops ?? 0)], ['Runs', String(st.runs ?? 0)], ['Hours', `${st.hours ?? 0}${st.overtime ? ` (${st.overtime} OT)` : ''}`], ['On time', st.onTimePct != null ? `${st.onTimePct}%` : '—']].forEach(([k, v], i) => { const x = 48 + i * 125; doc.setTextColor(110); doc.text(k, x, y); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(v, x, y + 14); doc.setFont('helvetica', 'normal') })
  y += 40
  const head = () => { doc.setFontSize(9); doc.setTextColor(110); doc.text('ITEM', 48, y); doc.text('QTY', 360, y, { align: 'right' }); doc.text('RATE', 450, y, { align: 'right' }); doc.text('AMOUNT', W - 48, y, { align: 'right' }); y += 8; doc.line(48, y, W - 48, y); y += 16; doc.setTextColor(20); doc.setFontSize(10) }
  const row = (l: string, q: string, r: string, a: string, bold = false) => { if (bold) doc.setFont('helvetica', 'bold'); const lines = doc.splitTextToSize(l, 280) as string[]; doc.text(lines, 48, y); doc.text(q, 360, y, { align: 'right' }); doc.text(r, 450, y, { align: 'right' }); doc.text(a, W - 48, y, { align: 'right' }); y += 16 * lines.length; if (bold) doc.setFont('helvetica', 'normal') }
  head()
  const sec = (kinds: string[]) => s.lines.filter((l) => kinds.includes(l.kind))
  for (const l of sec(['earning', 'bonus'])) row(l.label, l.qty != null ? String(l.qty) : '', l.rate != null ? fmt(l.rate, s.currency) : '', fmt(l.amount, s.currency))
  row('Gross pay', '', '', fmt(s.gross, s.currency), true)
  if (sec(['reimbursement']).length) { y += 4; for (const l of sec(['reimbursement'])) row(l.label, '', '', fmt(l.amount, s.currency)); row('Expenses paid back', '', '', fmt(s.reimbursed, s.currency), true) }
  if (sec(['deduction']).length) { y += 4; for (const l of sec(['deduction'])) row(l.label, '', '', fmt(l.amount, s.currency)); row('Deductions', '', '', `-${fmt(s.deducted, s.currency)}`, true) }
  y += 6; doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(48, y, W - 48, y); y += 20; doc.setFontSize(13); row('Net pay', '', '', fmt(s.net, s.currency), true); doc.setFontSize(9); doc.setTextColor(110); y += 16
  doc.text(`Status: ${s.status === 'paid' ? `paid${s.paidAt ? ` ${new Date(s.paidAt).toLocaleDateString('en-GB')}` : ''} by ${s.paidMethod}${s.paidRef ? ` (ref ${s.paidRef})` : ''}` : s.status === 'approved' ? `approved by ${s.approvedBy}, payment pending` : 'draft'}`, 48, y); y += 13
  if (payout.method) { doc.text(`Paid to: ${payout.method === 'momo' ? `MoMo ${payout.momo}` : payout.method === 'zelle' ? `Zelle ${payout.zelle}` : payout.method === 'bank' ? `${payout.bankName} ****${payout.bankLast4}` : 'cash'}`, 48, y); y += 13 }
  doc.text(employment === 'contractor' ? 'Contractor payment — no tax withheld.' : 'Tax and social security are handled by the company payroll.', 48, y); y += 13
  doc.text(`Payslip ${s.id} · generated ${new Date().toLocaleDateString('en-GB')} with Ntemtem`, 48, 800)
  return doc.output('blob')
}

/** Share through the phone's share sheet (WhatsApp, email…) when it can take files, otherwise download. */
export async function shareOrDownload(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] }) && nav.share) { try { await nav.share({ files: [file], title }); return 'shared' } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled' } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  return 'downloaded'
}
