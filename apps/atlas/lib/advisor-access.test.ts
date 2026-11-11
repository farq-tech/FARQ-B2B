import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseAdvisor } from './advisor-access.ts'

test('signed-in users can use property advice without directory targeting access', () => {
  assert.equal(canUseAdvisor('real_estate', false), true)
})

test('other advisor modes keep the targeting access restriction', () => {
  assert.equal(canUseAdvisor('compare', false), false)
  assert.equal(canUseAdvisor('branch', false), false)
  assert.equal(canUseAdvisor('compare', true), true)
})
