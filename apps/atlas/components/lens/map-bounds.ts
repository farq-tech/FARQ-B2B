/** Where the map's camera goes: pure geometry, kept apart from mapbox so it can be tested. */

type Bounds = [[number, number], [number, number]]
type Shape = { geometry?: { coordinates?: unknown } | null }

/** The box around every point of the shapes, or null when they hold none. */
export function boundsOf(features: Shape[]): Bounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      const [x, y] = coords as [number, number]
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y)
    } else if (Array.isArray(coords)) coords.forEach(visit)
  }
  features.forEach((feature) => visit(feature.geometry?.coordinates))
  return west < Infinity ? [[west, south], [east, north]] : null
}

const KM_PER_DEGREE = 111.32
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The box the city opens on: its districts, leaving out the few that lie far from all the others. Riyadh's list holds
 * one district 500 km to the west, and Dammam's one in another region, so framing every district opened the city as a
 * speck in the desert. A district is left out of the framing (never off the map) when its centre is more than
 * `4 × the median distance` and more than `minKm` from the middle of the city; a city of one or two districts is framed
 * whole.
 */
export function cityBounds(features: Shape[], minKm = 40): Bounds | null {
  const boxes = features.map((feature) => ({ feature, box: boundsOf([feature]) })).filter((item): item is { feature: Shape; box: Bounds } => item.box != null)
  if (boxes.length < 3) return boundsOf(features)
  const centres = boxes.map(({ box }) => [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2] as const)
  const middle = [median(centres.map((c) => c[0])), median(centres.map((c) => c[1]))] as const
  const scale = Math.cos((middle[1] * Math.PI) / 180)
  const distance = centres.map(([x, y]) => Math.hypot((x - middle[0]) * scale, y - middle[1]) * KM_PER_DEGREE)
  const limit = Math.max(minKm, 4 * median(distance))
  const kept = boxes.filter((_, index) => distance[index] <= limit).map(({ feature }) => feature)
  return boundsOf(kept.length ? kept : features)
}
