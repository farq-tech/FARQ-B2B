import assert from 'node:assert/strict'
import test from 'node:test'
import { isRegisteredDealsResponse } from './registered-deals-response.ts'
import { joinDistrictByIdOrUniqueName } from './district-join.ts'

const metric = { deals: 12, median_sar_per_sqm: 3200 }

test('registered deals validate canonical identities and allow repeated names only when IDs disambiguate them', () => {
  const response = { city: 'Riyadh', available: true, districts: [
    { district_id: 'd1', district_ar: 'الندى', residential: metric },
    { district_id: 'd2', district_ar: 'الندى', commercial: metric },
    { district_id: null, district_ar: 'الربيع', residential: metric },
  ] }
  assert.equal(isRegisteredDealsResponse(response, 'Riyadh'), true)
  assert.equal(isRegisteredDealsResponse(response, 'Jeddah'), false)
  assert.equal(isRegisteredDealsResponse({ ...response, districts: [response.districts[0], { ...response.districts[1], district_id: 'd1' }] }, 'Riyadh'), false)
  assert.equal(isRegisteredDealsResponse({ ...response, districts: [response.districts[0], { district_ar: 'الربيع', residential: metric }] }, 'Riyadh'), false)
})

test('an unresolved registered-deal identity does not fall back to its district name', () => {
  const response = { city: 'Riyadh', available: true, districts: [{ district_id: null, district_ar: 'الربيع', residential: metric }] }
  assert.equal(isRegisteredDealsResponse(response, 'Riyadh'), true)
  const joined = joinDistrictByIdOrUniqueName([{ id: 'd1', name: 'الربيع' }], response.districts)
  assert.equal(joined.has('d1'), false)
})

test('registered deals accept unique legacy rows and reject invalid counts or prices', () => {
  const legacy = { city: 'Riyadh', available: true, districts: [{ district_ar: 'الربيع', residential: metric }] }
  assert.equal(isRegisteredDealsResponse(legacy, 'Riyadh'), true)
  assert.equal(isRegisteredDealsResponse({ ...legacy, districts: [legacy.districts[0], legacy.districts[0]] }, 'Riyadh'), false)
  assert.equal(isRegisteredDealsResponse({ ...legacy, districts: [{ district_ar: 'الربيع', residential: { ...metric, deals: 9 } }] }, 'Riyadh'), false)
  assert.equal(isRegisteredDealsResponse({ ...legacy, districts: [{ district_ar: 'الربيع', residential: { ...metric, median_sar_per_sqm: 0 } }] }, 'Riyadh'), false)
  assert.equal(isRegisteredDealsResponse({ city: 'Riyadh', available: false, districts: [] }, 'Riyadh'), true)
})
