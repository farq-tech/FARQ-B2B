import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan'
import { isRamadan } from './hijri'
import { addMinutes, ksaClock, ksaInstant, ksaParts } from './time'
import { RIYADH, type LatLon } from './cities'

/*
 * Prayer times, computed locally on the Umm al-Qura method (adhan, MIT): Fajr at 18.5°, Asr by the shadow factor 1,
 * Maghrib at sunset, Isha 90 minutes after Maghrib — 120 minutes in Ramadan.
 *
 * Owner rule (2026-10-16): a WhatsApp campaign is not sent from the start of a prayer until 25 minutes after it,
 * nor during Friday prayer (11:30–13:30 Saudi time). server.py enforces it on the send path (saudi_rhythm.py, the same
 * method); the screens only say so ahead of time.
 */
export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | 'jumuah'
export const PRAYER_AR: Record<PrayerName, string> = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة' }
/** Minutes after a prayer starts during which sends wait. */
export const PRAYER_WINDOW_MIN = 25
/** Friday prayer window, Saudi wall clock. */
export const FRIDAY_WINDOW = { from: [11, 30], to: [13, 30] } as const

export type DayPrayers = Record<Exclude<PrayerName, 'jumuah'>, Date> & { sunrise: Date; ramadan: boolean }

/** The five prayers of the Saudi calendar day that contains `at`, for a place. */
export function prayerTimes(at: Date, where: LatLon = RIYADH): DayPrayers {
  const { year, month, day } = ksaParts(at)
  const params = CalculationMethod.UmmAlQura()
  params.madhab = Madhab.Shafi
  // adhan reads the calendar date from the Date's local fields: build it from the Saudi date
  const t = new PrayerTimes(new Coordinates(where.lat, where.lon), new Date(year, month - 1, day), params)
  const ramadan = isRamadan(ksaInstant(year, month, day, 12))
  return { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: ramadan ? addMinutes(t.maghrib, 120) : t.isha, ramadan }
}

export type QuietWindow = { prayer: PrayerName; from: Date; to: Date }

/** The windows of one Saudi day when campaigns wait: each prayer + 25 min, and Friday 11:30–13:30. */
export function quietWindows(at: Date, where: LatLon = RIYADH): QuietWindow[] {
  const p = prayerTimes(at, where)
  const list: QuietWindow[] = (['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => ({ prayer: k, from: p[k], to: addMinutes(p[k], PRAYER_WINDOW_MIN) }))
  const { year, month, day, weekday } = ksaParts(at)
  if (weekday === 5) {
    const from = ksaInstant(year, month, day, FRIDAY_WINDOW.from[0], FRIDAY_WINDOW.from[1])
    const to = ksaInstant(year, month, day, FRIDAY_WINDOW.to[0], FRIDAY_WINDOW.to[1])
    // Friday prayer replaces Dhuhr; keep the later end if Dhuhr's window runs past 13:30
    const dhuhr = list.find((w) => w.prayer === 'dhuhr')!
    list.splice(list.indexOf(dhuhr), 1, { prayer: 'jumuah', from: dhuhr.from < from ? dhuhr.from : from, to: dhuhr.to > to ? dhuhr.to : to })
  }
  return list.sort((a, b) => a.from.getTime() - b.from.getTime())
}

/** The quiet window `at` falls in, or null. */
export function quietWindowAt(at: Date, where: LatLon = RIYADH): QuietWindow | null {
  return quietWindows(at, where).find((w) => at >= w.from && at < w.to) || null
}

/** The first moment from `at` on that is outside every quiet window. */
export function nextAllowedSend(at: Date, where: LatLon = RIYADH): Date {
  let t = at
  for (let i = 0; i < 6; i++) {
    const w = quietWindowAt(t, where)
    if (!w) return t
    t = w.to
  }
  return t
}

/** The Arabic sentence the send path returns when a campaign waits for prayer. */
export function prayerBlockMessage(at: Date, where: LatLon = RIYADH): string | null {
  const w = quietWindowAt(at, where)
  if (!w) return null
  return `الحين وقت صلاة ${PRAYER_AR[w.prayer]}، فما أرسلنا الحملة. تقدر ترسلها من الساعة ${ksaClock(nextAllowedSend(at, where))}.`
}

/** Today's prayers as «الفجر 4:33 ص» … for small print. */
export function prayerLine(at: Date, where: LatLon = RIYADH): string {
  const p = prayerTimes(at, where)
  return (['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => `${PRAYER_AR[k]} ${ksaClock(p[k])}`).join(' · ')
}

