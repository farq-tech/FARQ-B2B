import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePbfTileY } from './tile-coordinate.ts'

test('accepts a vector-tile y segment with its .pbf suffix', () => {
  assert.equal(parsePbfTileY('12345.pbf'), '12345')
})

test('rejects a missing or malformed vector-tile suffix', () => {
  assert.equal(parsePbfTileY('12345'), null)
  assert.equal(parsePbfTileY('../12345.pbf'), null)
  assert.equal(parsePbfTileY('12345.pbf.json'), null)
})
