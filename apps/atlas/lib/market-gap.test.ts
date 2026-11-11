import assert from 'node:assert/strict'
import test from 'node:test'
import { isMarketGapResponse, marketGapCoverage } from './market-gap.ts'
import { joinDistrictByIdOrUniqueName } from './district-join.ts'

test('market-gap coverage requires a positive, consistent measured sample', () => {
  assert.deepEqual(marketGapCoverage(8, 12), { sample: 8, total: 12 })
  assert.equal(marketGapCoverage(undefined, 12), null)
  assert.equal(marketGapCoverage(null, 12), null)
  assert.equal(marketGapCoverage(0, 12), null, 'zero sample is not a measured city rate')
  assert.equal(marketGapCoverage(13, 12), null, 'sample cannot exceed districts with population')
  assert.equal(marketGapCoverage(1.5, 12), null, 'coverage counts must be integers')
})

test('market-gap responses validate canonical identities and preserve duplicate district labels safely', () => {
  const row = { population: 12000, businesses: 2, expected_businesses: 4.2, shortfall: 2.2, fit_score: 80 }
  const result = { city: 'Riyadh', residents_per_business: 5000, districts: [
    { ...row, district_id: 'd1', district_ar: 'الندى' },
    { ...row, district_id: 'd2', district_ar: 'الندى' },
    { ...row, district_id: null, district_ar: 'الربيع' },
  ] }
  assert.equal(isMarketGapResponse(result, 'Riyadh'), true)
  assert.equal(isMarketGapResponse(result, 'Jeddah'), false)
  assert.equal(isMarketGapResponse({ ...result, districts: [result.districts[0], { ...result.districts[1], district_id: 'd1' }] }, 'Riyadh'), false)
  assert.equal(isMarketGapResponse({ ...result, districts: [result.districts[0], { ...row, district_ar: 'الربيع' }] }, 'Riyadh'), false)
})

test('a market-gap row explicitly lacking an ID cannot color a same-named map district', () => {
  const result = { city: 'Riyadh', residents_per_business: 5000, districts: [
    { district_id: null, district_ar: 'الربيع', population: 12000, businesses: 0, expected_businesses: 2.4, shortfall: 2.4 },
  ] }
  assert.equal(isMarketGapResponse(result, 'Riyadh'), true)
  assert.equal(joinDistrictByIdOrUniqueName([{ id: 'district-1', name: 'الربيع' }], result.districts).has('district-1'), false)
})
