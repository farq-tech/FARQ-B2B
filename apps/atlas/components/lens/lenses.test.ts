import assert from 'node:assert/strict'
import test from 'node:test'
import { readMapQuery } from './map-query.ts'
import { LENSES, LENS_GOALS, METRICS, METRIC_TABLE, STEP_TABLES, TOOL_INPUTS, journeyStart, lensById, metricAvailability, neededTables, nextStep, stepTables, type MetricId } from './lenses.ts'

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

test('every step says what to do on it', () => {
  for (const lens of LENSES) for (const step of lens.steps) assert.ok(step.ask.trim().length > 0, `${lens.id}/${step.tool}`)
})

test('a step that takes a district starts from the nearest earlier step that put one first', () => {
  const known = (id: string) => id !== 'gone'
  const marketers = lensById('marketers')
  assert.deepEqual(journeyStart(marketers, 'businesses', { audience: 'd1' }, known), { id: 'd1', from: marketers.steps[0] })
  // nothing earlier answered, or the first step itself: nothing offered
  assert.equal(journeyStart(marketers, 'businesses', {}, known), null)
  assert.equal(journeyStart(marketers, 'audience', { audience: 'd1' }, known), null)
  // a district the city does not hold is skipped for an earlier one
  const shops = lensById('shops')
  assert.equal(journeyStart(shops, 'homes', { gaps: 'd2', competitors: 'gone' }, known)?.id, 'd2')
  assert.equal(journeyStart(shops, 'homes', { gaps: 'gone' }, known), null)
  // a step that takes no district never offers one
  assert.equal(journeyStart(shops, 'corridors', { gaps: 'd2' }, known), null)
  const property = lensById('property')
  assert.equal(journeyStart(property, 'district', { homes: 'd3' }, known)?.from.tool, 'homes')
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

test('every lens has one goal wording, and its landing link opens that lens on its first step', () => {
  assert.deepEqual(Object.keys(LENS_GOALS).sort(), LENSES.map((lens) => lens.id).sort())
  const steps = Object.fromEntries(LENSES.map((lens) => [lens.id, lens.steps.map((step) => step.tool)]))
  for (const lens of LENSES) {
    const view = readMapQuery(`?lens=${lens.id}`, steps)
    assert.equal(view.lens, lens.id)
    assert.equal(view.tool, null) // no tool named: the lens opens on its first step
  }
})
