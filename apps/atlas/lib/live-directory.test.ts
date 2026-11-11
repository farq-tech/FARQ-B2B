import assert from 'node:assert/strict'
import test from 'node:test'
import { dedupeDirectoryEntities, exactDirectoryTotal, hasPermanentlyClosedEntity, type PublicDirectoryEntity } from './live-directory.ts'

function row(id: string, district: string, status: PublicDirectoryEntity['status'] = null): PublicDirectoryEntity {
  return { id, district, status } as PublicDirectoryEntity
}

test('directory pages deduplicate businesses by their stable ID', () => {
  const merged = dedupeDirectoryEntities([row('poi-1', 'حي أ'), row('poi-2', 'حي ب'), row('poi-1', 'حي ج')])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map((item) => item.id), ['poi-1', 'poi-2'])
  assert.equal(merged[0].district, 'حي ج')
})

test('rejects a page containing permanent closures before trusting its total or page cursor', () => {
  assert.equal(hasPermanentlyClosedEntity([row('poi-1', 'حي أ'), row('poi-2', 'حي ب', 'closed_permanent')]), true)
  assert.equal(hasPermanentlyClosedEntity([row('poi-1', 'حي أ', 'closed_temporary'), row('poi-2', 'حي ب')]), false,
    'temporary closures remain visible with their status label')
})

test('multi-district totals stay unknown until all pages are loaded', () => {
  assert.equal(exactDirectoryTotal({ scopeCount: 3, pendingScopes: 2, uniqueCount: 400, singleScopeTotal: 0 }), null)
  assert.equal(exactDirectoryTotal({ scopeCount: 3, pendingScopes: 0, uniqueCount: 742, singleScopeTotal: 0 }), 742)
})

test('one-scope totals remain exact while more rows are available', () => {
  assert.equal(exactDirectoryTotal({ scopeCount: 1, pendingScopes: 1, uniqueCount: 200, singleScopeTotal: 255 }), 255)
})

test('a search with no selected scope cannot claim a measured zero', () => {
  assert.equal(exactDirectoryTotal({ scopeCount: 0, pendingScopes: 0, uniqueCount: 0, singleScopeTotal: 0 }), null)
})
