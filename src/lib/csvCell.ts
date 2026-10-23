/**
 * One CSV cell, always quoted, and safe to open in Excel or Google Sheets: text that starts like a formula
 * (= + - @ or a tab/return) gets a leading apostrophe so a customer-typed name can never run as a formula.
 * Real numbers (including negatives like -12.50) are left alone. Shared by server exports and in-browser downloads.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  // Numbers and phone numbers ("+233 24 410 2201", "-12.50") are harmless and stay as they are.
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().,/-]+$/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
