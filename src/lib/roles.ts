/** Driver roles. Pickup drivers collect from senders at origin; delivery drivers hand over to receivers at destination.
 *  `driver` is the old single role, still honoured for any account that wasn't moved over. */
export const DRIVER_ROLES = ['pickup_driver', 'delivery_driver', 'driver'] as const
export type DriverRole = (typeof DRIVER_ROLES)[number]
export const isDriverRole = (r: string | null | undefined): boolean => !!r && (DRIVER_ROLES as readonly string[]).includes(r)
/** Which run kind a driver role can be given ('both' for the old single role). */
export const runKindFor = (r: string | null | undefined): 'pickup' | 'delivery' | 'both' | null => (r === 'pickup_driver' ? 'pickup' : r === 'delivery_driver' ? 'delivery' : r === 'driver' ? 'both' : null)
export const canDriveKind = (r: string | null | undefined, kind: 'pickup' | 'delivery') => { const k = runKindFor(r); return k === 'both' || k === kind }
export const DRIVER_SQL = `('pickup_driver','delivery_driver','driver')`
