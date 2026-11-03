import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryFor, freshReplies, healthState, repliesFor, trackedFor, deliveryLabel, kindNote, mergeServerInbox, parseServerFeed, previewText, requestFor, unreadCount } from './inbox-feed.ts'
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
  assert.deepEqual(parseServerFeed(null), { messages: [], deliveries: [], owner: false })
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
