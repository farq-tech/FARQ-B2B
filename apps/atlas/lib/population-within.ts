export type PopulationWithin = {
  population: number | null
  dwellings: number | null
  businesses: number | null
  residents_per: number | null
  top_activities: { activity: string; n: number }[]
  home_buildings?: number
  people_per_district: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isMetric = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const isCount = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0)

/** Validate measured area totals before the site comparison ranks or displays them. */
export function parsePopulationWithin(input: unknown): PopulationWithin {
  if (!isRecord(input) || !isMetric(input.population) || !isMetric(input.dwellings) || !isCount(input.businesses)
    || !isMetric(input.residents_per) || !Array.isArray(input.top_activities)) {
    throw new Error('تعذر التحقق من بيانات النطاق.')
  }
  if (input.home_buildings !== undefined && !(Number.isSafeInteger(input.home_buildings) && (input.home_buildings as number) >= 0)) {
    throw new Error('تعذر التحقق من بيانات النطاق.')
  }
  if (input.people_per_district !== undefined && typeof input.people_per_district !== 'boolean') throw new Error('تعذر التحقق من بيانات النطاق.')
  const names = new Set<string>()
  const topActivities = input.top_activities.every((item) => {
    if (!isRecord(item) || typeof item.activity !== 'string' || !item.activity.trim() || names.has(item.activity)
      || !Number.isSafeInteger(item.n) || (item.n as number) <= 0) return false
    names.add(item.activity)
    return true
  })
  if (!topActivities || input.top_activities.length > 10) throw new Error('تعذر التحقق من بيانات النطاق.')
  // Older services can return a household-size estimate without a population
  // measurement; keep the dwelling count, but never display/rank that estimate.
  const hasPopulationData = input.people_per_district === true
  return {
    ...input,
    population: hasPopulationData ? input.population as number | null : null,
    residents_per: hasPopulationData ? input.residents_per as number | null : null,
    people_per_district: hasPopulationData,
  } as PopulationWithin
}
