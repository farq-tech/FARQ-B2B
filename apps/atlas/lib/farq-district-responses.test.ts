import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isDemandDistrictResponse,
  isMenuPriceDistrictResponse,
  isRestaurantDistrictResponse,
} from './farq-district-responses.ts'

test('accepts empty or measured Farq district responses with explicit zeros', () => {
  assert.equal(isRestaurantDistrictResponse({ districts: [{ district_id: '12', restaurants: 0 }] }), true)
  assert.equal(isMenuPriceDistrictResponse({ districts: [{ district_id: '12', price: 0.5, places: null }] }), true)
  assert.equal(isDemandDistrictResponse({ districts: [{ district_id: '12', searches: 0, unmet: 0, unmetTerms: [] }] }), true)
  assert.equal(isDemandDistrictResponse({ districts: [] }), true)
})

test('rejects duplicate or missing district identities for all Farq metrics', () => {
  const cases = [
    [isRestaurantDistrictResponse, { district_id: '12', restaurants: 1 }],
    [isMenuPriceDistrictResponse, { district_id: '12', price: 5, places: 2 }],
    [isDemandDistrictResponse, { district_id: '12', searches: 2, unmet: 1, unmetTerms: [] }],
  ] as const
  for (const [validate, row] of cases) {
    assert.equal(validate({ districts: [row, row] }), false)
    assert.equal(validate({ districts: [row, { ...row, district_id: ' 12 ' }] }), false)
    assert.equal(validate({ districts: [{ district_id: '' }] }), false)
  }
})

test('rejects invalid restaurant counts, menu prices and demand values', () => {
  assert.equal(isRestaurantDistrictResponse({ districts: [{ district_id: '12', restaurants: -1 }] }), false)
  assert.equal(isRestaurantDistrictResponse({ districts: [{ district_id: '12', restaurants: 1.5 }] }), false)
  assert.equal(isMenuPriceDistrictResponse({ districts: [{ district_id: '12', price: 0, places: 5 }] }), false)
  assert.equal(isMenuPriceDistrictResponse({ districts: [{ district_id: '12', price: 5, places: -1 }] }), false)
  assert.equal(isDemandDistrictResponse({ districts: [{ district_id: '12', searches: 3, unmet: 4, unmetTerms: [] }] }), false)
  assert.equal(isDemandDistrictResponse({ districts: [{ district_id: '12', searches: 2, unmet: 1, unmetTerms: [{ term: '', searches: 1, unmet: 1 }] }] }), false)
})
