import { counted, numberFormat } from '../../../lib/insights-api.ts'

/**
 * The one-line answers and the «أرني الأعلى» district the tools hand to the map, kept apart from the components so
 * they are tested (tool-answers.test.ts). Every figure is the service's, through numberFormat; a missing one reads
 * «غير متاح», never 0.
 */

type District = { id: string; name: string }

/** A district's competitors for the studied activity, as competitors-tool ranks them. */
export type CompetitorRow = { row: District; competitors: number; perKm2: number | null }

/** The district where the activity is densest per km², among those that have it; null when none has a density. */
export function densestDistrict<T extends CompetitorRow>(table: T[]): T | null {
  return table.reduce<T | null>((top, item) => (item.perKm2 != null && item.competitors > 0 && (top?.perKm2 == null || item.perKm2 > top.perKm2) ? item : top), null)
}

/**
 * The districts as «المنافسون» lists them. «dense»: those with the activity, most competitors per km² first.
 * «light»: the populated districts, and a district with none of the activity is the lightest of all (no competitor at
 * all, whatever its area), so it comes first, the most populous of them first; then the fewest per km², and a district
 * whose density is unknown (no area) last.
 */
export function rankCompetition<T extends CompetitorRow & { row: { population: number | null } }>(table: T[], order: 'dense' | 'light'): T[] {
  if (order === 'dense') return table.filter((item) => item.competitors > 0).sort((a, b) => (b.perKm2 ?? -1) - (a.perKm2 ?? -1))
  const lightness = (item: T) => (item.competitors === 0 ? -1 : item.perKm2 ?? Infinity)
  return table.filter((item) => item.row.population != null)
    .sort((a, b) => lightness(a) - lightness(b) || (b.row.population ?? 0) - (a.row.population ?? 0))
}

/**
 * «1,234 منشأة «صيدلية» في المدينة · الأكثر تنافساً: العليا», or (the list ordered by the lightest competition)
 * «… · الأخف منافسة: وادي لبن», so the peek line names the same district as the verdict over the list.
 */
export function competitorsSummary(cityTotal: number | null, label: string, top: CompetitorRow | null, order: 'dense' | 'light' = 'dense'): string {
  const total = cityTotal == null ? `عدد منشآت «${label}» غير متاح` : `${numberFormat.format(cityTotal)} منشأة «${label}» في المدينة`
  return `${total}${top ? ` · ${order === 'light' ? 'الأخف منافسة' : 'الأكثر تنافساً'}: ${top.row.name}` : ''}`
}

/** One district's count for each of two activities («قارن بنشاط آخر»). */
export type Pair<R extends District = District> = { row: R; a: number; b: number }

/**
 * Both activities' counts per district. district-counts lists only districts that have the activity, so a district
 * it leaves out has none of it (0); a district with neither is left out. «gap» puts first where the first activity
 * outnumbers the second the most; «first» orders by the first activity alone.
 */
export function comparePairs<R extends District>(rows: R[], first: { district_ar: string; n: number }[], second: { district_ar: string; n: number }[], order: 'gap' | 'first'): Pair<R>[] {
  const a = new Map(first.map((count) => [count.district_ar, count.n]))
  const b = new Map(second.map((count) => [count.district_ar, count.n]))
  return rows
    .map((row) => ({ row, a: a.get(row.name) ?? 0, b: b.get(row.name) ?? 0 }))
    .filter((item) => item.a > 0 || item.b > 0)
    .sort((x, y) => (order === 'gap' ? (y.a - y.b) - (x.a - x.b) || y.a - x.a : y.a - x.a || y.b - x.b))
}

/**
 * Where an audience total was counted. A district without a measured population or segment share is left out of the
 * sum, so when some are out the total says how many it covers («في 180 من 186 حياً مقاسة») instead of «في المدينة»:
 * a partial sum is never shown as the whole. `measured` districts were summed out of `scope` in view (the selected
 * ones, or the city's).
 */
export function audienceWhere({ selected, measured, scope }: { selected: number; measured: number; scope: number }): string {
  if (measured >= scope) return selected ? `في ${counted(selected, 'district')} محددة` : 'في المدينة'
  return `في ${numberFormat.format(measured)} من ${counted(scope, 'district')}${selected ? ' محددة' : ''} مقاسة`
}

/** «حجم الجمهور في المدينة: 120,400 شخص · الأعلى: النرجس»; the sizes are the service's segment figures, one per measured district. */
export function audienceSummary({ selected, scope, segment, sizes, unit, top, cityTotal }: {
  selected: number; scope: number; segment: string; sizes: number[]; unit: string; top: string | null
  /**
   * Businesses over the whole city: the service's own city count, which includes businesses with no known district,
   * so the line agrees with «المنافسون». null reads «غير متاح»; left out, the districts' sizes are summed.
   */
  cityTotal?: number | null
}): string {
  if (cityTotal !== undefined && !selected) {
    return cityTotal == null ? 'حجم الجمهور: غير متاح' : `حجم الجمهور في المدينة: ${numberFormat.format(cityTotal)} ${unit}${top ? ` · الأعلى: ${top}` : ''}`
  }
  if (!sizes.length) return `حجم الجمهور: ${segment ? `${segment}: ` : ''}غير متاح`
  const where = audienceWhere({ selected, measured: sizes.length, scope })
  const size = `${numberFormat.format(Math.round(sizes.reduce((sum, value) => sum + value, 0)))} ${unit}`
  return `حجم الجمهور ${where}: ${segment ? `${segment}: ` : ''}${size}${top ? ` · الأعلى: ${top}` : ''}`
}

/** «خطة الأسبوع: 96 زيارة على 5 أيام». */
export function weekSummary(visits: number, days: number): string {
  const span = days === 1 ? 'يوم واحد' : days === 2 ? 'يومين' : `${numberFormat.format(days)} أيام`
  return `خطة الأسبوع: ${numberFormat.format(visits)} زيارة على ${span}`
}

/**
 * The territories step's peek line: «5 مناطق متوازنة بالمنشآت» once the split is in, «تعذر التقسيم» when it failed,
 * and nothing while it loads or when it came back empty. It never reads «0 مناطق».
 */
