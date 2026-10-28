import { numberFormat } from './insights-api'

/** One current listing as the targeting service serves it (build_real_estate_reference.py --listings-out). */
export type Listing = {
  id: string
  url: string | null
  lon: number
  lat: number
  district_id: string
  district_ar: string
  kind: 'rent' | 'sale'
  group: string
  type: string
  /** For rent, the yearly rent whatever period the ad was written in. */
  price_sar: number
  area_sqm: number
  /** For rent, per m² per year. */
  sar_per_sqm: number
  /** Against the district's median for the same deal and group; null when the district has no median. */
  vs_district_pct: number | null
  photo: string | null
  address: string | null
  beds?: number
  livings?: number
  wc?: number
  street_width?: number
}

export type ListingKind = Listing['kind']

export const LISTING_TYPES: { id: string; label: string; kinds: ListingKind[] }[] = [
  { id: 'apartment', label: 'شقة', kinds: ['rent', 'sale'] },
  { id: 'floor', label: 'دور', kinds: ['rent', 'sale'] },
  { id: 'villa', label: 'فيلا', kinds: ['rent', 'sale'] },
  { id: 'store', label: 'محل', kinds: ['rent', 'sale'] },
  { id: 'office', label: 'مكتب', kinds: ['rent', 'sale'] },
  { id: 'warehouse', label: 'مستودع', kinds: ['rent', 'sale'] },
  { id: 'land', label: 'أرض', kinds: ['sale'] },
]

export const typeLabel = (type: string) => LISTING_TYPES.find((item) => item.id === type)?.label ?? 'عقار'

/** Budget steps: rent per year, sale in total. */
export const BUDGETS: Record<ListingKind, number[]> = {
  rent: [30000, 50000, 80000, 120000, 200000],
  sale: [700000, 1000000, 1500000, 2500000, 4000000],
}

export const sar = (value: number) => `${numberFormat.format(Math.round(value))} ريال`
export const priceLine = (listing: Pick<Listing, 'kind' | 'price_sar'>) => `${sar(listing.price_sar)}${listing.kind === 'rent' ? ' سنوياً' : ''}`

/** «أقل من وسيط الحي بـ 12%» / «أعلى …» / «قريب من …», or null when the district has no median. */
export function versusDistrict(listing: Pick<Listing, 'vs_district_pct' | 'district_ar'>): { text: string; tone: 'good' | 'even' | 'high' } | null {
  const pct = listing.vs_district_pct
  if (pct == null) return null
  if (Math.abs(pct) < 5) return { text: `قريب من وسيط ${listing.district_ar}`, tone: 'even' }
  return pct < 0
    ? { text: `أقل من وسيط ${listing.district_ar} بـ ${numberFormat.format(-pct)}%`, tone: 'good' }
    : { text: `أعلى من وسيط ${listing.district_ar} بـ ${numberFormat.format(pct)}%`, tone: 'high' }
}

/** Map dot colour by price against the district: green under, grey near, amber over, blue without a median. */
export const toneColor = { good: '#25c99a', even: '#a1a1aa', high: '#f59e0b', none: '#60a5fa' } as const
