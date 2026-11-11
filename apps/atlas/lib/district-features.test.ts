import assert from 'node:assert/strict'
import test from 'node:test'
import { isCityDistrictFeatureCollection } from './district-features.ts'

const feature = (id: number) => ({
  type: 'Feature', properties: { id, ar: `حي ${id}` },
  geometry: { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 24]]] },
})

test('accepts an empty district collection only when the city catalog confirms zero districts', () => {
  assert.equal(isCityDistrictFeatureCollection([], 0), true)
  assert.equal(isCityDistrictFeatureCollection([], 3), false)
  assert.equal(isCityDistrictFeatureCollection([]), false)
})

test('still rejects malformed or duplicate district features', () => {
  assert.equal(isCityDistrictFeatureCollection([feature(1), feature(2)], 2), true)
  assert.equal(isCityDistrictFeatureCollection([feature(1), feature(1)], 2), false)
  assert.equal(isCityDistrictFeatureCollection([{ ...feature(1), geometry: null }], 1), false)
})

test('rejects a partial city boundary set when the catalog provides its expected count', () => {
  assert.equal(isCityDistrictFeatureCollection([feature(1), feature(2)], 3), false)
  assert.equal(isCityDistrictFeatureCollection([feature(1), feature(2)], 2), true)
})

test('rejects polygon coordinates that cannot form a valid GeoJSON ring', () => {
  const valid = feature(1)
  assert.equal(isCityDistrictFeatureCollection([{ ...valid, geometry: { type: 'Polygon', coordinates: [] } }], 1), false)
  assert.equal(isCityDistrictFeatureCollection([{ ...valid, geometry: { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 25]]] } }], 1), false)
  assert.equal(isCityDistrictFeatureCollection([{ ...valid, geometry: { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 24], [NaN, 24]]] } }], 1), false)
  assert.equal(isCityDistrictFeatureCollection([{ ...valid, geometry: { type: 'Polygon', coordinates: [[[46, 24, 1], [47, 24, 1], [47, 25, 1], [46, 24, 2]]] } }], 1), false)
  assert.equal(isCityDistrictFeatureCollection([{ ...valid, geometry: { type: 'MultiPolygon', coordinates: [[[[46, 24], [47, 24], [47, 25], [46, 24]]]] } }], 1), true)
})
