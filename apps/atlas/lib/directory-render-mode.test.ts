import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryRenderMode } from './directory-render-mode.ts'

test('uses vector tiles until a large selected district has fully streamed', () => {
  assert.equal(directoryRenderMode({ mapQuery: 'a'.repeat(32), pinCount: 200, pinsComplete: false }), 'tiles')
  assert.equal(directoryRenderMode({ mapQuery: 'a'.repeat(32), pinCount: 16_155, pinsComplete: true }), 'direct')
})

test('uses direct points for a complete small cohort and has a safe empty state', () => {
  assert.equal(directoryRenderMode({ mapQuery: 'b'.repeat(32), pinCount: 18, pinsComplete: true }), 'direct')
  assert.equal(directoryRenderMode({ mapQuery: null, pinCount: 0, pinsComplete: false }), 'empty')
})
