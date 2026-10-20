import { MAP_HEIGHT, MAP_WIDTH } from './mock-data'
import type { Point } from './types'

export type LngLat = [number, number]
export type LngLatBounds = [LngLat, LngLat]

interface CityGeo {
  center: LngLat
  latSpan: number
}

const CITY_GEO: Record<string, CityGeo> = {
  riyadh: { center: [46.69, 24.725], latSpan: 0.14 },
  jeddah: { center: [39.235, 21.56], latSpan: 0.14 },
  dammam: { center: [50.1, 26.4], latSpan: 0.12 },
  abha: { center: [42.505, 18.22], latSpan: 0.08 },
}

const FALLBACK: CityGeo = CITY_GEO.riyadh

function geoFor(cityId: string) {
  const g = CITY_GEO[cityId] ?? FALLBACK
  const lngSpan = (g.latSpan * (MAP_WIDTH / MAP_HEIGHT)) / Math.cos((g.center[1] * Math.PI) / 180)
  return {
    west: g.center[0] - lngSpan / 2,
    north: g.center[1] + g.latSpan / 2,
    lngSpan,
    latSpan: g.latSpan,
  }
}

/** Projects the prototype's synthetic 1000×700 plan coordinates onto a real bounding box for the city. */
export function toLngLat(cityId: string, [x, y]: Point): LngLat {
  const g = geoFor(cityId)
  return [g.west + (x / MAP_WIDTH) * g.lngSpan, g.north - (y / MAP_HEIGHT) * g.latSpan]
}

export function cityBounds(cityId: string): LngLatBounds {
  const g = geoFor(cityId)
  return [
    [g.west, g.north - g.latSpan],
    [g.west + g.lngSpan, g.north],
  ]
}

export type MapArea =
  | { kind: 'district'; districtId: string; label: string }
  | { kind: 'rect'; bounds: LngLatBounds; label: string }

export function areaKey(area: MapArea | null | undefined) {
  if (!area) return ''
  return area.kind === 'district' ? `d:${area.districtId}` : `r:${area.bounds.flat().map((n) => n.toFixed(5)).join(',')}`
}

export function isInArea(cityId: string, b: { x: number; y: number; districtId: string }, area: MapArea) {
  if (area.kind === 'district') return b.districtId === area.districtId
  const [lng, lat] = toLngLat(cityId, [b.x, b.y])
  const [[w, s], [e, n]] = area.bounds
  return lng >= w && lng <= e && lat >= s && lat <= n
}

export function areaRing(cityId: string, area: MapArea, districtPolygon?: Point[]): LngLat[] {
  if (area.kind === 'district') return (districtPolygon ?? []).map((p) => toLngLat(cityId, p))
  const [[w, s], [e, n]] = area.bounds
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]
}

export function boundsOf(points: LngLat[]): LngLatBounds | null {
  if (points.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lng, lat] of points) {
    w = Math.min(w, lng)
    e = Math.max(e, lng)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  return [
    [w, s],
    [e, n],
  ]
}
