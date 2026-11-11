import assert from 'node:assert/strict'
import test from 'node:test'
import { populationSourceKind } from './population-source.ts'

test('population provenance recognizes only the golden-table sources', () => {
  assert.equal(populationSourceKind('910ths.sa'), 'measured')
  assert.equal(populationSourceKind('910ths.sa (هدف)'), 'measured')
  assert.equal(populationSourceKind('farq_buildings_v3'), 'buildings')
  assert.equal(populationSourceKind('WorldPop 2025'), 'worldpop')
  assert.equal(populationSourceKind('WorldPop 2025 age shape'), 'unknown')
  assert.equal(populationSourceKind(null), 'unknown')
  assert.equal(populationSourceKind(undefined), 'unknown')
  assert.equal(populationSourceKind('future-source'), 'unknown')
})
