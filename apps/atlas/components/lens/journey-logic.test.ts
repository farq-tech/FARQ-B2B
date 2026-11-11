import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionMomentProps } from '../../lib/commercial-metrics.ts'
import { homesHref, readHomesMax } from '../../lib/handoff.ts'
import { matchMain } from '../../lib/sticky-state.ts'
import type { DistrictRow } from './city-data.ts'
import { STEP_WAIT, decisionFor, partialNote, pickedLine, stepLine } from './journey-logic.ts'
import { readMapOptions, writeMapOptions } from './map-query.ts'
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
  // no sites compared yet: the card offers the comparison first, then the district's rentals and businesses
  assert.deepEqual(shops.actions.map((action) => (action.kind === 'step' ? action.tool : action.kind)), ['around', 'homes', 'businesses'])
  // two sites scored: side by side, the best first, and the card's district is the best site's
  const compared = decisionFor({ ...base, lens: 'shops', leads: { gaps: '3' }, activity: 'صيدلية', sites: { reach: '10 د بالسيارة', byIncome: true, sites: [
    { label: '1', district: 'طويق', score: 61, audience: 90000, spending: 4000, density: 30 },
    { label: '2', district: 'العليا', score: 88, audience: 70000, spending: 9000, density: 12 },
  ] } })
  assert.equal(compared.pick, 'أجذب موقع: الموقع 2 في العليا (88 من 100)')
  assert.deepEqual(compared.sites!.sites.map((site) => site.label), ['2', '1'])
  assert.deepEqual(compared.actions.map((action) => (action.kind === 'step' ? `${action.tool}:${action.ids}` : action.kind === 'businesses' ? `${action.kind}:${action.ids}` : action.kind)), ['homes:1', 'businesses:1'])
  // one scored site is no comparison
  assert.equal(decisionFor({ ...base, lens: 'shops', sites: { reach: '', byIncome: true, sites: [{ label: '1', district: null, score: 50, audience: 1, spending: 1, density: 1 }] } }).pick, null)

  const marketers = decisionFor({ ...base, lens: 'marketers', leads: { audience: '1' } })
  assert.deepEqual(marketers.actions, [{ kind: 'businesses', ids: ['1'], label: 'جهّز حملة لمنشآت العليا' }])
  // picks win over a lead
  assert.match(decisionFor({ ...base, lens: 'marketers', leads: { audience: '1' }, picked: [ROWS[2]] }).pick!, /اخترتها: طويق/)

  // the distributor's growth comes from the golden rows: the district building the most
  assert.match(decisionFor({ ...base, lens: 'distributors', done: ['growth'] }).pick!, /النرجس/)

  assert.equal(decisionFor({ ...base, lens: 'analysts', picked: [ROWS[0], ROWS[2]] }).pick, 'العليا مقابل طويق')

  const property = decisionFor({ ...base, lens: 'property', leads: { homes: '2' } })
  assert.deepEqual(property.actions.map((action) => (action.kind === 'link' ? action.href : '')), ['/homes?district=2', '/price?district=2'])
  // the search made in «اختر عقاراً» goes with the links: deal, type and budget to «العقار», deal and type to the price
  const searched = decisionFor({ ...base, lens: 'property', leads: { homes: '2' }, homes: { kind: 'rent', type: 'villa', deal: 'rent_month', budget: 8000 } })
  assert.deepEqual(searched.actions.map((action) => (action.kind === 'link' ? action.href : '')), ['/homes?deal=rent_month&type=villa&district=2&max=8000', '/price?district=2&deal=rent_month&type=villa'])
  assert.match(searched.actions[0].label, /فيلا حتى 8,000 ريال/)
  // a type the price page does not offer is not named there
  assert.match(decisionFor({ ...base, lens: 'property', leads: { homes: '2' }, homes: { kind: 'rent', type: 'store', deal: null, budget: 0 } }).actions[1].label, /سعّر عقاراً/)
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

test('decision moments are measured by sizes and ids only: no district, business, value or place', () => {
  const props = decisionMomentProps('audience_filtered', { lens: 'marketers', city: 'Riyadh', filters: ['sex', 'income'] })
  assert.deepEqual(props, { moment: 'audience_filtered', lens: 'marketers', city: 'Riyadh', filters: 'income,sex' })
  assert.deepEqual(decisionMomentProps('route_planned', { lens: 'distributors', city: 'Riyadh', count: 23 }), { moment: 'route_planned', lens: 'distributors', city: 'Riyadh', size: '16-30' })
  assert.equal(decisionMomentProps('audience_filtered', { lens: 'marketers', city: 'Riyadh', filters: [] }).filters, 'none')
})

test('the compared sites live in the map address: at most three, inside the Kingdom, read back as written', () => {
  const steps = ['gaps', 'competitors', 'corridors', 'around', 'homes']
  const sites = [{ lon: 46.67512, lat: 24.71101 }, { lon: 46.72, lat: 24.7 }]
  const search = writeMapOptions('', 'shops', steps, (key) => (key === 'around.sites' ? sites : undefined))
  assert.equal(new URLSearchParams(search).get('sites'), '46.67512,24.71101;46.72000,24.70000')
  assert.deepEqual(readMapOptions(search, 'shops', steps)['around.sites'], [{ lon: 46.67512, lat: 24.71101 }, { lon: 46.72, lat: 24.7 }])
  // outside the box, malformed, or a lens without the step: nothing
  assert.equal(readMapOptions('?sites=10,10;abc', 'shops', steps)['around.sites'], undefined)
  assert.equal(readMapOptions('?sites=46.7,24.7', 'analysts', ['district', 'compare'])['around.sites'], undefined)
  assert.equal((readMapOptions('?sites=46.1,24.1;46.2,24.2;46.3,24.3;46.4,24.4', 'shops', steps)['around.sites'] as unknown[]).length, 3)
  // no sites: no parameter
  assert.equal(writeMapOptions('', 'shops', steps, (key) => (key === 'around.sites' ? [] : undefined)), '')
})

test('«العقار» opens on the budget a link carries, and only a sensible one', () => {
  assert.equal(readHomesMax('?max=8000'), 8000)
  for (const bad of ['?max=-5', '?max=abc', '?max=0', '?max=99999999999', '']) assert.equal(readHomesMax(bad), null, bad)
  assert.equal(homesHref({ districts: ['2'], max: 50000 }), '/homes?district=2&max=50000')
  assert.equal(homesHref({ districts: ['2'], max: 0 }), '/homes?district=2')
})

test('a partial answer names what it is missing; a whole one says nothing', () => {
  assert.equal(partialNote([], null), null)
  assert.equal(partialNote(['البحث بلا نتيجة'], null), 'نتيجة جزئية: تعذّر تحميل «البحث بلا نتيجة»')
  assert.equal(partialNote(['الدخل'], 'السلاسل'), 'نتيجة جزئية: تعذّر تحميل «الدخل» و«السلاسل»')
})
