import assert from 'node:assert/strict'
import test from 'node:test'
import { isPopulationResponse } from './population-response.ts'

test('accepts golden population with measured zero and unavailable values', () => {
  assert.equal(isPopulationResponse({ city_en: 'Riyadh', districts: [
    { district_id: '12', district_ar: 'النخيل', population: 0, source: '910ths.sa' },
    { district_id: 13, district_ar: 'الربيع', population: null, source: 'WorldPop 2025' },
  ] }, 'Riyadh'), true)
})

test('rejects a response for another city, duplicate district IDs and invalid population rows', () => {
  const row = { district_id: '12', district_ar: 'النخيل', population: 9000, source: '910ths.sa' }
  assert.equal(isPopulationResponse({ city_en: 'Jeddah', districts: [row] }, 'Riyadh'), false)
  assert.equal(isPopulationResponse({ city_en: 'Riyadh', districts: [row, { ...row, district_id: 12 }] }, 'Riyadh'), false)
  for (const invalid of [
    { ...row, population: -1 },
    { ...row, population: Number.POSITIVE_INFINITY },
    { ...row, district_id: '' },
    { ...row, district_ar: ' ' },
    { ...row, source: 910 },
  ]) {
    assert.equal(isPopulationResponse({ city_en: 'Riyadh', districts: [invalid] }, 'Riyadh'), false)
  }
})