export function territoriesSummary(status: 'idle' | 'loading' | 'error', groups: number | null, weight: string): string | null {
  if (status === 'error') return 'تعذر التقسيم'
  if (status === 'loading' || !groups) return null
  return `${numberFormat.format(groups)} مناطق متوازنة ${weight === 'population' ? 'بالسكان' : 'بالمنشآت'}`
}

/** A drive or a route's time: «45 دقيقة», «2 ساعة», «1 ساعة 20 دقيقة»; a whole hour never reads «… 0 دقيقة». */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${numberFormat.format(minutes)} دقيقة`
  const hours = `${numberFormat.format(Math.floor(minutes / 60))} ساعة`
  return minutes % 60 ? `${hours} ${numberFormat.format(minutes % 60)} دقيقة` : hours
}

/**
 * Whether two studied activities are the same one: the same typed words, the same main activity, or the same name.
 * «قارن بنشاط آخر» refuses to compare an activity with itself (a list of zero gaps).
 */
export function sameActivity(a: { q?: string; main_id?: string; label: string }, b: { q?: string; main_id?: string; label: string }): boolean {
  if (a.q && b.q) return a.q.trim() === b.q.trim()
  if (a.main_id != null && a.main_id === b.main_id) return true
  return a.label.trim() === b.label.trim()
}

/**
 * What «أين جمهوري؟» cannot measure in this city when no district has a figure for the filters: the population
 * itself, the income (a minimum income set), or the measured share asked for. null when some district has a figure.
 * The wording names what is missing; the panel says it «غير متاح» with what still works, never a 0.
 */
export function audienceMissing({ rows, scored, sex, nationality, minIncome }: {
  rows: { population: number | null; income: number | null }[]; scored: number; sex: string; nationality: string; minIncome: number
}): { what: string; body: string } | null {
  if (!rows.length || scored > 0) return null
  const instead = { people: 'جرّب «أستهدف منشآت»: المنشآت تُعدّ في كل مدينة.', income: 'اختر «أي دخل» لترى الأحياء بسكانها.', share: 'اختر «الكل» لترى الأحياء بكل سكانها، أو «أستهدف منشآت».' }
  if (rows.every((row) => row.population == null)) return { what: 'سكان الأحياء', body: instead.people }
  if (minIncome > 0 && rows.every((row) => row.income == null)) return { what: 'دخل الأحياء', body: instead.income }
  if (sex !== 'all' && nationality !== 'all') return { what: 'الجنس والجنسية', body: instead.share }
  if (sex !== 'all') return { what: 'الجنس', body: instead.share }
  if (nationality !== 'all') return { what: 'الجنسية', body: instead.share }
  return { what: 'سكان الأحياء', body: instead.people }
}

/**
 * «قارن المواقع» keeps each site's number and colour for as long as it is on the map: a new site takes the lowest free
 * slot (0, 1, 2), and with every slot taken it replaces the oldest site in its slot. Removing site 1 leaves site 2 as
 * «2» in its own colour, instead of renumbering and recolouring every site after it.
 */
export function placeSite<S extends { id: number; slot: number }>(sites: S[], next: Omit<S, 'slot'>, slots: number): S[] {
  const taken = new Set(sites.map((site) => site.slot))
  const free = Array.from({ length: slots }, (_, slot) => slot).find((slot) => !taken.has(slot))
  if (free != null) return [...sites, { ...next, slot: free } as S]
  const oldest = sites.reduce((first, site) => (site.id < first.id ? site : first))
  return [...sites.filter((site) => site !== oldest), { ...next, slot: oldest.slot } as S]
}

/**
 * The answer's verdict, the same shape in every tool (verdict.tsx draws it): `lead` is the decision in one line, `why`
 * the one or two figures behind it in words, `caution` what makes it less sure (thin or partial data), said rather
 * than hidden. Every figure in it is the service's, through numberFormat or counted; nothing is estimated.
 */
export type VerdictText = { lead: string; why: string[]; caution?: string | null }

/**
 * When an answer is said to rest on thin or partial data, in one place, each measured on the live cities (read-only,
 * 2026-11-03; verdicts.test.ts keeps those cases):
 * - `located`: under 90% of a city's businesses in a known district. Riyadh pharmacies 92% (10,010 of 10,856), Riyadh
 *   cafés 87%, Dammam pharmacies 83%, cafés 80%, Jeddah 95–98%, Abha and Buraydah 94–100%: the line falls between
 *   the cities whose districts carry nearly all the count and those that miss a sixth.
 * - `thinGapShare`: the top shortfall is one business, or under a tenth of what the district needs. A fixed
 *   «two» would flag Riyadh only by accident (20 short of 300 passed) and call a small city's 2 of 4 thin.
 * - `perRep`: under 4 districts a rep, an uneven split comes from the districts' size, and is said that way.
 * - `uneven`: the largest share over the smallest by more than a quarter of the largest (Riyadh, 5 reps: 9%).
 * - `focus`: the top districts carry at least 3 times their share of the districts (Riyadh top 5 of 186: 15% of the
 *   audience from 2.7% of the districts, 5.6 times); in a city of 29 districts the same top 5 need about 52%.
 * - `level`: two sites within 3 points of 100 are level.
 * - `rentSample`: a street median from under 10 ads (lenses.RELIABLE_LISTINGS).
 * - `nextDoor`: a district with no competitor whose neighbours hold at least 10 is said to be served from next door
 *   (وادي لبن: none inside, 240 in ظهرة لبن across its edge).
 * - `sparse`: a district the population grid holds as settled over under half of its cells (golden settled_pct):
 *   وادي لبن 42%, النظيم 40%, الحائر 28% in Riyadh; three in four Riyadh districts are settled over 88% or more.
 * - `minArea`: a district and its neighbours with fewer than 10,000 residents together are ranked after the others in
 *   «أين المنافسة أخف؟» (الزاهر led Riyadh pharmacies with 6,246 people around it and none of the activity).
 * - `nearKm`: a neighbour counts by its nearness, 1 ÷ (1 + distance ÷ 3 km) between the districts' centres, so a
 *   neighbour across a long edge 6 km away weighs a third of one next door.
 * - `minDistrict`: a district of under 1,000 residents of its own goes after the others too, whatever its neighbours
 *   (الدانة 1, الرحاب 4, المجد 5 in Riyadh: grid estimates of nearly empty land).
 */
export const THIN = { located: 0.9, thinGapShare: 0.1, perRep: 4, uneven: 0.25, focus: 3, level: 3, rentSample: 10, nextDoor: 10, sparse: 50, minArea: 10000, nearKm: 3, minDistrict: 1000 } as const

/** What the districts around one district hold, summed from the same answer as the list (its neighbours by outline). */
export type Around = { districts: number; total: number; top: { name: string; n: number } | null }

/** «سكان طويق تقدير…»: said where a decision rests on a population spread from a density grid, not counted. */
const estimatedLine = (name: string, what: string) => `سكان ${name} تقدير من خرائط الكثافة لا عدّ مقاس، ف${what}.`

const n = (value: number) => numberFormat.format(value)
/** «النرجس، الملقا والياسمين». */
const names = (list: string[]) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join('، ')} و${list[list.length - 1]}`)

