import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteHighlights, quoteTotal } from './quote-highlights.ts'

const q = (id: string, unitPrice: number, qty: number, deliveryDays?: number) => ({ id, quote: { lines: [{ name: 'x', unitPrice, qty }], deliveryDays } })

test('a total is unit price times quantity over the quote\'s own lines', () => {
  assert.equal(quoteTotal({ id: 'a', quote: { lines: [{ name: 'a', unitPrice: 2.5, qty: 100 }, { name: 'b', unitPrice: 10, qty: 3 }] } }), 280)
  assert.equal(quoteTotal({ id: 'none' }), 0)
})

test('the lowest and the fastest are marked, with what each other quote costs more', () => {
  const h = quoteHighlights([q('a', 10, 10, 7), q('b', 8, 10, 3), q('c', 12, 10, 5)])
  assert.deepEqual([...h.lowest], ['b'])
  assert.deepEqual([...h.fastest], ['b'])
  assert.equal(h.overLowest.get('a'), 20)
  assert.equal(h.overLowest.get('b'), 0)
  assert.equal(h.overLowest.get('c'), 40)
})

test('one quote is neither the lowest nor the fastest', () => {
  const h = quoteHighlights([q('a', 10, 10, 2)])
  assert.equal(h.lowest.size, 0)
  assert.equal(h.fastest.size, 0)
})

test('ties mark every quote sharing the best value; all equal marks none', () => {
  const tie = quoteHighlights([q('a', 5, 10, 4), q('b', 5, 10, 4), q('c', 6, 10, 9)])
  assert.deepEqual([...tie.lowest].sort(), ['a', 'b'])
  assert.deepEqual([...tie.fastest].sort(), ['a', 'b'])
  const same = quoteHighlights([q('a', 5, 10, 4), q('b', 5, 10, 4)])
  assert.equal(same.lowest.size, 0)
  assert.equal(same.fastest.size, 0)
})

test('delivery is compared only among quotes that state it', () => {
  const h = quoteHighlights([q('a', 5, 10), q('b', 6, 10, 9), q('c', 7, 10, 3)])
  assert.deepEqual([...h.fastest], ['c'])
  const one = quoteHighlights([q('a', 5, 10), q('b', 6, 10, 9)])
  assert.equal(one.fastest.size, 0, 'a single stated time has nothing to beat')
})
