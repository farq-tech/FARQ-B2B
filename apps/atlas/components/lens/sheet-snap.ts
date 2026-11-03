export type SheetSnap = 'peek' | 'half' | 'full'

/** A release faster than this (px per ms) is a flick. */
export const FLICK = 0.5

/**
 * Where a released drag of the phone's sheet settles, given its height at release and the height of each stop: a flick
 * goes to the next stop past the release height in its direction (so a long fast pull from full lands collapsed, not
 * half), anything slower to the nearest stop.
 */
export function settle(height: number, speed: number, stops: Record<SheetSnap, number>): SheetSnap {
  const order = (['peek', 'half', 'full'] as const).map((id) => [id, stops[id]] as const)
  if (speed > FLICK) return order.find(([, at]) => at > height + 1)?.[0] ?? 'full'
  if (speed < -FLICK) return [...order].reverse().find(([, at]) => at < height - 1)?.[0] ?? 'peek'
  return order.reduce((best, stop) => (Math.abs(stop[1] - height) < Math.abs(best[1] - height) ? stop : best))[0]
}
