import assert from 'node:assert/strict'
import test from 'node:test'
import { isDistrictIncomeResponse } from './income-response.ts'

test('accepts measured income, zero and an explicitly unresolved district ID', () => {
  assert.equal(isDistrictIncomeResponse({ available: true, districts: [
    { district_ar: 'النخيل', district_id: '12', income_all: 9000, income_male: 0 },
    { district_ar: 'الربيع', district_id: null, income_all: null },
  ] }), true)
})

test('accepts a legacy response with no district ID and an unavailable empty source', () => {
  assert.equal(isDistrictIncomeResponse({ available: true, districts: [{ district_ar: 'النخيل', income_all: 9000 }] }), true)
  assert.equal(isDistrictIncomeResponse({ available: false, districts: [] }), true)
})

test('rejects malformed income figures, district names, IDs and unavailable rows', () => {
  const valid = { district_ar: 'النخيل', district_id: '12', income_all: 9000 }
  const invalid = [
    { ...valid, income_all: '9000' },
    { ...valid, income_all: -1 },
    { ...valid, income_male: Number.POSITIVE_INFINITY },
    { ...valid, district_ar: '  ' },
    { ...valid, district_id: '' },
    { available: false, districts: [valid] },
  ]
  for (const response of invalid) {
    const payload = 'available' in response ? response : { available: true, districts: [response] }
    assert.equal(isDistrictIncomeResponse(payload), false)
  }
})
