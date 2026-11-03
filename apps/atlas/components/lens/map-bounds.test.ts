import assert from 'node:assert/strict'
import test from 'node:test'
import { boundsOf, cityBounds } from './map-bounds.ts'

const square = (lon: number, lat: number, size = 0.02) => ({
  geometry: { coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]] },
})

// a city of districts around 46.6 E, 24.7 N, about 20 km across
const city = Array.from({ length: 30 }, (_, index) => square(46.5 + (index % 6) * 0.04, 24.6 + Math.floor(index / 6) * 0.04))

test('every district of a compact city is framed', () => {
  assert.deepEqual(cityBounds(city), boundsOf(city))
})

test('a district filed 500 km away does not shrink the city to a speck', () => {
  const bounds = cityBounds([...city, square(42.17, 24.47)])
  assert.ok(bounds && bounds[0][0] > 46, `west edge ${bounds?.[0][0]} should stay in the city`)
  assert.deepEqual(bounds, boundsOf(city))
})

test('a wide city keeps its far but real districts', () => {
  // districts spread over about 100 km (Jeddah runs 55 km from its middle): nothing is dropped
  const wide = Array.from({ length: 20 }, (_, index) => square(39.1 + (index % 4) * 0.05, 21.1 + Math.floor(index / 4) * 0.2))
  assert.deepEqual(cityBounds(wide), boundsOf(wide))
})

test('a city of one or two districts, or none, is framed as it is', () => {
  assert.deepEqual(cityBounds([square(1, 1), square(10, 10)]), boundsOf([square(1, 1), square(10, 10)]))
  assert.equal(cityBounds([]), null)
})
