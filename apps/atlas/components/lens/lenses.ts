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

/**
 * One step of a journey: its tool, its tab's words, and `ask`, what the customer does on it to get its answer. The ask
 * is said where the step has no answer yet (the phone's peeking sheet), instead of a figure the step never asked about.
 */
export type JourneyStep = { tool: ToolId; label: string; ask: string }

export type Lens = { id: LensId; label: string; metric: MetricId; metrics: MetricId[]; steps: JourneyStep[] }

export const LENSES: Lens[] = [
  {
    id: 'shops', label: 'أصحاب المتاجر', metric: 'residentsPerBusiness', metrics: ['residentsPerBusiness', 'unmet', 'shopRent', 'population'],
    steps: [
      { tool: 'gaps', label: 'أين ينقص نشاطي؟', ask: 'اختر نشاطك فتتلوّن الأحياء التي ينقصها' },
      { tool: 'competitors', label: 'المنافسون', ask: 'اختر نشاطك لترى منافسيك في كل حي' },
      { tool: 'corridors', label: 'شوارع النشاط', ask: 'اختر نشاطك لترى الشوارع التي يتجمع فيها' },
      { tool: 'around', label: 'قارن المواقع', ask: 'اضغط على الخريطة لتضع موقعاً مرشحاً' },
      { tool: 'homes', label: 'محلات للإيجار', ask: 'اختر الميزانية لترى المحلات المعروضة' },
    ],
  },
  {
    id: 'marketers', label: 'المسوّقون', metric: 'population', metrics: ['population', 'income', 'villaShare'],
    steps: [
      { tool: 'audience', label: 'أين جمهوري؟', ask: 'اختر جمهورك فتتلوّن الأحياء الأكثر مطابقة' },
      { tool: 'businesses', label: 'منشآت الأحياء والحملة', ask: 'اختر حياً لترى منشآته وتجهّز حملتك' },
    ],
  },
  {
    id: 'distributors', label: 'الموزّعون', metric: 'businesses', metrics: ['businesses', 'growth', 'warehouseRent'],
    steps: [
      { tool: 'territories', label: 'المناطق والمسار', ask: 'حدد نشاط عملائك وعدد المندوبين' },
      { tool: 'corridors', label: 'شوارع النشاط', ask: 'اختر نشاط عملائك لترى الشوارع التي يتجمعون فيها' },
      { tool: 'growth', label: 'أين يُبنى الآن؟', ask: 'اضغط حياً لترى البناء الجاري فيه' },
    ],
  },
  {
    id: 'analysts', label: 'المحلّلون', metric: 'population',
    metrics: ['population', 'businesses', 'residentsPerBusiness', 'income', 'villaShare', 'shopRent', 'homeRent', 'homeRentMonthly', 'homePrice', 'dealPrice', 'restaurants', 'menuPrice', 'unmet', 'growth'],
    steps: [
      { tool: 'district', label: 'الأحياء والترتيب', ask: 'اختر مقياساً من «طبقات»، واضغط حياً لملخصه' },
      { tool: 'compare', label: 'قارن حيين', ask: 'اختر حيين لتقارن بينهما' },
    ],
  },
  {
    id: 'property', label: 'الباحثون عن عقار', metric: 'homeRent', metrics: ['homeRent', 'homeRentMonthly', 'homePrice', 'dealPrice'],
    steps: [
      { tool: 'homes', label: 'اختر عقاراً', ask: 'اختر إيجاراً أو شراءً والنوع والميزانية' },
      { tool: 'district', label: 'تعرّف على الحي', ask: 'اضغط حياً لتتعرّف عليه' },
    ],
  },
]

/**
 * What a step that takes a district can start from when none is picked yet: the district an earlier step of the same
 * journey put first (its `lead`), so the answer the customer just saw is one tap from the next question. The nearest
 * earlier step wins; a lead the city's districts do not hold is skipped. Null when there is nothing to offer.
 */
export function journeyStart(lens: Lens, tool: ToolId, leads: Partial<Record<ToolId, string>>, known: (id: string) => boolean): { id: string; from: JourneyStep } | null {
  if (!TOOL_INPUTS[tool]?.district) return null
  const at = lens.steps.findIndex((step) => step.tool === tool)
  for (let index = at - 1; index >= 0; index--) {
    const from = lens.steps[index]
    const id = leads[from.tool]
    if (id && known(id)) return { id, from }
  }
  return null
}

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

/**
 * The tables each step reads from the district rows besides the golden two (population and the directory's counts,
 * which every step, card and pick reads). A city's other tables wait until these have answered and the page is idle:
 * the map opened with eleven requests at once, most of them for layers nobody was looking at.
 */
export const STEP_TABLES: Record<ToolId, CityTable[]> = {
  gaps: [], competitors: [], corridors: [], homes: [], territories: [], businesses: [], district: [],
  audience: ['income'],
  around: ['income', 'housing'],
  growth: ['growth'],
  compare: ['income', 'housing', 'realEstate', 'growth'],
}

/** The tables the open step cannot answer without: a failure among them is said over the panel. A layer that failed
 * is said in the map's key once picked, and marked «غير متاح الآن» in «طبقات» until then. */
export function stepTables(tool: ToolId): CityTable[] {
  return ['population', 'counts', ...STEP_TABLES[tool]]
}

/** What the open step and the layer in view need first, the layer's table ahead (it colours the map). */
export function neededTables(tool: ToolId, metric: MetricId): CityTable[] {
  return [...new Set<CityTable>([METRIC_TABLE[metric], ...stepTables(tool)])]
}