/** «منطقتان», «5 مناطق», «12 منطقة». */
const areas = (count: number) => (count === 2 ? 'منطقتان' : `${n(count)} ${count >= 3 && count <= 10 ? 'مناطق' : 'منطقة'}`)

/** A gap row as «أين ينقص نشاطي؟» reads it (market-gaps). */
// expected and shortfall are null where the count does not follow the population (market-gaps); such a row is never
// short, so it never reaches the verdict
export type GapVerdictRow = { district_ar: string; businesses: number; expected_businesses: number | null; shortfall: number | null; caveat?: 'industrial' | 'workers' | 'estimated' | 'campus' | null }

/**
 * «أكبر نقص في «صيدلية»: النرجس», with what it has against what it needs at the city rate, and the next two
 * districts of the same kind. A thin shortfall (THIN.thinGapShare), or a list of only industrial or labour-housing
 * districts, is said as a caution. `short` is the API's short districts in its order (largest first, caveats last).
 */
/**
 * How a district's population was arrived at, from its golden row's source id (city-data populationSource): counted
 * for the district, modelled from its buildings, or spread from a city-wide density grid. Only the kind is ever said.
 */
export function populationKind(source: string | null | undefined): 'measured' | 'buildings' | 'grid' | null {
  if (!source) return null
  if (source.startsWith('910ths')) return 'measured'
  if (source === 'farq_buildings_v3') return 'buildings'
  return 'grid'
}

export function gapsVerdict(short: (GapVerdictRow & { net?: number })[], label: string, residentsPerBusiness: number, topPopulation: 'measured' | 'buildings' | 'grid' | null = null,
  /** The top district's neighbours that hold more than they need at the city rate: their surplus, summed. */
  around: Around | null = null,
  /** The list was reordered by the gap net of the neighbours' surplus (rankGapsAround), so the lead says so. */
  reordered = false): VerdictText | null {
  const top = short[0]
  if (!top) return null
  const need = Math.round(top.expected_businesses ?? 0)
  const missing = need - top.businesses
  const next = short.filter((row) => row !== top && Boolean(row.caveat) === Boolean(top.caveat)).slice(0, 2)
  const why = [
    `فيه ${counted(top.businesses, 'business')} ويحتاج ${n(need)} بمعدل المدينة (منشأة لكل ${n(residentsPerBusiness)} ساكن).`,
    ...(next.length ? [`يليه ${names(next.map((row) => `${row.district_ar} (ناقص ${n(Math.round(row.expected_businesses ?? 0) - row.businesses)})`))}.`] : []),
    ...(around && around.total > 0 ? [`حوله فائض: ${counted(around.total, 'business')} فوق الحاجة في الأحياء المجاورة (${n(around.districts)})${around.top ? `، أكثرها ${around.top.name} (${n(around.top.n)})` : ''}.`] : []),
  ]
  const thin = missing <= 1 || missing < THIN.thinGapShare * need
  // a population spread from a density grid over a large district (Al Khobar's الظهران: 242,901 from 23% of its
  // area) makes a shortfall of hundreds out of a guess; the gap is only as sure as the people it is counted from
  const caution = top.caveat
    ? 'كل الأحياء الناقصة مناطق صناعية أو سكن عمال أو بسكان مقدّرين، فنقصها بعدد السكان لا يعني طلب أسر مقيمة.'
    : topPopulation === 'grid' ? `سكان ${top.district_ar} تقدير من خرائط الكثافة لا عدّ مقاس، فنقصه قد يكون أكبر من الحقيقة. قارنه بما يليه قبل القرار.`
    : thin ? `النقص في أعلى حي ${counted(missing, 'business')} فقط من ${n(need)}: الأحياء قريبة من معدل المدينة، فالفرصة ضعيفة.`
    : around && around.total >= missing ? `فائض الأحياء المجاورة يعادل نقصه أو أكثر، فقد يُخدم سكانه من جواره. قارن الحي التالي قبل القرار.` : null
  if (top.net != null && around && around.total > 0) why.push(`صافي نقصه بعد فائض جواره: ${counted(Math.max(0, top.net), 'business')}.`)
  return { lead: `أكبر نقص في «${label}»${reordered ? ' مع حساب الجوار' : ''}: ${top.district_ar}، ينقصه ${counted(missing, 'business')}`, why, caution }
}

/**
 * «المنافسون» in one line, for the order the visitor chose: the district where competition is densest, or the
 * populated district where it is lightest (none at all first). Thin data is said: a city count of which under nine in
 * ten fell in a known district, so the districts' counts are under the whole.
 */
