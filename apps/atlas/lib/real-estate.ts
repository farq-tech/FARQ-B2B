import { numberFormat, percent } from './insights-api'
import { PALETTE } from '@/lib/palette'

/** A deal as the ad states it: a sale, or a rent with its own period. Nothing is converted between periods. */
export type Deal = 'sale' | 'rent_year' | 'rent_month' | 'rent_unstated'

export type MarketSignal = {
  kind: 'cheaper_area' | 'rent_under_value' | 'rent_over_value'
  label: string
  /** The district's median rent per m² against its nearest districts'. */
  rent_pct: number
  /** Its registered deals' median price per m² against its nearest districts'. */
  deal_pct: number
  neighbours: string[]
  /** The nearest districts with registered deals, which the deal figure is measured against. */
  deal_neighbours?: string[]
}

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
  /** The building's age in years (0 = new); absent when the ad states none. */
  age?: number
  /** Where the age came from: Aqar's own field, or read from the ad's description. */
  age_source?: 'aqar' | 'text'
  /** Who may live there, for a rental that states it (Aqar's field, the ad's text where it names a side). */
  tenants?: Tenants
  /** What the property has as the ad's form records it: 1 has, 0 lacks; an unstated feature is absent. */
  features?: Partial<Record<Feature, 0 | 1>>
  /** When the ad went up and when it was last updated (YYYY-MM-DD). */
  listed_on?: string
  updated_on?: string
  /** The ad carries the real-estate authority's advertising licence. */
  licensed?: boolean
  /** Its district's market signal for its type (market_signals.py), or null: rent against the nearest districts read
   * with the prices paid there. Only yearly rent carries one. */
  signal?: MarketSignal | null
}

export type ListingKind = 'rent' | 'sale'

export type Tenants = 'families' | 'singles' | 'both'
export const TENANTS_LABEL: Record<Tenants, string> = { families: 'للعوائل', singles: 'للعزاب', both: 'عوائل وعزاب' }

/** The features a card lists, in the order a person reads them. */
export const FEATURES = [
  ['furnished', 'مفروش'], ['ketchen', 'مطبخ'], ['ac', 'مكيفات'], ['lift', 'مصعد'], ['car_entrance', 'مدخل سيارة'],
  ['extra_unit', 'ملحق'], ['two_entrances', 'مدخلان'], ['private_roof', 'سطح خاص'], ['stairs', 'درج داخلي'],
  ['maid', 'غرفة خادمة'], ['driver', 'غرفة سائق'], ['backyard', 'حوش'], ['pool', 'مسبح'], ['basement', 'قبو'], ['tent', 'خيمة'],
] as const
export type Feature = (typeof FEATURES)[number][0]

/** «منذ 3 أيام» for a YYYY-MM-DD date, counted in whole days; null without one. */
export function daysAgo(day: string | undefined, now = new Date()) {
  if (!day) return null
  const days = Math.floor((now.getTime() - Date.parse(`${day}T00:00:00Z`)) / 86400000)
  if (!Number.isFinite(days) || days < 0) return null
  if (days === 0) return 'اليوم'
  if (days === 1) return 'أمس'
  if (days < 30) return `منذ ${counted(days, 'يوم', 'يومين', 'أيام', 'يوماً')}`
  if (days < 365) return `منذ ${counted(Math.max(1, Math.round(days / 30)), 'شهر', 'شهرين', 'أشهر', 'شهراً')}`
  return `منذ ${counted(Math.round(days / 365), 'سنة', 'سنتين', 'سنوات', 'سنة')}`
}

/** «شهر»، «شهرين»، «3 أشهر»، «11 شهراً»: a count the way it is said. */
function counted(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one
  if (n === 2) return two
  return `${numberFormat.format(n)} ${n % 100 >= 3 && n % 100 <= 10 ? few : many}`
}

/** What Atlas shows of a listing: a price, a stated period, at least one photo, and figures that need no checking.
 * The service serves only these; the same test here keeps an older service answer to the same standard. */
export const isPublishable = (listing: Listing) =>
  !listing.check && listing.price_sar != null && listing.deal !== 'rent_unstated' && ((listing.photos?.length ?? 0) > 0 || !!listing.photo)

export const PERIOD_WORD: Record<Deal, string> = { sale: '', rent_year: 'سنوياً', rent_month: 'شهرياً', rent_unstated: '' }
export const RENT_DEALS: { id: Deal; label: string }[] = [
  { id: 'rent_year', label: 'سنوي' },
  { id: 'rent_month', label: 'شهري' },
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

/** «جديد»، «سنة»، «سنتان»، «5 سنوات»، «12 سنة»: a building's age the way it is said; «غير متاح» when unstated. */
export function ageLabel(age: number | null | undefined): string {
  if (age == null) return 'غير متاح'
  if (age === 0) return 'جديد'
  if (age === 1) return 'سنة'
  if (age === 2) return 'سنتان'
  return `${numberFormat.format(age)} ${age <= 10 ? 'سنوات' : 'سنة'}`
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
    ? { text: `أقل من وسيط ${listing.district_ar} بـ ${percent(-pct)}`, tone: 'good' }
    : { text: `أعلى من وسيط ${listing.district_ar} بـ ${percent(pct)}`, tone: 'high' }
}

/** Map dot colour by price against the district: green under, grey near, amber over, blue without a median, dark
 * grey when the ad's figures need checking. */
export const toneColor = { good: PALETTE.leaf, even: PALETTE.stone, high: PALETTE.ochre, none: PALETTE.slate, check: PALETTE.bark } as const

// in words, not a sign: «+22%» flips to «22%+» inside an Arabic line
const versusWords = (pct: number) => pct === 0 ? 'مثل' : `${pct < 0 ? 'أقل' : 'أعلى'} بـ ${percent(Math.abs(pct))} من`
/** What the signal rests on, for its explanation: the two figures and the districts they are measured against. */
export function signalLines(signal: MarketSignal, type: string): string[] {
  // a service from before deal_neighbours compared the deals with the rent neighbours' list
  const dealNeighbours = signal.deal_neighbours ?? signal.neighbours
  return [
    `إيجار ${typeLabel(type)} المعروض في الحي ${versusWords(signal.rent_pct)} أقرب ${numberFormat.format(signal.neighbours.length)} أحياء: ${signal.neighbours.join('، ')}.`,
    dealNeighbours.join() === signal.neighbours.join()
      ? `سعر المتر في صفقات البيع السكنية المسجلة (وزارة العدل) ${versusWords(signal.deal_pct)} نفس الجيران.`
      : `سعر المتر في صفقات البيع السكنية المسجلة (وزارة العدل) ${versusWords(signal.deal_pct)} أقرب ${numberFormat.format(dealNeighbours.length)} أحياء لها صفقات: ${dealNeighbours.join('، ')}.`,
    {
      cheaper_area: 'الإيجار والبيع كلاهما أقل: الحي نفسه أرخص، لا الإعلانات وحدها.',
      rent_under_value: 'الإيجار أقل مما يباع به الحي: مكسب للمستأجر، وعائد أقل لمن يشتري ليؤجر. قد يعني أيضاً مباني أقدم.',
      rent_over_value: 'الإيجار أعلى مما يباع به الحي: عائد أعلى لمن يشتري ليؤجر.',
    }[signal.kind],
    'وصف للحي كله لا لهذا العرض وحده، ولا يظهر إلا إذا ثبت عند إعادة الحساب على عينات مختلفة من الإعلانات.',
  ]
}
