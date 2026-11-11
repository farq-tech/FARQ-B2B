import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePriceEstimateResponse } from './price-estimate-response.ts'

const valid = {
  available: true,
  comparables: 15,
  scope: [{ district_id: '1', district_ar: 'الربيع', comparables: 15 }],
  price: { low: 90_000, mid: 100_000, high: 110_000 },
  per_sqm: { low: 500, mid: 550, high: 600 },
  comparables_per_sqm: { low: 500, mid: 550, high: 600 },
  adjustments_calibrated: true,
  adjustments: [],
  examples: [{ id: 'listing-1', url: null, photo: null, district_ar: 'الربيع', type: 'floor', price_sar: 100_000, area_sqm: 180 }],
}

test('an available price estimate needs ordered ranges, complete scope, and usable examples', () => {
  assert.equal(parsePriceEstimateResponse(valid), valid)
  assert.throws(() => parsePriceEstimateResponse({ ...valid, price: { low: 110_000, mid: 100_000, high: 120_000 } }))
  assert.throws(() => parsePriceEstimateResponse({ ...valid, per_sqm: undefined }))
  assert.throws(() => parsePriceEstimateResponse({ ...valid, comparables: 14 }))
  assert.throws(() => parsePriceEstimateResponse({ ...valid, adjustments_calibrated: undefined }))
  assert.throws(() => parsePriceEstimateResponse({ ...valid, scope: [{ district_id: '1', district_ar: 'الربيع', comparables: 14 }] }))
  assert.throws(() => parsePriceEstimateResponse({ ...valid, examples: [{ ...valid.examples[0], id: '' }] }))
})

test('an unavailable reason remains explicit and a future non-empty reason remains displayable', () => {
  assert.deepEqual(parsePriceEstimateResponse({ available: false, reason: 'too_few_comparables', comparables: 4 }),
    { available: false, reason: 'too_few_comparables', comparables: 4 })
  assert.equal(parsePriceEstimateResponse({ available: false, reason: 'new_reason' }).available, false)
  assert.throws(() => parsePriceEstimateResponse({ available: false, reason: ' ' }))
})
