/*
 * Centre coordinates of Saudi cities, for prayer times only (a few km off changes a prayer time by seconds).
 * Keys are the targeting service's city names: English (City.en, e.g. «Riyadh») and Arabic (City.ar).
 * server.py keeps the same table (saudi_rhythm.py CITIES); tests/saudi-rhythm.spec.ts checks they agree.
 */
export type LatLon = { lat: number; lon: number }

export const CITY_COORDS: Record<string, LatLon & { ar: string }> = {
  riyadh: { lat: 24.7136, lon: 46.6753, ar: 'الرياض' },
  jeddah: { lat: 21.4858, lon: 39.1925, ar: 'جدة' },
  makkah: { lat: 21.3891, lon: 39.8579, ar: 'مكة المكرمة' },
  madinah: { lat: 24.5247, lon: 39.5692, ar: 'المدينة المنورة' },
  dammam: { lat: 26.4207, lon: 50.0888, ar: 'الدمام' },
  khobar: { lat: 26.2172, lon: 50.1971, ar: 'الخبر' },
  dhahran: { lat: 26.2361, lon: 50.0393, ar: 'الظهران' },
  qatif: { lat: 26.5196, lon: 50.0115, ar: 'القطيف' },
  jubail: { lat: 27.0046, lon: 49.6460, ar: 'الجبيل' },
  hofuf: { lat: 25.3833, lon: 49.5833, ar: 'الأحساء' },
  taif: { lat: 21.2703, lon: 40.4158, ar: 'الطائف' },
  tabuk: { lat: 28.3835, lon: 36.5662, ar: 'تبوك' },
  abha: { lat: 18.2164, lon: 42.5053, ar: 'أبها' },
  'khamis mushait': { lat: 18.3000, lon: 42.7333, ar: 'خميس مشيط' },
  buraydah: { lat: 26.3260, lon: 43.9750, ar: 'بريدة' },
  unaizah: { lat: 26.0840, lon: 43.9940, ar: 'عنيزة' },
  hail: { lat: 27.5114, lon: 41.7208, ar: 'حائل' },
  jazan: { lat: 16.8892, lon: 42.5511, ar: 'جازان' },
  najran: { lat: 17.4933, lon: 44.1277, ar: 'نجران' },
  'al bahah': { lat: 20.0129, lon: 41.4677, ar: 'الباحة' },
  arar: { lat: 30.9753, lon: 41.0381, ar: 'عرعر' },
  sakaka: { lat: 29.9697, lon: 40.2064, ar: 'سكاكا' },
  yanbu: { lat: 24.0895, lon: 38.0618, ar: 'ينبع' },
  'hafar al batin': { lat: 28.4328, lon: 45.9708, ar: 'حفر الباطن' },
  'al kharj': { lat: 24.1556, lon: 47.3120, ar: 'الخرج' },
}

const ALIAS: Record<string, string> = {
  mecca: 'makkah', 'makkah al mukarramah': 'makkah', medina: 'madinah', 'al madinah': 'madinah', 'al madinah al munawwarah': 'madinah',
  'al khobar': 'khobar', 'al hofuf': 'hofuf', 'al ahsa': 'hofuf', 'al hasa': 'hofuf', 'al-ahsa': 'hofuf', buraidah: 'buraydah', 'ha\'il': 'hail',
  jizan: 'jazan', gizan: 'jazan', 'al jubail': 'jubail', 'al qatif': 'qatif', 'al taif': 'taif', 'ta\'if': 'taif', 'al baha': 'al bahah',
  'hafr al batin': 'hafar al batin', 'hafr al-batin': 'hafar al batin', kharj: 'al kharj', 'khamis mushayt': 'khamis mushait',
}
const norm = (s: string) => s.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
const arNorm = (s: string) => s.trim().replace(/[أإآ]/g, 'ا').replace(/ة$/, 'ه').replace(/\s+/g, ' ')
const BY_AR = Object.fromEntries(Object.entries(CITY_COORDS).flatMap(([k, v]) => [[arNorm(v.ar), k], [arNorm(v.ar.split(' ')[0]), k]]))
Object.assign(BY_AR, { [arNorm('مكه')]: 'makkah', [arNorm('المدينه')]: 'madinah', [arNorm('الاحساء')]: 'hofuf', [arNorm('الهفوف')]: 'hofuf', [arNorm('جده')]: 'jeddah' })

/** The coordinates of a city by its English or Arabic name; null when the table does not know it. */
export function cityCoords(name: string | null | undefined): LatLon | null {
  if (!name) return null
  const k = norm(name)
  const hit = CITY_COORDS[k] || CITY_COORDS[ALIAS[k]] || CITY_COORDS[BY_AR[arNorm(name)]]
  return hit ? { lat: hit.lat, lon: hit.lon } : null
}

/** The capital: the fallback for prayer times when the city is not known yet. */
export const RIYADH: LatLon = { lat: CITY_COORDS.riyadh.lat, lon: CITY_COORDS.riyadh.lon }
