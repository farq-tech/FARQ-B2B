export type ListingSort = 'best' | 'price_asc' | 'price_desc' | 'area_desc' | 'sqm_asc'

const RESULT_SORT_WORD: Record<ListingSort, string> = {
  best: 'الأنسب',
  price_asc: 'الأقل سعراً',
  price_desc: 'الأعلى سعراً',
  area_desc: 'الأكبر مساحةً',
  sqm_asc: 'الأقل سعراً للمتر',
}

export function listingsSubsetLabel(sort: ListingSort, shownLabel: string, totalLabel: string): string {
  return `${RESULT_SORT_WORD[sort]}: ${shownLabel} من أصل ${totalLabel}`
}

/** Keep source unavailability and missing density distinct from a measured zero-result search. */
export function listingsEmptyStateHeading(available: boolean, densityUnavailable: boolean, city: string): string | null {
  if (available) return null
  return densityUnavailable ? `عروض ${city}` : `العروض غير متاحة في ${city}`
}
