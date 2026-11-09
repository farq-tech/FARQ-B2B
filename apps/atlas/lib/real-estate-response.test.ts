import assert from 'node:assert/strict'
import test from 'node:test'
import { densityUnavailableCount, listingTotal } from './real-estate-response.ts'

test('an inactive density filter has no unavailable listings', () => {
  assert.equal(densityUnavailableCount(undefined, false), 0)
})

test('an active density filter preserves a measured zero and marks an omitted or invalid count unavailable', () => {
  assert.equal(densityUnavailableCount(0, true), 0)
  assert.equal(densityUnavailableCount(3, true), 3)
  assert.equal(densityUnavailableCount(undefined, true), null)
  assert.equal(densityUnavailableCount(-1, true), null)
  assert.equal(densityUnavailableCount(1.5, true), null)
  assert.equal(densityUnavailableCount(Number.NaN, true), null)
})

test('a listing total stays unavailable when missing or smaller than the returned page', () => {
  assert.equal(listingTotal(undefined, 2), null)
  assert.equal(listingTotal(1, 2), null)
  assert.equal(listingTotal(2, 2), 2)
  assert.equal(listingTotal(0, 0), 0)
})
