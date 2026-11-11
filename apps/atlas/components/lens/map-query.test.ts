import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanQuery, mapOptions, readMapOptions, readMapQuery, writeMapOptions, writeMapQuery } from './map-query.ts'

const LENSES = { shops: ['gaps', 'competitors', 'corridors'], analysts: ['district', 'compare'] }

test('a valid address opens the same view', () => {
  assert.deepEqual(readMapQuery('?city=Jeddah&lens=analysts&tool=compare&district=12,40&q=مورد قهوة', LENSES), {
    city: 'Jeddah', lens: 'analysts', tool: 'compare', districts: ['12', '40'], q: 'مورد قهوة', activity: null, main: null, pick: null, layer: null,
  })
})

test('anything outside what a value may be falls back to the default', () => {
  const view = readMapQuery('?city=<script>&lens=__proto__&tool=compare&district=1;drop,../x,ok_1&q=%00%00', LENSES)
  assert.deepEqual(view, { city: null, lens: null, tool: null, districts: ['ok_1'], q: null, activity: null, main: null, pick: null, layer: null })
  // a step of another lens does not open in the default one
  assert.equal(readMapQuery('?tool=compare', LENSES).tool, null)
  assert.equal(readMapQuery('?tool=competitors', LENSES).tool, 'competitors')
  assert.equal(readMapQuery('?lens=constructor', LENSES).lens, null)
})

test('a landing goal names its lens', () => {
  assert.equal(readMapQuery('?goal=explore', LENSES, { explore: 'analysts' }).lens, 'analysts')
  assert.equal(readMapQuery('?goal=nope', LENSES, { explore: 'analysts' }).lens, null)
})

test('a search is cleaned and capped', () => {
  assert.equal(cleanQuery('  مورد\n\tقهوة <b> '), 'مورد قهوة b')
  assert.equal(cleanQuery('x'.repeat(200))?.length, 80)
  assert.equal(cleanQuery('   '), null)
})

test('the address keeps only what differs from the defaults, and other parameters', () => {
  assert.equal(writeMapQuery('?goal=expand&ref=mail&search=1', { city: 'Riyadh', lens: 'shops', tool: 'gaps', districts: [], q: null }, 'gaps'), '?ref=mail')
  assert.equal(writeMapQuery('', { city: 'Jeddah', lens: 'analysts', tool: 'compare', districts: ['1', '2'], q: 'قهوة' }, 'district'),
    '?city=Jeddah&lens=analysts&tool=compare&district=1%2C2&q=%D9%82%D9%87%D9%88%D8%A9')
})

test('the studied activity: typed words, or a main activity by id that wins over them', () => {
  assert.equal(readMapQuery('?activity=  مغسلة <i>ملابس</i> ', LENSES).activity, 'مغسلة i ملابس /i')
  assert.deepEqual(readMapQuery('?activity=مخبز&main=5611', LENSES), { ...readMapQuery('', LENSES), main: '5611', activity: null })
  assert.equal(readMapQuery('?main=../5', LENSES).main, null)
  assert.equal(readMapQuery('?main=../5&activity=مخبز', LENSES).activity, 'مخبز')
  const base = { city: 'Riyadh', lens: 'shops', tool: 'gaps', districts: [], q: null }
  // no activity chosen: none written; a chosen one is written, the old default «صيدلية» too (it is a choice now)
  assert.equal(writeMapQuery('', { ...base, activity: null }, 'gaps'), '')
  assert.equal(writeMapQuery('', { ...base, activity: 'صيدلية' }, 'gaps'), '?activity=%D8%B5%D9%8A%D8%AF%D9%84%D9%8A%D8%A9')
  assert.equal(writeMapQuery('?activity=x', { ...base, main: '5611', activity: 'مطاعم' }, 'gaps'), '?main=5611')
  assert.equal(writeMapQuery('?main=1', { ...base, activity: 'مخبز' }, 'gaps'), '?activity=%D9%85%D8%AE%D8%A8%D8%B2')
})

test('a picked subcategory or specialty: kept by id, it wins over a main activity and typed words', () => {
  assert.equal(readMapQuery('?pick=sub:personal.laundry', LENSES).pick, 'sub:personal.laundry')
  assert.equal(readMapQuery('?pick=spec:food.fast_food.burger,food.restaurant.burger', LENSES).pick, 'spec:food.fast_food.burger,food.restaurant.burger')
  const both = readMapQuery('?pick=sub:health.pharmacy&main=health&activity=صيدلية', LENSES)
  assert.deepEqual([both.pick, both.main, both.activity], ['sub:health.pharmacy', null, null])
  // anything else falls back: an unknown kind, a path, capitals, more than one subcategory
  for (const bad of ['main:health', 'sub:../x', 'sub:Health', 'sub:a,b', 'spec:', 'sub:a b']) assert.equal(readMapQuery(`?pick=${encodeURIComponent(bad)}`, LENSES).pick, null, bad)
  const base = { city: 'Riyadh', lens: 'shops', tool: 'gaps', districts: [], q: null }
  assert.equal(writeMapQuery('?main=health&activity=x', { ...base, pick: 'sub:health.pharmacy', main: 'health', activity: 'صيدلية' }, 'gaps'), '?pick=sub%3Ahealth.pharmacy')
  assert.equal(writeMapQuery('?pick=sub:x', { ...base, pick: 'sub:../x', activity: 'مخبز' }, 'gaps'), '?activity=%D9%85%D8%AE%D8%A8%D8%B2')
  const view = { ...base, tool: 'competitors', main: null, pick: 'spec:food.fast_food.pizza', activity: null, layer: null }
  assert.deepEqual(readMapQuery(writeMapQuery('', view, 'gaps'), LENSES), { ...view, city: null, lens: null })
})

