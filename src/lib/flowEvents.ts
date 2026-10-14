/** Tiny bus so cards outside the store can ask the shipment list to reload after a change. */
const subs = new Set<() => void>()
export const onShipmentsChanged = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
export const refreshShipments = () => { for (const f of subs) f() }
