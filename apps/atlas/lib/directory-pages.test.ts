import assert from 'node:assert/strict'
import test from 'node:test'
import { appendUniqueDirectoryRows, nextDirectoryOffset } from './directory-pages.ts'

test('directory page append preserves order and removes a boundary duplicate', () => {
  assert.deepEqual(
    appendUniqueDirectoryRows([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  )
})

test('directory pagination continues when a legacy response omits next_offset', () => {
  assert.equal(nextDirectoryOffset(16_155, 200, null), 200)
  assert.equal(nextDirectoryOffset(200, 200, null), null)
})
