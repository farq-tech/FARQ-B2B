import { numberFormat } from './insights-api'
import { PALETTE } from '@/lib/palette'

/** A deal as the ad states it: a sale, or a rent with its own period. Nothing is converted between periods. */
export type Deal = 'sale' | 'rent_year' | 'rent_month' | 'rent_unstated'

/** One current listing as the targeting service serves it (build_real_estate_reference.py --listings-out). */
export type Listing = {
  id: string
  url: string | null
  lon: number
  lat: number
  district_id: string | null
  district_ar: string | null
  kind: 'rent' | 'sale' | null
  deal: Deal | null
  group: string
  type: string
  /** As advertised, in the ad's own period; null when the ad gives no price. */
  price_sar: number | null
  area_sqm: number | null
  /** In the ad's own period; null without a price or an area. */
  sar_per_sqm: number | null
  /** Against the district's median for the same deal, period and group; null when there is none. */
  vs_district_pct: number | null
  /** The figures look wrong (a building's area on one flat, a price out of range): shown, never in a median. */
  check: boolean
  /** The service's city name (city_en), the key every other Atlas call takes. */
  city: string
  photo: string | null
  photos: string[]
  address: string | null
  beds?: number
  livings?: number
  wc?: number
  street_width?: number
}

export type ListingKind = 'rent' | 'sale'

export const PERIOD_WORD: Record<Deal, string> = { sale: '', rent_year: 'سنوياً', rent_month: 'شهرياً', rent_unstated: '' }
export const RENT_DEALS: { id: Deal; label: string }[] = [
  { id: 'rent_year', label: 'سنوي' },
  { id: 'rent_month', label: 'شهري' },
  { id: 'rent_unstated', label: 'المدة غير مذكورة' },
]
const GROUP_WORD: Record<string, string> = { residential: 'سكن', commercial: 'محل', office: 'مكتب', warehouse: 'مستودع', land: 'أرض', studio: 'استديو' }

/** «إيجار سكن شهري» for a district group key such as rent_month_residential. */
export function groupLabel(key: string): string {
  const deal = (['rent_year', 'rent_month', 'rent_unstated', 'sale'] as Deal[]).find((item) => key.startsWith(`${item}_`))
  if (!deal) return key
  const what = GROUP_WORD[key.slice(deal.length + 1)] ?? key.slice(deal.length + 1)
  return deal === 'sale' ? `بيع ${what}` : deal === 'rent_unstated' ? `إيجار ${what} (المدة غير مذكورة)` : `إيجار ${what} ${deal === 'rent_year' ? 'سنوي' : 'شهري'}`
}

export const LISTING_TYPES: { id: string; label: string; kinds: ListingKind[] }[] = [
  { id: 'room', label: 'غرفة', kinds: ['rent'] },
  { id: 'apartment', label: 'شقة', kinds: ['rent', 'sale'] },
  { id: 'floor', label: 'دور', kinds: ['rent', 'sale'] },
  { id: 'villa', label: 'فيلا', kinds: ['rent', 'sale'] },
  { id: 'store', label: 'محل', kinds: ['rent', 'sale'] },
  { id: 'office', label: 'مكتب', kinds: ['rent', 'sale'] },
  { id: 'warehouse', label: 'مستودع', kinds: ['rent', 'sale'] },
  { id: 'land', label: 'أرض', kinds: ['sale'] },
]

export const typeLabel = (type: string) => LISTING_TYPES.find((item) => item.id === type)?.label ?? 'عقار'

/** Budget steps by deal, in the ad's own period. */
export const BUDGETS: Record<Deal, number[]> = {
  rent_year: [30000, 50000, 80000, 120000, 200000],
  rent_month: [2000, 3000, 5000, 8000, 12000],
  rent_unstated: [30000, 50000, 80000, 120000, 200000],
  sale: [700000, 1000000, 1500000, 2500000, 4000000],
}

export const sar = (value: number) => `${numberFormat.format(Math.round(value))} ريال`
/** The price as the ad gives it, with its period: «3,500 ريال شهرياً», «… · المدة غير مذكورة», «السعر غير مذكور». */
export function priceLine(listing: Pick<Listing, 'deal' | 'price_sar'>): string {
  if (listing.price_sar == null) return 'السعر غير مذكور'
  const word = listing.deal ? PERIOD_WORD[listing.deal] : ''
  return `${sar(listing.price_sar)}${word ? ` ${word}` : listing.deal === 'rent_unstated' ? ' · المدة غير مذكورة' : ''}`
}
export const perSqmLine = (listing: Pick<Listing, 'deal' | 'sar_per_sqm'>) =>
  listing.sar_per_sqm == null ? null : `${sar(listing.sar_per_sqm)} للمتر${listing.deal && PERIOD_WORD[listing.deal] ? ` ${PERIOD_WORD[listing.deal]}` : ''}`

/** «أقل من وسيط الحي بـ 12%» / «أعلى …» / «قريب من …», or null when the district has no median. */
export function versusDistrict(listing: Pick<Listing, 'vs_district_pct' | 'district_ar'>): { text: string; tone: 'good' | 'even' | 'high' } | null {
  const pct = listing.vs_district_pct
  if (pct == null) return null
  if (Math.abs(pct) < 5) return { text: `قريب من وسيط ${listing.district_ar}`, tone: 'even' }
  return pct < 0
    ? { text: `أقل من وسيط ${listing.district_ar} بـ ${numberFormat.format(-pct)}%`, tone: 'good' }
    : { text: `أعلى من وسيط ${listing.district_ar} بـ ${numberFormat.format(pct)}%`, tone: 'high' }
}

/** Map dot colour by price against the district: green under, grey near, amber over, blue without a median, dark
 * grey when the ad's figures need checking. */
export const toneColor = { good: PALETTE.leaf, even: PALETTE.stone, high: PALETTE.ochre, none: PALETTE.slate, check: PALETTE.bark } as const
