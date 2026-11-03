import assert from 'node:assert/strict'
import test from 'node:test'
import { daysAgo } from './real-estate.ts'

const now = new Date('2026-11-02T10:00:00Z')

test('an ad date reads as the time since it, the way it is said', () => {
  assert.equal(daysAgo('2026-11-02', now), 'اليوم')
  assert.equal(daysAgo('2026-11-01', now), 'أمس')
  assert.equal(daysAgo('2026-10-26', now), 'منذ 7 أيام')
  assert.equal(daysAgo('2026-09-03', now), 'منذ شهرين')
  assert.equal(daysAgo('2025-12-01', now), 'منذ 11 شهراً')
})

test('a date close to a year back reads as a year, never as twelve months', () => {
  // 2025-11-06 is 361 days before; it used to read «منذ 12 شهراً» beside another ad's «منذ سنة»
  assert.equal(daysAgo('2025-11-06', now), 'منذ سنة')
  assert.equal(daysAgo('2025-10-31', now), 'منذ سنة')
  assert.equal(daysAgo('2024-10-30', now), 'منذ سنتين')
})

test('no date, a bad one or one ahead of today reads as nothing', () => {
  assert.equal(daysAgo(undefined, now), null)
  assert.equal(daysAgo('not a date', now), null)
  assert.equal(daysAgo('2026-12-01', now), null)
})
