export type DistrictIncomeRow = {
  district_ar: string
  /** Absent only on a legacy response; null means the current service could not resolve the identity. */
  district_id?: string | number | null
  income_all?: number | null
  income_male?: number | null
  income_female?: number | null
  income_saudi?: number | null
  income_non_saudi?: number | null
}

export type DistrictIncomeResponse = { available: boolean; districts: DistrictIncomeRow[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isOptionalIncome = (value: unknown) => value === undefined || value === null
  || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const isDistrictId = (value: unknown) => value === null
  || (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isSafeInteger(value))

/** Validate the income contract before values or identities reach the city map. */
export function isDistrictIncomeResponse(value: unknown): value is DistrictIncomeResponse {
  if (!isRecord(value) || typeof value.available !== 'boolean' || !Array.isArray(value.districts)) return false
  if (!value.available && value.districts.length > 0) return false
  return value.districts.every((row) => {
    if (!isRecord(row) || typeof row.district_ar !== 'string' || !row.district_ar.trim()) return false
    if (Object.hasOwn(row, 'district_id') && !isDistrictId(row.district_id)) return false
    return ['income_all', 'income_male', 'income_female', 'income_saudi', 'income_non_saudi'].every((key) => isOptionalIncome(row[key]))
  })
}
