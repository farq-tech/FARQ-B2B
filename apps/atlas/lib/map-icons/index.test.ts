import assert from 'node:assert/strict'
import test from 'node:test'
import { mapIconImageId, mapPinSvg, resolveMapIcon } from './index.ts'

test('prefers the most specific known specialty over a broad category', () => {
  assert.deepEqual(resolveMapIcon({ category: 'مقاولات وخدمات إنشائية', specialties: ['مقاول كهرباء'] }), { icon: 'bolt', matched: 'specialty' })
})

test('resolves subcategory then broad activity labels', () => {
  assert.deepEqual(resolveMapIcon({ category: 'مقاولات عامة' }), { icon: 'crane', matched: 'subcategory' })
  assert.deepEqual(resolveMapIcon({ category: 'سيارات ومركبات' }), { icon: 'car', matched: 'category' })
})

test('uses a neutral pin for unknown activities and emits brand-coloured SVG', () => {
  assert.deepEqual(resolveMapIcon({ category: 'نشاط غير معروف' }), { icon: 'map-pin', matched: 'fallback' })
  const svg = mapPinSvg('crane', true)
  assert.match(svg, /#303030/)
  assert.match(svg, /#008060/)
  assert.equal(mapIconImageId('crane', true), 'farq-atlas-selected-crane')
})
