import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFilterNumber } from './numeric-input.ts'

test('property number filters accept Arabic and Persian keyboard digits', () => {
  assert.equal(parseFilterNumber('١٢٣٤'), 1234)
  assert.equal(parseFilterNumber('۱۲۳۴'), 1234)
  assert.equal(parseFilterNumber('١٬٢٣٤'), 1234)
})

test('property number filters ignore grouping punctuation and clear when no digits remain', () => {
  assert.equal(parseFilterNumber('1,234'), 1234)
  assert.equal(parseFilterNumber(''), null)
  assert.equal(parseFilterNumber('٫'), null)
})

test('property number filters reject values outside JavaScript safe integer precision', () => {
  assert.equal(parseFilterNumber('٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩'), null)
})
