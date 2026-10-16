// Writes tests/fixtures/prayer-umalqura.json: prayer times from the npm package `adhan` (Umm al-Qura, Shafi), the same
// call src/lib/saudi/prayer.ts makes, for tests/python/test_saudi_rhythm.py to check saudi_rhythm.py against.
// In Ramadan (Umm al-Qura month 9, Saudi day) Isha is Maghrib + 120 minutes, like prayer.ts.
// Run: node scripts/gen-prayer-fixture.mjs
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { CalculationMethod, Coordinates, Madhab, PrayerTimes } = require('adhan')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CITIES = { riyadh: [24.7136, 46.6753], jeddah: [21.4858, 39.1925], dammam: [26.4207, 50.0888], tabuk: [28.3835, 36.5662], jazan: [16.8892, 42.5511], abha: [18.2164, 42.5053] }
const DATES = ['2026-01-15', '2026-03-01', '2026-03-19', '2026-06-21', '2026-09-23', '2026-10-16', '2026-12-21', '2027-02-20', '2027-04-10', '2027-07-30', '2027-11-05', '2028-02-10', '2028-08-15']

const hijri = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'numeric', day: 'numeric' })
const isRamadan = (y, m, d) => hijri.formatToParts(new Date(Date.UTC(y, m - 1, d, 9))).find((x) => x.type === 'month').value === '9'

const cases = []
for (const [city, [lat, lon]] of Object.entries(CITIES)) {
  for (const date of DATES) {
    const [y, m, d] = date.split('-').map(Number)
    const params = CalculationMethod.UmmAlQura()
    params.madhab = Madhab.Shafi
    // adhan reads the calendar date from the Date's local fields
    const t = new PrayerTimes(new Coordinates(lat, lon), new Date(y, m - 1, d), params)
    const ramadan = isRamadan(y, m, d)
    const isha = ramadan ? new Date(t.maghrib.getTime() + 120 * 60000) : t.isha
    cases.push({ city, lat, lon, date, ramadan, fajr: t.fajr.toISOString(), sunrise: t.sunrise.toISOString(), dhuhr: t.dhuhr.toISOString(), asr: t.asr.toISOString(), maghrib: t.maghrib.toISOString(), isha: isha.toISOString() })
  }
}
const file = join(ROOT, 'tests', 'fixtures', 'prayer-umalqura.json')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, JSON.stringify({ source: 'adhan CalculationMethod.UmmAlQura(), Madhab.Shafi; isha = maghrib + 120 in Ramadan', cases }, null, 1) + '\n')
console.log(`wrote ${cases.length} cases to ${file}`)