export function competitorsVerdict<T extends CompetitorRow & { row: { name: string; population: number | null; populationSource?: string | null; settledPct?: number | null }; residentsPer?: number | null; area?: AroundArea | null }>(
  ranked: T[], order: 'dense' | 'light', label: string, cityTotal: number | null, located: number | null,
  /** The top district's neighbours by outline: how many competitors they hold together, and the most. */
  around: Around | null = null,
): VerdictText | null {
  const top = ranked[0]
  if (!top) return null
  const density = (item: T) => (item.perKm2 == null ? null : `${n(Math.round(item.perKm2 * 10) / 10)} لكل كم²`)
  const partial = cityTotal != null && located != null && cityTotal > 0 && located < THIN.located * cityTotal
  const caution = partial ? `${n(located!)} فقط من ${n(cityTotal!)} منشأة «${label}» بحي معروف، فأعداد الأحياء أقل من الحقيقة.` : null
  if (order === 'dense') {
    return {
      lead: `أشد منافسة على «${label}»: ${top.row.name}`,
      why: [[counted(top.competitors, 'business'), density(top), top.residentsPer != null ? `ساكن لكل منافس: ${n(Math.round(top.residentsPer))}` : null].filter(Boolean).join(' · ') + '.'],
      caution,
    }
  }
  const empty = ranked.filter((item) => item.competitors === 0).length
  const people = top.row.population != null ? `${n(Math.round(top.row.population))} ساكن` : null
  const nextDoor = top.competitors === 0 && around != null && around.total >= THIN.nextDoor && !top.area
  const sparse = top.row.settledPct != null && top.row.settledPct < THIN.sparse
  const cautions = [
    caution,
    sparse ? `${top.row.name} مأهول في ${n(top.row.settledPct!)}% من مساحته فقط، فسكانه في جزء منه وكثافة منافسيه لكل كم² تبدو أخف مما هي.` : null,
    nextDoor ? 'لا منافس داخل حدوده، لكن منافسي الأحياء المجاورة قريبون منه ويخدمون سكانه أيضاً.' : null,
    populationKind(top.row.populationSource) === 'grid' ? estimatedLine(top.row.name, 'خفة المنافسة فيه بعدد سكانه تقريبية') : null,
  ].filter(Boolean)
  // ranked with its neighbours (rankLightAround): the area's residents per competitor leads, the district's own after
  const area = top.area
  const areaLine = area == null ? []
    : area.competitors === 0 ? [`لا منافس فيه ولا في الأحياء المجاورة (${n(area.districts - 1)})، وفيها ${n(Math.round(area.residents))} ساكن.`]
      : area.weighted
        ? [`هو وجواره (${counted(area.districts, 'district')}): ${n(Math.round(area.ratio ?? area.residents / area.competitors))} ساكن لكل منافس، والجار الأبعد يُحسب أقل. فيها ${n(Math.round(area.residents))} ساكن و${counted(area.competitors, 'business')}.`]
        : [`هو وجواره (${counted(area.districts, 'district')}): ${n(Math.round(area.residents / area.competitors))} ساكن لكل منافس (${n(Math.round(area.residents))} ساكن، ${counted(area.competitors, 'business')}).`]
  return {
    lead: `أخف منافسة على «${label}»${area ? ' مع جواره' : ''}: ${top.row.name}`,
    why: [
      ...areaLine,
      top.competitors === 0
        ? `لا منافس فيه${people ? `، وفيه ${people}` : ''}.`
        : [`${counted(top.competitors, 'business')} فقط`, density(top), people].filter(Boolean).join(' · ') + '.',
      // the area line already sums the neighbours; the plain list (no outlines) names them here
      ...(around && around.districts > 0 && !area ? [around.total
        ? `حوله: ${counted(around.total, 'business')} في الأحياء المجاورة (${n(around.districts)})${around.top ? `، أكثرها ${around.top.name} (${n(around.top.n)})` : ''}.`
        : `ولا منافس في الأحياء المجاورة له (${n(around.districts)}).`] : []),
      ...(empty > 1 ? [`${counted(empty, 'district')} مأهولة بلا أي منافس، والأكثر سكاناً أولاً.`] : []),
    ],
    caution: cautions.length ? cautions.join(' ') : null,
  }
}

/**
 * «السلاسل» in one line: whether chains or independent shops hold the market (the chains' share of the service's
 * count, as the line under it reads it), and the largest chain.
 */
export function brandsVerdict(brands: { total: number; chains: number; in_chains: number; brands: { brand: string; branches: number; districts: number }[] }): VerdictText | null {
  if (!brands.total) return null
  const top = brands.brands[0]
  if (!brands.chains || !top) return { lead: 'السوق كله محلات مستقلة', why: ['لا سلسلة لهذا النشاط بثلاثة فروع أو أكثر.'] }
  const share = Math.round((100 * brands.in_chains) / brands.total)
  return {
    // «أكثر» only past half (5,255 of 10,575 Riyadh pharmacies is 49.7%, «50%» but not most); half said as half
    lead: share > 50 ? `السلاسل تملك أكثر السوق: ${n(share)}%` : share === 50 ? 'السلاسل تملك نصف السوق تقريباً: 50%' : `أكثر السوق محلات مستقلة: السلاسل ${n(share)}% فقط`,
    why: [`أكبرها ${top.brand}: ${counted(top.branches, 'branch')} في ${counted(top.districts, 'district')}.`],
  }
}

/** «قارن بنشاط آخر»: how many districts have the first activity and none of the second, and the widest lead. */
export function pairsVerdict(pairs: Pair[], first: string, second: string): VerdictText | null {
  if (!pairs.length) return null
  const alone = pairs.filter((item) => item.a > 0 && item.b === 0)
  const widest = pairs.reduce((top, item) => (item.a - item.b > top.a - top.b ? item : top))
  if (widest.a - widest.b <= 0) return { lead: `لا حي يزيد فيه «${first}» على «${second}»`, why: [`«${second}» حاضر في كل حي فيه «${first}»، بعدد مثله أو أكثر.`] }
  return {
    lead: alone.length ? `أحياء فيها «${first}» بلا «${second}»: ${n(alone.length)}` : `«${second}» حاضر حيث «${first}»، بأعداد أقل`,
    why: [`أوسع فرق في ${widest.row.name}: ${n(widest.a)} «${first}» مقابل ${n(widest.b)} «${second}».`],
  }
}

/**
 * «أين جمهوري؟»: the best-matching district and how concentrated the audience is (the top five districts' share of
 * the sizes summed, each the service's figure), so a campaign knows whether a few districts carry it. `ranked` are
 * the districts in scope with a measured figure, largest first.
 */
