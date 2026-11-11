import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeNumericInput, parseFilterInteger } from './numeric-input.ts'

test('filter integer input accepts English, Arabic and Persian digits', () => {
  assert.equal(parseFilterInteger('30,000'), 30000)
  assert.equal(parseFilterInteger('٣٠٬٠٠٠'), 30000)
  assert.equal(parseFilterInteger('۱۲,۵۰۰'), 12500)
  assert.equal(normalizeNumericInput('١٢٬٥٠٠ م²'), '12500')
  assert.equal(normalizeNumericInput('۱۲,۵۰۰'), '12500')
  assert.equal(parseFilterInteger(''), null)
  assert.equal(parseFilterInteger('٩'.repeat(20)), null)
})
