import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateKey, keepEstimate } from './estimate-key.ts'

test('the same price question has one key, whoever writes it and in whatever order', () => {
  const card = { city: 'Riyadh', district_id: '481', deal: 'sale', type: 'villa', area_sqm: 840, age: '11+', street_width: 'lt15', furnished: 'no' }
  const page = { furnished: 'no', street_width: 'lt15', age: '11+', area_sqm: 840, type: 'villa', deal: 'sale', district_id: '481', city: 'Riyadh', streets: undefined }
  assert.equal(estimateKey(card), estimateKey(page))
  assert.notEqual(estimateKey(card), estimateKey({ ...card, area_sqm: 841 }))
  assert.equal(estimateKey({ a: 1, b: '' }), 'estimate|a=1')
})

test('only an answer is kept, never a failure', () => {
  assert.equal(keepEstimate({ available: false, reason: 'too_few_comparables' }), true)
  assert.equal(keepEstimate({ error: 'x' }), false)
  assert.equal(keepEstimate(null), false)
})
