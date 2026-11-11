import assert from 'node:assert/strict'
import test from 'node:test'
import { completeComparisonMaximum } from './complete-comparison.ts'

test('comparison marks the maximum only when every selected site has a valid value', () => {
  assert.equal(completeComparisonMaximum([12, 20, 18], 3), 20)
  assert.equal(completeComparisonMaximum([12, null, 18], 3), null)
  assert.equal(completeComparisonMaximum([12, 18], 3), null)
  assert.equal(completeComparisonMaximum([12], 1), null)
  assert.equal(completeComparisonMaximum([12, Number.NaN], 2), null)
})
