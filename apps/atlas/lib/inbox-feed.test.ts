import assert from 'node:assert/strict'
import test from 'node:test'
import { followUpChain, followUpDepth, heldBackState, MAX_FOLLOW_UP_DEPTH } from './inbox-feed.ts'
import { answeredFollowUps, combinedRate, durationParts, elsewhereFor, openingReplyFilter, rateFor, readReplyFilter, replyFilterKey, replyWindow, statFor, writeReplyFilter } from './inbox-feed.ts'
import { deliveryFor, freshReplies, healthState, replyGroups, replyRate, repliesFor, trackedFor, wasSent, deliveryLabel, kindNote, mergeServerInbox, parseServerFeed, previewText, requestFor, unreadCount } from './inbox-feed.ts'
import { inboxAccounts } from './inbox-scope.ts'
import type { InboxMessage } from './types.ts'

// fixed fakes: no network, no real business, no number anywhere
const reply = { id: 'wamid.IN1', requestId: 'cmp-1', poiKey: 'poi:1', kind: 'text', body: 'نعم مهتم', receivedAt: '2026-11-03T10:00:00Z', read: false }
const local: InboxMessage = { id: 'm-local', source: 'rfq', requestId: 'rfq-1', businessId: 'b1', body: 'عرض', receivedAt: '2026-11-01T00:00:00Z', unread: false }

test('server replies join the inbox without replacing anything on the device', () => {
  const first = mergeServerInbox([local], [reply])
  assert.equal(first.length, 2)
  assert.equal(first[0], local, 'the device item is untouched')
  assert.equal(first[1].unread, true, 'an unread reply arrives unread')
  assert.equal(first[1].origin, 'whatsapp')
  assert.equal(first[1].source, 'campaign')
  assert.equal(first[1].businessId, 'poi:1')
  assert.equal(mergeServerInbox(first, [reply, reply]), first, 'nothing changed: the same array, so the store skips the update')
})

test('the read state the service keeps reaches every device, except a mark this device has not heard back about', () => {
  const withDraft = mergeServerInbox([], [reply]).map((m) => ({ ...m, replyDraft: 'شكراً' }))
  const readElsewhere = mergeServerInbox(withDraft, [{ ...reply, read: true }])
  assert.equal(readElsewhere[0].unread, false, 'read on another device')
  assert.equal(readElsewhere[0].replyDraft, 'شكراً', 'the draft stays')
  const markedHere = readElsewhere.map((m) => ({ ...m, unread: true }))
  assert.equal(mergeServerInbox(markedHere, [{ ...reply, read: true }], new Set([reply.id])), markedHere, 'pending: the stale feed does not undo it')
  const localSameId = [{ ...local, id: reply.id, origin: undefined, unread: true }]
  assert.equal(mergeServerInbox(localSameId, [{ ...reply, read: true }]), localSameId, 'a device-only item is never changed by the feed')
})

test('the feed parser keeps only well-formed replies and deliveries', () => {
  const feed = parseServerFeed({
    ok: true, owner: true,
    messages: [{ ...reply, read: true }, { id: 1 }, { ...reply, id: 'x', receivedAt: 'not a date' }, null],
    deliveries: [{ requestId: 'cmp-1', poiKey: 'poi:1', status: 'read', at: '2026-11-03T10:00:00Z' }, { requestId: 'cmp-1', poiKey: 'poi:2', status: 'lost' }],
  })
  assert.deepEqual(feed.messages, [{ ...reply, read: true }])
  assert.deepEqual(feed.deliveries, [{ requestId: 'cmp-1', poiKey: 'poi:1', status: 'read', at: '2026-11-03T10:00:00Z' }])
  assert.equal(feed.owner, true)
  assert.deepEqual(parseServerFeed(null), { messages: [], deliveries: [], owner: false, requests: [], elsewhere: [] })
  assert.equal(parseServerFeed({ owner: 'yes' }).owner, false)
})

test('a recipient’s delivery state is found by the request’s local or cloud id', () => {
  const deliveries = [{ requestId: 'r-9', poiKey: 'poi:1', status: 'delivered' as const, at: null }]
  assert.equal(deliveryFor(deliveries, { id: 'cmp-1', remoteId: 'r-9' }, 'poi:1')?.status, 'delivered')
  assert.equal(deliveryFor(deliveries, { id: 'cmp-1' }, 'poi:1'), undefined)
  assert.equal(deliveryFor(deliveries, { id: 'r-9' }, 'poi:2'), undefined)
  assert.deepEqual(trackedFor([...deliveries, { requestId: 'cmp-1', poiKey: 'poi:2', status: 'read', at: null }, { requestId: 'other', poiKey: 'poi:3', status: 'read', at: null }], { id: 'cmp-1', remoteId: 'r-9' }), { 'poi:1': 'delivered', 'poi:2': 'read' })
  assert.deepEqual(['sent', 'delivered', 'read', 'failed'].map((s) => deliveryLabel(s as 'sent')), ['أُرسلت', 'وصلت', 'قُرئت', 'لم تصل'])
})

