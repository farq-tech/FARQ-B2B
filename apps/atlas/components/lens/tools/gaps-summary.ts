/**
 * The one line «أين ينقص نشاطي؟» hands the phone's peeking sheet, from the API's answer as returned: its districts
 * come largest shortfall first, so the first short one is the top. The shortfall is said in words («بنقص 122 منشأة»),
 * not as a signed figure: a «+» beside a Latin number inside an Arabic line can drift to the wrong side of it.
 * The formatters come in so the line is tested with the real ones (lib/insights-api.ts counted and numberFormat).
 */
// shortfall is null when the population model does not hold (the count is not population-driven here); such a
// district is never «short», it is simply listed by its real count
export type GapRow = { district_ar: string; shortfall: number | null }

/** Short by at least one whole business («ناقص 1» or more), the one rule the list, the map and the peek line share. */
export const isShortRow = (row: GapRow) => Math.round(row.shortfall ?? 0) > 0

export function gapsSummary(
  result: { residents_per_business: number | null; districts: GapRow[] } | null,
  counted: (value: number, noun: 'district' | 'business') => string,
): string | null {
  if (!result || result.residents_per_business == null) return null
  // short by at least one whole business, as the list and the map read it: a shortfall under half a business rounds
  // to «ناقص 0», so it is not counted here either, and the line's count agrees with the list's
  const short = result.districts.filter(isShortRow)
  const top = short[0]
  if (!top) return 'لا نقص في أي حي'
  // the top district leads: on a phone the line is cut at its end, and the count of districts matters least
  return `الأعلى: ${top.district_ar} بنقص ${counted(Math.round(top.shortfall ?? 0), 'business')} · ${counted(short.length, 'district')} ${short.length === 1 ? 'فيه' : 'فيها'} نقص`
}

/**
 * The line the card beside the pointer gives a district while «أين ينقص نشاطي؟» colours the map, from the same answer
 * as the list: its shortfall in words, or «مكتفٍ» with the businesses it has. A district the answer leaves out says
 * why (no population, or under the API's floor of residents), so its blank on the map is read, not guessed.
 */
export function gapsHoverLine(
  row: (GapRow & { businesses?: number }) | undefined,
  population: number | null,
  minPopulation: number,
  counted: (value: number, noun: 'district' | 'business') => string,
  numberFormat: { format: (value: number) => string },
): string {
  if (!row) return population == null ? 'لا يُحسب: السكان غير متاح' : `لا يُحسب: أقل من ${numberFormat.format(minPopulation)} ساكن`
  const short = Math.round(row.shortfall ?? 0)
  if (short >= 1) return `بنقص ${counted(short, 'business')}`
  return row.businesses == null ? 'مكتفٍ' : `مكتفٍ: فيه ${counted(row.businesses, 'business')}`
}

/**
 * The line closing the visible part of the list while its industrial and labour-housing districts (listed last) are
 * still below the cut: «و3 مناطق صناعية أو سكن عمال في الأسفل». Null when none is hidden.
 */
export function hiddenCaveatsLine(hidden: number, numberFormat: { format: (value: number) => string }): string | null {
  if (hidden <= 0) return null
  const areas = hidden === 1 ? 'منطقة واحدة صناعية' : hidden === 2 ? 'منطقتان صناعيتان'
    : `${numberFormat.format(hidden)} ${hidden % 100 >= 3 && hidden % 100 <= 10 ? 'مناطق صناعية' : 'منطقة صناعية'}`
  return `و${areas} أو سكن عمال في الأسفل`
}
