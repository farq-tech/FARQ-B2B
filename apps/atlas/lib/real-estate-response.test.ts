import assert from 'node:assert/strict'
import test from 'node:test'
import { parseListingResponse } from './real-estate-response.ts'
import type { Listing } from './real-estate.ts'

const listing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 'listing-1', url: null, lon: 46.7, lat: 24.7, district_id: '1', district_ar: 'العليا',
  kind: 'rent', deal: 'rent_year', group: 'residential', type: 'apartment', price_sar: 60000,
  area_sqm: 120, sar_per_sqm: 500, vs_district_pct: -10, check: false, city: 'Riyadh',
  photo: 'https://example.com/photo.jpg', photos: ['https://example.com/photo.jpg'], address: null,
  ...overrides,
})

test('accepts valid listings and an explicit unavailable source', () => {
  const row = listing()
  assert.deepEqual(parseListingResponse({ available: true, total: 1, listings: [row] }).listings, [row])
  assert.deepEqual(parseListingResponse({ available: false, total: 0, listings: [] }), {
    available: false, total: 0, listings: [],
  })
  assert.throws(() => parseListingResponse({ available: false, total: 1, listings: [row] }))
  assert.throws(() => parseListingResponse({ available: false, total: 1, listings: [] }))
})

test('rejects coordinates outside the global range or non-finite values', () => {
  for (const row of [listing({ lat: 91 }), listing({ lon: -181 }), listing({ lat: Number.NaN })]) {
    assert.throws(() => parseListingResponse({ available: true, total: 1, listings: [row] }))
  }
})

test('rejects malformed listing figures and fields before they can reach cards or filters', () => {
  const rows = [
    { ...listing(), price_sar: -1 },
    { ...listing(), area_sqm: Number.NaN },
    { ...listing(), sar_per_sqm: Number.POSITIVE_INFINITY },
    { ...listing(), beds: -1 },
    { ...listing(), age: -1 },
    { ...listing(), deal: 'yearly' },
    { ...listing(), features: { furnished: 2 } },
  ]
  for (const row of rows) assert.throws(() => parseListingResponse({ available: true, total: 1, listings: [row] }))
})

test('accepts a complete district signal and rejects incomplete signal details', () => {
  const signal: NonNullable<Listing['signal']> = { kind: 'cheaper_area', label: 'حي أرخص من جيرانه', rent_pct: -20, deal_pct: -15, neighbours: ['الندى'] }
  assert.deepEqual(parseListingResponse({ available: true, total: 1, listings: [listing({ signal })] }).listings[0].signal, signal)
  for (const invalid of [
    { ...signal, kind: 'unknown' },
    { ...signal, rent_pct: Number.NaN },
    { ...signal, neighbours: null },
    { ...signal, deal_neighbours: [''] },
  ]) {
    assert.throws(() => parseListingResponse({ available: true, total: 1, listings: [{ ...listing(), signal: invalid }] }))
  }
})

test('keeps only the listing card contract and drops the phone itself', () => {
  const row = { ...listing(), phone: '0500000000', has_phone: true, internal_debug: 'source row' }
  const parsed = parseListingResponse({ available: true, total: 1, listings: [row] })
  assert.equal('phone' in parsed.listings[0], false)
  assert.equal(parsed.listings[0].has_phone, true, 'the UI needs availability only, not the number')
  assert.equal('internal_debug' in parsed.listings[0], false)
})

test('rejects empty or duplicate listing identities', () => {
  assert.throws(() => parseListingResponse({ available: true, total: 1, listings: [listing({ id: '  ' })] }))
  assert.throws(() => parseListingResponse({ available: true, total: 2, listings: [listing(), listing()] }))
})

test('rejects a total smaller than the returned page', () => {
  assert.throws(() => parseListingResponse({ available: true, total: 0, listings: [listing()] }))
})
