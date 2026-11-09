import assert from 'node:assert/strict'
import test from 'node:test'
import { cityLabel, fetchCities } from './insights-api.ts'

test('city catalog preserves cities without district boundaries and labels the missing coverage', () => {
  const rows = [
    { en: 'Riyadh', ar: 'الرياض', districts: 197 },
    { en: 'Adham', ar: 'أضم', districts: 0 },
  ]
  assert.deepEqual(rows.map(cityLabel), ['الرياض', 'أضم · حدود الأحياء غير متاحة'])
  assert.equal(cityLabel({ en: 'Jeddah', ar: null }), 'Jeddah', 'unknown coverage is not presented as missing')
})

test('the city list is asked for once and shared, and asked again after a failure', async () => {
  const original = globalThis.fetch
  let calls = 0
  let fail = true
  globalThis.fetch = (async () => {
    calls++
    if (fail) return new Response('{}', { status: 502 })
    return new Response(JSON.stringify([
      { en: 'Riyadh', ar: 'الرياض', districts: 3 },
      { en: 'Adham', ar: 'أضم', districts: 0 },
      { en: 'Riyadh', ar: 'الرياض', districts: 3 },
    ]), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(fetchCities())
    fail = false
    const [first, second] = await Promise.all([fetchCities(), fetchCities()])
    assert.equal(calls, 2, 'one failed request, then one shared request')
    assert.equal(first, second)
    assert.deepEqual(first.map((row) => row.en), ['Riyadh', 'Adham'], 'a repeated city is removed while a city without boundaries is kept')
    await fetchCities()
    assert.equal(calls, 2, 'a later page reuses the answer')
  } finally {
    globalThis.fetch = original
  }
})
