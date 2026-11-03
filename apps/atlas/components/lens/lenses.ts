import type { CityTable, DistrictRow } from './city-data'

/**
 * The five user groups of docs/atlas-product-foundation.md. A lens is one journey: its own steps (the tools, in the
 * order a decision takes) and the three figures that shade its map; the analysts' lens keeps every figure.
 */
export type LensId = 'shops' | 'marketers' | 'distributors' | 'analysts' | 'property'

/** The insight tools, named by the question each answers; their results are drawn on the one map. */
export type ToolId = 'district' | 'homes' | 'gaps' | 'competitors' | 'audience' | 'businesses' | 'around' | 'growth' | 'territories' | 'compare' | 'corridors'

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
    // residents ÷ businesses, computed once in the service (server.py enrich_district_counts); rounded only for display
    value: (row) => (row.residentsPerBusiness == null ? null : Math.round(row.residentsPerBusiness)),
  },
  restaurants: { label: 'مطاعم على تطبيقات التوصيل', value: (row) => row.restaurants },
  menuPrice: { label: 'سعر الصنف المعتاد', value: (row) => row.menuPrice, unit: 'ريال' },
  unmet: { label: 'بحث بلا نتيجة', value: (row) => row.unmetSearches },
  villaShare: { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  // each rent period is its own figure, never converted (services/targeting-api/build_real_estate_reference.py)
  // a shop rent whose ad states no period counts as yearly (services/targeting-api/build_real_estate_reference.py)
  shopRent: { label: 'إيجار متر المحل سنوياً', value: (row) => ranked(row.realEstate.rent_year_commercial), unit: 'ريال' },
  homeRent: { label: 'إيجار متر السكن سنوياً', value: (row) => ranked(row.realEstate.rent_year_residential), unit: 'ريال' },
  homeRentMonthly: { label: 'إيجار متر السكن شهرياً', value: (row) => ranked(row.realEstate.rent_month_residential), unit: 'ريال' },
  homePrice: { label: 'سعر متر السكن للبيع (معروض)', value: (row) => ranked(row.realEstate.sale_residential), unit: 'ريال' },
  dealPrice: { label: 'سعر متر البيع في الصفقات المسجلة', value: (row) => row.deals.residential?.median ?? null, unit: 'ريال' },
  warehouseRent: { label: 'إيجار متر المستودع سنوياً', value: (row) => ranked(row.realEstate.rent_year_warehouse), unit: 'ريال' },
  income: { label: 'متوسط الدخل', value: (row) => row.income, unit: 'ريال' },
  growth: {
    label: 'مبانٍ جديدة وتحت الإنشاء',
    value: (row) => (row.underConstruction != null && row.newBuildings != null ? row.underConstruction + row.newBuildings : null),
  },
}

/** The table each figure arrives in (city-data.ts): a figure whose table failed to load reads «تعذّر التحميل», not «غير متاح». */
export const METRIC_TABLE: Record<MetricId, CityTable> = {
  population: 'population', businesses: 'counts', residentsPerBusiness: 'counts', restaurants: 'restaurants', menuPrice: 'menuPrices',
  unmet: 'demand', villaShare: 'housing', shopRent: 'realEstate', homeRent: 'realEstate', homeRentMonthly: 'realEstate', homePrice: 'realEstate',
  dealPrice: 'deals', warehouseRent: 'realEstate', income: 'income', growth: 'growth',
}

/**
 * Whether a figure can colour this city's map: `loading` while its table is being asked, `failed` when it did not load this time (worth a retry),
 * `missing` when it loaded and no district has it (said «غير متاح»), `ready` otherwise.
 */
export function metricAvailability(id: MetricId, rows: DistrictRow[], failed: readonly CityTable[], pending: readonly CityTable[] = []): 'ready' | 'loading' | 'failed' | 'missing' {
  if (pending.includes(METRIC_TABLE[id])) return 'loading'
  if (failed.includes(METRIC_TABLE[id])) return 'failed'
  return rows.length && !rows.some((row) => METRICS[id].value(row) != null) ? 'missing' : 'ready'
}

export type Lens = { id: LensId; label: string; metric: MetricId; metrics: MetricId[]; steps: { tool: ToolId; label: string }[] }

export const LENSES: Lens[] = [
  {
    id: 'shops', label: 'أصحاب المتاجر', metric: 'residentsPerBusiness', metrics: ['residentsPerBusiness', 'unmet', 'shopRent', 'population'],
    steps: [{ tool: 'gaps', label: 'أين ينقص نشاطي؟' }, { tool: 'competitors', label: 'المنافسون' }, { tool: 'corridors', label: 'شوارع النشاط' }, { tool: 'around', label: 'قارن المواقع' }, { tool: 'homes', label: 'محلات للإيجار' }],
  },
  {
    id: 'marketers', label: 'المسوّقون', metric: 'population', metrics: ['population', 'income', 'villaShare'],
    steps: [{ tool: 'audience', label: 'أين جمهوري؟' }, { tool: 'businesses', label: 'منشآت الأحياء والحملة' }],
  },
  {
    id: 'distributors', label: 'الموزّعون', metric: 'businesses', metrics: ['businesses', 'growth', 'warehouseRent'],
    steps: [{ tool: 'territories', label: 'المناطق والمسار' }, { tool: 'corridors', label: 'شوارع النشاط' }, { tool: 'growth', label: 'أين يُبنى الآن؟' }],
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

/**
 * Each lens said as the visitor's goal, in one voice (simple modern Arabic, first person). The landing's goal cards and
 * the map's first-visit row both read it, so the goal picked on one is the goal named on the other.
 */
export const LENS_GOALS: Record<LensId, string> = {
  shops: 'أفتح محلاً أو أوسّع نشاطي',
  marketers: 'أصل إلى جمهوري بحملة',
  distributors: 'أوزّع وأغطّي المناطق',
  analysts: 'أفهم السوق والأحياء',
  property: 'أبحث عن عقار مناسب',
}

/**
 * What each step takes from the steps before it: the studied activity (lib/sticky-state, shared by every step) and the
 * districts picked on the map. «التالي» names what it carries into the next step. `pickAnswers` marks a step whose
 * answer is the picked districts' summary, so it counts as done once a district is picked on it.
 */
export const TOOL_INPUTS: Record<ToolId, { activity?: boolean; district?: boolean; pickAnswers?: boolean }> = {
  gaps: { activity: true, district: true },
  competitors: { activity: true, district: true },
  corridors: { activity: true },
  around: { activity: true },
  homes: { district: true },
  audience: { district: true },
  businesses: { district: true, pickAnswers: true },
  territories: {},
  growth: { district: true, pickAnswers: true },
  district: { district: true, pickAnswers: true },
  compare: { district: true, pickAnswers: true },
}

/** The step after `tool` in the lens's journey, or null on its last step (or a tool the lens does not have). */
export function nextStep(lens: Lens, tool: ToolId): Lens['steps'][number] | null {
  const at = lens.steps.findIndex((step) => step.tool === tool)
  return at < 0 ? null : lens.steps[at + 1] ?? null
}
