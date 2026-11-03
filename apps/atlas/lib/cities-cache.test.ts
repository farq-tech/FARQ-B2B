import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchCities } from './insights-api.ts'

test('the city list is asked for once and shared, and asked again after a failure', async () => {
  const original = globalThis.fetch
  let calls = 0
  let fail = true
  globalThis.fetch = (async () => {
    calls++
    if (fail) return new Response('{}', { status: 502 })
    return new Response(JSON.stringify([{ en: 'Riyadh', ar: 'الرياض', districts: 3 }, { en: 'Riyadh', ar: 'الرياض', districts: 3 }]), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(fetchCities())
    fail = false
    const [first, second] = await Promise.all([fetchCities(), fetchCities()])
    assert.equal(calls, 2, 'one failed request, then one shared request')
    assert.equal(first, second)
    assert.deepEqual(first.map((row) => row.en), ['Riyadh'], 'a repeated city is kept once')
    await fetchCities()
    assert.equal(calls, 2, 'a later page reuses the answer')
  } finally {
    globalThis.fetch = original
  }
})
