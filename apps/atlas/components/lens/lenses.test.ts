import assert from 'node:assert/strict'
import test from 'node:test'
import { readMapQuery } from './map-query.ts'
import { LENSES, LENS_GOALS, METRICS, METRIC_TABLE, TOOL_INPUTS, lensById, metricAvailability, nextStep, type MetricId } from './lenses.ts'

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

test('every lens has one goal wording, and its landing link opens that lens on its first step', () => {
  assert.deepEqual(Object.keys(LENS_GOALS).sort(), LENSES.map((lens) => lens.id).sort())
  const steps = Object.fromEntries(LENSES.map((lens) => [lens.id, lens.steps.map((step) => step.tool)]))
  for (const lens of LENSES) {
    const view = readMapQuery(`?lens=${lens.id}`, steps)
    assert.equal(view.lens, lens.id)
    assert.equal(view.tool, null) // no tool named: the lens opens on its first step
  }
})
