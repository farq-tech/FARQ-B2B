import type { DistrictFeature } from '@/lib/insights-api'

/** Area of a district outline in km², on a local flat projection (well under 1% off at district scale). */
export function areaKm2(geometry: DistrictFeature['geometry']): number {
  const polygons: number[][][][] = geometry?.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates as number[][][][] : []
  let total = 0
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const lat = (ring.reduce((sum, point) => sum + point[1], 0) / ring.length) * (Math.PI / 180)
      let twice = 0
      for (let i = 0; i < ring.length - 1; i++) twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
      const km2 = Math.abs(twice / 2) * 111.32 * 111.32 * Math.cos(lat)
      total += index === 0 ? km2 : -km2   // inner rings are holes
    })
  }
  return total
}

/** Crossings of a ray east from (x, y) over one ring's edges — the ray-casting parity test, counted per polygon. */
function ringCrossings(ring: number[][], x: number, y: number): number {
  let crossings = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) crossings++
  }
  return crossings
}

/** Whether the point falls inside the outline. Odd crossings across a polygon's rings = inside (holes subtract). */
export function containsPoint(geometry: DistrictFeature['geometry'], point: { lon: number; lat: number }): boolean {
  const polygons: number[][][][] = geometry?.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates as number[][][][] : []
  for (const polygon of polygons) {
    let crossings = 0
    for (const ring of polygon) crossings += ringCrossings(ring, point.lon, point.lat)
    if (crossings % 2 === 1) return true
  }
  return false
}

/** The id of the district whose outline contains the point, or null — the honest join from a dropped pin to its حي. */
export function districtAt(point: { lon: number; lat: number }, features: DistrictFeature[]): string | null {
  for (const feature of features) if (containsPoint(feature.geometry, point)) return String(feature.properties.id)
  return null
}

/** Straight-line distance in km between two points. */
export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/**
 * Which districts touch which, from their outlines: two districts are neighbours when a point of one's outline lies
 * within `metres` of the other's outline (official outlines leave slivers and overlaps along shared streets, so an
 * exact shared edge is not required). Each outline is sampled to at most 120 points and measured against every edge
 * of the other, on a flat local projection; bounding boxes rule out the far pairs first. Keyed by the feature ids as
 * strings, symmetric, a district never its own neighbour.
 */
export function neighbourMap(features: { id: string; geometry: DistrictFeature['geometry'] }[], metres = 120): Map<string, Set<string>> {
  const firsts = features.map((feature) => outerRings(feature.geometry)[0]?.[0]?.[1]).filter((lat): lat is number => typeof lat === 'number')
  const lat0 = firsts.length ? (firsts.reduce((sum, lat) => sum + lat, 0) / firsts.length) * (Math.PI / 180) : 0
  const kx = 111320 * Math.cos(lat0)
  const ky = 110540
  const shapes = features.map((feature) => {
    const rings = outerRings(feature.geometry).map((ring) => ring.map(([lon, lat]) => [lon * kx, lat * ky] as [number, number]))
    const points = rings.flat()
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const step = Math.max(1, Math.ceil(points.length / 120))
    return {
      id: feature.id, rings, samples: points.filter((_, index) => index % step === 0),
      box: points.length ? [Math.min(...xs) - metres, Math.min(...ys) - metres, Math.max(...xs) + metres, Math.max(...ys) + metres] : [0, 0, -1, -1],
    }
  })
  const near = (point: [number, number], rings: [number, number][][]) => rings.some((ring) => {
    for (let i = 0; i < ring.length - 1; i++) if (segmentDistance(point, ring[i], ring[i + 1]) <= metres) return true
    return false
  })
  const out = new Map(shapes.map((shape) => [shape.id, new Set<string>()]))
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]
      const b = shapes[j]
      if (a.box[0] > b.box[2] || b.box[0] > a.box[2] || a.box[1] > b.box[3] || b.box[1] > a.box[3]) continue
      if (a.samples.some((point) => near(point, b.rings)) || b.samples.some((point) => near(point, a.rings))) {
        out.get(a.id)!.add(b.id)
        out.get(b.id)!.add(a.id)
      }
    }
  }
  return out
}

/** The centre of a district's outline (its bounding box's), for the distance between two neighbours. */
export function outlineCentre(geometry: DistrictFeature['geometry']): { lon: number; lat: number } | null {
  const points = outerRings(geometry).flat()
  if (!points.length) return null
  const lons = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 }
}

function outerRings(geometry: DistrictFeature['geometry']): number[][][] {
  if (geometry?.type === 'Polygon') return [geometry.coordinates[0] as number[][]]
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates as number[][][][]).map((polygon) => polygon[0])
  return []
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
