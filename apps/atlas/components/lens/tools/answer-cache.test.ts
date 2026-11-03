import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnswerCache } from './answer-cache.ts'

const memoryStorage = () => {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) }, items }
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
  assert.equal(storage.items.size, 0)
  assert.equal((cache.get('big') as string).length, 300_000)
  // no window (a server render): nothing breaks
  assert.equal(createAnswerCache(() => null).get('k'), undefined)
})
