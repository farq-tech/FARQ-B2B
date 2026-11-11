import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTerritoryCoverage } from './territory-coverage.ts'

test('missing coverage remains unknown while an explicit zero is preserved', () => {
  assert.deepEqual(parseTerritoryCoverage({}), { unweighted_districts: null, unlocated_businesses: null })
  assert.deepEqual(parseTerritoryCoverage({ unweighted_districts: 0, unlocated_businesses: 0 }), {
    unweighted_districts: 0,
    unlocated_businesses: 0,
  })
})

test('coverage accepts nullable optional totals but rejects malformed counts', () => {
  assert.deepEqual(parseTerritoryCoverage({ unweighted_districts: null, unlocated_businesses: 3 }), {
    unweighted_districts: null,
    unlocated_businesses: 3,
  })
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', true]) {
    assert.throws(() => parseTerritoryCoverage({ unweighted_districts: invalid }))
  }
  assert.throws(() => parseTerritoryCoverage(null))
})
