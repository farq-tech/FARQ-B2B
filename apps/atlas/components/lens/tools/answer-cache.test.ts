import assert from 'node:assert/strict'
import test from 'node:test'
import { ANSWER_TTL, createAnswerCache, dataVersion } from './answer-cache.ts'

const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) },
    key: (index: number) => [...items.keys()][index] ?? null, get length() { return items.size }, items,
  }
}

test('a slow answer is kept for the visit under its question, and survives a reload through the tab', () => {
  const storage = memoryStorage()
  const cache = createAnswerCache(() => storage)
  cache.set('gaps|Riyadh|صيدلية|', { districts: [1, 2] })
  assert.deepEqual(cache.get('gaps|Riyadh|صيدلية|'), { districts: [1, 2] })
  // another city or activity is another question
  assert.equal(cache.get('gaps|Jeddah|صيدلية|'), undefined)
  // a fresh page (a reload) reads it back from the tab's storage
  assert.deepEqual(createAnswerCache(() => storage).get('gaps|Riyadh|صيدلية|'), { districts: [1, 2] })
  // «أعد المحاولة» forgets it everywhere
  cache.drop('gaps|Riyadh|صيدلية|')
  assert.equal(createAnswerCache(() => storage).get('gaps|Riyadh|صيدلية|'), undefined)
})

test('a blocked or full storage keeps the answer in memory only, and a huge answer is not written to it', () => {
  const blocked = createAnswerCache(() => ({ getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') }, removeItem: () => {} }))
  blocked.set('k', 1)
  assert.equal(blocked.get('k'), 1)
  const storage = memoryStorage()
  const cache = createAnswerCache(() => storage)
  cache.set('big', 'x'.repeat(300_000))
  assert.equal([...storage.items.keys()].filter((key) => key.startsWith('atlas.answer|')).length, 0)
  assert.equal((cache.get('big') as string).length, 300_000)
  // no window (a server render): nothing breaks
  assert.equal(createAnswerCache(() => null).get('k'), undefined)
})

test('an answer lasts thirty minutes, and a new data version forgets them all', () => {
  let clock = 0
  const storage = memoryStorage()
  const cache = createAnswerCache(() => storage, { now: () => clock })
  cache.setVersion('Riyadh:192:900000')
  cache.set('gaps|Riyadh|بقالة|', 1)
  clock = ANSWER_TTL - 1
  assert.equal(cache.get('gaps|Riyadh|بقالة|'), 1)
  clock = ANSWER_TTL + 1
  assert.equal(cache.get('gaps|Riyadh|بقالة|'), undefined)
  // the same version again keeps what is there; a new one (a new snapshot) drops it, from the tab's storage too
  clock = 0
  cache.set('a', 2)
  cache.setVersion('Riyadh:192:900000')
  assert.equal(cache.get('a'), 2)
  cache.setVersion('Riyadh:192:900500')
  assert.equal(cache.get('a'), undefined)
  assert.equal(createAnswerCache(() => storage, { now: () => clock }).get('a'), undefined)
  // a reload under the new version still reads what was kept under it
  cache.set('b', 3)
  assert.equal(createAnswerCache(() => storage, { now: () => clock }).get('b'), 3)
})

test('the data version is the city list: districts and business counts per city, in any order', () => {
  assert.equal(dataVersion([{ en: 'Jeddah', districts: 120, n: 5 }, { en: 'Riyadh', districts: 192, n: 9 }]), dataVersion([{ en: 'Riyadh', districts: 192, n: 9 }, { en: 'Jeddah', districts: 120, n: 5 }]))
  assert.notEqual(dataVersion([{ en: 'Riyadh', districts: 192, n: 9 }]), dataVersion([{ en: 'Riyadh', districts: 192, n: 10 }]))
})
