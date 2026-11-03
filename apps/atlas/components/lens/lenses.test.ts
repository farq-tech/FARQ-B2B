import assert from 'node:assert/strict'
import test from 'node:test'
import { LENSES, METRICS, METRIC_TABLE, STEP_TABLES, TOOL_INPUTS, lensById, metricAvailability, neededTables, nextStep, stepTables, type MetricId } from './lenses.ts'

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

test('every shading figure names the table it arrives in', () => {
  for (const id of Object.keys(METRICS) as MetricId[]) assert.ok(METRIC_TABLE[id], id)
})

test('a figure whose table failed is «failed», one no district has is «missing»', () => {
  const row = (population: number | null) => ({ population }) as unknown as Parameters<typeof metricAvailability>[1][number]
  assert.equal(metricAvailability('population', [row(10), row(null)], []), 'ready')
  assert.equal(metricAvailability('population', [row(null), row(null)], []), 'missing')
  // a failed table empties every row: that is a load to retry, not a city without the figure
  assert.equal(metricAvailability('population', [row(null), row(null)], ['population']), 'failed')
  assert.equal(metricAvailability('population', [row(null)], ['demand']), 'missing')
  // a table still being asked (a first load, a retry) is «loading», whatever its rows hold now
  assert.equal(metricAvailability('population', [row(null)], ['population'], ['population']), 'loading')
  // no rows yet (still loading) is not «missing»
  assert.equal(metricAvailability('population', [], []), 'ready')
})

test('the open step and the layer in view load first; the rest wait', () => {
  const needed = neededTables('audience', 'population')
  assert.equal(needed[0], 'population')
  assert.deepEqual([...needed].sort(), ['counts', 'income', 'population'])
  // the layer's table leads, so the map colours before the step's own tables answer
  assert.equal(neededTables('gaps', 'unmet')[0], 'demand')
  // a layer that failed is not the step's: no notice over the panel for it
  assert.ok(!stepTables('audience').includes('demand'))
  for (const lens of LENSES) for (const step of lens.steps) assert.ok(STEP_TABLES[step.tool], `${lens.id}/${step.tool}`)
})
