import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePopulationWithin } from './population-within.ts'

const valid = { population: 250, dwellings: 50.5, businesses: 40, residents_per: 6.25,
  top_activities: [{ activity: 'صيدلية', n: 4 }], home_buildings: 12, people_per_district: true }

test('population-within accepts explicit counts, unavailable metrics, and the service activity list', () => {
  assert.deepEqual(parsePopulationWithin(valid), valid)
  assert.equal(parsePopulationWithin({ population: null, dwellings: null, businesses: null, residents_per: null, top_activities: [] }).population, null)
})

test('population-within rejects malformed totals and activity rows before rendering', () => {
  assert.throws(() => parsePopulationWithin({ ...valid, businesses: -1 }))
  assert.throws(() => parsePopulationWithin({ ...valid, population: Infinity }))
  assert.throws(() => parsePopulationWithin({ ...valid, top_activities: [{ activity: 'صيدلية', n: 0 }] }))
  assert.throws(() => parsePopulationWithin({ ...valid, top_activities: [valid.top_activities[0], valid.top_activities[0]] }))
  assert.throws(() => parsePopulationWithin({ ...valid, home_buildings: 2.5 }))
  assert.throws(() => parsePopulationWithin({ ...valid, home_buildings: null }))
})

test('population-within hides legacy household-size estimates when no building population was measured', () => {
  const result = parsePopulationWithin({ ...valid, people_per_district: false })
  assert.equal(result.population, null)
  assert.equal(result.residents_per, null)
  assert.equal(result.dwellings, valid.dwellings)
})

test('population-within treats a missing population-source flag as unavailable', () => {
  const { people_per_district: _source, ...legacy } = valid
  const result = parsePopulationWithin(legacy)
  assert.equal(result.population, null)
  assert.equal(result.residents_per, null)
})
