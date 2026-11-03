import assert from 'node:assert/strict'
import test from 'node:test'
import { LENSES, TOOL_INPUTS, lensById, nextStep } from './lenses.ts'

test('the next step follows the lens order and ends on its last step', () => {
  const shops = lensById('shops')
  assert.equal(nextStep(shops, 'gaps')?.tool, 'competitors')
  assert.equal(nextStep(shops, 'around')?.tool, 'homes')
  assert.equal(nextStep(shops, 'homes'), null)
  assert.equal(nextStep(shops, 'compare'), null)
})

test('every step of every lens says what it takes from the journey', () => {
  for (const lens of LENSES) for (const step of lens.steps) assert.ok(TOOL_INPUTS[step.tool], `${lens.id}/${step.tool}`)
})
