import { numberFormat } from './insights-api'
import { PERIOD_WORD, isPublishable, typeLabel, type Deal, type Listing, type ListingKind } from './real-estate'

/** Every filter «العقار» offers. The deal, types and districts go to the service; the rest narrow what it sent. */
export type HomeFilters = {
  kind: ListingKind
  rentDeal: Deal
  types: string[]
  /** District ids (the atlas ids the listings carry). */
  districts: string[]
  minPrice: number | null
  maxPrice: number | null
  minArea: number | null
  maxArea: number | null
  beds: number
  livings: number
  wc: number
  street: number
  belowMedian: boolean
  sort: SortId
}

export type SortId = 'best' | 'price_asc' | 'price_desc' | 'area_desc' | 'sqm_asc'

export const DEFAULT_FILTERS: HomeFilters = {
  kind: 'rent', rentDeal: 'rent_year', types: ['apartment'], districts: [],
  minPrice: null, maxPrice: null, minArea: null, maxArea: null, beds: 0, livings: 0, wc: 0, street: 0,
  belowMedian: false, sort: 'best',
}

export const SORTS: { id: SortId; label: string }[] = [
  { id: 'best', label: 'الأنسب (الأقل من وسيط الحي أولاً)' },
  { id: 'price_asc', label: 'السعر: الأقل أولاً' },
  { id: 'price_desc', label: 'السعر: الأعلى أولاً' },
  { id: 'area_desc', label: 'المساحة: الأكبر أولاً' },
  { id: 'sqm_asc', label: 'سعر المتر: الأقل أولاً' },
]

/** «عرض واحد»، «عرضان»، «9 عروض»، «24 عرضاً»: the count the way it is said. */
export function offersLabel(count: number): string {
  if (count === 1) return 'عرض واحد'
  if (count === 2) return 'عرضان'
  return `${numberFormat.format(count)} ${count % 100 >= 3 && count % 100 <= 10 ? 'عروض' : 'عرضاً'}`
}

/** «3+» steps for rooms and the like; 0 means any. */
export const COUNT_STEPS = [0, 1, 2, 3, 4, 5]
export const STREET_STEPS = [0, 12, 15, 20, 30]

export const dealOf = (filters: Pick<HomeFilters, 'kind' | 'rentDeal'>): Deal => (filters.kind === 'sale' ? 'sale' : filters.rentDeal)

/** A figure the ad does not state never passes a range or a minimum on it: it is not taken as zero. */
const within = (value: number | null | undefined, low: number | null, high: number | null) =>
  (low == null && high == null) || (value != null && (low == null || value >= low) && (high == null || value <= high))
const atLeast = (value: number | undefined, step: number) => !step || (value ?? 0) >= step

export function applyFilters(listings: Listing[], filters: HomeFilters): Listing[] {
  const kept = listings.filter((l) => isPublishable(l) && within(l.price_sar, filters.minPrice, filters.maxPrice) && within(l.area_sqm, filters.minArea, filters.maxArea)
    && atLeast(l.beds, filters.beds) && atLeast(l.livings, filters.livings) && atLeast(l.wc, filters.wc) && atLeast(l.street_width, filters.street)
    && (!filters.belowMedian || (l.vs_district_pct ?? 0) < 0))
  if (filters.sort === 'best') return kept
  // an ad without the figure a sort reads goes last, in the service's order
  const by = (pick: (l: Listing) => number | null, direction: 1 | -1) => [...kept].sort((a, b) => {
    const x = pick(a), y = pick(b)
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
    return (x - y) * direction
  })
  if (filters.sort === 'price_asc') return by((l) => l.price_sar, 1)
  if (filters.sort === 'price_desc') return by((l) => l.price_sar, -1)
  if (filters.sort === 'area_desc') return by((l) => l.area_sqm, -1)
  return by((l) => l.sar_per_sqm, 1)
}

/** The filters set beyond the deal and the city, each as a chip label and what removing it resets. */
export function activeFilters(filters: HomeFilters, districtName: (id: string) => string): { id: string; label: string; clear: Partial<HomeFilters> }[] {
  const deal = dealOf(filters)
  const period = PERIOD_WORD[deal] ? ` ${PERIOD_WORD[deal]}` : ''
  const range = (low: number | null, high: number | null, unit: string) =>
    low != null && high != null ? `${numberFormat.format(low)}–${numberFormat.format(high)}${unit}` : low != null ? `من ${numberFormat.format(low)}${unit}` : `حتى ${numberFormat.format(high ?? 0)}${unit}`
  const out: { id: string; label: string; clear: Partial<HomeFilters> }[] = []
  if (filters.types.length > 1) out.push({ id: 'types', label: filters.types.map(typeLabel).join('، '), clear: { types: filters.types.slice(0, 1) } })
  for (const id of filters.districts) out.push({ id: `d:${id}`, label: districtName(id), clear: { districts: filters.districts.filter((item) => item !== id) } })
  if (filters.minPrice != null || filters.maxPrice != null) out.push({ id: 'price', label: range(filters.minPrice, filters.maxPrice, ` ريال${period}`), clear: { minPrice: null, maxPrice: null } })
  if (filters.minArea != null || filters.maxArea != null) out.push({ id: 'area', label: range(filters.minArea, filters.maxArea, ' م²'), clear: { minArea: null, maxArea: null } })
  if (filters.beds) out.push({ id: 'beds', label: `${numberFormat.format(filters.beds)}+ غرف`, clear: { beds: 0 } })
  if (filters.livings) out.push({ id: 'livings', label: `${numberFormat.format(filters.livings)}+ صالات`, clear: { livings: 0 } })
  if (filters.wc) out.push({ id: 'wc', label: `${numberFormat.format(filters.wc)}+ دورات مياه`, clear: { wc: 0 } })
  if (filters.street) out.push({ id: 'street', label: `شارع ${numberFormat.format(filters.street)} م فأكثر`, clear: { street: 0 } })
  if (filters.belowMedian) out.push({ id: 'below', label: 'أقل من وسيط الحي', clear: { belowMedian: false } })
  if (filters.sort !== 'best') out.push({ id: 'sort', label: SORTS.find((item) => item.id === filters.sort)?.label ?? '', clear: { sort: 'best' } })
  return out
}
