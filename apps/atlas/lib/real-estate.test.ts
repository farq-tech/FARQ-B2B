import assert from 'node:assert/strict'
import test from 'node:test'
import { daysAgo, flattenSimilar, groupSimilar, priceTag, similarLabel, type Listing, type MarketSignal } from './real-estate.ts'

const now = new Date('2026-11-02T10:00:00Z')

test('an ad date reads as the time since it, the way it is said', () => {
  assert.equal(daysAgo('2026-11-02', now), 'اليوم')
  assert.equal(daysAgo('2026-11-01', now), 'أمس')
  assert.equal(daysAgo('2026-10-26', now), 'منذ 7 أيام')
  assert.equal(daysAgo('2026-09-03', now), 'منذ شهرين')
  assert.equal(daysAgo('2025-12-01', now), 'منذ 11 شهراً')
})

test('a date close to a year back reads as a year, never as twelve months', () => {
  // 2025-11-06 is 361 days before; it used to read «منذ 12 شهراً» beside another ad's «منذ سنة»
  assert.equal(daysAgo('2025-11-06', now), 'منذ سنة')
  assert.equal(daysAgo('2025-10-31', now), 'منذ سنة')
  assert.equal(daysAgo('2024-10-30', now), 'منذ سنتين')
})

test('no date, a bad one or one ahead of today reads as nothing', () => {
  assert.equal(daysAgo(undefined, now), null)
  assert.equal(daysAgo('not a date', now), null)
  assert.equal(daysAgo('2026-12-01', now), null)
})

test('folded ads are filtered one by one and come back together under the first that survives', () => {
  const ad = (id: string, extra: Partial<Listing> = {}) => ({ id, ...extra }) as Listing
  const flat = flattenSimilar([ad('a', { similar: [ad('b'), ad('c')] }), ad('d')])
  assert.deepEqual(flat.map((item) => [item.id, item.similar_of ?? null]), [['a', null], ['b', 'a'], ['c', 'a'], ['d', null]])
  assert.ok(!('similar' in flat[0]))
  // the lead filtered out: the next ad of its set leads
  const groups = groupSimilar(flat.filter((item) => item.id !== 'a'))
  assert.deepEqual(groups.map((group) => [group.lead.id, group.others.map((item) => item.id)]), [['b', ['c']], ['d', []]])
})

test('a set of similar ads is counted the way it is said', () => {
  assert.equal(similarLabel(2), 'عرضان متشابهان')
  assert.equal(similarLabel(6), '6 عروض متشابهة')
  assert.equal(similarLabel(12), '12 عرضاً متشابهاً')
})

test('a card carries one price tag: the ad against its district first, the district signal only without it', () => {
  const signal: MarketSignal = { kind: 'rent_over_value', label: 'إيجار مرتفع مقابل سعر الحي', rent_pct: 10, deal_pct: -5, neighbours: [] }
  const tag = priceTag({ vs_district_pct: -23, district_ar: 'اليرموك', signal })
  assert.equal(tag?.tone, 'good')
  assert.match(tag?.text ?? '', /^أقل من وسيط اليرموك بـ .*23%/)
  assert.equal(priceTag({ vs_district_pct: null, district_ar: 'اليرموك', signal })?.tone, 'signal')
  assert.equal(priceTag({ vs_district_pct: null, district_ar: 'اليرموك', signal: null }), null)
})