test('the shading figure: kept when it is one of the lens\'s own, left out when it is the lens\'s first', () => {
  const LAYERS = { shops: ['residentsPerBusiness', 'unmet', 'population'], analysts: ['population', 'income'] }
  assert.equal(readMapQuery('?layer=unmet', LENSES, {}, LAYERS).layer, 'unmet')
  assert.equal(readMapQuery('?lens=analysts&layer=income', LENSES, {}, LAYERS).layer, 'income')
  // a figure of another lens, an unknown one, and a prototype key all fall back to the lens's own
  assert.equal(readMapQuery('?layer=income', LENSES, {}, LAYERS).layer, null)
  assert.equal(readMapQuery('?layer=__proto__', LENSES, {}, LAYERS).layer, null)
  assert.equal(readMapQuery('?layer=unmet', LENSES).layer, null)
  const base = { city: 'Riyadh', lens: 'shops', tool: 'gaps', districts: [], q: null }
  assert.equal(writeMapQuery('', { ...base, layer: 'residentsPerBusiness' }, 'gaps', 'residentsPerBusiness'), '')
  assert.equal(writeMapQuery('?layer=unmet', { ...base, layer: 'unmet' }, 'gaps', 'residentsPerBusiness'), '?layer=unmet')
  assert.equal(writeMapQuery('?layer=unmet', { ...base, layer: null }, 'gaps', 'residentsPerBusiness'), '')
})

test('a written address reads back as the same view (a reload or a shared link restores the work)', () => {
  const LAYERS = { shops: ['residentsPerBusiness', 'unmet'], analysts: ['population', 'income'] }
  const view = { city: 'Jeddah', lens: 'analysts', tool: 'compare', districts: ['7', '9'], q: 'مورد قهوة', main: '5611', pick: null, activity: null, layer: 'income' }
  assert.deepEqual(readMapQuery(writeMapQuery('?ref=x', view, 'district', 'population'), LENSES, {}, LAYERS), view)
  // defaults are left out of the address and read back as «the default» (null)
  const typed = { city: 'Riyadh', lens: 'shops', tool: 'competitors', districts: [], q: null, main: null, pick: null, activity: 'مخبز', layer: 'unmet' }
  assert.deepEqual(readMapQuery(writeMapQuery('', typed, 'gaps', 'residentsPerBusiness'), LENSES, {}, LAYERS),
    { ...typed, city: null, lens: null })
})

const SHOPS = ['gaps', 'competitors', 'corridors', 'around', 'homes']
const DISTRIBUTORS = ['territories', 'corridors', 'growth']
const PROPERTY = ['homes', 'district']
const MARKETERS = ['audience', 'businesses']
const written = (values: Record<string, unknown>, lens: string, steps: string[], search = '') => writeMapOptions(search, lens, steps, (key) => values[key])

test('the choices inside a step read back as they were written (a reload restores them)', () => {
  const shops = {
    'competitors.order': 'light', 'competitors.view': 'brands', 'competitors.rival': { q: 'عيادة', label: 'عيادة' }, 'competitors.rivalOrder': 'first',
    'around.reach': { kind: 'drive', minutes: 10 }, 'homes.preset.kind': 'sale', 'homes.preset.type': 'office', 'homes.preset.budget': 1500000,
    'businesses.search': { q: 'مخبز', scope: 'Riyadh|حي|' }, 'businesses.open': 'poi:123-abc',
  }
  const address = written(shops, 'shops', SHOPS, '?city=Jeddah')
  assert.equal(new URLSearchParams(address).get('city'), 'Jeddah')
  // the list's scope stays in the page: read from the address, the search fits the first list that opens
  assert.deepEqual(readMapOptions(address, 'shops', SHOPS), { ...shops, 'businesses.search': { q: 'مخبز', scope: null } })

  const territories = { 'territories.count': 12, 'territories.weight': 'population', 'territories.days': 3, 'territories.perDay': 40 }
  assert.equal(written(territories, 'distributors', DISTRIBUTORS), '?reps=12&weight=population&days=3&perday=40')
  assert.deepEqual(readMapOptions('?reps=12&weight=population&days=3&perday=40', 'distributors', DISTRIBUTORS), territories)

  const audience = { 'audience.mode': 'businesses', 'audience.sex': 'women', 'audience.nationality': 'saudi', 'audience.minIncome': 12000, 'audience.rankBy': 'nationality' }
  assert.deepEqual(readMapOptions(written(audience, 'marketers', MARKETERS), 'marketers', MARKETERS), audience)

  // a second activity named by a main activity's id reads back without its name (the page takes it from the list)
  assert.equal(written({ 'competitors.rival': { main_id: '5611', label: 'مخابز' } }, 'shops', SHOPS), '?vsmain=5611')
  assert.deepEqual(readMapOptions('?vsmain=5611&vs=x', 'shops', SHOPS), { 'competitors.rival': { main_id: '5611' } })
  // «كل الأنشطة» in the business list
  assert.equal(written({ 'businesses.search': { q: '', scope: 'x' } }, 'analysts', ['district', 'compare']), '?bq=*')
  assert.deepEqual(readMapOptions('?bq=*', 'analysts', ['district', 'compare']), { 'businesses.search': { q: '', scope: null } })
})

