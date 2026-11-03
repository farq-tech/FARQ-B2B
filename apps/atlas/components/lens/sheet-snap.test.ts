import assert from 'node:assert/strict'
import test from 'node:test'
import { settle } from './sheet-snap.ts'

const STOPS = { peek: 136, half: 420, full: 700 }

test('a slow release settles on the nearest stop', () => {
  assert.equal(settle(150, 0, STOPS), 'peek')
  assert.equal(settle(380, 0.1, STOPS), 'half')
  assert.equal(settle(640, -0.1, STOPS), 'full')
})

test('a flick goes to the next stop past the release, in its direction', () => {
  assert.equal(settle(200, 1, STOPS), 'half')
  assert.equal(settle(500, 1, STOPS), 'full')
  assert.equal(settle(700, 1, STOPS), 'full')
  // a long fast pull down from full that is already below half lands collapsed, not half
  assert.equal(settle(300, -1, STOPS), 'peek')
  assert.equal(settle(650, -1, STOPS), 'half')
  assert.equal(settle(136, -1, STOPS), 'peek')
})
