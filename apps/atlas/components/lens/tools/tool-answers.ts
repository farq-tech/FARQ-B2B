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
