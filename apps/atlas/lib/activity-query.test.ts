import assert from 'node:assert/strict'
import test from 'node:test'
import { activityBody, activityForToken, activityKey, isActivity, pickToken, searchActivities, studiedFrom, type Activity } from './activity-query.ts'
import { matchActivity } from './sticky-state.ts'

const entry = (kind: Activity['kind'], name_ar: string, parent_ar: string, main_ar: string, n: number, query: Activity['query']): Activity =>
  ({ kind, key: (query.sub_ids ?? query.specialty_ids ?? []).join('|'), name_ar, parent_ar, main_id: 'x', main_ar, n, query })

const LIST: Activity[] = [
  entry('sub', 'حلاق رجالي', 'تجميل وعناية شخصية', 'تجميل وعناية شخصية', 22683, { sub_ids: ['beauty.barber'] }),
  entry('sub', 'مغسلة ملابس', 'خدمات شخصية', 'خدمات شخصية', 10390, { sub_ids: ['personal.laundry'] }),
  entry('sub', 'صيدلية', 'صحة وطب', 'صحة وطب', 9737, { sub_ids: ['health.pharmacy'] }),
  entry('sub', 'مغسلة سيارات', 'سيارات ومركبات', 'سيارات ومركبات', 4464, { sub_ids: ['auto.car_wash'] }),
  entry('specialty', 'برجر', 'وجبات سريعة، مطعم', 'أغذية ومشروبات', 1992, { specialty_ids: ['food.fast_food.burger', 'food.restaurant.burger'] }),
  entry('specialty', 'مغسلة خدمة ذاتية', 'مغسلة سيارات', 'سيارات ومركبات', 37, { specialty_ids: ['auto.car_wash.self_service'] }),
]

test('one way of naming an activity reaches the service, the most exact first', () => {
  assert.deepEqual(activityBody({ q: 'صيدلية', sub_ids: ['health.pharmacy'] }), { q: 'صيدلية' })
  assert.deepEqual(activityBody({ specialty_ids: ['a'], sub_ids: ['b'], main_id: 'c' }), { specialty_ids: ['a'] })
  assert.deepEqual(activityBody({ sub_ids: ['b'], main_id: 'c' }), { sub_ids: ['b'] })
  assert.deepEqual(activityBody({ main_id: 'c' }), { main_id: 'c' })
  assert.deepEqual(activityBody({ sub_ids: [] }), {})
  assert.deepEqual(activityBody(null), {})
})

test('keys tell activities apart, and a pick token is kept only for a subcategory or specialty', () => {
  assert.notEqual(activityKey({ sub_ids: ['a'] }), activityKey({ specialty_ids: ['a'] }))
  assert.equal(activityKey({}), '')
  assert.equal(pickToken({ sub_ids: ['personal.laundry'] }), 'sub:personal.laundry')
  assert.equal(pickToken({ specialty_ids: ['food.fast_food.burger', 'food.restaurant.burger'] }), 'spec:food.fast_food.burger,food.restaurant.burger')
  assert.equal(pickToken({ q: 'برجر' }), null)
  assert.equal(pickToken({ main_id: 'food' }), null)
  assert.equal(pickToken({ sub_ids: ['a', 'b'] }), null, 'one subcategory per pick')
  assert.equal(activityForToken('spec:food.fast_food.burger,food.restaurant.burger', LIST)?.name_ar, 'برجر')
  assert.equal(activityForToken('sub:nothing.here', LIST), undefined)
})

test('a picked entry is studied by its own query and shop name', () => {
  assert.deepEqual(studiedFrom(LIST[4]), { specialty_ids: ['food.fast_food.burger', 'food.restaurant.burger'], label: 'برجر' })
})

test('search finds shops by name first, then by their parent, folding Arabic letters', () => {
  assert.deepEqual(searchActivities(LIST, 'مغسلة').map((item) => item.name_ar), ['مغسلة ملابس', 'مغسلة سيارات', 'مغسلة خدمة ذاتية'])
  assert.deepEqual(searchActivities(LIST, 'مغسله سيارات').map((item) => item.name_ar), ['مغسلة سيارات', 'مغسلة خدمة ذاتية'])
  assert.deepEqual(searchActivities(LIST, 'البرجر').map((item) => item.name_ar), ['برجر'])
  assert.deepEqual(searchActivities(LIST, 'أغذية').map((item) => item.name_ar), ['برجر'], 'a heading word finds its shops')
  assert.equal(searchActivities(LIST, '').length, LIST.length)
  assert.equal(searchActivities(LIST, '', 2).length, 2)
  assert.deepEqual(searchActivities(LIST, 'طيران'), [])
})

test('a typed activity carries over only when it names an entry exactly', () => {
  assert.equal(matchActivity(LIST, ' الصيدلية ')?.name_ar, 'صيدلية')
  assert.equal(matchActivity(LIST, 'مغسله ملابس')?.name_ar, 'مغسلة ملابس')
  assert.equal(matchActivity(LIST, 'مغسلة'), undefined)
  assert.equal(matchActivity(LIST, ''), undefined)
})

test('entries the service sends malformed are dropped', () => {
  assert.equal(isActivity(LIST[0]), true)
  assert.equal(isActivity({ ...LIST[0], kind: 'main' }), false)
  assert.equal(isActivity({ ...LIST[0], query: { sub_ids: ['../x'] } }), false)
  assert.equal(isActivity({ ...LIST[0], query: { specialty_ids: ['a'] } }), false, 'a subcategory carries sub_ids')
  assert.equal(isActivity({ ...LIST[0], n: Number.NaN }), false)
  assert.equal(isActivity(null), false)
})
