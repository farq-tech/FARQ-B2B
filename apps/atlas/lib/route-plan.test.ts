import assert from 'node:assert/strict'
import test from 'node:test'
import { planRoute, tourOrder, windows, type Stop } from './route-plan.ts'

const grid = (n: number): Stop[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, lon: 46.6 + (i % 100) * 0.001, lat: 24.7 + Math.floor(i / 100) * 0.001 }))

test('any number of stops is cut into windows Valhalla accepts, each visited once', () => {
  const stops = grid(10_000)
  const start = { lon: 46.59, lat: 24.69 }
  const parts = windows(start, tourOrder(start, stops))
  assert.ok(parts.every((part) => part.stops.length + 1 <= 25), 'start point plus stops fit the 25-location request')
  const visited = parts.flatMap((part) => part.stops.map((stop) => stop.id))
  assert.equal(visited.length, 10_000)
  assert.equal(new Set(visited).size, 10_000, 'no stop is repeated or lost')
})

test('each window starts where the previous one ended, the first at the start point', () => {
  const start = { lon: 46.59, lat: 24.69 }
  const parts = windows(start, tourOrder(start, grid(60)))
  assert.deepEqual(parts[0].from, start)
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].from, parts[i - 1].stops[parts[i - 1].stops.length - 1])
})

test('the tour begins at the end nearer the start point', () => {
  const stops = grid(300)
  const ordered = tourOrder({ lon: 46.75, lat: 24.71 }, stops)
  const first = ordered[0], last = ordered[ordered.length - 1]
  const near = (stop: Stop) => (stop.lon - 46.75) ** 2 + (stop.lat - 24.71) ** 2
  assert.ok(near(first) <= near(last))
})

test('route distance and duration stay measured and missing values fail instead of becoming zero', async () => {
  const originalFetch = globalThis.fetch
  const start = { lon: 46.59, lat: 24.69 }
  const stops: Stop[] = [{ id: 's1', lon: 46.6, lat: 24.7 }]
  const signal = new AbortController().signal
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [{ distance: 1_234, duration: 120 }] }), { status: 200 })) as typeof fetch
    const [part] = await planRoute(start, stops, () => undefined, signal)
    assert.equal(part.meters, 1_234)
    assert.equal(part.seconds, 120)

    globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [{ distance: 1_234 }] }), { status: 200 })) as typeof fetch
    await assert.rejects(planRoute(start, stops, () => undefined, signal), /بيانات المسافة وزمن القيادة/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
