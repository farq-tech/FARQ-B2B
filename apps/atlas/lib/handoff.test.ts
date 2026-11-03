import assert from 'node:assert/strict'
import test from 'node:test'
import { priceStartHref, ageBucket, cityKey, districtMapHref, homesHref, lastView, loginHref, mapHref, priceHref, readHomesQuery, rememberView, safeMapOrigin, widthBucket, writeHomesQuery } from './handoff.ts'

const TYPES = [
  { id: 'room', kinds: ['rent'] }, { id: 'apartment', kinds: ['rent', 'sale'] }, { id: 'villa', kinds: ['rent', 'sale'] }, { id: 'land', kinds: ['sale'] },
]
const listing = { city: 'Jeddah', district_id: '812', deal: 'sale', type: 'villa', area_sqm: 312.4, age: 4, street_width: 20, features: { furnished: 1 as const } }

test('a listing opens the price page with its own facts as the answers', () => {
  assert.equal(priceHref(listing), '/price?city=Jeddah&district=812&deal=sale&type=villa&area=312&age=3-5&width=20-29&furnished=yes')
  // the price page's defaults are left out: Riyadh, a yearly rent, a floor
  assert.equal(priceHref({ city: 'Riyadh', district_id: '5', deal: 'rent_year', type: 'floor', area_sqm: 200 }), '/price?district=5&area=200')
})

test('a listing the price page cannot price gets no link, never a half-filled form', () => {
  assert.equal(priceHref({ ...listing, type: 'store' }), null, 'a type the page does not offer')
  assert.equal(priceHref({ ...listing, deal: 'rent_unstated' }), null, 'a period the ad does not state')
  assert.equal(priceHref({ ...listing, district_id: null }), null)
  assert.equal(priceHref({ ...listing, area_sqm: null }), null)
  assert.equal(priceHref({ ...listing, district_id: '../x' }), null)
})

test('age and street width fall in the price page chips', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 11, 40].map(ageBucket), ['0', '1-2', '1-2', '3-5', '3-5', '6-10', '6-10', '11+', '11+'])
  assert.equal(ageBucket(undefined), null)
  assert.deepEqual([10, 15, 19, 20, 29, 30, 60].map(widthBucket), ['lt15', '15-19', '15-19', '20-29', '20-29', '30+', '30+'])
  assert.equal(widthBucket(0), null)
})

test('«العقار» reads its address back, every value checked', () => {
  assert.deepEqual(readHomesQuery('?city=Dammam&deal=sale&type=land,villa,room&district=1,2,bad;id', ['rent_year', 'rent_month'], TYPES),
    { city: 'Dammam', kind: 'sale', rentDeal: 'rent_year', types: ['land', 'villa'], districts: ['1', '2'] })
  assert.deepEqual(readHomesQuery('?city=<x>&deal=rent_week&type=castle', ['rent_year', 'rent_month'], TYPES),
    { city: 'Riyadh', kind: 'rent', rentDeal: 'rent_year', types: ['apartment'], districts: [] })
  assert.equal(readHomesQuery('?deal=rent_month', ['rent_year', 'rent_month'], TYPES).rentDeal, 'rent_month')
})

test('«العقار» writes only what differs from its defaults, and reads back the same', () => {
  assert.equal(writeHomesQuery({ city: 'Riyadh', kind: 'rent', rentDeal: 'rent_year', types: ['apartment'], districts: [] }), '')
  const view = { city: 'Jeddah', kind: 'rent' as const, rentDeal: 'rent_month', types: ['villa'], districts: ['77'] }
  assert.deepEqual(readHomesQuery(`?${writeHomesQuery(view)}`, ['rent_year', 'rent_month'], TYPES), view)
  assert.equal(homesHref({ city: 'Riyadh', districts: ['9'] }), '/homes?district=9')
  assert.equal(homesHref({}), '/homes')
})

test('the map opens on a district, a group and a step', () => {
  assert.equal(mapHref({ city: 'Riyadh', lens: 'shops' }), '/map')
  assert.equal(districtMapHref('Makkah', '31'), '/map?city=Makkah&lens=property&tool=district&district=31')
  assert.equal(districtMapHref('Riyadh', null), null)
  assert.equal(mapHref({ q: ' مورد <b>قهوة ' }), `/map?${new URLSearchParams({ q: 'مورد b قهوة' })}`)
})

test('a request goes back only to a view inside the map', () => {
  assert.equal(safeMapOrigin('/map?lens=marketers&district=4'), '/map?lens=marketers&district=4')
  assert.equal(safeMapOrigin('/map'), '/map')
  for (const bad of ['https://evil.example/map', '//evil.example', '/mapx', '/map?"><script>', '/requests', '', null, undefined]) assert.equal(safeMapOrigin(bad), null, String(bad))
})

test('a city key comes from the shared list, and a login comes back to the same view', () => {
  assert.equal(cityKey('al khobar', [{ en: 'Riyadh' }, { en: 'Al Khobar' }]), 'Al Khobar')
  assert.equal(cityKey('tabuk', [{ en: 'Riyadh' }]), null)
  assert.equal(loginHref('/map?district=4&lens=marketers'), '/login?next=%2Fmap%3Fdistrict%3D4%26lens%3Dmarketers')
  assert.equal(loginHref('//evil.example'), '/login?next=%2Fmap')
})

test('the last view of a surface is kept for the tab, and a blocked storage opens the default view', () => {
  const store = new Map<string, string>()
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  assert.equal(lastView('/homes'), '/homes')
  rememberView('/homes', '?city=Jeddah&deal=sale')
  assert.equal(lastView('/homes'), '/homes?city=Jeddah&deal=sale')
  rememberView('/map', '')
  assert.equal(lastView('/map'), '/map')
  store.set('atlas.view|/price', 'javascript:alert(1)')
  assert.equal(lastView('/price'), '/price', 'anything but a query is ignored')
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  rememberView('/map', '?x=1')
  assert.equal(lastView('/map'), '/map')
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage
})

test('the price page starts from what the page already knows', () => {
  assert.equal(priceStartHref({ city: 'Riyadh', district: null, deal: 'rent_year', type: 'apartment' }), '/price?type=apartment')
  assert.equal(priceStartHref({ city: 'Jeddah', district: '4', deal: 'sale', type: 'store' }), '/price?city=Jeddah&district=4&deal=sale', 'a type the page does not offer is left to ask')
})
