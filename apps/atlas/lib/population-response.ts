export type PopulationDistrictRow = {
  district_id: string | number
  district_ar: string
  population: number | null
  source?: string | null
}

export type PopulationResponse = { city_en: string; districts: PopulationDistrictRow[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDistrictId = (value: unknown) => (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isSafeInteger(value))
const isPopulation = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)

/** Validate the golden population payload and its city identity before it drives rankings or audience sizes. */
export function isPopulationResponse(value: unknown, expectedCity: string): value is PopulationResponse {
  if (!isRecord(value) || value.city_en !== expectedCity || !Array.isArray(value.districts)) return false
  const ids = new Set<string>()
  return value.districts.every((row) => {
    if (!isRecord(row) || !isDistrictId(row.district_id) || typeof row.district_ar !== 'string' || !row.district_ar.trim()
      || !isPopulation(row.population)
      || !(row.source === undefined || row.source === null || (typeof row.source === 'string' && !!row.source.trim()))) return false
    const id = String(row.district_id).trim()
    if (ids.has(id)) return false
    ids.add(id)
    return true
  })
}
