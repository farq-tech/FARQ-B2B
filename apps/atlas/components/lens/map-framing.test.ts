import assert from 'node:assert/strict'
import test from 'node:test'
import { cityFrame, framePadding } from './map-framing.ts'

const square = (lon: number, lat: number, size = 0.02) => ({
  geometry: { coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]] },
})

// a grid of districts around Riyadh's middle
const riyadh = Array.from({ length: 100 }, (_, index) => square(46.5 + (index % 10) * 0.025, 24.5 + Math.floor(index / 10) * 0.025))

test('a city frames all its districts when none sits far away', () => {
  const [[west, south], [east, north]] = cityFrame(riyadh)!
  assert.ok(Math.abs(west - 46.5) < 1e-9 && Math.abs(south - 24.5) < 1e-9)
  assert.ok(Math.abs(east - 46.745) < 1e-9 && Math.abs(north - 24.745) < 1e-9)
})

test('a district far from the city stays out of the frame', () => {
  // «الجامعية» 4° west and an air base near Al-Kharj, as in the Riyadh table
  const frame = cityFrame([...riyadh, square(42.15, 24.46), square(47.4, 23.95, 0.3)])!
  assert.ok(frame[0][0] > 46.4, `west edge ${frame[0][0]}`)
  assert.ok(frame[0][1] > 24.4, `south edge ${frame[0][1]}`)
  assert.ok(frame[1][0] < 47, `east edge ${frame[1][0]}`)
})

test('nothing to frame: null, and a single district frames itself', () => {
  assert.equal(cityFrame([]), null)
  assert.equal(cityFrame([{ geometry: null }]), null)
  assert.deepEqual(cityFrame([square(46, 24)]), [[46, 24], [46.02, 24.02]])
})

test('the phone keeps the floating controls and the sheet clear, the desktop its colour key', () => {
  const peek = framePadding({ height: 676, width: 390, phone: true, cover: 0, peek: 136 })
  assert.equal(peek.top, 124)
  assert.equal(peek.bottom, 104)
  // half the screen: the sheet's part above the map's own bottom (the peek) is kept clear too
  const half = framePadding({ height: 676, width: 390, phone: true, cover: 0.55, peek: 136 })
  assert.ok(half.bottom > 300, `half bottom ${half.bottom}`)
  assert.ok(half.top + half.bottom <= 676 * (2 / 3) + 1e-9)
  const desk = framePadding({ height: 836, width: 900, phone: false, cover: 0, peek: 136 })
  assert.deepEqual(desk, { top: 40, bottom: 104, left: 40, right: 40 })
})
