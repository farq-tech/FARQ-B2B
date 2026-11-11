import assert from 'node:assert/strict'
import test from 'node:test'
import { BELOW_MEDIAN_FILTER_LABEL } from './real-estate-filter-label.ts'
import { densityFilterReadiness, districtsAtMinDensity, districtsWithoutDensity } from './real-estate-density.ts'
import { invalidListingRange } from './real-estate-filters.ts'
import { AGE_STEPS, ageStepLabel, ageWithin } from './real-estate-age.ts'
import { listingsEmptyStateHeading, listingsSubsetLabel } from './real-estate-result-summary.ts'

test('the building-age filter offers the 20-year limit shown in the iOS app', () => {
  assert.ok(AGE_STEPS.includes(20))
  assert.equal(ageStepLabel(20, String), 'حتى 20 سنة')
  assert.equal(ageWithin(20, 20), true)
  assert.equal(ageWithin(21, 20), false)
  assert.equal(ageWithin(null, 20), false, 'an ad without a measured age is not treated as new')
  assert.equal(ageWithin(null, null), true, 'no age filter leaves unstated ages available')
})

test('a minimum population density uses available values and excludes missing ones', () => {
  const rows = [
    { id: 'low', density: 4_999 },
    { id: 'threshold', density: 5_000 },
    { id: 'high', density: 12_000 },
    { id: 'unknown', density: null },
  ]
  assert.equal(districtsAtMinDensity(rows, null), null, 'no threshold means no district restriction')
  assert.deepEqual(districtsAtMinDensity(rows, 5_000), ['threshold', 'high'])
  assert.deepEqual(districtsAtMinDensity(rows, 20_000), [], 'no matching districts stays an explicit empty set')
  assert.equal(districtsWithoutDensity(rows), 1, 'missing density stays unavailable instead of being represented by zero')
})

test('a district-density filter waits for its source before reporting no available listings', () => {
  assert.equal(densityFilterReadiness(5_000, 'ready', 'loading', false), 'loading')
  assert.equal(densityFilterReadiness(5_000, 'ready', 'ready', false), 'unavailable')
  assert.equal(densityFilterReadiness(5_000, 'ready', 'ready', true), 'ready')
  assert.equal(densityFilterReadiness(5_000, 'ready', 'error', false), 'error')
  assert.equal(densityFilterReadiness(null, 'ready', 'loading', false), 'ready')
})

test('a capped listing result names the selected sort instead of always claiming best fit', () => {
  assert.equal(listingsSubsetLabel('best', '24 عرضاً', '100 عرضاً'), 'الأنسب: 24 عرضاً من أصل 100 عرضاً')
  assert.equal(listingsSubsetLabel('price_asc', '24 عرضاً', '100 عرضاً'), 'الأقل سعراً: 24 عرضاً من أصل 100 عرضاً')
  assert.equal(listingsSubsetLabel('price_desc', '24 عرضاً', '100 عرضاً'), 'الأعلى سعراً: 24 عرضاً من أصل 100 عرضاً')
  assert.equal(listingsSubsetLabel('area_desc', '24 عرضاً', '100 عرضاً'), 'الأكبر مساحةً: 24 عرضاً من أصل 100 عرضاً')
  assert.equal(listingsSubsetLabel('sqm_asc', '24 عرضاً', '100 عرضاً'), 'الأقل سعراً للمتر: 24 عرضاً من أصل 100 عرضاً')
})

test('the below-median filter label states the maximum discount the service includes', () => {
  assert.equal(BELOW_MEDIAN_FILTER_LABEL, 'أقل من وسيط الحي (حتى 30%)')
})

test('a reversed price or area range is invalid while equal or open bounds remain valid', () => {
  const defaults = { minPrice: null, maxPrice: null, minArea: null, maxArea: null }
  assert.equal(invalidListingRange({ ...defaults, minPrice: 50_000, maxPrice: 30_000 }), 'price')
  assert.equal(invalidListingRange({ ...defaults, minArea: 200, maxArea: 120 }), 'area')
  assert.equal(invalidListingRange({ ...defaults, minPrice: 30_000, maxPrice: 30_000 }), null)
  assert.equal(invalidListingRange({ ...defaults, minArea: 120 }), null)
})

test('an unavailable listing source does not claim there are zero offers', () => {
  assert.equal(listingsEmptyStateHeading(false, false, 'بارق'), 'العروض غير متاحة في بارق')
  assert.equal(listingsEmptyStateHeading(false, true, 'الرياض'), 'عروض الرياض', 'missing density is explained by the density state, not as missing listings')
  assert.equal(listingsEmptyStateHeading(true, false, 'الرياض'), null, 'an available zero-result search keeps its measured count')
})