test('the badge counts every unread message; only replies that arrive later are announced', () => {
  assert.equal(unreadCount([{ unread: true }, { unread: false }, { unread: true }]), 2)
  const inbox = mergeServerInbox([local], [reply, { ...reply, id: 'wamid.IN2', read: true }])
  assert.deepEqual(freshReplies(null, inbox), [], 'the first look announces nothing')
  assert.deepEqual(freshReplies(new Set(['wamid.IN2']), inbox).map((m) => m.id), ['wamid.IN1'])
  assert.deepEqual(freshReplies(new Set(['wamid.IN1', 'wamid.IN2']), inbox), [])
  assert.deepEqual(freshReplies(new Set(), [{ ...local, unread: true }]), [], 'device items are not replies')
})

test('a non-text reply names its kind; a text reply keeps its words', () => {
  const [image] = mergeServerInbox([], [{ ...reply, id: 'img', kind: 'image', body: '' }])
  assert.equal(image.kind, 'image')
  assert.equal(previewText(image), 'مرفق: صورة')
  assert.equal(kindNote(image.kind), 'مرفق (صورة) لا يعرضه أطلس. افتحه في واتساب.')
  assert.equal(kindNote(undefined), null, 'a text reply has no note')
  const [captioned] = mergeServerInbox([], [{ ...reply, id: 'cap', kind: 'document', body: 'الكتالوج' }])
  assert.equal(previewText(captioned), 'الكتالوج')
  const [button] = mergeServerInbox([], [{ ...reply, id: 'btn', kind: 'button', body: 'مهتم' }])
  assert.equal(button.kind, undefined)
})

test('a reply finds its request by the id it was sent under, then by the cloud id', () => {
  const requests = [{ id: 'cmp-1', remoteId: 'r-9' }, { id: 'cmp-2' }]
  assert.equal(requestFor(requests, 'cmp-1')?.id, 'cmp-1')
  assert.equal(requestFor(requests, 'r-9')?.id, 'cmp-1')
  assert.equal(requestFor(requests, 'cmp-3'), undefined)
})

test('replies are filed under the organisation, and the person also reads their own account', () => {
  assert.deepEqual(inboxAccounts('0c1d-org', '42'), { send: '0c1d-org', read: ['0c1d-org', 'user-42'], sender: '42' })
  assert.deepEqual(inboxAccounts(null, '42'), { send: 'user-42', read: ['user-42'], sender: '42' })
  assert.deepEqual(inboxAccounts('bad org!', 'a@b'), { send: 'user-ab', read: ['user-ab'], sender: 'ab' })
  assert.deepEqual(inboxAccounts(null, ''), { send: null, read: [], sender: null })
})

test('each recipient’s latest reply in a request is found, other requests left out', () => {
  const inbox = mergeServerInbox([], [
    reply, { ...reply, id: 'wamid.IN2', receivedAt: '2026-11-03T11:00:00Z' },
    { ...reply, id: 'wamid.IN3', poiKey: 'poi:2', requestId: 'r-9' }, { ...reply, id: 'wamid.X', requestId: 'other' },
  ])
  assert.deepEqual(repliesFor(inbox, { id: 'cmp-1', remoteId: 'r-9' }), { 'poi:1': 'wamid.IN2', 'poi:2': 'wamid.IN3' })
  assert.deepEqual(repliesFor(inbox, { id: 'none' }), {})
})

test('the reply source’s health reads as off, never, failing, stale or ok', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  const base = { running: true, lastOkAt: '2026-11-03T11:59:00Z', lastErrorAt: null, lastErrorKind: null, failures: 0 }
  assert.equal(healthState(null, now), 'unknown')
  assert.equal(healthState({ ...base, running: false }, now), 'off')
  assert.equal(healthState({ ...base, lastOkAt: null }, now), 'never')
  assert.equal(healthState({ ...base, failures: 3, lastErrorKind: 'InsufficientPrivilege' }, now), 'failing')
  assert.equal(healthState({ ...base, lastOkAt: '2026-11-03T11:30:00Z' }, now), 'stale')
  assert.equal(healthState(base, now), 'ok')
})

