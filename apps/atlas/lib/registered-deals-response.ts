export type DealMetric = { deals: number; median_sar_per_sqm: number }

export type RegisteredDealRow = {
  district_id?: string | null
  district_ar: string
  residential?: DealMetric
  commercial?: DealMetric
}

export type RegisteredDealsResponse = {
  city: string
  available: boolean
  districts: RegisteredDealRow[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDealMetric = (value: unknown) => isRecord(value)
  && Number.isSafeInteger(value.deals) && (value.deals as number) >= 10
  && Number.isSafeInteger(value.median_sar_per_sqm) && (value.median_sar_per_sqm as number) > 0

/** Validate registered-sale deal metrics and their district identities before they reach map comparisons. */
export function isRegisteredDealsResponse(value: unknown, expectedCity: string): value is RegisteredDealsResponse {
  if (!isRecord(value) || value.city !== expectedCity || typeof value.available !== 'boolean' || !Array.isArray(value.districts)) return false
  if (!value.available) return value.districts.length === 0
  const names = new Set<string>()
  const ids = new Set<string>()
  const hasIds = value.districts.some((item) => isRecord(item) && Object.prototype.hasOwnProperty.call(item, 'district_id'))
  return value.districts.every((item) => {
    if (!isRecord(item) || typeof item.district_ar !== 'string' || !item.district_ar.trim()) return false
    const hasResidential = Object.hasOwn(item, 'residential')
    const hasCommercial = Object.hasOwn(item, 'commercial')
    if (!hasResidential && !hasCommercial) return false
    if (hasResidential && !isDealMetric(item.residential)) return false
    if (hasCommercial && !isDealMetric(item.commercial)) return false
    if (hasIds) {
      if (!Object.hasOwn(item, 'district_id')) return false
      if (item.district_id !== null && (typeof item.district_id !== 'string' || !item.district_id.trim() || ids.has(item.district_id))) return false
      if (typeof item.district_id === 'string') ids.add(item.district_id)
    } else {
      if (names.has(item.district_ar)) return false
      names.add(item.district_ar)
    }
    return true
  })
}
