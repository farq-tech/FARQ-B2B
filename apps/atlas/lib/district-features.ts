export type CityDistrictFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string | number; ar?: string; district_ar?: string }>

function isPosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90
}

function isLinearRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition)) return false
  const first = value[0]
  const last = value[value.length - 1]
  return first.length === last.length && first.every((coordinate, index) => coordinate === last[index])
}

function isPolygonCoordinates(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isLinearRing)
}

function hasValidGeometry(geometry: unknown): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (!geometry || typeof geometry !== 'object') return false
  const candidate = geometry as { type?: unknown; coordinates?: unknown }
  if (candidate.type === 'Polygon') return isPolygonCoordinates(candidate.coordinates)
  return candidate.type === 'MultiPolygon' && Array.isArray(candidate.coordinates)
    && candidate.coordinates.length > 0 && candidate.coordinates.every(isPolygonCoordinates)
}

/** Reject partial or malformed outlines instead of painting a city as if its neighborhood coverage were complete. */
export function isCityDistrictFeatureCollection(value: unknown, expectedDistrictCount?: number): value is CityDistrictFeature[] {
  if (!Array.isArray(value) || (expectedDistrictCount !== undefined && value.length !== expectedDistrictCount)) return false
  if (value.length === 0) return expectedDistrictCount === 0
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return false
    const feature = candidate as CityDistrictFeature
    if (feature.type !== 'Feature' || !feature.properties || typeof feature.properties !== 'object') return false
    const id = feature.properties?.id
    const name = feature.properties?.ar || feature.properties?.district_ar
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() || typeof name !== 'string' || !name.trim()) return false
    if (!hasValidGeometry(feature.geometry)) return false
    const key = String(id)
    if (ids.has(key)) return false
    ids.add(key)
  }
  return true
}
