import { hijriParts, isRamadan } from './hijri'
import { ksaParts } from './time'

/*
 * The Saudi rhythm of the day: greeting, suggested send windows (Ramadan moves them after iftar and taraweeh),
 * and the occasions banner (Eid al-Fitr, Eid al-Adha on the Hijri calendar; National Day 23 Sep; Founding Day 22 Feb).
 * Wording is plain and quiet: no flag, no emblem, no religious imagery.
 */

/** «صباح الخير» before 12:00 Saudi time, otherwise «مساء النور». */
export const greeting = (at: Date = new Date()) => (ksaParts(at).hour < 12 ? 'صباح الخير' : 'مساء النور')

export type SendWindow = { ramadan: boolean; label: string; from: [number, number]; to: [number, number] }
/** When campaigns tend to get replies: working hours normally; after iftar and taraweeh in Ramadan. */
export function suggestedSendWindow(at: Date = new Date()): SendWindow {
  if (isRamadan(at)) return { ramadan: true, label: 'أنسب وقت للإرسال في رمضان: بعد التراويح، من 9:30 م إلى 1:00 ص', from: [21, 30], to: [1, 0] }
  return { ramadan: false, label: 'أنسب وقت للإرسال: الأحد إلى الخميس، من 9:00 ص إلى 12:00 م ومن 4:30 م إلى 9:00 م', from: [9, 0], to: [21, 0] }
}

/** A reminder time on a Saudi day: 10:00 normally, 21:30 (after taraweeh) in Ramadan. */
export const reminderHour = (at: Date = new Date()): [number, number] => (isRamadan(at) ? [21, 30] : [10, 0])

export type Occasion = { id: string; title: string; text: string }

/** The occasion of this Saudi day, or null. `id` is unique per year (for «don't show again»). */
export function occasionOn(at: Date = new Date()): Occasion | null {
  const g = ksaParts(at)
  const h = hijriParts(at)
  if (h.month === 10 && h.day <= 3) return { id: `eid-fitr-${h.year}`, title: 'عيدكم مبارك', text: 'كل عام وأنتم بخير، وعساكم من عوّاده.' }
  if (h.month === 12 && h.day >= 10 && h.day <= 13) return { id: `eid-adha-${h.year}`, title: 'عيدكم مبارك', text: 'كل عام وأنتم بخير، وعيد أضحى سعيد.' }
  if (g.month === 9 && g.day === 23) return { id: `national-day-${g.year}`, title: 'اليوم الوطني السعودي', text: 'كل عام والوطن بخير.' }
  if (g.month === 2 && g.day === 22) return { id: `founding-day-${g.year}`, title: 'يوم التأسيس', text: 'يوم بدينا. كل عام والوطن بخير.' }
  return null
}
