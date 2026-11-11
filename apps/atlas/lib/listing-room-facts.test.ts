import assert from 'node:assert/strict'
import test from 'node:test'
import { listingRoomFacts } from './listing-room-facts.ts'

test('listing cards keep explicit zero room counts and omit only unstated fields', () => {
  assert.deepEqual(listingRoomFacts({ area_sqm: 90, beds: 0, livings: 0, wc: 1 }), [
    { kind: 'area', value: 90 }, { kind: 'beds', value: 0 }, { kind: 'livings', value: 0 }, { kind: 'wc', value: 1 },
  ])
  assert.deepEqual(listingRoomFacts({ area_sqm: null }), [])
})
