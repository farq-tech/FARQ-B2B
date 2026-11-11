type DistrictCountRow = {
  district_id?: string | null
  district_ar: string
  n: number
  area_km2?: number | null
  residents_per?: number | null
  per_km2?: number | null
  density?: number | null
}

export type DistrictCountResponse = {
  districts: DistrictCountRow[]
  total: number
  /** Sum of directory counts assigned to a reliable district; absent on older service releases. */
  located?: number
  scope_summary?: unknown
}

export type DistrictScopeSummary = {
  population: number | null
  businesses: number | null
  residents_per: number | null
  districts: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isOptionalMetric = (value: unknown) => value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)

/** Validate the service's city count payload before the UI joins and displays it. */
export function isDistrictCountResponse(value: unknown): value is DistrictCountResponse {
  if (!isRecord(value) || !isCount(value.total) || !Array.isArray(value.districts)) return false
  if (value.located !== undefined && !isCount(value.located)) return false
  const names = new Set<string>()
  const ids = new Set<string>()
  const hasIds = value.districts.some((item) => isRecord(item) && Object.prototype.hasOwnProperty.call(item, 'district_id'))
  return value.districts.every((item): item is DistrictCountRow => {
    if (!isRecord(item) || typeof item.district_ar !== 'string' || !item.district_ar.trim() || !isCount(item.n)) return false
    if (hasIds) {
      if (!Object.prototype.hasOwnProperty.call(item, 'district_id')) return false
      if (item.district_id !== null && (typeof item.district_id !== 'string' || !item.district_id.trim() || ids.has(item.district_id))) return false
      if (typeof item.district_id === 'string') ids.add(item.district_id)
    } else {
      if (names.has(item.district_ar)) return false
      names.add(item.district_ar)
    }
    return ['area_km2', 'residents_per', 'per_km2', 'density'].every((key) => isOptionalMetric(item[key]))
  })
}

export function isDistrictScopeSummary(value: unknown): value is DistrictScopeSummary {
  return isRecord(value)
    && isOptionalMetric(value.population)
    && isOptionalMetric(value.businesses)
    && isOptionalMetric(value.residents_per)
    && isCount(value.districts)
}
