import assert from 'node:assert/strict'
import test from 'node:test'
import { cityLabel, numberFormat, parseCityCatalog } from './insights-api.ts'
import { formatSar } from './format.ts'

test('Atlas number formatter uses English digits and separators', () => {
  assert.equal(numberFormat.format(12345), '12,345')
  assert.equal(numberFormat.format(28), '28')
  assert.equal(formatSar(12345), '12,345 ر.س', 'currency in request views must reuse the Atlas formatter')
})

test('city catalog keeps cities without neighborhood boundaries and labels the coverage gap', () => {
  assert.deepEqual(parseCityCatalog([
    { en: 'Riyadh', ar: 'الرياض', n: 1000, districts: 145 },
    { en: 'Unaizah', ar: 'عنيزة', n: 2000, districts: 90 },
    { en: 'Unsupported', ar: 'غير مدعومة', n: 3000, districts: 0 },
  ]), [
    { en: 'Riyadh', ar: 'الرياض', districts: 145 },
    { en: 'Unaizah', ar: 'عنيزة', districts: 90 },
    { en: 'Unsupported', ar: 'غير مدعومة', districts: 0 },
  ])
  assert.equal(cityLabel({ en: 'Bariq', ar: 'بارق', districts: 0 }), 'بارق · الأحياء غير متاحة')
  assert.equal(cityLabel({ en: 'Riyadh', ar: 'الرياض', districts: 145 }), 'الرياض')
})

test('city catalog rejects incomplete or empty responses instead of accepting a partial list', () => {
  assert.throws(() => parseCityCatalog([{ en: 'Riyadh', ar: 'الرياض', districts: '145' }]))
  assert.throws(() => parseCityCatalog({ error: 'UNAVAILABLE' }))
  assert.deepEqual(parseCityCatalog([{ en: 'Unsupported', ar: 'غير مدعومة', districts: 0 }]), [
    { en: 'Unsupported', ar: 'غير مدعومة', districts: 0 },
  ])
})

test('city catalog accepts a legacy complete city list without district counts', () => {
  assert.deepEqual(parseCityCatalog([{ en: 'Riyadh', ar: 'الرياض' }]), [{ en: 'Riyadh', ar: 'الرياض' }])
})
