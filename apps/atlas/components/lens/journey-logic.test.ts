import assert from 'node:assert/strict'
import test from 'node:test'
import { matchMain } from '../../lib/sticky-state.ts'
import type { DistrictRow } from './city-data.ts'
import { STEP_WAIT, decisionFor, pickedLine, stepLine } from './journey-logic.ts'
import { LENSES, TOOL_INPUTS, journeyStart, lensById } from './lenses.ts'

// a fixed city of three districts, for every journey below (no production data)
const row = (id: string, name: string, extra: Partial<DistrictRow> = {}): DistrictRow => ({
  id, name, population: 1000, populationSource: null, businesses: 100, areaKm2: 2, residentsPerBusiness: 10, businessesPerKm2: 50, density: 500,
  restaurants: null, menuPrice: null, menuPricePlaces: null, searches: null, unmetSearches: null, unmetTerms: [], income: null,
  underConstruction: null, newBuildings: null, villaShare: null, realEstate: {}, deals: { residential: null, commercial: null }, ...extra,
})
const ROWS = [
  row('1', 'العليا', { population: 120000, businesses: 9000, underConstruction: 40, newBuildings: 60 }),
  row('2', 'النرجس', { population: null, businesses: 3000, underConstruction: 500, newBuildings: 700 }),
  row('3', 'طويق', { population: 280000, businesses: 22000 }),
]
const step = (tool: string) => LENSES.flatMap((lens) => lens.steps).find((item) => item.tool === tool)!

test('a step line says its answer, else that it works or failed, else what to do', () => {
  const gaps = step('gaps')
  assert.deepEqual(stepLine({ tool: 'gaps', step: gaps, summary: 'الأعلى: طويق' }), { text: 'الأعلى: طويق', tone: 'answer' })
  assert.equal(stepLine({ tool: 'gaps', step: gaps, state: 'loading' })?.tone, 'loading')
  assert.equal(stepLine({ tool: 'gaps', step: gaps, state: 'loading', slow: true })?.tone, 'slow')
  assert.match(stepLine({ tool: 'gaps', step: gaps, state: 'error' })!.text, /تعذّر/)
  // waiting for the customer: the ask, never the shading's unrelated top district
  assert.deepEqual(stepLine({ tool: 'gaps', step: gaps, rankLine: 'الأعلى في السكان: طويق' }), { text: gaps.ask, tone: 'ask' })
  // the ranking steps' answer is the ranking
  assert.equal(stepLine({ tool: 'district', step: step('district'), rankLine: 'الأعلى في السكان: طويق' })?.text, 'الأعلى في السكان: طويق')
  // every step that can be slow says why and what to do
  for (const lens of LENSES) for (const item of lens.steps) assert.ok(STEP_WAIT[item.tool].why && STEP_WAIT[item.tool].meanwhile, item.tool)
})

test('a step answered by its picks posts its own line from the golden rows, «غير متاح» where a figure is missing', () => {
  assert.equal(pickedLine('district', [ROWS[0]]), 'العليا: 120,000 ساكن · 9,000 منشأة')
  assert.equal(pickedLine('district', [ROWS[1]]), 'النرجس: غير متاح ساكن · 3,000 منشأة')
  assert.equal(pickedLine('growth', [ROWS[1]]), 'النرجس: 1,200 مبنى جديد وتحت الإنشاء')
  assert.equal(pickedLine('growth', [ROWS[2]]), 'طويق: غير متاح مبنى جديد وتحت الإنشاء')
  assert.equal(pickedLine('compare', [ROWS[0], ROWS[2]]), 'العليا مقابل طويق')
  assert.equal(pickedLine('compare', [ROWS[0]]), null)
  assert.equal(pickedLine('district', []), null)
  // every step answered by picks has a line (the businesses list posts its own count)
  for (const [tool, inputs] of Object.entries(TOOL_INPUTS)) if (inputs.pickAnswers && tool !== 'businesses') assert.ok(pickedLine(tool as never, [ROWS[0], ROWS[2]]) || tool === 'growth' || tool === 'district', tool)
})

test('each journey closes on a decision from what its steps found, acted on through the existing flows', () => {
  const base = { city: 'Riyadh', rows: ROWS, picked: [] as DistrictRow[], leads: {}, activity: null }
  // nothing found yet: no «قرارك» is made up
  for (const lens of LENSES) assert.equal(decisionFor({ ...base, lens: lens.id }).pick, null, lens.id)

  const shops = decisionFor({ ...base, lens: 'shops', leads: { gaps: '3' }, activity: 'صيدلية' })
  assert.equal(shops.title, 'أين تفتح «صيدلية»')
  assert.match(shops.pick!, /طويق/)
  assert.deepEqual(shops.actions.map((action) => action.kind), ['step', 'businesses'])

  const marketers = decisionFor({ ...base, lens: 'marketers', leads: { audience: '1' } })
  assert.deepEqual(marketers.actions, [{ kind: 'businesses', ids: ['1'], label: 'جهّز حملة لمنشآت العليا' }])
  // picks win over a lead
  assert.match(decisionFor({ ...base, lens: 'marketers', leads: { audience: '1' }, picked: [ROWS[2]] }).pick!, /اخترتها: طويق/)

  // the distributor's growth comes from the golden rows: the district building the most
  assert.match(decisionFor({ ...base, lens: 'distributors', done: ['growth'] }).pick!, /النرجس/)

  assert.equal(decisionFor({ ...base, lens: 'analysts', picked: [ROWS[0], ROWS[2]] }).pick, 'العليا مقابل طويق')

  const property = decisionFor({ ...base, lens: 'property', leads: { homes: '2' } })
  assert.deepEqual(property.actions.map((action) => (action.kind === 'link' ? action.href : '')), ['/homes?district=2', '/price?district=2'])
  // another city keeps its name in the links
  const jeddah = decisionFor({ ...base, city: 'Jeddah', lens: 'property', leads: { homes: '2' } })
  assert.ok(jeddah.actions.every((action) => action.kind === 'link' && action.href.includes('city=Jeddah')))
  // a lead the city does not hold is no decision
  assert.equal(decisionFor({ ...base, lens: 'property', leads: { homes: 'gone' } }).pick, null)
})

test('a journey walked on fixed data: each step hands the next its answer, and the last one decides', () => {
  // the marketer: step 1 puts a district first, step 2 starts from it, and the close acts on it
  const marketers = lensById('marketers')
  const leads = { audience: '3' }
  const start = journeyStart(marketers, 'businesses', leads, (id) => ROWS.some((item) => item.id === id))
  assert.equal(start?.id, '3')
  assert.equal(decisionFor({ lens: 'marketers', city: 'Riyadh', rows: ROWS, picked: [], leads, activity: null }).actions[0].kind, 'businesses')
  // the property seeker: the best listing's district is the next step's start and the close's pick
  const property = lensById('property')
  assert.equal(journeyStart(property, 'district', { homes: '2' }, () => true)?.from.tool, 'homes')
})

test('an activity typed in one step carries to a main-activity picker by its name, nothing else does', () => {
  const activities = [{ main_id: 'pharmacy', main_ar: 'صيدلية' }, { main_id: 'cafe', main_ar: 'المقاهي' }]
  assert.equal(matchMain(activities, 'صيدلية'), 'pharmacy')
  assert.equal(matchMain(activities, ' مقاهي '), 'cafe')
  assert.equal(matchMain(activities, 'مطعم'), null)
  assert.equal(matchMain(activities, ''), null)
})
