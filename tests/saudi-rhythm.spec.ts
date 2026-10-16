import { expect, test } from '@playwright/test'
import {
  addBusinessDays, cityCoords, CITY_COORDS, crError, formatNationalAddress, hijriLabel, hijriParts, isBusinessDay, isRamadan, isValidCr,
  isValidShortAddress, isValidVat, isWeekendDay, ksaClock, ksaInstant, ksaParts, marketNameFor, MARKET_NAMES, nationalAddressErrors,
  nextAllowedSend, nextBusinessDay, occasionOn, prayerBlockMessage, prayerTimes, quietWindowAt, quietWindows, greeting, suggestedSendWindow,
  toBusinessDay, vatError, addDaysToBusinessDay, isSaudiEstablishment, EMPTY_NATIONAL_ADDRESS,
} from '../src/lib/saudi'

/*
 * Pure checks of the Saudi rhythm library (no browser page): prayer windows on the Umm al-Qura method, the
 * Sunday–Thursday week, Ramadan detection on the Umm al-Qura calendar, CR / VAT / national address validators,
 * popular market names, occasions and greeting.
 */
const RIYADH = cityCoords('Riyadh')!
const clock = (d: Date) => ksaClock(d)

test.describe('prayer windows (Umm al-Qura)', () => {
  test('Riyadh, 16 Oct 2026: times in the expected place (Umm al-Qura method, adhan)', () => {
    const p = prayerTimes(ksaInstant(2026, 10, 16, 9), RIYADH)
    // Riyadh, mid-October: Fajr ≈ 4:32, Dhuhr ≈ 11:39, Asr ≈ 2:57 م, Maghrib ≈ 5:26 م (±2 min); Isha = Maghrib + 90
    const near = (d: Date, h: number, m: number) => Math.abs(d.getTime() - ksaInstant(2026, 10, 16, h, m).getTime()) <= 2 * 60_000
    expect(near(p.fajr, 4, 32)).toBe(true)
    expect(near(p.dhuhr, 11, 39)).toBe(true)
    expect(near(p.asr, 14, 57)).toBe(true)
    expect(near(p.maghrib, 17, 26)).toBe(true)
    expect(p.isha.getTime() - p.maghrib.getTime()).toBe(90 * 60_000)
    expect(p.ramadan).toBe(false)
  })

  test('Isha is 120 minutes after Maghrib in Ramadan', () => {
    const at = ksaInstant(2027, 2, 20, 12)
    expect(isRamadan(at)).toBe(true)
    const p = prayerTimes(at, RIYADH)
    expect(p.ramadan).toBe(true)
    expect(p.isha.getTime() - p.maghrib.getTime()).toBe(120 * 60_000)
  })

  test('a window runs from the prayer to 25 minutes after it', () => {
    const p = prayerTimes(ksaInstant(2026, 10, 15, 9), RIYADH)
    expect(quietWindowAt(new Date(p.asr.getTime() - 60_000), RIYADH)).toBeNull()
    expect(quietWindowAt(p.asr, RIYADH)?.prayer).toBe('asr')
    expect(quietWindowAt(new Date(p.asr.getTime() + 24 * 60_000), RIYADH)?.prayer).toBe('asr')
    expect(quietWindowAt(new Date(p.asr.getTime() + 25 * 60_000), RIYADH)).toBeNull()
    expect(nextAllowedSend(p.asr, RIYADH).getTime()).toBe(p.asr.getTime() + 25 * 60_000)
    expect(prayerBlockMessage(p.asr, RIYADH)).toBe(`الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة ${clock(new Date(p.asr.getTime() + 25 * 60_000))}.`)
    expect(prayerBlockMessage(ksaInstant(2026, 10, 15, 10), RIYADH)).toBeNull()
  })

  test('Friday prayer: 11:30–13:30 Saudi time', () => {
    const fri = ksaInstant(2026, 10, 16, 11, 30)
    expect(ksaParts(fri).weekday).toBe(5)
    expect(quietWindowAt(ksaInstant(2026, 10, 16, 11, 29), RIYADH)).toBeNull()
    expect(quietWindowAt(fri, RIYADH)?.prayer).toBe('jumuah')
    expect(quietWindowAt(ksaInstant(2026, 10, 16, 13, 29), RIYADH)?.prayer).toBe('jumuah')
    expect(quietWindowAt(ksaInstant(2026, 10, 16, 13, 30), RIYADH)).toBeNull()
    expect(clock(nextAllowedSend(ksaInstant(2026, 10, 16, 12, 0), RIYADH))).toBe('1:30 م')
    expect(prayerBlockMessage(ksaInstant(2026, 10, 16, 12, 0), RIYADH)).toContain('صلاة الجمعة')
    // a Thursday at noon is Dhuhr's window, not Friday's
    expect(quietWindows(ksaInstant(2026, 10, 15, 12), RIYADH).some((w) => w.prayer === 'jumuah')).toBe(false)
  })

  test('the city changes the times (Jeddah is later than Dammam)', () => {
    const at = ksaInstant(2026, 10, 15, 9)
    const jed = prayerTimes(at, cityCoords('جدة')!), dmm = prayerTimes(at, cityCoords('Dammam')!)
    expect(jed.dhuhr.getTime() - dmm.dhuhr.getTime()).toBeGreaterThan(35 * 60_000)
  })

  test('the city table matches server.py (saudi_rhythm.py CITIES)', async () => {
    const { readFileSync } = await import('node:fs')
    const py = readFileSync('saudi_rhythm.py', 'utf8')
    for (const [k, v] of Object.entries(CITY_COORDS)) {
      const m = new RegExp(`'${k}':\\s*\\(([\\d.]+),\\s*([\\d.]+)`).exec(py)
      expect(m, k).not.toBeNull()
      expect(Number(m![1])).toBeCloseTo(v.lat, 3)
      expect(Number(m![2])).toBeCloseTo(v.lon, 3)
    }
  })
})

