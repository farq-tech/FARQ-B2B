import { isRamadan } from './hijri'
import { quietWindowAt } from './prayer'
import { RIYADH, type LatLon } from './cities'
import { addMinutes, ksaInstant, ksaParts } from './time'

/*
 * Default time for a scheduled campaign (owner 2026-10-16): the next allowed window — never during prayer
 * (prayer + 25 min, Friday 11:30–13:30), Sunday–Thursday preferred, working windows 9:00–12:00 and 16:30–21:00;
 * in Ramadan the after-taraweeh window 21:30–01:00. Saudi time throughout (UTC+3).
 */
const STEP = 15

function inWindow(t: Date): boolean {
  const { hour, minute, weekday } = ksaParts(t)
  const m = hour * 60 + minute
  if (isRamadan(t)) {
    // 21:30–24:00 on Sun–Thu evenings, 00:00–01:00 belongs to the evening before
    if (m >= 21 * 60 + 30) return weekday <= 4
    if (m < 60) return weekday >= 1 && weekday <= 5
    return false
  }
  if (weekday > 4) return false
  return (m >= 9 * 60 && m < 12 * 60) || (m >= 16 * 60 + 30 && m < 21 * 60)
}

/** The first 15-minute slot from `now` (+15 min lead) inside the preferred window and outside every prayer window. */
export function nextScheduleSlot(now: Date = new Date(), where: LatLon = RIYADH): Date {
  const lead = addMinutes(now, STEP)
  const p = ksaParts(lead)
  let t = ksaInstant(p.year, p.month, p.day, p.hour, Math.ceil(p.minute / STEP) * STEP)
  for (let i = 0; i < (8 * 24 * 60) / STEP; i++) {
    if (inWindow(t) && !quietWindowAt(t, where)) return t
    t = addMinutes(t, STEP)
  }
  return lead
}

/** «2026-10-18T09:00» for an <input type="datetime-local">, in Saudi time. */
export function toKsaInput(at: Date): string {
  const { year, month, day, hour, minute } = ksaParts(at)
  const z = (v: number) => String(v).padStart(2, '0')
  return `${year}-${z(month)}-${z(day)}T${z(hour)}:${z(minute)}`
}

/** The instant of a Saudi «YYYY-MM-DDTHH:mm» value, or null. */
export function fromKsaInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  return ksaInstant(+m[1], +m[2], +m[3], +m[4], +m[5])
}

/** Why a chosen time is not a good one (null = fine). Prayer is a hard stop; the rest is advice. */
export function scheduleWarning(at: Date, now: Date = new Date(), where: LatLon = RIYADH): string | null {
  if (at.getTime() <= now.getTime()) return 'اختر وقتاً قادماً.'
  if (quietWindowAt(at, where)) return 'هذا الوقت وقت صلاة؛ الإرسال ينتظر. اختر وقتاً بعدها.'
  if (!inWindow(at)) return isRamadan(at) ? 'في رمضان الأنسب بعد التراويح (9:30 م – 1:00 ص).' : 'الأنسب الأحد إلى الخميس، 9:00 ص – 12:00 م أو 4:30 م – 9:00 م.'
  return null
}