export function audienceVerdict(ranked: { name: string; size: number; populationSource?: string | null }[], unit: string, segment: string): VerdictText | null {
  const top = ranked[0]
  if (!top || top.size <= 0) return null
  const total = ranked.reduce((sum, item) => sum + item.size, 0)
  // the top five of a large city, fewer in a small one (a quarter of its districts at most), none under eight
  const k = Math.min(5, Math.floor(ranked.length / 4))
  const share = (100 * ranked.slice(0, k).reduce((sum, item) => sum + item.size, 0)) / total
  const focused = share >= THIN.focus * ((100 * k) / ranked.length)
  return {
    lead: `أعلى حي لجمهورك${segment ? ` (${segment})` : ''}: ${top.name}`,
    why: [
      `فيه ${n(Math.round(top.size))} ${unit}${ranked[1] ? `، ويليه ${names(ranked.slice(1, 3).map((item) => item.name))}` : ''}.`,
      ...(k >= 2 ? [`أعلى ${counted(k, 'district')} من ${n(ranked.length)} تجمع ${n(Math.round(share))}% من الجمهور، ${focused ? 'فحملة مركّزة عليها أجدى من توزيعها على المدينة' : 'فالجمهور موزّع، وحملة على المدينة كلها لا تضيّع كثيراً'}.`] : []),
    ],
    // a people figure from a density grid: the size is a guess, and said where the campaign would be aimed
    caution: unit !== 'منشأة' && populationKind(top.populationSource) === 'grid' ? estimatedLine(top.name, 'حجم جمهوره تقريبي') : null,
  }
}

/** A site in «قارن المواقع» with the three factors of its score; null where a factor is not available. */
export type SiteFactors = { id: number; audience: number | null; spending: number | null; density: number | null }

export type Factor = 'audience' | 'spending' | 'density'
const FACTORS: Factor[] = ['audience', 'spending', 'density']

/**
 * «جاذبية الموقع»: a 0–100 score comparing the chosen sites on equal factors (audience, purchasing power, and
 * lightness of competition per km²), each scaled to the best site; the score is their mean. It is worked out on the
 * factors every site has (`factors`), so one district without a published income no longer leaves every site without
 * a score: the verdict says the score rests on the other two. It needs two sites and one shared factor.
 */
export function attractionScores(sites: SiteFactors[], chosen: readonly Factor[] = FACTORS): { scores: Map<number, number>; factors: Factor[]; dropped: Factor[] } {
  const scores = new Map<number, number>()
  // the factors the visitor kept (all three by default), of those every site has
  const factors = FACTORS.filter((factor) => chosen.includes(factor) && sites.every((site) => site[factor] != null))
  const dropped = FACTORS.filter((factor) => !chosen.includes(factor))
  if (sites.length < 2 || !factors.length) return { scores, factors: [], dropped }
  const values = (factor: Factor) => sites.map((site) => site[factor]!)
  const top: Record<Factor, number> = {
    audience: factors.includes('audience') ? Math.max(...values('audience')) : 0,
    spending: factors.includes('spending') ? Math.max(...values('spending')) : 0,
    density: factors.includes('density') ? Math.min(...values('density')) : 0,
  }
  for (const site of sites) {
    const parts = factors.map((factor) => {
      const value = site[factor]!
      if (factor === 'density') return value > 0 ? (100 * top.density) / value : 100
      return top[factor] > 0 ? (100 * value) / top[factor] : 0
    })
    scores.set(site.id, Math.round(parts.reduce((sum, part) => sum + part, 0) / parts.length))
  }
  return { scores, factors, dropped }
}

export const factorWord = (factor: Factor, byIncome: boolean) => (factor === 'audience' ? 'السكان' : factor === 'spending' ? (byIncome ? 'دخل الحي' : 'حصة الفلل') : 'المنافسة')

/**
 * «قارن المواقع» in one line: which site is the most attractive and on which factors it leads or trails, or that the
 * top two are level (within 3 points). A site without a score says which factor it is missing. The population quoted
 * is the service's figure in the table, so the reason reads what the visitor sees.
 */
export function sitesVerdict(sites: (SiteFactors & { label: string; population: number | null })[], attraction: { scores: Map<number, number>; factors: Factor[]; dropped?: Factor[] }, byIncome: boolean): VerdictText | null {
  const { scores, factors } = attraction
  const dropped = attraction.dropped ?? []
  // a factor the visitor left out is their choice, said as such; only a factor they kept and a site lacks is «غير متاح»
  const choice = dropped.length ? [`بلا ${names(dropped.map((factor) => factorWord(factor, byIncome)))} باختيارك.`] : []
  const kept = (factor: Factor) => !dropped.includes(factor)
  if (sites.length === 0) return null
  if (sites.length === 1) return { lead: 'أضف موقعاً ثانياً لتعرف أيهما أجذب', why: ['اضغط على الخريطة في مكان آخر، فيُقاس بالنطاق نفسه.'] }
  // a factor one site lacks is left out of every site's score, and said: «الدرجة من السكان والمنافسة فقط»
  const missing = sites.flatMap((site) => {
    const what = kept('audience') && site.audience == null ? 'السكان' : kept('spending') && site.spending == null ? (byIncome ? 'دخل حيه' : 'حصة الفلل في حيه') : kept('density') && site.density == null ? 'كثافة المنشآت' : null
    return what ? [`الموقع ${site.label} (${what} غير متاح)`] : []
  })
  const caution = !missing.length ? null
    : factors.length ? `الدرجة من ${names(factors.map((factor) => factorWord(factor, byIncome)))} فقط: ${missing.join('، ')}.`
      : `بلا درجة: ${missing.join('، ')}.`
  const scored = sites.filter((site) => scores.has(site.id)).sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)
  if (scored.length < 2) return { lead: 'جاذبية المواقع غير متاحة للمقارنة', why: ['لا عامل مختار متاح للمواقع كلها.', ...choice], caution }
  const [best, second] = scored
  const gap = scores.get(best.id)! - scores.get(second.id)!
  if (gap <= THIN.level) {
    return { lead: `الموقعان ${best.label} و${second.label} متقاربان: ${n(scores.get(best.id)!)} و${n(scores.get(second.id)!)} من 100`, why: ['الفرق أصغر من أن يحسم وحده: قارن المنافسين في بطاقة كل موقع.', ...choice], caution }
  }
  return {
    lead: `الموقع ${best.label} هو الأجذب: ${n(scores.get(best.id)!)} من 100`,
    why: [siteReasons(scored, factors, byIncome).get(best.id) ?? 'لا يتقدم في عامل واحد.', ...choice],
    caution,
  }
}

/**
 * Each scored site's own reason, against the best of the other sites on each factor in the score: «سكان أكثر
 * (48,210)، لكن منافسة أكثف». The population quoted is the service's figure in the table. A site with no other to
 * compare with has none.
 */