test('a recipient counts as sent from WhatsApp’s report, else from this device’s send result', () => {
  assert.equal(wasSent('a', { a: 'read' }, {}), true)
  assert.equal(wasSent('a', { a: 'failed' }, { a: 'sent' }), false, 'WhatsApp said it did not arrive')
  assert.equal(wasSent('a', {}, { a: 'sent' }), true)
  assert.equal(wasSent('a', undefined, { a: 'unknown' }), false)
})

test('the reply filter splits the sent recipients into waiting and replied; the rate counts only those reached', () => {
  const ids = ['a', 'b', 'c', 'd']
  const sent = (id: string) => id !== 'd'
  const replied = { b: 'wamid.B', d: 'wamid.D' }
  assert.deepEqual(replyGroups(ids, sent, replied), { all: ids, waiting: ['a', 'c'], replied: ['b', 'd'] })
  assert.deepEqual(replyRate(ids, sent, replied), { sent: 3, replied: 1, percent: 33 })
  assert.equal(replyRate(ids, () => false, replied), null, 'nothing sent: no rate, never 0%')
  assert.deepEqual(replyRate(['a'], () => true, {}), { sent: 1, replied: 0, percent: 0 })
})

test('the service’s reply figures and replied-elsewhere flags are parsed and found by local or cloud id', () => {
  const feed = parseServerFeed({
    requests: [{ requestId: 'r-9', sent: 3, replied: 2, medianReplySeconds: 5400 }, { requestId: 'x', sent: -1, replied: 0 }],
    elsewhere: [{ requestId: 'cmp-1', poiKey: 'poi:1', otherRequestId: 'cmp-2', messageId: 'wamid.R1', at: '2026-11-03T10:00:00Z' }, { requestId: 'cmp-1' }],
  })
  assert.deepEqual(feed.requests, [{ requestId: 'r-9', sent: 3, replied: 2, medianReplySeconds: 5400 }])
  const request = { id: 'cmp-1', remoteId: 'r-9' }
  assert.equal(statFor(feed.requests, request)?.replied, 2)
  assert.deepEqual(Object.keys(elsewhereFor(feed.elsewhere, request)), ['poi:1'])
  assert.equal(elsewhereFor(feed.elsewhere, { id: 'other' })['poi:1'], undefined)
})

test('the rate prefers the service’s figures, else this device’s, and never says 0% for nothing sent', () => {
  assert.deepEqual(rateFor({ requestId: 'r', sent: 4, replied: 1, medianReplySeconds: 600 }, { sent: 3, replied: 3, percent: 100 }), { sent: 4, replied: 1, percent: 25, medianReplySeconds: 600 })
  assert.deepEqual(rateFor(undefined, { sent: 3, replied: 2, percent: 67 }), { sent: 3, replied: 2, percent: 67, medianReplySeconds: null })
  assert.deepEqual(rateFor({ requestId: 'r', sent: 0, replied: 0, medianReplySeconds: null }, null), null)
  assert.equal(rateFor({ requestId: 'r', sent: 2, replied: 5, medianReplySeconds: null }, null)?.percent, 100, 'never above 100%')
})

test('a reply time reads in minutes, hours or days', () => {
  assert.deepEqual(durationParts(20), { value: 1, unit: 'minute' })
  assert.deepEqual(durationParts(45 * 60), { value: 45, unit: 'minute' })
  assert.deepEqual(durationParts(5400), { value: 2, unit: 'hour' })
  assert.deepEqual(durationParts(30 * 3600), { value: 30, unit: 'hour' })
  assert.deepEqual(durationParts(3 * 86400), { value: 3, unit: 'day' })
})

test('the recipient filter lives in the address and keeps the other parameters', () => {
  assert.equal(readReplyFilter('?replies=waiting'), 'waiting')
  assert.equal(readReplyFilter('?replies=<x>'), 'all')
  assert.equal(readReplyFilter(''), 'all')
  assert.equal(writeReplyFilter('?tab=1', 'replied'), '?tab=1&replies=replied')
  assert.equal(writeReplyFilter('?replies=waiting', 'all'), '')
})

test('a campaign and its follow-ups read as one result over the original’s recipients', () => {
  const original = { id: 'cmp-1', campaign: { templateId: 't', variables: {}, included: ['a', 'b', 'c', 'd'] } }
  const followUp = { id: 'cmp-2' }
  const inbox = mergeServerInbox([], [
    { ...reply, id: 'r-a', requestId: 'cmp-1', poiKey: 'a' },
    { ...reply, id: 'r-b', requestId: 'cmp-2', poiKey: 'b' },
    { ...reply, id: 'r-x', requestId: 'cmp-2', poiKey: 'x' },   // not one of the original's recipients
  ])
  assert.deepEqual(combinedRate(original, [followUp], inbox, (id) => id !== 'd'), { sent: 3, replied: 2, percent: 67, viaFollowUps: 1 })
  assert.deepEqual(combinedRate(original, [], inbox, (id) => id !== 'd'), { sent: 3, replied: 1, percent: 33, viaFollowUps: 0 })
  assert.equal(combinedRate(original, [followUp], inbox, () => false), null)
})