test.describe('working week Sunday–Thursday', () => {
  test('Friday and Saturday are the weekend', () => {
    expect(isWeekendDay('2026-10-16')).toBe(true) // Friday
    expect(isWeekendDay('2026-10-17')).toBe(true) // Saturday
    expect(isBusinessDay('2026-10-18')).toBe(true) // Sunday
    expect(isBusinessDay('2026-10-15')).toBe(true) // Thursday
  })
  test('next business day skips Friday and Saturday', () => {
    expect(nextBusinessDay('2026-10-15')).toBe('2026-10-18') // Thu → Sun
    expect(nextBusinessDay('2026-10-18')).toBe('2026-10-19')
    expect(toBusinessDay('2026-10-17')).toBe('2026-10-18')
    expect(toBusinessDay('2026-10-14')).toBe('2026-10-14')
    expect(addBusinessDays('2026-10-15', 3)).toBe('2026-10-20')
    expect(addDaysToBusinessDay('2026-10-14', 2)).toBe('2026-10-18') // Wed + 2 = Fri → Sun
  })
})

test.describe('Hijri calendar and Ramadan', () => {
  test('Umm al-Qura dates', () => {
    expect(hijriParts(ksaInstant(2026, 10, 16, 12))).toEqual({ year: 1448, month: 5, day: 5 })
    expect(hijriLabel(ksaInstant(2026, 10, 16, 12))).toMatch(/^5 جمادى الأولى 1448 هـ$/)
  })
  test('Ramadan detection', () => {
    expect(isRamadan(ksaInstant(2026, 10, 16, 12))).toBe(false)
    expect(isRamadan(ksaInstant(2027, 2, 20, 12))).toBe(true)
    expect(isRamadan(ksaInstant(2026, 3, 1, 12))).toBe(true) // Ramadan 1447
    expect(suggestedSendWindow(ksaInstant(2027, 2, 20, 12))).toMatchObject({ ramadan: true, from: [21, 30], to: [1, 0] })
    expect(suggestedSendWindow(ksaInstant(2026, 10, 16, 12)).ramadan).toBe(false)
  })
  test('occasions', () => {
    expect(occasionOn(ksaInstant(2026, 9, 23, 10))?.title).toBe('اليوم الوطني السعودي')
    expect(occasionOn(ksaInstant(2027, 2, 22, 10))?.title).toBe('يوم التأسيس')
    expect(occasionOn(ksaInstant(2026, 10, 16, 10))).toBeNull()
    // 1 Shawwal 1447 and 10 Dhu al-Hijjah 1447 on the Umm al-Qura calendar
    const fitr = Array.from({ length: 40 }, (_, i) => ksaInstant(2026, 3, 1 + i, 10)).find((d) => hijriParts(d).month === 10)!
    expect(occasionOn(fitr)?.id).toBe('eid-fitr-1447')
    const adha = Array.from({ length: 60 }, (_, i) => ksaInstant(2026, 5, 1 + i, 10)).find((d) => hijriParts(d).month === 12 && hijriParts(d).day === 10)!
    expect(occasionOn(adha)?.id).toBe('eid-adha-1447')
  })
  test('greeting by Saudi time', () => {
    expect(greeting(ksaInstant(2026, 10, 16, 11, 59))).toBe('صباح الخير')
    expect(greeting(ksaInstant(2026, 10, 16, 12, 0))).toBe('مساء النور')
  })
})

