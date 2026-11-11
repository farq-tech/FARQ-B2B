export type MarketGapCoverage = { sample: number; total: number }
export type MarketGapRow = {
  district_id?: string | null
  district_ar: string
  population: number
  businesses: number
  expected_businesses: number
  shortfall: number
  fit_score?: number | null
  fit_gap_rank?: number | null
  fit_income_rank?: number | null
}
export type MarketGapResponse = {
  city: string
  residents_per_business: number | null
  rate_sample_districts?: number | null
  districts_with_population?: number | null
  fit_sample_districts?: number | null
  fit_candidate_districts?: number | null
  districts: MarketGapRow[]
  message?: string
  understood?: { labels: string[]; more: number } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const optionalCount = (value: unknown) => value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) >= 0)
const optionalScore = (value: unknown) => value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)

/** Check city, counts, scores and district identity before a gap response colors or ranks the map. */
export function isMarketGapResponse(value: unknown, expectedCity: string): value is MarketGapResponse {
  if (!isRecord(value) || value.city !== expectedCity || !Array.isArray(value.districts)) return false
  if (!(value.residents_per_business === null || (typeof value.residents_per_business === 'number' && Number.isFinite(value.residents_per_business) && value.residents_per_business >= 0))) return false
  for (const key of ['rate_sample_districts', 'districts_with_population', 'fit_sample_districts', 'fit_candidate_districts']) {
    if (!optionalCount(value[key])) return false
  }
  if (value.message !== undefined && typeof value.message !== 'string') return false
  if (value.understood !== undefined && value.understood !== null
    && (!isRecord(value.understood) || !Array.isArray(value.understood.labels)
      || !value.understood.labels.every((label) => typeof label === 'string')
      || !Number.isSafeInteger(value.understood.more) || (value.understood.more as number) < 0)) return false
  const names = new Set<string>()
  const ids = new Set<string>()
  const hasIds = value.districts.some((item) => isRecord(item) && Object.hasOwn(item, 'district_id'))
  return value.districts.every((item) => {
    if (!isRecord(item) || typeof item.district_ar !== 'string' || !item.district_ar.trim()
      || !Number.isSafeInteger(item.population) || (item.population as number) < 0
      || !Number.isSafeInteger(item.businesses) || (item.businesses as number) < 0
      || typeof item.expected_businesses !== 'number' || !Number.isFinite(item.expected_businesses) || item.expected_businesses < 0
      || typeof item.shortfall !== 'number' || !Number.isFinite(item.shortfall)) return false
    if (!optionalScore(item.fit_score) || !optionalScore(item.fit_gap_rank) || !optionalScore(item.fit_income_rank)) return false
    if (item.male_pct !== undefined && !(item.male_pct === null || (typeof item.male_pct === 'number' && Number.isFinite(item.male_pct) && item.male_pct >= 0 && item.male_pct <= 100))) return false
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

/** Missing or inconsistent sample coverage stays unavailable; never draw it as zero or a full city rate. */
export function marketGapCoverage(sample: unknown, total: unknown): MarketGapCoverage | null {
  if (!Number.isSafeInteger(sample) || !Number.isSafeInteger(total)) return null
  if ((sample as number) < 1 || (total as number) < (sample as number)) return null
  return { sample: sample as number, total: total as number }
}
