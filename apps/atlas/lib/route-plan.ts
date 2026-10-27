/**
 * A visit route through any number of stops on the real road network (Valhalla, via /api/routing).
 *
 * No routing engine orders thousands of stops in one request, so the stops are first put in a near-tour order
 * along a Hilbert curve (neighbours on the curve are neighbours on the ground), cut into windows of at most
 * WINDOW stops, and each window is ordered optimally by Valhalla with its two ends fixed: the first window starts
 * at the start point, and each window ends on the stop the next one starts from, so the parts join without a jump.
 * Windows are solved a few at a time and handed back as they finish, so the route draws itself live.
 */
export type Point = { lon: number; lat: number }
export type Stop = Point & { id: string }
export type RoutePart = { index: number; order: string[]; line: GeoJSON.LineString | null; meters: number; seconds: number }

const WINDOW = 23          // interior stops per request; with its two fixed ends that is Valhalla's 25 via /api/routing
const CONCURRENCY = 4

function hilbertKey(x: number, y: number, order = 16): number {
  // (x, y) in [0, 2^order); classic xy-to-d conversion
  let d = 0
  for (let s = 1 << (order - 1); s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0
    const ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y }
      ;[x, y] = [y, x]
    }
  }
  return d
}

/** Stops along a Hilbert curve over their bounding box, starting from the end nearer the start point. */
export function tourOrder(start: Point, stops: Stop[]): Stop[] {
  if (stops.length < 2) return [...stops]
  const lons = stops.map((stop) => stop.lon), lats = stops.map((stop) => stop.lat)
  const west = Math.min(...lons), east = Math.max(...lons), south = Math.min(...lats), north = Math.max(...lats)
  const scale = (value: number, low: number, high: number) => Math.min(65535, Math.floor(((value - low) / (high - low || 1)) * 65535))
  const ordered = [...stops].sort((a, b) => hilbertKey(scale(a.lon, west, east), scale(a.lat, south, north)) - hilbertKey(scale(b.lon, west, east), scale(b.lat, south, north)))
  const near = (stop: Stop) => (stop.lon - start.lon) ** 2 + (stop.lat - start.lat) ** 2
  return near(ordered[0]) <= near(ordered[ordered.length - 1]) ? ordered : ordered.reverse()
}

type Window = { index: number; from: Point; stops: Stop[] }   // stops: interior then the fixed last stop

export function windows(start: Point, ordered: Stop[]): Window[] {
  const parts: Window[] = []
  let from: Point = start
  for (let i = 0; i < ordered.length; i += WINDOW + 1) {
    const stops = ordered.slice(i, i + WINDOW + 1)
    parts.push({ index: parts.length, from, stops })
    from = stops[stops.length - 1]
  }
  return parts
}

async function solve(window: Window, signal: AbortSignal): Promise<RoutePart> {
  const locations = [window.from, ...window.stops].map(({ lon, lat }) => ({ lon, lat }))
  const action = locations.length >= 4 ? 'optimized_route' : 'route'
  const response = await fetch(`/api/routing/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ locations, costing: 'auto' }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error((data && data.error) || 'تعذر حساب المسار.')
  if (action === 'route') {
    const route = data.routes?.[0]
    return { index: window.index, order: window.stops.map((stop) => stop.id), line: route?.geometry ?? null, meters: route?.distance ?? 0, seconds: route?.duration ?? 0 }
  }
  if (Array.isArray(data.trips) && data.trips[0]) {   // OSRM-shaped answer: waypoints[i].waypoint_index is input i's place in the trip
    const osrm = data.trips[0] as { geometry?: GeoJSON.LineString; distance?: number; duration?: number }
    const places: number[] = (data.waypoints ?? []).map((waypoint: { waypoint_index: number }) => waypoint.waypoint_index)
    const order = window.stops.map((stop, i) => ({ id: stop.id, at: places[i + 1] ?? i + 1 })).sort((a, b) => a.at - b.at).map((item) => item.id)
    return { index: window.index, order, line: osrm.geometry ?? null, meters: osrm.distance ?? 0, seconds: osrm.duration ?? 0 }
  }
  // Valhalla's own trip: locations in visiting order, each with its input position; legs carry GeoJSON shapes
  const trip = data.trip as { locations?: { original_index?: number }[]; legs?: { shape?: GeoJSON.LineString }[]; summary?: { length?: number; time?: number } } | undefined
  const visited = (trip?.locations ?? []).map((location) => location.original_index).filter((at): at is number => typeof at === 'number' && at > 0)
  const order = visited.length === window.stops.length ? visited.map((at) => window.stops[at - 1].id) : window.stops.map((stop) => stop.id)
  const coordinates = (trip?.legs ?? []).flatMap((leg) => (leg.shape?.type === 'LineString' ? leg.shape.coordinates : []))
  return {
    index: window.index,
    order,
    line: coordinates.length > 1 ? { type: 'LineString', coordinates } : null,
    meters: (trip?.summary?.length ?? 0) * 1000,   // requested in kilometres
    seconds: trip?.summary?.time ?? 0,
  }
}

/** Plans the route; `onPart` receives each solved window as soon as it is ready. Resolves with all parts in order. */
export async function planRoute(start: Point, stops: Stop[], onPart: (part: RoutePart, done: number, total: number) => void, signal: AbortSignal): Promise<RoutePart[]> {
  const queue = windows(start, tourOrder(start, stops))
  const results: RoutePart[] = new Array(queue.length)
  let next = 0, done = 0
  async function worker() {
    while (next < queue.length && !signal.aborted) {
      const window = queue[next++]
      const part = await solve(window, signal)
      results[part.index] = part
      onPart(part, ++done, queue.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  return results
}
