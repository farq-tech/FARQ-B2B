import assert from 'node:assert/strict'
import test from 'node:test'
import { issueTileAccess, verifyTileAccess } from './map-tile-access.ts'

const QUERY = '0123456789abcdef0123456789abcdef'

test('issues a time-boxed proof only for an opaque map query', () => {
  process.env.ATLAS_SESSION_SECRET = 'a'.repeat(32)
  const token = issueTileAccess(QUERY, 1_000)
  assert.ok(token)
  assert.equal(verifyTileAccess(QUERY, token, 1_100), true)
  assert.equal(verifyTileAccess('bad', token, 1_100), false)
})

test('rejects an expired or altered tile proof', () => {
  process.env.ATLAS_SESSION_SECRET = 'b'.repeat(32)
  const token = issueTileAccess(QUERY, 1_000)
  assert.ok(token)
  assert.equal(verifyTileAccess(QUERY, token, 1_901), false)
  assert.equal(verifyTileAccess(QUERY, `${token}x`, 1_100), false)
})
