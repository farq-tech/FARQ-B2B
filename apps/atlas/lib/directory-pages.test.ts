import assert from 'node:assert/strict'
import test from 'node:test'
import { appendUniqueDirectoryRows } from './directory-pages.ts'

test('directory page append preserves order and removes a boundary duplicate', () => {
  assert.deepEqual(
    appendUniqueDirectoryRows([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  )
})
