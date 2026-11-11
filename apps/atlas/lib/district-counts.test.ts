import assert from 'node:assert/strict'
import test from 'node:test'
import { isDistrictCountResponse, isDistrictScopeSummary } from './district-counts.ts'
import { joinDistrictByIdOrUniqueName } from './district-join.ts'

const valid = { total: 4, districts: [{ district_ar: 'الربيع', n: 4, area_km2: 1.2, residents_per: null }] }

test('accepts finite nonnegative district counts and optional metrics', () => {
  assert.equal(isDistrictCountResponse(valid), true)
  assert.equal(isDistrictCountResponse({ ...valid, located: 3 }), true)
  assert.equal(isDistrictCountResponse({ ...valid, located: 0 }), true)
  assert.equal(isDistrictScopeSummary({ population: 0, businesses: 4, residents_per: 0, districts: 1 }), true)
  assert.equal(isDistrictScopeSummary({ population: null, businesses: null, residents_per: null, districts: 0 }), true)
})

test('rejects totals or rows that are non-finite, fractional, negative, or unsafe', () => {
  for (const total of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isDistrictCountResponse({ ...valid, total }), false)
  }
  for (const located of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isDistrictCountResponse({ ...valid, located }), false)
  }
  for (const n of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isDistrictCountResponse({ ...valid, districts: [{ district_ar: 'الربيع', n }] }), false)
  }
})

test('rejects duplicate district names and invalid derived metrics instead of overwriting a row', () => {
  assert.equal(isDistrictCountResponse({ ...valid, districts: [valid.districts[0], valid.districts[0]] }), false)
  assert.equal(isDistrictCountResponse({ ...valid, districts: [{ district_ar: 'الربيع', n: 4, density: Infinity }] }), false)
  assert.equal(isDistrictScopeSummary({ population: 1, businesses: 1, residents_per: NaN, districts: 1 }), false)
})

test('count rows join by canonical ID and unresolved IDs never fall back to a display name', () => {
  const byId = { total: 8, districts: [
    { district_id: 'id-a', district_ar: 'الندى', n: 3 },
    { district_id: 'id-b', district_ar: 'الندى', n: 4 },
    { district_id: null, district_ar: 'الربيع', n: 1 },
  ] }
  assert.equal(isDistrictCountResponse(byId), true,
    'same names must be permitted when different canonical IDs distinguish the districts')
  const rows = byId.districts.map((row) => ({ ...row, district_id: row.district_id as string | null }))
  assert.equal(isDistrictCountResponse({ total: 8, districts: [rows[0], { ...rows[1], district_id: 'id-a' }] }), false,
    'duplicate canonical IDs cannot replace another district count')
  assert.equal(isDistrictCountResponse({ total: 8, districts: [rows[0], { district_ar: 'الربيع', n: 1 }] }), false,
    'an ID response cannot mix legacy name-only rows')
  const joined = joinDistrictByIdOrUniqueName([
    { id: 'id-a', name: 'الندى' }, { id: 'id-b', name: 'الندى' }, { id: 'id-c', name: 'الربيع' },
  ], rows)
  assert.equal(joined.get('id-a')?.n, 3)
  assert.equal(joined.get('id-b')?.n, 4)
  assert.equal(joined.has('id-c'), false, 'an explicit unresolved identity must stay unavailable')
})
