import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_VIEWS, cleanName, defaultName, readView, saveView, type SavedView } from './saved-views.ts'

const view = (id: string, href: string, name = 'العليا مقابل الملقا'): SavedView => ({ id, name, href, city: 'Riyadh', cityName: 'الرياض', districts: ['العليا', 'الملقا'], createdAt: '2026-11-03T10:00:00Z' })

test('a comparison is offered its districts as its name, and a typed name is cleaned', () => {
  assert.equal(defaultName(['العليا', 'الملقا']), 'العليا مقابل الملقا')
  assert.equal(cleanName('  مقارنة <b>\u0000 الشمال  '), 'مقارنة b الشمال')
  assert.equal(cleanName('x'.repeat(200)).length, 80)
})

test('saving the same view again renames it and moves it to the top, never a second copy', () => {
  const a = view('1', '/map?lens=analysts&tool=compare&district=1,2')
  const b = view('2', '/map?lens=analysts&tool=compare&district=3,4')
  const list = saveView(saveView([], a), b)
  assert.deepEqual(list.map((item) => item.id), ['2', '1'])
  const renamed = saveView(list, { ...a, id: '3', name: 'شمال الرياض' })
  assert.deepEqual(renamed.map((item) => [item.id, item.name]), [['3', 'شمال الرياض'], ['2', 'العليا مقابل الملقا']])
})

test('only a map address with a name is saved or read back, and the list is capped', () => {
  assert.deepEqual(saveView([], view('1', 'https://evil.example/map')), [])
  assert.deepEqual(saveView([], view('1', '/map', '   ')), [])
  assert.equal(readView({ ...view('1', '/map'), districts: [1] }), null)
  assert.equal(readView(null), null)
  let list: SavedView[] = []
  for (let i = 0; i < MAX_VIEWS + 5; i++) list = saveView(list, view(String(i), `/map?district=${i}`))
  assert.equal(list.length, MAX_VIEWS)
  assert.equal(list[0].id, String(MAX_VIEWS + 4))
})
