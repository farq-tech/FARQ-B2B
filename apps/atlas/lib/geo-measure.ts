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

/** Straight-line distance in km between two points. */
export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