export function siteReasons(sites: (SiteFactors & { population: number | null })[], factors: Factor[], byIncome: boolean): Map<number, string> {
  const out = new Map<number, string>()
  for (const site of sites) {
    const others = sites.filter((other) => other !== site)
    if (!others.length) continue
    const leads: string[] = []
    const lags: string[] = []
    const versus = (value: number | null, pick: (other: (typeof others)[number]) => number | null) => {
      const rival = others.map(pick).filter((v): v is number => v != null)
      return value == null || !rival.length ? null : value >= Math.max(...rival) ? 'lead' : 'lag'
    }
    const people = factors.includes('audience') ? versus(site.population, (other) => other.population) : null
    if (people) (people === 'lead' ? leads : lags).push(`${people === 'lead' ? 'سكان أكثر' : 'سكان أقل'} (${n(Math.round(site.population!))})`)
    const spend = factors.includes('spending') ? versus(site.spending, (other) => other.spending) : null
    if (spend) (spend === 'lead' ? leads : lags).push(byIncome ? `دخل حيه ${spend === 'lead' ? 'أعلى' : 'أقل'}` : `فلل ${spend === 'lead' ? 'أكثر' : 'أقل'} في حيه`)
    const crowd = factors.includes('density') ? versus(site.density == null ? null : -site.density, (other) => (other.density == null ? null : -other.density)) : null
    if (crowd) (crowd === 'lead' ? leads : lags).push(crowd === 'lead' ? 'منافسة أخف' : 'منافسة أكثف')
    out.set(site.id, leads.length
      ? `${leads.join('، ')}${lags.length ? `، لكن ${lags.join('، ')}` : ''}.`
      : lags.length ? `${lags.join('، ')}.` : 'لا يتقدم في عامل واحد.')
  }
  return out
}

/** «بطاقة الموقع» in one line: how many competitors are in the range and how near the nearest is. */
export function siteCardVerdict(
  competitors: { n: number; nearest: { name: string | null; distance_m: number | null }[] } | null,
  residentsPerCompetitor: number | null, population: number | null, activity: string, distance: (metres: number) => string,
): VerdictText | null {
  if (!competitors) return null
  if (competitors.n === 0) {
    return { lead: `لا منافس من «${activity}» في هذا النطاق`, why: population != null ? [`وفيه ${n(Math.round(population))} ساكن.`] : [] }
  }
  const near = competitors.nearest.find((row) => row.distance_m != null)
  const reasons = [
    residentsPerCompetitor != null ? `ساكن لكل منافس: ${n(Math.round(residentsPerCompetitor))}` : null,
    near?.name ? `الأقرب: ${near.name}` : null,
  ].filter(Boolean)
  return {
    lead: `${counted(competitors.n, 'business')} من «${activity}» في النطاق${near ? `، أقربها على ${distance(near.distance_m!)}` : ''}`,
    why: reasons.length ? [`${reasons.join(' · ')}.`] : [],
  }
}

/** A street as «شوارع النشاط» lists it (street-density). */
export type CorridorVerdictRow = { street_ar: string; n: number; per_100m: number; road_class?: 'main' | 'secondary' | null }

/** «أقوى شارع لـ«أدوات صحية»: طريق الملك فهد», with its shops and the next street. */
export function corridorVerdict(corridors: CorridorVerdictRow[], label: string): VerdictText | null {
  const [top, next] = corridors
  if (!top) return null
  return {
    lead: `أقوى شارع لـ«${label}»: ${top.street_ar}`,
    why: [
      `${counted(top.n, 'shop')} منه، ${n(Math.round(top.per_100m * 10) / 10)} لكل 100 م${top.road_class === 'main' ? '، على شارع رئيسي' : ''}.`,
      ...(next ? [`يليه ${next.street_ar} (${counted(next.n, 'shop')}).`] : []),
    ],
  }
}

/** A street as «أين الفرصة» lists it (street-opportunities). */
export type OpportunityVerdictRow = { street_ar: string; total: number; score: number; requested_n: number | null; requested_below: number | null; nearest: { street_ar: string; distance_m: number } | null }

/** «أقوى فرصة لـ«صيدلية»: شارع التخصصي (82 من 100)», with the street's shops and what it has of the activity. */
export function opportunityVerdict(streets: OpportunityVerdictRow[], label: string, populationUsed: boolean, distance: (metres: number) => string): VerdictText | null {
  const top = streets[0]
  if (!top) return null
  // neither a count nor «fewer than 5»: the service keeps only the activity's strongest streets (it lines too many to
  // keep all), so «not among them» does not mean none here, and the score reads the street as lacking it
  const unknown = top.requested_n == null && top.requested_below == null
  const has = top.requested_n != null ? (top.requested_n === 0 ? `ولا محل «${label}» عليه` : `وعليه ${counted(top.requested_n, 'shop')} فقط من «${label}»`)
    : top.requested_below != null ? `و«${label}» عليه أقل من ${n(top.requested_below)} محلات` : `وعدد محلات «${label}» عليه غير متاح`
  return {
    lead: `أقوى فرصة لـ«${label}»: ${top.street_ar} (${n(top.score)} من 100)`,
    why: [
      `${counted(top.total, 'shop')} على الشارع ${has}.`,
      ...(top.nearest ? [`أقرب تجمع لـ«${label}»: ${top.nearest.street_ar}${top.nearest.distance_m < 30 ? '، يتقاطع معه أو يلاصقه' : ` على ${distance(top.nearest.distance_m)}`}.`] : []),
    ],
    caution: unknown
      ? `«${label}» منتشر في المدينة أكثر من أن تُحفظ كل شوارعه، فعدده على هذا الشارع غير معروف والدرجة تعدّه قليلاً. تحقّق منه في «أين يتجمع» قبل القرار.`
      : populationUsed ? null : 'سكان الأحياء غير متاحين هنا، فالدرجة من حركة الشارع التجارية وحدها.',
  }
}

/**
 * «المناطق والمسار» once the city is split: how even the reps' shares are (the largest against the smallest, each
 * the service's figure). A spread over a quarter of the largest is said, with the change most likely to even it.
 */
