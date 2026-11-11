import assert from 'node:assert/strict'
import test from 'node:test'
import { isBelowDistrictMedian } from './real-estate-comparison.ts'

test('requires a measured negative comparison to classify a listing below its district median', () => {
  assert.equal(isBelowDistrictMedian(-0.1), true)
  assert.equal(isBelowDistrictMedian(-20), true)
  assert.equal(isBelowDistrictMedian(0), false)
  assert.equal(isBelowDistrictMedian(12), false)
  assert.equal(isBelowDistrictMedian(null), false)
  assert.equal(isBelowDistrictMedian(undefined), false)
})
