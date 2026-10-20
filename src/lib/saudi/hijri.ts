/*
 * Hijri dates on the Umm al-Qura calendar (the Kingdom's official civil calendar), from the browser's own
 * Intl data (islamic-umalqura). Nothing is computed by hand here: the month table is ICU's.
 */
const TZ = 'Asia/Riyadh'
let numeric: Intl.DateTimeFormat | null = null
let long: Intl.DateTimeFormat | null = null

/** { year, month (1 Muharram … 9 Ramadan … 12 Dhu al-Hijjah), day } for the Saudi calendar day of an instant. */
export function hijriParts(at: Date): { year: number; month: number; day: number } {
  numeric ??= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
  const p = Object.fromEntries(numeric.formatToParts(at).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
  return { year: parseInt(String(p.year), 10), month: parseInt(String(p.month), 10), day: parseInt(String(p.day), 10) }
}

/** «4 ربيع الآخر 1448 هـ» (Latin digits, like the rest of the app). */
export function hijriLabel(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  long ??= new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' })
  // ICU writes «… 1448 هـ»; keep one era mark whatever the ICU version prints
  return long.format(d).replace(/\s*هـ$/, '') + ' هـ'
}

/** «16 أكتوبر 2026» on the Gregorian calendar, Saudi day. */
export function gregorianLabel(at: Date | string | number): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}

/** Gregorian date with Western numerals, using the Saudi day. Kept under its existing name for callers. */
export function dualDateLabel(at: Date | string | number): string {
  return gregorianLabel(at)
}

/** Ramadan = Hijri month 9 on the Umm al-Qura calendar, Saudi day. */
export const isRamadan = (at: Date) => hijriParts(at).month === 9
