/**
 * Audience segment types. The sizes themselves (population × each measured share) are computed once in the service
 * (services/targeting-api/district_metrics.audience_sizes) and read by the map; no screen recomposes them. Two
 * segments are never multiplied together: their overlap (Saudi men, say) is not measured.
 */
export type Sex = 'all' | 'men' | 'women'
export type Nationality = 'all' | 'saudi' | 'non_saudi'
export type AudienceMode = 'people' | 'businesses'
export type AudienceSourceStatus = 'loading' | 'ready' | 'unavailable' | 'error'
export type IncomeCoverageStatus = 'loading' | 'error' | 'unavailable' | 'partial' | 'complete'
export type AudienceDistrict = DistrictShare & {
  district_id?: string | null
  district_ar: string
  men: number | null
  women: number | null
  saudi: number | null
  non_saudi: number | null
}
export type AudienceResponse = { city: string; available: boolean; districts?: AudienceDistrict[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keep the summary label tied to the metric actually shown, regardless of filters remembered from another mode. */
export function audienceSummaryHeading(mode: AudienceMode, hasPeopleSegment: boolean, minIncome: number, scope: string): string {
  if (mode === 'businesses') return `عدد المنشآت في ${scope}`
  if (minIncome > 0) {
    return `${hasPeopleSegment ? 'سكان الشريحة في الأحياء المطابقة' : 'سكان الأحياء المطابقة'} ضمن ${scope}`
  }
  return `حجم الجمهور في ${scope}`
}
const isShare = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
const isSize = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const sizesMatchShare = (share: unknown, first: unknown, second: unknown) => {
  if (share === null) return first === null && second === null
  if (first === null || second === null) return first === null && second === null
  const firstSize = first as number
  const secondSize = second as number
  const total = firstSize + secondSize
  if (!Number.isFinite(total)) return false
  // A zero population yields two valid zero sizes; otherwise their ratio must match the source share.
  return total === 0 || Math.abs(100 * firstSize / total - (share as number)) <= 0.1
}

/** Validate measured district shares and their server-computed sizes before using them to color or rank districts. */
export function isAudienceResponse(value: unknown, expectedCity: string): value is AudienceResponse {
  if (!isRecord(value) || value.city !== expectedCity || typeof value.available !== 'boolean') return false
  if (!value.available) return true
  if (!Array.isArray(value.districts)) return false
  const names = new Set<string>()
  const ids = new Set<string>()
  const hasIds = value.districts.some((item) => isRecord(item) && Object.prototype.hasOwnProperty.call(item, 'district_id'))
  return value.districts.every((item) => {
    if (!isRecord(item) || typeof item.district_ar !== 'string' || !item.district_ar.trim()) return false
    if (hasIds) {
      if (!Object.prototype.hasOwnProperty.call(item, 'district_id')) return false
      if (item.district_id !== null && (typeof item.district_id !== 'string' || !item.district_id.trim() || ids.has(item.district_id))) return false
      if (typeof item.district_id === 'string') ids.add(item.district_id)
    } else {
      if (names.has(item.district_ar)) return false
      names.add(item.district_ar)
    }
    return isShare(item.male_pct) && isShare(item.saudi_pct)
      && ['men', 'women', 'saudi', 'non_saudi'].every((key) => isSize(item[key]))
      && sizesMatchShare(item.male_pct, item.men, item.women)
      && sizesMatchShare(item.saudi_pct, item.saudi, item.non_saudi)
  })
}

export function audienceDataStatus(mode: AudienceMode, needsShares: boolean, status: AudienceSourceStatus): AudienceSourceStatus {
  return mode !== 'people' || !needsShares ? 'ready' : status
}

/** Distinguish a missing income source from a real zero and from partial district coverage. */
export function incomeCoverageStatus(source: 'loading' | 'ready' | 'error', measured: number, total: number): IncomeCoverageStatus {
  if (source !== 'ready') return source
  if (!Number.isInteger(measured) || !Number.isInteger(total) || total < 1 || measured < 0 || measured > total || measured === 0) return 'unavailable'
  return measured < total ? 'partial' : 'complete'
}

/** A scoped audience total is valid only when every eligible district in that scope has a measured value. */
export function completeAudienceTotal(values: readonly (number | null)[]): number | null {
  if (!values.length || values.some((value) => value == null || !Number.isFinite(value) || value < 0)) return null
  return values.reduce<number>((sum, value) => sum + value!, 0)
}

/** Map a measured 0–100 audience score to the five sequential audience shades; missing values have no shade. */
export function audienceShadeIndex(score: number): number | null {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null
  return Math.min(4, Math.floor(score / 20))
}

/** A missing/invalid income stays unknown; a measured value below the chosen floor is ineligible. */
export function meetsIncomeThreshold(income: number | null, minimum: number): boolean | null {
  if (!Number.isFinite(minimum) || minimum < 0) return null
  if (minimum === 0) return true
  if (income == null || !Number.isFinite(income) || income < 0) return null
  return income >= minimum
}

/** A missing district row is a measured zero only when the same city query confirms total zero. */
export function districtBusinessCount(cityTotal: number | null, districtTotal: number | null | undefined): number | null {
  if (districtTotal == null) return cityTotal === 0 ? 0 : null
  return typeof districtTotal === 'number' && Number.isSafeInteger(districtTotal) && districtTotal >= 0 ? districtTotal : null
}
/** Measured per district: percentage of men and of Saudis among residents. */
export type DistrictShare = { male_pct: number | null; saudi_pct: number | null }
