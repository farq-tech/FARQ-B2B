import type { DistrictRow } from './city-data'

/**
 * The five user groups of docs/atlas-product-foundation.md. A lens is one journey: its own steps (the tools, in the
 * order a decision takes) and the three figures that shade its map; the analysts' lens keeps every figure.
 */
export type LensId = 'shops' | 'marketers' | 'distributors' | 'analysts' | 'property'

/** The insight tools, named by the question each answers; their results are drawn on the one map. */
export type ToolId = 'district' | 'homes' | 'gaps' | 'competitors' | 'audience' | 'businesses' | 'around' | 'growth' | 'territories' | 'compare'

export type MetricId = 'population' | 'businesses' | 'residentsPerBusiness' | 'income' | 'growth' | 'restaurants' | 'villaShare' | 'shopRent' | 'shopRentUnstated' | 'homeRent' | 'homeRentMonthly' | 'homePrice' | 'warehouseRent'

export const METRICS: Record<MetricId, { label: string; value: (row: DistrictRow) => number | null; unit?: string }> = {
  population: { label: 'السكان', value: (row) => row.population },
  businesses: { label: 'المنشآت', value: (row) => row.businesses },
  residentsPerBusiness: {
    label: 'ساكن لكل منشأة',
    value: (row) => (row.population != null && row.businesses ? Math.round(row.population / row.businesses) : null),
  },
  restaurants: { label: 'مطاعم على تطبيقات التوصيل', value: (row) => row.restaurants },
  villaShare: { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  // each rent period is its own figure, never converted (services/targeting-api/build_real_estate_reference.py)
  shopRent: { label: 'إيجار متر المحل سنوياً', value: (row) => row.realEstate.rent_year_commercial?.median ?? null, unit: 'ر.س' },
  shopRentUnstated: { label: 'إيجار متر المحل (المدة غير مذكورة)', value: (row) => row.realEstate.rent_unstated_commercial?.median ?? null, unit: 'ر.س' },
  homeRent: { label: 'إيجار متر السكن سنوياً', value: (row) => row.realEstate.rent_year_residential?.median ?? null, unit: 'ر.س' },
  homeRentMonthly: { label: 'إيجار متر السكن شهرياً', value: (row) => row.realEstate.rent_month_residential?.median ?? null, unit: 'ر.س' },
  homePrice: { label: 'سعر متر السكن للبيع', value: (row) => row.realEstate.sale_residential?.median ?? null, unit: 'ر.س' },
  warehouseRent: { label: 'إيجار متر المستودع سنوياً', value: (row) => row.realEstate.rent_year_warehouse?.median ?? null, unit: 'ر.س' },
  income: { label: 'متوسط الدخل', value: (row) => row.income, unit: 'ر.س' },
  growth: {
    label: 'مبانٍ جديدة وتحت الإنشاء',
    value: (row) => (row.underConstruction != null && row.newBuildings != null ? row.underConstruction + row.newBuildings : null),
  },
}

export type Lens = { id: LensId; label: string; metric: MetricId; metrics: MetricId[]; steps: { tool: ToolId; label: string }[] }

export const LENSES: Lens[] = [
  {
    id: 'shops', label: 'أصحاب المتاجر', metric: 'residentsPerBusiness', metrics: ['residentsPerBusiness', 'shopRentUnstated', 'population'],
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
    metrics: ['population', 'businesses', 'residentsPerBusiness', 'income', 'villaShare', 'shopRent', 'shopRentUnstated', 'homeRent', 'homeRentMonthly', 'homePrice', 'restaurants', 'growth'],
    steps: [{ tool: 'district', label: 'الأحياء والترتيب' }, { tool: 'compare', label: 'قارن حيين' }],
  },
  {
    id: 'property', label: 'الباحثون عن عقار', metric: 'homeRent', metrics: ['homeRent', 'homeRentMonthly', 'homePrice'],
    steps: [{ tool: 'homes', label: 'اختر عقاراً' }, { tool: 'district', label: 'تعرّف على الحي' }],
  },
]

export const lensById = (id: LensId) => LENSES.find((lens) => lens.id === id) ?? LENSES[0]
