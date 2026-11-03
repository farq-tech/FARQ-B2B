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

/** «1,234 منشأة «صيدلية» في المدينة · الأكثر تنافساً: العليا». */
export function competitorsSummary(cityTotal: number | null, label: string, densest: CompetitorRow | null): string {
  const total = cityTotal == null ? `عدد منشآت «${label}» غير متاح` : `${numberFormat.format(cityTotal)} منشأة «${label}» في المدينة`
  return `${total}${densest ? ` · الأكثر تنافساً: ${densest.row.name}` : ''}`
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

const n = (value: number) => numberFormat.format(value)
/** «النرجس، الملقا والياسمين». */
const names = (list: string[]) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join('، ')} و${list[list.length - 1]}`)

/** «منطقتان», «5 مناطق», «12 منطقة». */
const areas = (count: number) => (count === 2 ? 'منطقتان' : `${n(count)} ${count >= 3 && count <= 10 ? 'مناطق' : 'منطقة'}`)

/** A gap row as «أين ينقص نشاطي؟» reads it (market-gaps). */
export type GapVerdictRow = { district_ar: string; businesses: number; expected_businesses: number; shortfall: number; caveat?: 'industrial' | 'workers' | null }

/**
 * «أكبر نقص في «صيدلية»: النرجس», with what it has against what it needs at the city rate, and the next two
 * districts of the same kind. A shortfall of one or two businesses, or a list of only industrial or labour-housing
 * districts, is said as a caution. `short` is the API's short districts in its order (largest first, caveats last).
 */
export function gapsVerdict(short: GapVerdictRow[], label: string, residentsPerBusiness: number): VerdictText | null {
  const top = short[0]
  if (!top) return null
  const need = Math.round(top.expected_businesses)
  const missing = need - top.businesses
  const next = short.filter((row) => row !== top && Boolean(row.caveat) === Boolean(top.caveat)).slice(0, 2)
  const why = [
    `فيه ${counted(top.businesses, 'business')} ويحتاج ${n(need)} بمعدل المدينة (منشأة لكل ${n(residentsPerBusiness)} ساكن).`,
    ...(next.length ? [`يليه ${names(next.map((row) => `${row.district_ar} (ناقص ${n(Math.round(row.expected_businesses) - row.businesses)})`))}.`] : []),
  ]
  const caution = top.caveat
    ? 'كل الأحياء الناقصة مناطق صناعية أو سكن عمال، فنقصها بعدد السكان لا يعني طلب أسر مقيمة.'
    : missing <= 2 ? `النقص في أعلى حي ${missing === 1 ? 'منشأة واحدة' : 'منشأتان'} فقط: الأحياء قريبة من معدل المدينة، فالفرصة ضعيفة.` : null
  return { lead: `أكبر نقص في «${label}»: ${top.district_ar}، ينقصه ${counted(missing, 'business')}`, why, caution }
}

/**
 * «المنافسون» in one line, for the order the visitor chose: the district where competition is densest, or the
 * populated district where it is lightest (none at all first). Thin data is said: a city count of which under nine in
 * ten fell in a known district, so the districts' counts are under the whole.
 */
export function competitorsVerdict<T extends CompetitorRow & { row: { name: string; population: number | null }; residentsPer?: number | null }>(
  ranked: T[], order: 'dense' | 'light', label: string, cityTotal: number | null, located: number | null,
): VerdictText | null {
  const top = ranked[0]
  if (!top) return null
  const density = (item: T) => (item.perKm2 == null ? null : `${n(Math.round(item.perKm2 * 10) / 10)} لكل كم²`)
  const partial = cityTotal != null && located != null && cityTotal > 0 && located < 0.9 * cityTotal
  const caution = partial ? `${n(located!)} فقط من ${n(cityTotal!)} منشأة «${label}» بحي معروف، فأعداد الأحياء أقل من الحقيقة.` : null
  if (order === 'dense') {
    return {
      lead: `أشد منافسة على «${label}»: ${top.row.name}`,
      why: [[counted(top.competitors, 'business'), density(top), top.residentsPer != null ? `ساكن لكل منافس: ${n(Math.round(top.residentsPer))}` : null].filter(Boolean).join(' · ') + '.'],
      caution,
    }
  }
  const empty = ranked.filter((item) => item.competitors === 0).length
  const people = top.row.population != null ? `${n(top.row.population)} ساكن` : null
  return {
    lead: `أخف منافسة على «${label}»: ${top.row.name}`,
    why: [
      top.competitors === 0
        ? `لا منافس فيه${people ? `، وفيه ${people}` : ''}.`
        : [`${counted(top.competitors, 'business')} فقط`, density(top), people].filter(Boolean).join(' · ') + '.',
      ...(empty > 1 ? [`${counted(empty, 'district')} مأهولة بلا أي منافس، والأكثر سكاناً أولاً.`] : []),
    ],
    caution,
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
    lead: share >= 50 ? `السلاسل تملك أكثر السوق: ${n(share)}%` : `أكثر السوق محلات مستقلة: السلاسل ${n(share)}% فقط`,
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
export function audienceVerdict(ranked: { name: string; size: number }[], unit: string, segment: string): VerdictText | null {
  const top = ranked[0]
  if (!top || top.size <= 0) return null
  const total = ranked.reduce((sum, item) => sum + item.size, 0)
  const share = Math.round((100 * ranked.slice(0, 5).reduce((sum, item) => sum + item.size, 0)) / total)
  return {
    lead: `أعلى حي لجمهورك${segment ? ` (${segment})` : ''}: ${top.name}`,
    why: [
      `فيه ${n(Math.round(top.size))} ${unit}${ranked[1] ? `، ويليه ${names(ranked.slice(1, 3).map((item) => item.name))}` : ''}.`,
      ...(ranked.length > 5 ? [`أعلى ${counted(5, 'district')} تجمع ${n(share)}% من الجمهور، ${share >= 50 ? 'فحملة مركّزة عليها تصل إلى أكثره' : 'فالجمهور موزّع على أحياء كثيرة'}.`] : []),
    ],
  }
}

/** A site in «قارن المواقع» with the three factors of its score; null where a factor is not available. */
export type SiteFactors = { id: number; audience: number | null; spending: number | null; density: number | null }

/**
 * «جاذبية الموقع»: a 0–100 score comparing the chosen sites on three equal factors (audience, purchasing power, and
 * lightness of competition per km²), each scaled to the best site; the score is their mean. A site missing a factor
 * gets none, and the score needs two complete sites, since it is a comparison.
 */
export function attractionScores(sites: SiteFactors[]): Map<number, number> {
  const complete = sites.filter((item) => item.audience != null && item.spending != null && item.density != null)
  const scores = new Map<number, number>()
  if (complete.length < 2) return scores
  const maxAudience = Math.max(...complete.map((item) => item.audience!))
  const maxSpending = Math.max(...complete.map((item) => item.spending!))
  const minDensity = Math.min(...complete.map((item) => item.density!))
  for (const item of complete) {
    const audience = maxAudience > 0 ? (100 * item.audience!) / maxAudience : 0
    const spending = maxSpending > 0 ? (100 * item.spending!) / maxSpending : 0
    const uncrowded = item.density! > 0 ? (100 * minDensity) / item.density! : 100
    scores.set(item.id, Math.round((audience + spending + uncrowded) / 3))
  }
  return scores
}

/**
 * «قارن المواقع» in one line: which site is the most attractive and on which factors it leads or trails, or that the
 * top two are level (within 3 points). A site without a score says which factor it is missing. The population quoted
 * is the service's figure in the table, so the reason reads what the visitor sees.
 */
export function sitesVerdict(sites: (SiteFactors & { label: string; population: number | null })[], scores: Map<number, number>, byIncome: boolean): VerdictText | null {
  if (sites.length === 0) return null
  if (sites.length === 1) return { lead: 'أضف موقعاً ثانياً لتعرف أيهما أجذب', why: ['اضغط على الخريطة في مكان آخر، فيُقاس بالنطاق نفسه.'] }
  const missing = sites.filter((site) => !scores.has(site.id)).map((site) => {
    const what = site.audience == null ? 'السكان' : site.spending == null ? (byIncome ? 'دخل حيه' : 'حصة الفلل في حيه') : 'كثافة المنشآت'
    return `الموقع ${site.label} (${what} غير متاح)`
  })
  const caution = missing.length ? `بلا درجة: ${missing.join('، ')}.` : null
  const scored = sites.filter((site) => scores.has(site.id)).sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)
  if (scored.length < 2) return { lead: 'جاذبية المواقع غير متاحة للمقارنة', why: ['الدرجة تحتاج موقعين لكل منهما عوامله الثلاثة.'], caution }
  const [best, second] = scored
  const gap = scores.get(best.id)! - scores.get(second.id)!
  if (gap <= 3) {
    return { lead: `الموقعان ${best.label} و${second.label} متقاربان: ${n(scores.get(best.id)!)} و${n(scores.get(second.id)!)} من 100`, why: ['الفرق أصغر من أن يحسم وحده: قارن المنافسين في بطاقة كل موقع.'], caution }
  }
  const others = scored.filter((site) => site !== best)
  const leads: string[] = []
  const lags: string[] = []
  const versus = (value: number | null, pick: (site: (typeof others)[number]) => number | null) => {
    const rival = others.map(pick).filter((v): v is number => v != null)
    return value == null || !rival.length ? null : value >= Math.max(...rival) ? 'lead' : 'lag'
  }
  const people = versus(best.population, (site) => site.population)
  if (people) (people === 'lead' ? leads : lags).push(`${people === 'lead' ? 'سكان أكثر' : 'سكان أقل'} (${n(Math.round(best.population!))})`)
  const spend = versus(best.spending, (site) => site.spending)
  if (spend) (spend === 'lead' ? leads : lags).push(byIncome ? `دخل حيه ${spend === 'lead' ? 'أعلى' : 'أقل'}` : `فلل ${spend === 'lead' ? 'أكثر' : 'أقل'} في حيه`)
  const crowd = versus(best.density == null ? null : -best.density, (site) => (site.density == null ? null : -site.density))
  if (crowd) (crowd === 'lead' ? leads : lags).push(crowd === 'lead' ? 'منافسة أخف' : 'منافسة أكثف')
  return {
    lead: `الموقع ${best.label} هو الأجذب: ${n(scores.get(best.id)!)} من 100`,
    why: [`${leads.length ? leads.join('، ') : 'لا يتقدم في عامل واحد'}${lags.length ? `، لكن ${lags.join('، ')}` : ''}.`],
    caution,
  }
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
      `${counted(top.n, 'shop')} منه، ${n(top.per_100m)} لكل 100 م${top.road_class === 'main' ? '، على شارع رئيسي' : ''}.`,
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
  const has = top.requested_n != null ? (top.requested_n === 0 ? `ولا محل «${label}» عليه` : `وعليه ${counted(top.requested_n, 'shop')} فقط من «${label}»`)
    : top.requested_below != null ? `و«${label}» عليه أقل من ${n(top.requested_below)} محلات` : `وعدد محلات «${label}» عليه غير متاح`
  return {
    lead: `أقوى فرصة لـ«${label}»: ${top.street_ar} (${n(top.score)} من 100)`,
    why: [
      `${counted(top.total, 'shop')} على الشارع ${has}.`,
      ...(top.nearest ? [`أقرب تجمع لـ«${label}»: ${top.nearest.street_ar}${top.nearest.distance_m < 30 ? '، يتقاطع معه أو يلاصقه' : ` على ${distance(top.nearest.distance_m)}`}.`] : []),
    ],
    caution: populationUsed ? null : 'سكان الأحياء غير متاحين هنا، فالدرجة من حركة الشارع التجارية وحدها.',
  }
}

/**
 * «المناطق والمسار» once the city is split: how even the reps' shares are (the largest against the smallest, each
 * the service's figure). A spread over a quarter of the largest is said, with the change most likely to even it.
 */
export function territoriesVerdict(weights: number[], weight: 'population' | 'businesses'): VerdictText | null {
  if (!weights.length) return null
  const unit = (value: number) => (weight === 'population' ? `${n(Math.round(value))} ساكن` : counted(Math.round(value), 'business'))
  const largest = Math.max(...weights)
  const smallest = Math.min(...weights)
  const uneven = largest > 0 && (largest - smallest) / largest > 0.25
  return {
    lead: `${uneven ? 'تقسيم غير متساوٍ' : 'تقسيم متوازن'}: ${areas(weights.length)} ${weight === 'population' ? 'بالسكان' : 'بالمنشآت'}`,
    why: [`أكبر حصة ${unit(largest)} وأصغرها ${unit(smallest)}.`],
    caution: uneven ? 'الحي الواحد لا يُقسم بين مندوبين، فحي كبير يرفع حصة منطقته. جرّب عدداً آخر من المندوبين.' : null,
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
