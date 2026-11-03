/**
 * The one line «أين ينقص نشاطي؟» hands the phone's peeking sheet, from the API's answer as returned: its districts
 * come largest shortfall first, so the first short one is the top. The shortfall is said in words («بنقص 122 منشأة»),
 * not as a signed figure: a «+» beside a Latin number inside an Arabic line can drift to the wrong side of it.
 * The formatters come in so the line is tested with the real ones (lib/insights-api.ts counted and numberFormat).
 */
export type GapRow = { district_ar: string; shortfall: number }

export function gapsSummary(
  result: { residents_per_business: number | null; districts: GapRow[] } | null,
  counted: (value: number, noun: 'district' | 'business') => string,
): string | null {
  if (!result || result.residents_per_business == null) return null
  const short = result.districts.filter((row) => row.shortfall > 0)
  const top = short[0]
  if (!top) return 'لا نقص في أي حي'
  // the top district leads: on a phone the line is cut at its end, and the count of districts matters least
  return `الأعلى: ${top.district_ar} بنقص ${counted(Math.round(top.shortfall), 'business')} · ${counted(short.length, 'district')} فيها نقص`
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
  const short = Math.round(row.shortfall)
  if (short >= 1) return `بنقص ${counted(short, 'business')}`
  return row.businesses == null ? 'مكتفٍ' : `مكتفٍ: فيه ${counted(row.businesses, 'business')}`
}
