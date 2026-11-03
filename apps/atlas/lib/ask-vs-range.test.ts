import assert from 'node:assert/strict'
import test from 'node:test'
import { askVsRange } from './ask-vs-range.ts'

test('a listing price reads against the expected range from the two figures only', () => {
  assert.deepEqual(askVsRange(85000, { low: 70000, high: 90000 }), { tone: 'inside', text: 'ضمن المدى المتوقع' })
  assert.deepEqual(askVsRange(99000, { low: 70000, high: 90000 }), { tone: 'above', text: 'أعلى من المدى المتوقع بـ 10%' })
  assert.deepEqual(askVsRange(56000, { low: 70000, high: 90000 }), { tone: 'below', text: 'أقل من المدى المتوقع بـ 20%' })
  assert.deepEqual(askVsRange(1_250_000, { low: 1_000_000, high: 1_100_000 }), { tone: 'above', text: 'أعلى من المدى المتوقع بـ 14%' })
})

test('a missing figure says nothing', () => {
  assert.equal(askVsRange(null, { low: 1, high: 2 }), null)
  assert.equal(askVsRange(100, null), null)
  assert.equal(askVsRange(0, { low: 1, high: 2 }), null)
  assert.equal(askVsRange(100, { low: 0, high: 2 }), null)
})
