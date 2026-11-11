import assert from 'node:assert/strict'
import test from 'node:test'
import { breakEvenOrdersPerDay } from './break-even.ts'

test('rounds required orders up to cover fixed monthly costs', () => {
  assert.equal(breakEvenOrdersPerDay({ monthlyCosts: 5_000, averageOrder: 100, contributionMarginPercent: 30, operatingDays: 30 }), 6)
})

test('leaves the result unavailable until every assumption is valid', () => {
  const valid = { monthlyCosts: 5_000, averageOrder: 100, contributionMarginPercent: 30, operatingDays: 30 }
  assert.equal(breakEvenOrdersPerDay({ ...valid, monthlyCosts: null }), null)
  assert.equal(breakEvenOrdersPerDay({ ...valid, monthlyCosts: 0 }), null)
  assert.equal(breakEvenOrdersPerDay({ ...valid, averageOrder: 0 }), null)
  assert.equal(breakEvenOrdersPerDay({ ...valid, contributionMarginPercent: 101 }), null)
  assert.equal(breakEvenOrdersPerDay({ ...valid, operatingDays: 1.5 }), null)
  assert.equal(breakEvenOrdersPerDay({ ...valid, operatingDays: 32 }), null)
  assert.equal(breakEvenOrdersPerDay({ monthlyCosts: 1e308, averageOrder: 0.01, contributionMarginPercent: 0.01, operatingDays: 1 }), null)
})
