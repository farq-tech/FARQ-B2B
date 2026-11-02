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
export function audienceSummary({ selected, scope, segment, sizes, unit, top }: { selected: number; scope: number; segment: string; sizes: number[]; unit: string; top: string | null }): string {
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
