export type RestaurantDistrictRow = { district_id: string; restaurants: number }
export type MenuPriceDistrictRow = { district_id: string; price: number; places: number | null }
export type DemandTerm = { term: string; searches: number; unmet: number }
export type DemandDistrictRow = { district_id: string; searches: number; unmet: number; unmetTerms: DemandTerm[] }
export type FarqDistrictResponse<T> = { districts: T[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isDistrictId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isPositivePrice = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0

function uniqueRows<T extends { district_id: string }>(districts: unknown, isRow: (value: unknown) => value is T): districts is T[] {
  if (!Array.isArray(districts)) return false
  const ids = new Set<string>()
  return districts.every((row) => {
    if (!isRow(row)) return false
    const id = row.district_id.trim()
    if (ids.has(id)) return false
    ids.add(id)
    return true
  })
}

export function isRestaurantDistrictResponse(value: unknown): value is FarqDistrictResponse<RestaurantDistrictRow> {
  return isRecord(value) && uniqueRows(value.districts, (row): row is RestaurantDistrictRow => isRecord(row)
    && isDistrictId(row.district_id) && isCount(row.restaurants))
}

export function isMenuPriceDistrictResponse(value: unknown): value is FarqDistrictResponse<MenuPriceDistrictRow> {
  return isRecord(value) && uniqueRows(value.districts, (row): row is MenuPriceDistrictRow => isRecord(row)
    && isDistrictId(row.district_id) && isPositivePrice(row.price)
    && (row.places === null || isCount(row.places)))
}

function isDemandTerm(value: unknown): value is DemandTerm {
  return isRecord(value) && typeof value.term === 'string' && value.term.trim().length > 0
    && isCount(value.searches) && isCount(value.unmet) && value.unmet <= value.searches
}

export function isDemandDistrictResponse(value: unknown): value is FarqDistrictResponse<DemandDistrictRow> {
  return isRecord(value) && uniqueRows(value.districts, (row): row is DemandDistrictRow => isRecord(row)
    && isDistrictId(row.district_id) && isCount(row.searches) && isCount(row.unmet) && row.unmet <= row.searches
    && Array.isArray(row.unmetTerms) && row.unmetTerms.every(isDemandTerm))
}
