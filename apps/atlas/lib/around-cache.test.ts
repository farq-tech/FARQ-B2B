import assert from 'node:assert/strict'
import test from 'node:test'
import { isActiveAroundKey, pruneAroundResults } from './around-cache.ts'

test('site comparison cache drops removed sites and keeps reach variants for current sites', () => {
  const active = new Set(['2', '3'])
  const before = { '1|radius|500': 'old', '2|radius|500': 'near', '2|drive|5': 'drive', '3|radius|1000': 'current' }
  assert.equal(isActiveAroundKey('2|drive|5', active), true)
  assert.equal(isActiveAroundKey('1|radius|500', active), false)
  assert.deepEqual(pruneAroundResults(before, active), {
    '2|radius|500': 'near', '2|drive|5': 'drive', '3|radius|1000': 'current',
  })
  assert.deepEqual(pruneAroundResults(before, new Set()), {})
})
