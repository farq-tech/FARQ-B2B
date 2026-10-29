import assert from 'node:assert/strict'
import test from 'node:test'
import { nationalityAudience, residentsPer, sexAudience } from './audience.ts'

const share = { male_pct: 60, saudi_pct: 40 }

test('each segment is the population times its own measured share', () => {
  assert.equal(sexAudience(10_000, share, 'men'), 6_000)
  assert.equal(sexAudience(10_000, share, 'women'), 4_000)
  assert.equal(nationalityAudience(10_000, share, 'saudi'), 4_000)
  assert.equal(nationalityAudience(10_000, share, 'non_saudi'), 6_000)
})

test('two segments stay two figures: neither is the product of the shares', () => {
  const men = sexAudience(10_000, share, 'men')
  const saudis = nationalityAudience(10_000, share, 'saudi')
  assert.notEqual(men, 10_000 * 0.6 * 0.4)
  assert.notEqual(saudis, 10_000 * 0.6 * 0.4)
})

test('no measured share means unknown, not zero and not the whole population', () => {
  assert.equal(sexAudience(10_000, undefined, 'men'), null)
  assert.equal(nationalityAudience(10_000, undefined, 'saudi'), null)
  assert.equal(sexAudience(10_000, undefined, 'all'), 10_000)
})

test('residents per business is unknown without population or businesses', () => {
  assert.equal(residentsPer(12_000, 40), 300)
  assert.equal(residentsPer(null, 40), null)
  assert.equal(residentsPer(12_000, 0), null)
  assert.equal(residentsPer(12_000, null), null)
})
