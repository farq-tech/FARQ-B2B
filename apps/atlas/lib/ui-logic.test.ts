import assert from 'node:assert/strict'
import test from 'node:test'
import { NEXT_STEP, STATUS_LABEL } from './format.ts'
import { formatDistance } from './insights-api.ts'
import { PALETTE, readableOn } from './palette.ts'
import { mergeCloudRequests } from './workspace-merge.ts'

test('every request status has its next step, and only completed has none', () => {
  assert.deepEqual(Object.keys(NEXT_STEP).sort(), Object.keys(STATUS_LABEL).sort())
  for (const [status, step] of Object.entries(NEXT_STEP)) {
    if (status === 'completed') assert.equal(step, null)
    else assert.ok(step && step.length > 0, status)
  }
  // sending stays manual: the ready step asks for the person's own confirmation
  assert.match(NEXT_STEP.ready_manual ?? '', /بتأكيدك/)
})

test('a distance is metres to the nearest 10 under a kilometre, then kilometres to one decimal', () => {
  assert.equal(formatDistance(0), '0 م')
  assert.equal(formatDistance(4), '0 م')
  assert.equal(formatDistance(847), '850 م')
  assert.equal(formatDistance(994), '990 م')
  assert.equal(formatDistance(995), '1 كم', 'never «1,000 م»: a rounded thousand is a kilometre')
  assert.equal(formatDistance(1000), '1 كم')
  assert.equal(formatDistance(1449), '1.4 كم')
  assert.equal(formatDistance(12_345), '12.3 كم')
  assert.equal(formatDistance(150_000), '150 كم')
  assert.doesNotMatch(formatDistance(2_500_000), /[٠-٩]/, 'English digits only')
  assert.equal(formatDistance(2_500_000), '2,500 كم')
})

test('text on a filled colour is white or ink, whichever contrasts more', () => {
  assert.equal(readableOn(PALETTE.olive), PALETTE.white)
  assert.equal(readableOn(PALETTE.plum), PALETTE.white)
  assert.equal(readableOn(PALETTE.ochre), PALETTE.ink)
  assert.equal(readableOn(PALETTE.sage), PALETTE.ink)
  assert.equal(readableOn(PALETTE.sand), PALETTE.ink)
  assert.equal(readableOn('#000000'), PALETTE.white)
  assert.equal(readableOn('#FFFFFF'), PALETTE.ink, 'upper-case hex reads the same')
  assert.equal(readableOn('var(--primary)'), PALETTE.white, 'anything that is not #rrggbb keeps the old white')
  assert.equal(readableOn('#abc'), PALETTE.white)
})

test('the account\'s requests join the screen without replacing or reordering it', () => {
  const local = [{ id: 'a', title: 'edited title' }, { id: 'b', remoteId: 'r-b', title: 'saved once' }]
  const cloud = [
    { id: 'r-b', remoteId: 'r-b', title: 'old cloud title' },   // already on screen under its cloud id
    { id: 'a', title: 'stale copy' },                           // already on screen under its local id
    { id: 'r-c', remoteId: 'r-c', title: 'new' },
    { id: 'r-c', remoteId: 'r-c', title: 'new, sent twice' },
  ]
  const merged = mergeCloudRequests(local, cloud)
  assert.deepEqual(merged.map((r) => r.title), ['edited title', 'saved once', 'new'])
  assert.equal(merged[0], local[0], 'the local object itself, edits and all')
})

test('nothing new from the account returns the same list, so the store skips the update', () => {
  const local = [{ id: 'a' }]
  assert.equal(mergeCloudRequests(local, []), local)
  assert.equal(mergeCloudRequests(local, [{ id: 'a' }]), local)
})