export function territoriesVerdict(groups: { weight: number; districts: number }[], weight: 'population' | 'businesses'): VerdictText | null {
  if (!groups.length) return null
  const unit = (value: number) => (weight === 'population' ? `${n(Math.round(value))} ساكن` : counted(Math.round(value), 'business'))
  const weights = groups.map((group) => group.weight)
  const largest = Math.max(...weights)
  const smallest = Math.min(...weights)
  const uneven = largest > 0 && (largest - smallest) / largest > THIN.uneven
  const perRep = groups.reduce((sum, group) => sum + group.districts, 0) / groups.length
  return {
    lead: `${uneven ? 'تقسيم غير متساوٍ' : 'تقسيم متوازن'}: ${areas(groups.length)} ${weight === 'population' ? 'بالسكان' : 'بالمنشآت'}`,
    why: [`أكبر حصة ${unit(largest)} وأصغرها ${unit(smallest)}.`],
    caution: !uneven ? null
      : perRep < THIN.perRep ? `أحياء قليلة لكل مندوب (${n(Math.round(perRep * 10) / 10)} في المتوسط)، والحي لا يُقسم بين مندوبين: مندوبون أقل يوازنون أكثر.`
        : 'الحي الواحد لا يُقسم بين مندوبين، فحي كبير يرفع حصة منطقته. جرّب عدداً آخر من المندوبين.',
  }
}

/**
 * The week plan's next step when some customers do not fit: the visits a day, or the days, that would fit them all
 * (within the steppers' limits), so the manager changes one number instead of guessing.
 */
export function weekFitHint(customers: number, unplanned: number, days: number, perDay: number, { maxDays = 6, maxPerDay = 100 } = {}): string | null {
  if (unplanned <= 0 || customers <= 0) return null
  const fitPerDay = Math.ceil(customers / days)
  const fitDays = Math.ceil(customers / perDay)
  const ways = [
    ...(fitPerDay <= maxPerDay ? [`زيارات اليوم إلى ${n(fitPerDay)}`] : []),
    ...(fitDays <= maxDays ? [`أيام العمل إلى ${n(fitDays)}`] : []),
  ]
  return ways.length ? `لتتسع كلها: زد ${ways.join(' أو ')}.` : 'لا تتسع في أسبوع واحد: زد عدد المندوبين لتصغر كل منطقة.'
}

/** «اختر عقاراً» in one line: the first listing of the list (best value, or nearest the viewer's point) and why. */
export function listingVerdict(first: { type: string; district: string | null; price: string | null; versus: string | null; area: number | null; away: string | null } | null, nearest: boolean): VerdictText | null {
  if (!first) return null
  const where = first.district ? ` في ${first.district}` : ''
  const line = [first.versus, first.area != null ? `${n(first.area)} م²` : null, first.away].filter(Boolean).join(' · ')
  return {
    lead: `${nearest ? 'الأقرب لنقطتك' : 'أنسب عرض'}: ${first.type}${where}${first.price ? ` بـ ${first.price}` : '، السعر غير مذكور'}`,
    why: line ? [`${line}.`] : [],
    caution: !nearest && !first.versus ? 'حيه بلا وسيط كافٍ، فترتيبه لا يقارن سعره بجيرانه.' : null,
  }
}

/** One figure of a district pair: its label, the two raw values, and each as the comparison table shows it. */
/** A district of the pair whose population grid settles under half of it: said beside the figures. */
export function sparseLine(names2: [string, string], settled: [number | null | undefined, number | null | undefined]): string | null {
  const sparse = names2.flatMap((name, index) => (settled[index] != null && settled[index]! < THIN.sparse ? [`${name} مأهول في ${n(settled[index]!)}% من مساحته`] : []))
  return sparse.length ? `${sparse.join('، و')} فقط، فسكانه في جزء منه.` : null
}

export type DistrictFigure = {
  label: string; a: number | null; b: number | null; shown: [string, string]
  /** A median from fewer listings than lenses.RELIABLE_LISTINGS on that side: shown in the table, never weighed here. */
  thin?: [boolean, boolean]
}

/**
 * «قارن حيين» in one line: where the two districts differ most (the ratio of the larger figure to the smaller, among
 * the figures both have), and the next two; the figures one of them lacks are named. No recommendation: analysts read
 * the figures (docs/atlas-product-foundation.md §3.4). Within 15% on every shared figure, the two are said level.
 */
export function districtsVerdict([a, b]: [string, string], figures: DistrictFigure[]): VerdictText | null {
  if (!figures.length) return null
  const solid = (item: DistrictFigure) => !item.thin?.[0] && !item.thin?.[1]
  const both = figures.filter((item) => solid(item) && item.a != null && item.b != null && item.a > 0 && item.b > 0)
    .map((item) => ({ ...item, ratio: Math.max(item.a!, item.b!) / Math.min(item.a!, item.b!) }))
    .sort((x, y) => y.ratio - x.ratio)
  const lacking = (side: 'a' | 'b') => figures.filter((item) => item[side] == null).map((item) => item.label)
  const gaps = ([[a, lacking('a')], [b, lacking('b')]] as [string, string[]][]).filter(([, list]) => list.length).map(([name, list]) => `في ${name}: ${list.join('، ')}`)
  const few = (side: 0 | 1) => figures.filter((item) => item.thin?.[side] && (side ? item.b : item.a) != null).map((item) => item.label)
  const small = ([[a, few(0)], [b, few(1)]] as [string, string[]][]).filter(([, list]) => list.length).map(([name, list]) => `في ${name}: ${list.join('، ')}`)
  const caution = [gaps.length ? `غير متاح ${gaps.join('؛ ')}.` : null, small.length ? `من عروض قليلة فلا تُوازن هنا ${small.join('؛ ')}.` : null].filter(Boolean).join(' ') || null
  const line = (item: DistrictFigure) => `${item.label}: ${item.shown[0]} في ${a} مقابل ${item.shown[1]} في ${b}.`
  if (!both.length) return { lead: 'لا رقم متاح للحيين معاً للمقارنة', why: [], caution }
  if (both[0].ratio < 1.15) return { lead: `${a} و${b} متقاربان في كل الأرقام المتاحة لهما`, why: [line(both[0])], caution }
  return { lead: `أكبر فرق بين ${a} و${b}: ${both[0].label}`, why: both.slice(0, 3).filter((item) => item.ratio >= 1.15).map(line), caution }
}

