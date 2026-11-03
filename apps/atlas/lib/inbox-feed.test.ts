import assert from 'node:assert/strict'
import test from 'node:test'
import { inboxBusiness, inboxMapHref, kindNote, mergeServerInbox, parseServerInbox, previewText, requestFor } from './inbox-feed.ts'
import type { InboxMessage, LiveBusinessSnapshot } from './types.ts'

// fixed fakes: no network, no real business, no number anywhere
const reply = { id: 'wamid.IN1', requestId: 'cmp-1', poiKey: 'poi:1', kind: 'text', body: 'نعم مهتم', receivedAt: '2026-11-03T10:00:00Z' }
const live = (id: string, extra: Partial<LiveBusinessSnapshot> = {}) => ({ id, name: 'مخبز تجريبي', category: 'مخابز', district: 'العليا', street: '', latitude: null, longitude: null, wholesale: false, whatsapp: true, reason: '', fit: null, ...extra }) as LiveBusinessSnapshot

test('server replies join the inbox without replacing anything on the device', () => {
  const local: InboxMessage = { id: 'm-local', source: 'rfq', requestId: 'rfq-1', businessId: 'b1', body: 'عرض', receivedAt: '2026-11-01T00:00:00Z', unread: false }
  const first = mergeServerInbox([local], [reply])
  assert.equal(first.length, 2)
  assert.deepEqual(first[0], local, 'the device item is untouched')
  assert.equal(first[1].unread, true, 'a new reply arrives unread')
  assert.equal(first[1].origin, 'whatsapp')
  assert.equal(first[1].source, 'campaign')
  assert.equal(first[1].businessId, 'poi:1')

  const read = first.map((m) => (m.id === reply.id ? { ...m, unread: false, replyDraft: 'شكراً' } : m))
  const again = mergeServerInbox(read, [reply, reply])
  assert.equal(again, read, 'nothing new: the same array, so the store skips the update')
  assert.equal(again[1].unread, false, 'read state survives the next fetch')
  assert.equal(again[1].replyDraft, 'شكراً')
})

test('the feed parser keeps only well-formed replies', () => {
  const parsed = parseServerInbox({ ok: true, messages: [reply, { id: 1 }, { ...reply, id: 'x', receivedAt: 'not a date' }, null] })
  assert.deepEqual(parsed, [reply])
  assert.deepEqual(parseServerInbox(null), [])
  assert.deepEqual(parseServerInbox({ messages: 'no' }), [])
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
  assert.equal(previewText(button), 'مهتم')
})

test('a reply finds its request by the id it was sent under, then by the cloud id', () => {
  const requests = [{ id: 'cmp-1', remoteId: 'r-9' }, { id: 'cmp-2' }]
  assert.equal(requestFor(requests, 'cmp-1')?.id, 'cmp-1')
  assert.equal(requestFor(requests, 'r-9')?.id, 'cmp-1')
  assert.equal(requestFor(requests, 'cmp-3'), undefined)
})

test('the business is named from the request it answers, else the sample, else unknown — never a contact', () => {
  const request = { liveBusinesses: [live('poi:1')] }
  assert.deepEqual(inboxBusiness('poi:1', request), { name: 'مخبز تجريبي', category: 'مخابز', district: 'العليا' })
  assert.deepEqual(inboxBusiness('b1', request, { name: 'عينة', category: 'نشاط', district: null }), { name: 'عينة', category: 'نشاط', district: null })
  assert.deepEqual(inboxBusiness('poi:2', undefined), { name: null, category: null, district: null })
  assert.equal(Object.keys(inboxBusiness('poi:1', { liveBusinesses: [live('poi:1', { extraPhones: ['0500000000'] })] })).includes('extraPhones'), false)
})

test('the map link opens the request city with the business in the search', () => {
  assert.equal(inboxMapHref({ cityId: 'riyadh' }, 'مخبز تجريبي'), `/map?q=${encodeURIComponent('مخبز تجريبي').replace(/%20/g, '+')}`)
  assert.equal(inboxMapHref({ cityId: 'al khobar' }, null, [{ en: 'Al Khobar' }]), '/map?city=Al+Khobar')
  assert.equal(inboxMapHref({ cityId: 'jeddah' }, null), '/map?city=Jeddah')
  assert.equal(inboxMapHref(undefined, null), '/map')
  assert.equal(new URLSearchParams(inboxMapHref({ cityId: 'riyadh' }, '<b>x</b>').split('?')[1]).get('q'), 'b x /b', 'angle brackets dropped')
})
