import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanQuery, readMapQuery, writeMapQuery } from './map-query.ts'

const LENSES = { shops: ['gaps', 'competitors', 'corridors'], analysts: ['district', 'compare'] }

test('a valid address opens the same view', () => {
  assert.deepEqual(readMapQuery('?city=Jeddah&lens=analysts&tool=compare&district=12,40&q=مورد قهوة', LENSES), {
    city: 'Jeddah', lens: 'analysts', tool: 'compare', districts: ['12', '40'], q: 'مورد قهوة',
  })
})

test('anything outside what a value may be falls back to the default', () => {
  const view = readMapQuery('?city=<script>&lens=__proto__&tool=compare&district=1;drop,../x,ok_1&q=%00%00', LENSES)
  assert.deepEqual(view, { city: null, lens: null, tool: null, districts: ['ok_1'], q: null })
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
