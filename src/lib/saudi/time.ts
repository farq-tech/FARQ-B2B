/*
 * Saudi local time. The Kingdom is on UTC+3 all year (no daylight saving), so «Riyadh time» is a fixed offset:
 * the same answer in the browser, in tests and in server.py, whatever the machine's own time zone is.
 */
export const KSA_OFFSET_MIN = 180
const MIN = 60_000

/** The calendar date and clock time in Saudi Arabia for an instant. weekday: 0 Sunday … 5 Friday, 6 Saturday. */
export function ksaParts(at: Date) {
  const t = new Date(at.getTime() + KSA_OFFSET_MIN * MIN)
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), weekday: t.getUTCDay(), hour: t.getUTCHours(), minute: t.getUTCMinutes() }
}

/** The instant of a Saudi wall-clock time on a Saudi calendar date. */
export function ksaInstant(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KSA_OFFSET_MIN * MIN)
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MIN)
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 60 * MIN)

/** «1:05 م» — Saudi clock, 12-hour, Latin digits (the app's number style). */
export function ksaClock(at: Date): string {
  const { hour, minute } = ksaParts(at)
  const h12 = ((hour + 11) % 12) + 1
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'ص' : 'م'}`
}