test.describe('CR / VAT / national address', () => {
  test('commercial registration: 10 digits', () => {
    expect(isValidCr('1010123456')).toBe(true)
    expect(isValidCr('١٠١٠١٢٣٤٥٦')).toBe(true)
    expect(isValidCr('101012345')).toBe(false)
    expect(isValidCr('10101234567')).toBe(false)
    expect(isValidCr('10101234a6')).toBe(false)
    expect(crError('')).toBeNull()
    expect(crError('123')).toBe('السجل التجاري ١٠ أرقام.')
  })
  test('VAT: 15 digits, starts and ends with 3', () => {
    expect(isValidVat('300000000000003')).toBe(true)
    expect(isValidVat('310123456700003')).toBe(true)
    expect(isValidVat('210123456700003')).toBe(false)
    expect(isValidVat('310123456700002')).toBe(false)
    expect(isValidVat('31012345670003')).toBe(false)
    expect(vatError('31012345670003')).toBe('الرقم الضريبي ١٥ رقمًا.')
    expect(vatError('310123456700002')).toBe('الرقم الضريبي يبدأ بـ 3 وينتهي بـ 3.')
    expect(vatError('')).toBeNull()
  })
  test('national address', () => {
    expect(isValidShortAddress('RRRD2929')).toBe(true)
    expect(isValidShortAddress('rrrd 2929')).toBe(true)
    expect(isValidShortAddress('RRR2929')).toBe(false)
    expect(isValidShortAddress('RRRD292')).toBe(false)
    expect(nationalAddressErrors(EMPTY_NATIONAL_ADDRESS)).toEqual({})
    const a = { shortAddress: 'RRRD2929', buildingNo: '2929', street: 'شارع الأمير محمد بن عبدالعزيز', district: 'العليا', city: 'الرياض', postalCode: '12241', additionalNo: '7788' }
    expect(nationalAddressErrors(a)).toEqual({})
    expect(Object.keys(nationalAddressErrors({ ...a, shortAddress: 'XX', postalCode: '1224', buildingNo: '29' })).sort()).toEqual(['buildingNo', 'postalCode', 'shortAddress'])
    expect(formatNationalAddress(a)).toBe('RRRD2929 · 2929 شارع الأمير محمد بن عبدالعزيز · حي العليا · الرياض 12241 · الرقم الإضافي 7788')
  })
})

test.describe('market names and «منشأة سعودية»', () => {
  test('a popular name needs city + district + trade', () => {
    const c = { district_ar: 'الديرة', street_ar: null, sub_ar: 'أقمشة', label_ar: 'أقمشة — الديرة' }
    expect(marketNameFor(c, 'Riyadh')).toBe('سوق الزل للأقمشة')
    expect(marketNameFor(c, 'الرياض')).toBe('سوق الزل للأقمشة')
    expect(marketNameFor(c, 'Jeddah')).toBeNull()
    expect(marketNameFor({ ...c, district_ar: 'العليا' }, 'Riyadh')).toBeNull()
    expect(marketNameFor({ ...c, sub_ar: 'أدوات صحية', label_ar: '' }, 'Riyadh')).toBeNull()
    expect(marketNameFor({ district_ar: 'حي السلي', street_ar: null, sub_ar: 'قطع غيار سيارات', label_ar: '' }, 'Riyadh')).toBe('صناعية السلي')
    // unconfirmed names never show
    expect(marketNameFor({ district_ar: 'الملك فيصل', street_ar: 'شارع خالد بن الوليد', sub_ar: 'أدوات صحية وسباكة', label_ar: '' }, 'Riyadh')).toBeNull()
    expect(MARKET_NAMES.length).toBeLessThanOrEqual(10)
  })
  test('the badge needs data, never a guess', () => {
    expect(isSaudiEstablishment({ cr_number: '1010123456' })).toBe(true)
    expect(isSaudiEstablishment({ cr_number: '123' })).toBe(false)
    expect(isSaudiEstablishment({ sources: ['firms_license'] })).toBe(true)
    expect(isSaudiEstablishment({ commercial_license: '41012345' })).toBe(true)
    expect(isSaudiEstablishment({ sources: ['osm', 'farq_supplier'] })).toBe(false)
    expect(isSaudiEstablishment(null)).toBe(false)
  })
})
