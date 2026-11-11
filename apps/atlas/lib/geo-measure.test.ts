import assert from 'node:assert/strict'
import test from 'node:test'
import { areaKm2, containsPoint, districtAt, neighbourMap } from './geo-measure.ts'
import type { DistrictFeature } from './insights-api.ts'

/** A unit square from (0,0) to (0.1,0.1) in lon/lat — small enough that the flat projection holds. */
const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]] }
/** The same square with a hole cut from its middle. */
const squareWithHole: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]],
    [[0.04, 0.04], [0.06, 0.04], [0.06, 0.06], [0.04, 0.06], [0.04, 0.04]],
  ],
}

const feature = (id: string, geometry: GeoJSON.Polygon): DistrictFeature => ({ type: 'Feature', geometry, properties: { id } })

test('containsPoint: inside the outline is inside, outside is outside', () => {
  assert.equal(containsPoint(square, { lon: 0.05, lat: 0.05 }), true)
  assert.equal(containsPoint(square, { lon: 0.2, lat: 0.05 }), false)
  assert.equal(containsPoint(square, { lon: 0.05, lat: 0.3 }), false)
})

test('containsPoint: a point in a hole is outside', () => {
  assert.equal(containsPoint(squareWithHole, { lon: 0.05, lat: 0.05 }), false)
  assert.equal(containsPoint(squareWithHole, { lon: 0.02, lat: 0.02 }), true)
})

test('districtAt: returns the id of the containing district, or null', () => {
  const features = [feature('A', square), feature('B', { type: 'Polygon', coordinates: [[[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3], [0.2, 0.2]]] })]
  assert.equal(districtAt({ lon: 0.05, lat: 0.05 }, features), 'A')
  assert.equal(districtAt({ lon: 0.25, lat: 0.25 }, features), 'B')
  assert.equal(districtAt({ lon: 0.9, lat: 0.9 }, features), null)
})

test('areaKm2: a 0.1° square near the equator is close to its geometric area', () => {
  // 0.1° of latitude ≈ 11.132 km; near the equator longitude is nearly the same, so ≈ 123.9 km².
  const area = areaKm2(square)
  assert.ok(area > 120 && area < 125, `expected ~124 km², got ${area}`)
})

test('districts that share an edge, or nearly do across a sliver, are neighbours; a district a block away is not', () => {
  // 1 km squares near Riyadh: A|B touch, B and C are 50 m apart (a sliver), D is 2 km east of C
  const km = 1 / 111
  const box = (x0: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[46.7 + x0, 24.7], [46.7 + x0 + km, 24.7], [46.7 + x0 + km, 24.7 + km], [46.7 + x0, 24.7 + km], [46.7 + x0, 24.7]]] })
  const map = neighbourMap([
    { id: 'A', geometry: box(0) }, { id: 'B', geometry: box(km) }, { id: 'C', geometry: box(2 * km + 0.05 * km) }, { id: 'D', geometry: box(5 * km) },
  ])
  assert.deepEqual([...map.get('A')!], ['B'])
  assert.deepEqual([...map.get('B')!].sort(), ['A', 'C'])
  assert.deepEqual([...map.get('C')!], ['B'])
  assert.equal(map.get('D')!.size, 0)
  assert.ok(!map.get('A')!.has('A'))
})
