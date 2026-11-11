export type TerritoryCoverage = {
  unweighted_districts: number | null
  unlocated_businesses: number | null
}

/** Missing coverage is unknown, while an explicit zero means the source checked every district. */
export function parseTerritoryCoverage(value: unknown): TerritoryCoverage {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid territory coverage')
  const payload = value as Record<string, unknown>
  const count = (raw: unknown) => {
    if (raw == null) return null
    if (!Number.isSafeInteger(raw) || (raw as number) < 0) throw new Error('Invalid territory coverage count')
    return raw as number
  }
  return {
    unweighted_districts: count(payload.unweighted_districts),
    unlocated_businesses: count(payload.unlocated_businesses),
  }
}
