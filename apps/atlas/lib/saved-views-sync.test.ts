import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_VIEWS, deviceOnlyViews, mergeSavedViews, readView, viewKey, viewPayload, type SavedView } from './saved-views.ts'

const view = (id: string, href: string, createdAt = '2026-11-03T10:00:00Z', extra: Partial<SavedView> = {}): SavedView => (
  { id, name: `مقارنة ${id}`, href, city: 'Riyadh', cityName: 'الرياض', districts: ['العليا', 'الملقا'], createdAt, ...extra })

test('the same view is one item, whatever order its address lists its parts in', () => {
  assert.equal(viewKey('/map?tool=compare&district=1,2&lens=analysts'), viewKey('/map?lens=analysts&district=1,2&tool=compare'))
  assert.notEqual(viewKey('/map?district=1,2'), viewKey('/map?district=2,1'))
  assert.equal(viewKey('/map'), '/map')
})

test('signing in: this device’s comparisons join the account’s, without a second copy of the same view', () => {
  const local = [view('a', '/map?district=1,2', '2026-11-01T00:00:00Z'), view('b', '/map?lens=analysts&district=3,4', '2026-11-02T00:00:00Z')]
  const cloud = [view('c', '/map?district=3,4&lens=analysts', '2026-11-02T00:00:00Z'), view('d', '/map?district=5,6', '2026-10-30T00:00:00Z')]
  const plan = mergeSavedViews(local, cloud)
  assert.deepEqual(plan.views.map((item) => item.id), ['c', 'a', 'd'], 'newest first; the shared view once, as the account has it')
  assert.deepEqual(plan.upload.map((item) => item.id), ['a'], 'only what the account lacks is sent')
  assert.deepEqual(plan.remove, [])
  assert.ok(plan.views.find((item) => item.id === 'c')?.synced)
  assert.ok(!plan.views.find((item) => item.id === 'a')?.synced, 'not marked as kept until the account confirms')
})

test('a rename made on this device while signed out wins over the account’s older name', () => {
  const plan = mergeSavedViews([view('a', '/map?district=1,2', '2026-11-03T00:00:00Z', { name: 'الاسم الجديد' })], [view('c', '/map?district=1,2', '2026-11-01T00:00:00Z')])
  assert.deepEqual(plan.views.map((item) => [item.id, item.name]), [['c', 'الاسم الجديد']])
  assert.equal(plan.upload.length, 1)
})

test('deleted on another device: an item this device had from the account does not come back', () => {
  const plan = mergeSavedViews([view('a', '/map?district=1,2', undefined, { synced: true }), view('b', '/map?district=3,4')], [])
  assert.deepEqual(plan.views.map((item) => item.id), ['b'])
  assert.deepEqual(plan.upload.map((item) => item.id), ['b'])
})

test('deleted here while the account was out of reach: it stays out and is asked again', () => {
  const plan = mergeSavedViews([], [view('c', '/map?district=1,2'), view('d', '/map?district=3,4')], ['/map?district=1,2', '/map?district=9'])
  assert.deepEqual(plan.views.map((item) => item.id), ['d'])
  assert.deepEqual(plan.remove, ['/map?district=1,2'], 'an address the account no longer has needs nothing')
})

test('at most MAX_VIEWS: what falls off the end leaves the account too', () => {
  const cloud = Array.from({ length: MAX_VIEWS }, (_, i) => view(`c${i}`, `/map?district=${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`))
  const local = [view('new', '/map?district=new', '2026-11-03T00:00:00Z')]
  const plan = mergeSavedViews(local, cloud)
  assert.equal(plan.views.length, MAX_VIEWS)
  assert.equal(plan.views[0].id, 'new')
  assert.equal(plan.remove.length, 1)
  assert.ok(!plan.views.some((item) => plan.remove.includes(item.href)))
})

test('the account sending the same view twice keeps it once', () => {
  const plan = mergeSavedViews([], [view('c', '/map?a=1&b=2', '2026-11-01T00:00:00Z'), view('d', '/map?b=2&a=1', '2026-11-02T00:00:00Z')])
  assert.deepEqual(plan.views.map((item) => item.id), ['d'])
})

test('signed out, only this device’s comparisons stay; the account record holds no figure', () => {
  assert.deepEqual(deviceOnlyViews([view('a', '/map?x=1', undefined, { synced: true }), view('b', '/map?x=2')]).map((item) => item.id), ['b'])
  const payload = viewPayload(view('a', '/map?x=1', undefined, { synced: true }))
  assert.deepEqual(Object.keys(payload.view).sort(), ['city', 'cityName', 'createdAt', 'districts', 'href', 'id', 'name'])
  assert.equal(readView({ ...view('a', '/map'), synced: true })?.synced, true)
  assert.equal(readView({ ...view('a', '/map'), synced: 'yes' })?.synced, undefined)
})

test('a saved site comparison (kind: sites) keeps its kind through the account and the merge', () => {
  const sites = view('s', '/map?lens=shops&tool=around&sites=1', '2026-11-03T09:00:00Z', { kind: 'sites', districts: ['الموقع 1 في العليا', 'الموقع 2 في الملقا'] })
  // the record the account keeps, as JSON, read back the way app/api/saved-views reads it
  const record = JSON.parse(JSON.stringify(viewPayload(sites))) as { view: unknown }
  const back = readView(record.view)
  assert.equal(back?.kind, 'sites')
  assert.equal(mergeSavedViews([], [{ ...back!, synced: true }]).views[0].kind, 'sites')
  assert.equal(mergeSavedViews([sites], []).upload[0].kind, 'sites')
  const renamed = mergeSavedViews([{ ...sites, name: 'جديد', createdAt: '2026-11-03T12:00:00Z' }], [{ ...back!, synced: true }])
  assert.deepEqual([renamed.views[0].name, renamed.views[0].kind, renamed.upload[0]?.kind], ['جديد', 'sites', 'sites'])
  assert.equal(readView({ ...sites, kind: 'other' })?.kind, undefined, 'an unknown kind is not carried')
})
