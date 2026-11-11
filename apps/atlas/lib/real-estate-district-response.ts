export type RealEstateDistrictFigure = {
  listings: number
  median_sar_per_sqm: number
  reliable?: boolean
  by_age?: Partial<Record<'new' | 'older', { listings: number; median_sar_per_sqm: number }>>
}

export type RealEstateDistrictRow = {
  district_id: string | number
  district_ar: string
  groups: Record<string, RealEstateDistrictFigure>
}

export type RealEstateDistrictResponse = { available: boolean; districts: RealEstateDistrictRow[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDistrictId = (value: unknown) => (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isSafeInteger(value))
const isPositiveCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0
const isPositiveFigure = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0

function isFigure(value: unknown): value is RealEstateDistrictFigure {
  if (!isRecord(value) || !isPositiveCount(value.listings) || !isPositiveFigure(value.median_sar_per_sqm)) return false
  if (value.reliable !== undefined && typeof value.reliable !== 'boolean') return false
  if (value.by_age === undefined) return true
  if (!isRecord(value.by_age) || Object.keys(value.by_age).some((key) => key !== 'new' && key !== 'older')) return false
  return Object.values(value.by_age).every((band) => isRecord(band)
    && isPositiveCount(band.listings) && isPositiveFigure(band.median_sar_per_sqm))
}

/** Reject malformed or colliding property district data before it can affect map colors or comparisons. */
export function isRealEstateDistrictResponse(value: unknown): value is RealEstateDistrictResponse {
  if (!isRecord(value) || typeof value.available !== 'boolean' || !Array.isArray(value.districts)) return false
  if (!value.available && value.districts.length > 0) return false
  const ids = new Set<string>()
  return value.districts.every((row) => {
    if (!isRecord(row) || !isDistrictId(row.district_id) || typeof row.district_ar !== 'string' || !row.district_ar.trim()
      || !isRecord(row.groups)) return false
    const id = String(row.district_id).trim()
    if (ids.has(id)) return false
    ids.add(id)
    return Object.entries(row.groups).every(([group, figure]) => group.trim().length > 0 && isFigure(figure))
  })
}