/**
 * What a district's neighbours hold together, from the figure each one has in the same answer (`figure` gives a
 * neighbour's name and its count, or null when the answer does not count it); a neighbour at 0 counts as a district
 * and adds nothing. Null with no neighbour or no counted neighbour.
 */
export function aroundOf(id: string, neighbours: Map<string, Set<string>> | null, figure: (id: string) => { name: string; n: number } | null): Around | null {
  const ids = [...(neighbours?.get(id) ?? [])]
  const known = ids.map(figure).filter((item): item is { name: string; n: number } => item != null)
  if (!known.length) return null
  const total = known.reduce((sum, item) => sum + Math.max(0, item.n), 0)
  const top = known.reduce<{ name: string; n: number } | null>((best, item) => (item.n > 0 && (!best || item.n > best.n) ? item : best), null)
  return { districts: known.length, total, top }
}

/**
 * The tag on a gap row the service lists after the residential ones: an industrial name, labour housing (with the
 * measured share of men when there is one), or a population estimated from a grid over little of the district.
 */
export function caveatTag(row: { caveat?: 'industrial' | 'workers' | 'estimated' | 'campus' | null; male_pct?: number | null; population_coverage_pct?: number | null }): string | null {
  if (row.caveat === 'industrial') return 'منطقة صناعية'
  if (row.caveat === 'workers') return row.male_pct != null ? `${n(Math.round(row.male_pct))}% من سكانه رجال` : 'سكن عمال غالباً'
  if (row.caveat === 'campus') return 'حرم مغلق له خدماته'
  if (row.caveat === 'estimated') return row.population_coverage_pct != null ? `سكان مقدّرون من ${n(row.population_coverage_pct)}% من مساحته` : 'سكان مقدّرون'
  return null
}

/** A district and its neighbours together: their residents and competitors summed from the same answer. */
export type AroundArea = {
  districts: number; residents: number; competitors: number
  /** Residents per competitor with each neighbour weighted by its nearness (THIN.nearKm); null with no competitor. */
  ratio?: number | null
  /** Fewer residents than THIN.minArea in the district and its neighbours: ranked after the others. */
  small?: boolean
  /** The ratio weighs each neighbour by its distance (a distance was given). */
  weighted?: boolean
}

/**
 * «أين المنافسة أخف؟» with the neighbours counted: a populated district ranks by the residents per competitor of
 * itself and its populated neighbours together (each summed from the service's own figures), so a district with
 * none inside but a crowded edge (وادي لبن: 0 inside, 668 next door) no longer leads. An area with no competitor at
 * all comes first, the most residents first. Without outlines, the plain ranking (rankCompetition).
 */
export function rankLightAround<T extends CompetitorRow & { row: { id: string; population: number | null } }>(table: T[], neighbours: Map<string, Set<string>> | null,
  /** Distance in km between two districts' centres; without it every neighbour weighs 1. */
  distance?: (a: string, b: string) => number | null): (T & { area: AroundArea | null })[] {
  if (!neighbours) return rankCompetition(table, 'light').map((item) => ({ ...item, area: null }))
  const byId = new Map(table.map((item) => [item.row.id, item]))
  const weight = (a: string, b: string) => { const km = distance?.(a, b); return km == null ? 1 : 1 / (1 + km / THIN.nearKm) }
  const scored = table.filter((item) => item.row.population != null).map((item) => {
    const others = [...(neighbours.get(item.row.id) ?? [])].map((id) => byId.get(id)).filter((other): other is T => other != null && other.row.population != null)
    const residents = (item.row.population ?? 0) + others.reduce((sum, other) => sum + (other.row.population ?? 0), 0)
    const competitors = item.competitors + others.reduce((sum, other) => sum + other.competitors, 0)
    const weighted = others.reduce((sum, other) => {
      const w = weight(item.row.id, other.row.id)
      return { residents: sum.residents + w * (other.row.population ?? 0), competitors: sum.competitors + w * other.competitors }
    }, { residents: item.row.population ?? 0, competitors: item.competitors })
    const area: AroundArea = { districts: others.length + 1, residents, competitors, ratio: competitors === 0 ? null : weighted.residents / weighted.competitors, small: residents < THIN.minArea || (item.row.population ?? 0) < THIN.minDistrict, weighted: distance != null }
    return { ...item, area }
  })
  const per = (area: AroundArea) => (area.competitors === 0 ? Infinity : area.ratio ?? 0)
  // a small area after the others; then the lightest; the same area (districts that are all each other's neighbours):
  // the district with fewer competitors of its own first
  return scored.sort((a, b) => Number(a.area.small) - Number(b.area.small) || per(b.area) - per(a.area) || b.area.residents - a.area.residents || a.competitors - b.competitors)
}

/** A light-order row's line: «مع جواره: 2,310 ساكن لكل منافس», or that its whole area has none. */
export function areaLine(area: AroundArea | null): string | null {
  if (!area) return null
  const line = area.competitors === 0 ? 'لا منافس فيه ولا في جواره' : `مع جواره: ${n(Math.round(area.ratio ?? area.residents / area.competitors))} ساكن لكل منافس`
  return area.small ? `${line}، منطقة قليلة السكان` : line
}

/**
 * «أين ينقص نشاطي؟» with the neighbours: the first `consider` residential districts reorder by their gap net of
 * the surplus next door (missing − the neighbours' businesses over their own need), so a gap a crowded neighbour
 * already serves no longer leads. The rest keep the service's order; flagged districts stay last.
 */
export function rankGapsAround<R extends GapVerdictRow>(short: R[], aroundOfRow: (row: R) => Around | null, consider = 10): (R & { around: Around | null; net?: number })[] {
  const lead = short.slice(0, consider).filter((row) => !row.caveat)
  const rest = short.filter((row) => !lead.includes(row))
  const scored = lead.map((row, index) => {
    const around = aroundOfRow(row)
    const missing = Math.round(row.expected_businesses ?? 0) - row.businesses
    return { ...row, around, net: missing - (around?.total ?? 0), index }
  })
  scored.sort((a, b) => b.net - a.net || a.index - b.index)
  return [...scored.map(({ index: _index, ...row }) => row as R & { around: Around | null; net: number }), ...rest.map((row) => ({ ...row, around: null }))]
}
