/** A sensible "ships on" for quotes priced automatically (rate cards, demo shippers): no earlier than the goods are
 *  ready or three days out; ocean goes on the next weekly (Friday) consolidation, air on that day. */
export function defaultShipsOn(readyDate: unknown, air: boolean): string {
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '')
  const soonest = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  const start = [d(readyDate), soonest].filter(Boolean).sort().pop()!
  const t = new Date(start + 'T12:00:00Z')
  if (!air) t.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7))
  return t.toISOString().slice(0, 10)
}
