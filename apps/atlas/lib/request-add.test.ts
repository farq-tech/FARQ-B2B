import assert from 'node:assert/strict'
import test from 'node:test'
import { draftsFor, mergeIntoRequest, removeFromRequest } from './request-add.ts'
import type { LiveBusinessSnapshot, RequestItem } from './types.ts'

const business = (id: string, whatsapp: boolean): LiveBusinessSnapshot => ({ id, name: `منشأة ${id}`, category: 'صيدلية', district: 'العليا', street: '', latitude: null, longitude: null, wholesale: false, whatsapp, reason: '', fit: null })
const base: RequestItem = { id: 'r1', type: 'list', title: 'قائمة', status: 'draft', createdAt: '2026-11-01', updatedAt: '2026-11-01', cityId: 'riyadh', businessIds: ['a'], liveBusinesses: [business('a', true)] }

test('picked businesses join a draft once each, with their snapshot', () => {
  const result = mergeIntoRequest(base, [business('a', true), business('b', false), business('b', false), business('c', true)])
  assert.equal(result?.added, 2)
  assert.deepEqual(result?.patch.businessIds, ['a', 'b', 'c'])
  assert.deepEqual(result?.patch.liveBusinesses?.map((item) => item.id), ['a', 'b', 'c'])
})

test('a campaign takes the new businesses that can receive WhatsApp as recipients', () => {
  const campaign = { ...base, type: 'campaign' as const, campaign: { templateId: 't', variables: {}, included: ['a'] } }
  assert.deepEqual(mergeIntoRequest(campaign, [business('b', false), business('c', true)])?.patch.campaign?.included, ['a', 'c'])
})

test('nothing new adds nothing, and a reviewed request is never changed', () => {
  assert.deepEqual(mergeIntoRequest(base, [business('a', true)]), { patch: {}, added: 0 })
  assert.equal(mergeIntoRequest({ ...base, status: 'ready_manual' }, [business('b', true)]), null)
})

test('the drafts offered are the city\'s own, latest first', () => {
  const requests = [
    { ...base, id: 'old', updatedAt: '2026-10-01' },
    { ...base, id: 'new', updatedAt: '2026-11-02' },
    { ...base, id: 'done', status: 'completed' as const },
    { ...base, id: 'jeddah', cityId: 'jeddah' },
  ]
  assert.deepEqual(draftsFor(requests, 'Riyadh').map((item) => item.id), ['new', 'old'])
})

test('a business comes off a draft in place: its list, its snapshot and a campaign\'s recipients', () => {
  const campaign = { ...base, type: 'campaign' as const, businessIds: ['a', 'b'], liveBusinesses: [business('a', true), business('b', true)], campaign: { templateId: 't', variables: {}, included: ['a', 'b'] } }
  const result = removeFromRequest(campaign, ['b', 'zz'])
  assert.equal(result?.removed, 1)
  assert.deepEqual(result?.patch.businessIds, ['a'])
  assert.deepEqual(result?.patch.liveBusinesses?.map((item) => item.id), ['a'])
  assert.deepEqual(result?.patch.campaign?.included, ['a'])
  assert.equal(removeFromRequest({ ...base, status: 'awaiting' }, ['a']), null)
})
