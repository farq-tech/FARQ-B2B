import assert from 'node:assert/strict'
import test from 'node:test'
import { incomeForAudience, scoreConsumerAudience } from './consumer-audience-score.ts'

test('uses the matching measured worker segment for income filters', () => {
  const row = { income: 11000, incomeMale: 13000, incomeFemale: 9000, incomeSaudi: 15000, incomeNonSaudi: 8000 }
  assert.equal(incomeForAudience(row, 'sex', 'men', 'all'), 13000)
  assert.equal(incomeForAudience(row, 'sex', 'women', 'all'), 9000)
  assert.equal(incomeForAudience(row, 'nationality', 'all', 'saudi'), 15000)
  assert.equal(incomeForAudience(row, 'nationality', 'all', 'non_saudi'), 8000)
  assert.equal(incomeForAudience(row, 'none', 'all', 'all'), 11000)
})

test('balances audience size and the purchasing power measure without multiplying unrelated populations and income', () => {
  const result = scoreConsumerAudience([
    { row: 'large audience', audience: 100, purchasingPower: 20 },
    { row: 'higher income', audience: 60, purchasingPower: 80 },
  ])

  assert.equal(result.scored[0]?.row, 'higher income')
  assert.equal(result.scored[0]?.score, 80)
  assert.equal(result.scored[1]?.row, 'large audience')
  assert.equal(result.scored[1]?.score, 63)
  assert.equal(result.unknown, 0)
})

test('does not manufacture a score when either measured factor is missing', () => {
  const result = scoreConsumerAudience([
    { row: 'measured', audience: 100, purchasingPower: 80 },
    { row: 'missing income', audience: 90, purchasingPower: null },
    { row: 'missing audience', audience: null, purchasingPower: 100 },
  ])

  assert.deepEqual(result.scored.map((item) => item.row), ['measured'])
  assert.equal(result.unknown, 2)
})

test('a measured zero audience has no priority even when the district has high income', () => {
  const result = scoreConsumerAudience([
    { row: 'target audience', audience: 10, purchasingPower: 10 },
    { row: 'no target audience', audience: 0, purchasingPower: 100 },
  ])

  assert.equal(result.scored[0]?.row, 'target audience')
  assert.equal(result.scored[1]?.score, 0)
})
