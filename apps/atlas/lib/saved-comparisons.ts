export type SavedComparison = {
  name: string
  city: string
  districtIds: string[]
  savedAt: string
}

const STORAGE_KEY = 'farq-atlas-saved-district-comparisons-v1'

/** Read only well-formed, two-district comparisons; malformed local storage is treated as empty. */
export function parseSavedComparisons(value: unknown): SavedComparison[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (
      typeof row.name !== 'string' || !row.name.trim() ||
      typeof row.city !== 'string' || !row.city.trim() ||
      !Array.isArray(row.districtIds) || row.districtIds.length !== 2 ||
      row.districtIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      row.districtIds[0] === row.districtIds[1] ||
      typeof row.savedAt !== 'string'
    ) return []
    return [{ name: row.name.trim().slice(0, 80), city: row.city, districtIds: row.districtIds as string[], savedAt: row.savedAt }]
  }).slice(0, 20)
}

export function loadSavedComparisons(): SavedComparison[] {
  try {
    return parseSavedComparisons(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function persistSavedComparisons(items: SavedComparison[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parseSavedComparisons(items)))
    return true
  } catch {
    return false
  }
}

export function comparisonShareUrl(origin: string, city: string, districtIds: string[]): string {
  const url = new URL('/map', origin)
  url.searchParams.set('lens', 'analysts')
  url.searchParams.set('tool', 'compare')
  url.searchParams.set('city', city)
  url.searchParams.set('districts', districtIds.join(','))
  return url.toString()
}

export function parseComparisonDistrictIds(value: string | null): string[] {
  if (!value) return []
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
  return ids.length === 2 && ids[0] !== ids[1] ? ids : []
}
