export type PriceRange = { low: number; mid: number; high: number }
export type PriceEstimate = {
  available: boolean
  reason?: string
  comparables?: number
  scope?: { district_id: string; district_ar: string | null; comparables: number }[]
  per_sqm?: PriceRange
  price?: PriceRange
  comparables_per_sqm?: PriceRange
  adjustments_calibrated?: boolean
  adjustments?: { factor: string; label: string; pct: number }[]
  examples?: { id: string; url: string | null; photo: string | null; district_ar: string | null; type: string; price_sar: number; area_sqm: number; beds?: number; age?: number }[]
  rules_source?: string
  listings_retrieved?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

function isRange(value: unknown): value is PriceRange {
  if (!isRecord(value)) return false
  const { low, mid, high } = value
  return [low, mid, high].every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)
    && (low as number) <= (mid as number) && (mid as number) <= (high as number)
}

/** Reject malformed estimate replies before the result view reads required ranges or renders comparable rows. */
export function parsePriceEstimateResponse(input: unknown): PriceEstimate {
  if (!isRecord(input) || typeof input.available !== 'boolean') throw new Error('Invalid price estimate response')
  if (!input.available) {
    if (input.reason !== undefined && (typeof input.reason !== 'string' || !input.reason.trim())) throw new Error('Invalid estimate reason')
    if (input.comparables !== undefined && !isCount(input.comparables)) throw new Error('Invalid comparable count')
    return input as PriceEstimate
  }

  if (!isCount(input.comparables) || (input.comparables as number) < 15
    || !isRange(input.price) || !isRange(input.per_sqm) || !isRange(input.comparables_per_sqm)
    || typeof input.adjustments_calibrated !== 'boolean'
    || !Array.isArray(input.scope) || !Array.isArray(input.adjustments) || !Array.isArray(input.examples)) {
    throw new Error('Invalid available estimate')
  }
  const scopeIds = new Set<string>()
  let scopedComparables = 0
  const validScope = input.scope.every((item) => {
    if (!isRecord(item) || typeof item.district_id !== 'string' || !item.district_id.trim() || scopeIds.has(item.district_id)
      || !isTextOrNull(item.district_ar) || !isCount(item.comparables)) return false
    scopeIds.add(item.district_id)
    scopedComparables += item.comparables
    return true
  })
  const validAdjustments = input.adjustments.every((item) => isRecord(item) && typeof item.factor === 'string'
    && typeof item.label === 'string' && typeof item.pct === 'number' && Number.isFinite(item.pct))
  const exampleIds = new Set<string>()
  const validExamples = input.examples.every((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || exampleIds.has(item.id)
      || !isTextOrNull(item.url) || !isTextOrNull(item.photo) || !isTextOrNull(item.district_ar)
      || typeof item.type !== 'string' || typeof item.price_sar !== 'number' || !Number.isFinite(item.price_sar) || item.price_sar < 0
      || typeof item.area_sqm !== 'number' || !Number.isFinite(item.area_sqm) || item.area_sqm <= 0) return false
    exampleIds.add(item.id)
    return true
  })
  if (!validScope || scopedComparables !== input.comparables || !validAdjustments || !validExamples) throw new Error('Invalid estimate details')
  return input as PriceEstimate
}