test('the 24-hour window runs from the business’s latest message on that request, for information only', () => {
  const [first, second] = mergeServerInbox([], [
    { ...reply, id: 'w1', receivedAt: '2026-11-03T08:00:00Z' }, { ...reply, id: 'w2', receivedAt: '2026-11-03T10:00:00Z' },
  ])
  const inbox = [first, second]
  const now = Date.parse('2026-11-04T09:00:00Z')
  assert.deepEqual(replyWindow(inbox, first, now), { open: true, until: '2026-11-04T10:00:00.000Z' }, 'the older message names the same end')
  assert.equal(replyWindow(inbox, second, Date.parse('2026-11-04T10:00:01Z'))?.open, false)
  assert.equal(replyWindow(inbox, { ...local }, now), null, 'not a WhatsApp reply')
})

test('the recipient filter opens from the address, else from this tab’s last choice for that request', () => {
  assert.equal(replyFilterKey('cmp-1'), 'atlas.replies|cmp-1')
  assert.equal(openingReplyFilter('?replies=replied', 'waiting'), 'replied', 'the address wins')
  assert.equal(openingReplyFilter('?replies=all', 'waiting'), 'all', 'an explicit «all» in the address wins too')
  assert.equal(openingReplyFilter('', 'waiting'), 'waiting')
  assert.equal(openingReplyFilter('', '<x>'), 'all')
  assert.equal(openingReplyFilter('', null), 'all')
})

test('a recipient who answered a follow-up is not silent on the original', () => {
  const inbox = mergeServerInbox([], [
    { ...reply, id: 'r-a', requestId: 'cmp-1', poiKey: 'a' },
    { ...reply, id: 'r-a2', requestId: 'cmp-2', poiKey: 'a' },   // answered both: already a reply on the original
    { ...reply, id: 'r-b', requestId: 'cmp-2', poiKey: 'b' },
  ])
  const flagged = answeredFollowUps(inbox, { id: 'cmp-1' }, [{ id: 'cmp-2' }])
  assert.deepEqual(Object.keys(flagged), ['b'])
  assert.deepEqual(flagged.b, { requestId: 'cmp-1', poiKey: 'b', otherRequestId: 'cmp-2', messageId: 'r-b', at: null })
})

test('a follow-up chain is the original, then its follow-ups by step; it stops at two', () => {
  const r = (id: string, followUpOf?: string, createdAt = '2026-11-01') => ({ id, followUpOf, createdAt })
  const requests = [r('o'), r('f1', 'o', '2026-11-02'), r('f1b', 'o', '2026-11-03'), r('f2', 'f1', '2026-11-04'), r('alone')]
  assert.deepEqual(followUpChain(requests, requests[3]).map((m) => [m.request.id, m.depth]), [['o', 0], ['f1', 1], ['f1b', 1], ['f2', 2]], 'the same chain from any member')
  assert.deepEqual(followUpChain(requests, requests[4]).map((m) => m.request.id), ['alone'])
  assert.equal(followUpDepth(requests, requests[0]), 0)
  assert.equal(followUpDepth(requests, requests[3]), 2)
  assert.equal(followUpDepth(requests, requests[3]) < MAX_FOLLOW_UP_DEPTH, false, 'a second follow-up cannot be followed up')
  const loop = [r('a', 'b'), r('b', 'a')]
  assert.equal(followUpDepth(loop, loop[0]), 1, 'a loop in the links stops')
})

test('a held-back recipient reads as held until ticked, then as added at review', () => {
  const campaign = { included: ['a', 'b'], heldBack: { b: 'replied_elsewhere' as const, c: 'replied_elsewhere' as const } }
  assert.equal(heldBackState(campaign, 'a'), null)
  assert.equal(heldBackState(campaign, 'b'), 'added')
  assert.equal(heldBackState(campaign, 'c'), 'held')
  assert.equal(heldBackState(undefined, 'b'), null)
})

test('the service’s combined figures are parsed and kept within bounds', () => {
  const feed = parseServerFeed({ requests: [{ requestId: 'o', sent: 3, replied: 1, combined: { sent: 3, replied: 9, viaFollowUps: 5 } }, { requestId: 'p', sent: 1, replied: 0, combined: { sent: 'x' } }] })
  assert.deepEqual(feed.requests[0].combined, { sent: 3, replied: 3, viaFollowUps: 3 })
  assert.equal(feed.requests[1].combined, undefined)
})
