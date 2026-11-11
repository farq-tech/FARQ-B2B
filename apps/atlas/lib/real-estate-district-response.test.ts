import assert from 'node:assert/strict'
import test from 'node:test'
import { isRealEstateDistrictResponse } from './real-estate-district-response.ts'

const district = (overrides: Record<string, unknown> = {}) => ({
  district_id: '12', district_ar: 'العليا', groups: {
    rent_year_commercial: {
      listings: 7, median_sar_per_sqm: 900, reliable: false,
      by_age: { new: { listings: 5, median_sar_per_sqm: 950 } },
    },
  },
  ...overrides,
})

test('accepts valid property medians and an unavailable empty source', () => {
  assert.equal(isRealEstateDistrictResponse({ available: true, districts: [district()] }), true)
  assert.equal(isRealEstateDistrictResponse({ available: false, districts: [] }), true)
})

test('rejects duplicate or missing district IDs instead of letting a map overwrite rows', () => {
  assert.equal(isRealEstateDistrictResponse({ available: true, districts: [district(), district()] }), false)
  assert.equal(isRealEstateDistrictResponse({ available: true, districts: [district({ district_id: null })] }), false)
})

test('rejects malformed medians, listing counts and age bands', () => {
  const invalid = [
    district({ groups: { rent_year_commercial: { listings: 0, median_sar_per_sqm: 900 } } }),
    district({ groups: { rent_year_commercial: { listings: 7, median_sar_per_sqm: Number.NaN } } }),
    district({ groups: { rent_year_commercial: { listings: 7, median_sar_per_sqm: 900, by_age: { new: { listings: -1, median_sar_per_sqm: 950 } } } } }),
  ]
  for (const row of invalid) assert.equal(isRealEstateDistrictResponse({ available: true, districts: [row] }), false)
})