test('a choice back on its step\'s default leaves the address, and so does one never made', () => {
  const defaults = Object.fromEntries(mapOptions('shops').map((option) => [option.sticky, option.initial]))
  assert.equal(written(defaults, 'shops', SHOPS, '?ref=mail'), '?ref=mail')
  assert.equal(written({}, 'distributors', DISTRIBUTORS, '?reps=9'), '')
  // the homes step opens on store rents in the shops lens and on yearly apartments in the homes lens
  assert.equal(written({ 'homes.preset.type': 'store', 'homes.preset.rentDeal': 'all' }, 'shops', SHOPS), '')
  assert.equal(written({ 'homes.plain.type': 'apartment', 'homes.plain.rentDeal': 'rent_year' }, 'property', PROPERTY), '')
  assert.equal(written({ 'homes.plain.type': 'store', 'homes.plain.rentDeal': 'all' }, 'property', PROPERTY), '?type=store&deal=all')
})

test('the options of another lens\'s steps leave the address with it', () => {
  // the territories' reps are not a step of the shops lens: opening it there drops them
  assert.equal(written({ 'territories.count': 12, 'competitors.order': 'light' }, 'shops', SHOPS, '?reps=12&lens=shops'), '?lens=shops&order=light')
  assert.deepEqual(readMapOptions('?reps=12&order=light', 'shops', SHOPS), { 'competitors.order': 'light' })
  // the homes filters belong to the lens they were set in
  assert.deepEqual(readMapOptions('?type=villa', 'property', PROPERTY), { 'homes.plain.type': 'villa' })
  assert.deepEqual(readMapOptions('?type=villa', 'shops', SHOPS), { 'homes.preset.type': 'villa' })
})

test('a choice the step does not offer is dropped on read', () => {
  const bad = '?order=random&view=__proto__&vsorder=1&reach=750m&aud=x&sex=other&nat=&income=9000&rank=age' +
    '&reps=1&days=7&perday=0&weight=&kind=lease&type=castle&deal=sale&budget=-5&vsmain=../5&biz=%3Cscript%3E&bq=%00'
  assert.deepEqual(readMapOptions(bad, 'shops', SHOPS), {})
  assert.deepEqual(readMapOptions(bad, 'distributors', DISTRIBUTORS), {})
  assert.deepEqual(readMapOptions(bad, 'marketers', MARKETERS), {})
  assert.deepEqual(readMapOptions('?reps=51&days=1e2&perday=20.5', 'distributors', DISTRIBUTORS), {})
  assert.deepEqual(readMapOptions('?reach=2000m', 'shops', SHOPS), { 'around.reach': { kind: 'radius', metres: 2000 } })
  // a budget is kept only with the deal it belongs to: a yearly rent's step under a monthly deal is dropped, and the
  // shops lens's «all periods» takes no budget
  assert.deepEqual(readMapOptions('?deal=rent_month&budget=50000', 'property', PROPERTY), { 'homes.plain.rentDeal': 'rent_month' })
  assert.deepEqual(readMapOptions('?deal=rent_month&budget=5000', 'property', PROPERTY), { 'homes.plain.rentDeal': 'rent_month', 'homes.plain.budget': 5000 })
  assert.deepEqual(readMapOptions('?budget=50000', 'shops', SHOPS), {})
  assert.deepEqual(readMapOptions('?kind=sale&budget=700000', 'shops', SHOPS), { 'homes.preset.kind': 'sale', 'homes.preset.budget': 700000 })
  // a value the page holds that no step offers writes nothing either
  assert.equal(written({ 'territories.count': 500, 'competitors.order': '<b>' }, 'distributors', DISTRIBUTORS), '')
})

test('the view and the step choices share one address without touching each other', () => {
  const view = { city: 'Jeddah', lens: 'distributors', tool: 'territories', districts: ['3'], q: null }
  const both = written({ 'territories.count': 8 }, 'distributors', DISTRIBUTORS, writeMapQuery('', view, 'territories'))
  assert.equal(both, '?city=Jeddah&lens=distributors&district=3&reps=8')
  assert.equal(writeMapQuery(both, view, 'territories'), both)
  assert.equal(readMapQuery(both, { distributors: DISTRIBUTORS }).city, 'Jeddah')
})
