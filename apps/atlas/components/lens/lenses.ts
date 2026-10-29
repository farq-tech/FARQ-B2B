import type { DistrictRow } from './city-data'
import { residentsPer } from '@/lib/audience'

/**
 * The five user groups of docs/atlas-product-foundation.md. A lens is one journey: its own steps (the tools, in the
 * order a decision takes) and the three figures that shade its map; the analysts' lens keeps every figure.
 */
export type LensId = 'shops' | 'marketers' | 'distributors' | 'analysts' | 'property'

/** The insight tools, named by the question each answers; their results are drawn on the one map. */
export type ToolId = 'district' | 'homes' | 'gaps' | 'competitors' | 'audience' | 'businesses' | 'around' | 'growth' | 'territories' | 'compare'

export type MetricId = 'population' | 'businesses' | 'residentsPerBusiness' | 'income' | 'growth' | 'restaurants' | 'villaShare' | 'menuPrice' | 'unmet' | 'shopRent' | 'homeRent' | 'homeRentMonthly' | 'homePrice' | 'dealPrice' | 'warehouseRent'

// a district median from fewer listings than this is shown in its summary, marked as a small sample, but never shades
// the map or enters a ranking (build_real_estate_reference.RELIABLE_LISTINGS)
export const RELIABLE_LISTINGS = 10
const ranked = (figure?: { median: number; listings: number }) => (figure && figure.listings >= RELIABLE_LISTINGS ? figure.median : null)

export const METRICS: Record<MetricId, { label: string; value: (row: DistrictRow) => number | null; unit?: string }> = {
  population: { label: 'السكان', value: (row) => row.population },
  businesses: { label: 'المنشآت', value: (row) => row.businesses },
  residentsPerBusiness: {
    label: 'ساكن لكل منشأة',
    value: (row) => { const value = residentsPer(row.population, row.businesses); return value == null ? null : Math.round(value) },
  },
  restaurants: { label: 'مطاعم على تطبيقات التوصيل', value: (row) => row.restaurants },
  menuPrice: { label: 'سعر الصنف المعتاد', value: (row) => row.menuPrice, unit: 'ر.س' },
  unmet: { label: 'بحث بلا نتيجة', value: (row) => row.unmetSearches },
  villaShare: { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  // each rent period is its own figure, never converted (services/targeting-api/build_real_estate_reference.py)
  // a shop rent whose ad states no period counts as yearly (services/targeting-api/build_real_estate_reference.py)
  shopRent: { label: 'إيجار متر المحل سنوياً', value: (row) => ranked(row.realEstate.rent_year_commercial), unit: 'ر.س' },
  homeRent: { label: 'إيجار متر السكن سنوياً', value: (row) => ranked(row.realEstate.rent_year_residential), unit: 'ر.س' },
  homeRentMonthly: { label: 'إيجار متر السكن شهرياً', value: (row) => ranked(row.realEstate.rent_month_residential), unit: 'ر.س' },
  homePrice: { label: 'سعر متر السكن للبيع (معروض)', value: (row) => ranked(row.realEstate.sale_residential), unit: 'ر.س' },
  dealPrice: { label: 'سعر متر البيع في الصفقات المسجلة', value: (row) => row.deals.residential?.median ?? null, unit: 'ر.س' },
  warehouseRent: { label: 'إيجار متر المستودع سنوياً', value: (row) => ranked(row.realEstate.rent_year_warehouse), unit: 'ر.س' },
  income: { label: 'متوسط الدخل', value: (row) => row.income, unit: 'ر.س' },
  growth: {
    label: 'مبانٍ جديدة وتحت الإنشاء',
    value: (row) => (row.underConstruction != null && row.newBuildings != null ? row.underConstruction + row.newBuildings : null),
  },
}

export type Lens = { id: LensId; label: string; metric: MetricId; metrics: MetricId[]; steps: { tool: ToolId; label: string }[] }

export const LENSES: Lens[] = [
  {
    id: 'shops', label: 'أصحاب المتاجر', metric: 'residentsPerBusiness', metrics: ['residentsPerBusiness', 'unmet', 'shopRent', 'population'],
    steps: [{ tool: 'gaps', label: 'أين ينقص نشاطي؟' }, { tool: 'competitors', label: 'المنافسون' }, { tool: 'around', label: 'قارن المواقع' }, { tool: 'homes', label: 'محلات للإيجار' }],
  },
  {
    id: 'marketers', label: 'المسوّقون', metric: 'population', metrics: ['population', 'income', 'villaShare'],
    steps: [{ tool: 'audience', label: 'أين جمهوري؟' }, { tool: 'businesses', label: 'منشآت الأحياء والحملة' }],
  },
  {
    id: 'distributors', label: 'الموزّعون', metric: 'businesses', metrics: ['businesses', 'growth', 'warehouseRent'],
    steps: [{ tool: 'territories', label: 'المناطق والمسار' }, { tool: 'growth', label: 'أين يُبنى الآن؟' }],
  },
  {
    id: 'analysts', label: 'المحلّلون', metric: 'population',
    metrics: ['population', 'businesses', 'residentsPerBusiness', 'income', 'villaShare', 'shopRent', 'homeRent', 'homeRentMonthly', 'homePrice', 'dealPrice', 'restaurants', 'menuPrice', 'unmet', 'growth'],
    steps: [{ tool: 'district', label: 'الأحياء والترتيب' }, { tool: 'compare', label: 'قارن حيين' }],
  },
  {
    id: 'property', label: 'الباحثون عن عقار', metric: 'homeRent', metrics: ['homeRent', 'homeRentMonthly', 'homePrice', 'dealPrice'],
    steps: [{ tool: 'homes', label: 'اختر عقاراً' }, { tool: 'district', label: 'تعرّف على الحي' }],
  },
]

export const lensById = (id: LensId) => LENSES.find((lens) => lens.id === id) ?? LENSES[0]
