import { ksaParts } from './time'

/*
 * The Saudi working week: Sunday to Thursday. Friday and Saturday are the weekend.
 * Dates here are calendar days written «YYYY-MM-DD» (what <input type="date"> gives), read as Saudi days.
 */
export const WEEKEND_DAYS = [5, 6] as const // Friday, Saturday (Date.getUTCDay numbering)
export const WEEK_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const toUtc = (iso: string) => { const m = ISO.exec(iso); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null }
const toIso = (d: Date) => d.toISOString().slice(0, 10)

/** 0 Sunday … 6 Saturday for a «YYYY-MM-DD» day; -1 when it is not a date. */
export function weekdayOf(iso: string): number { const d = toUtc(iso); return d ? d.getUTCDay() : -1 }
export const isWeekendDay = (iso: string) => (WEEKEND_DAYS as readonly number[]).includes(weekdayOf(iso))
export const isBusinessDay = (iso: string) => weekdayOf(iso) >= 0 && !isWeekendDay(iso)

/** The day itself when it is a working day, else the Sunday after. */
export function toBusinessDay(iso: string): string {
  const d = toUtc(iso)
  if (!d) return iso
  while ((WEEKEND_DAYS as readonly number[]).includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1)
  return toIso(d)
}

/** The next working day strictly after `iso` (Thursday → Sunday). */
export function nextBusinessDay(iso: string): string {
  const d = toUtc(iso)
  if (!d) return iso
  d.setUTCDate(d.getUTCDate() + 1)
  return toBusinessDay(toIso(d))
}

/** `n` working days after `iso` (weekend days are not counted). */
export function addBusinessDays(iso: string, n: number): string {
  let out = iso
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) out = nextBusinessDay(out)
  return out
}

/** `n` calendar days after `iso`, moved forward to a working day when it lands on the weekend. */
export function addDaysToBusinessDay(iso: string, n: number): string {
  const d = toUtc(iso)
  if (!d) return iso
  d.setUTCDate(d.getUTCDate() + Math.round(n))
  return toBusinessDay(toIso(d))
}

/** Today in Saudi Arabia as «YYYY-MM-DD». */
export function ksaToday(at: Date = new Date()): string {
  const { year, month, day } = ksaParts(at)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** «الجمعة إجازة نهاية الأسبوع» — or null on a working day. */
export function weekendNote(iso: string): string | null {
  return isWeekendDay(iso) ? `${WEEK_AR[weekdayOf(iso)]} إجازة نهاية الأسبوع، وأقرب يوم عمل ${WEEK_AR[weekdayOf(toBusinessDay(iso))]} ${toBusinessDay(iso)}.` : null
}
