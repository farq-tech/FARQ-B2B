import assert from 'node:assert/strict'
import test from 'node:test'
import { districtKey, joinDistrictByIdOrUniqueName, uniqueDistrictIdJoin, uniqueDistrictJoin } from './district-join.ts'

test('normalizes common Arabic district spelling differences and the حي prefix', () => {
  assert.equal(districtKey('حي النخيل'), districtKey('النخيل'))
  assert.equal(districtKey('أحد'), districtKey('احد'))
  assert.equal(districtKey('الروضة'), districtKey('الروضه'))
  assert.equal(districtKey('حَيّ النخيل'), districtKey('النخيل'))
})

test('joins a unique normalized district name', () => {
  const row = { district_ar: 'حي النخيل', n: 12 }
  const matches = uniqueDistrictJoin(['النخيل', 'الربيع'], [row])
  assert.equal(matches.get(districtKey('النخيل')), row)
  assert.equal(matches.has(districtKey('الربيع')), false)
})

test('leaves source collisions unavailable instead of overwriting one metric', () => {
  const matches = uniqueDistrictJoin(['الروضة'], [
    { district_ar: 'الروضة', n: 10 },
    { district_ar: 'الروضه', n: 99 },
  ])
  assert.equal(matches.has(districtKey('الروضة')), false)
})

test('leaves target collisions unavailable instead of applying one metric to multiple polygons', () => {
  const matches = uniqueDistrictJoin(['حي النخيل', 'النخيل'], [{ district_ar: 'النخيل', n: 12 }])
  assert.equal(matches.has(districtKey('النخيل')), false)
})

test('joins canonical metrics by district ID even when names repeat or differ', () => {
  const metric = { district_id: 12, district_ar: 'النخيل', villa_share_pct: 47.5 }
  const matches = uniqueDistrictIdJoin(['11', '12'], [metric])
  assert.equal(matches.get('12'), metric)
  assert.equal(matches.has('11'), false)
})

test('leaves duplicate canonical IDs unavailable instead of overwriting a metric', () => {
  const matches = uniqueDistrictIdJoin(['12'], [
    { district_id: 12, district_ar: 'النخيل', count: 10 },
    { district_id: '12', district_ar: 'النخيل', count: 99 },
  ])
  assert.equal(matches.has('12'), false)
})

test('income joins by canonical ID and uses unique names only for legacy rows without IDs', () => {
  const targets = [{ id: '12', name: 'النخيل' }, { id: '13', name: 'الربيع' }]
  const idMetric = { district_id: 12, district_ar: 'اسم قديم للنخيل', income_all: 12000 }
  const legacyMetric = { district_ar: 'الربيع', income_all: 9000 }
  const matches = joinDistrictByIdOrUniqueName(targets, [idMetric, legacyMetric])
  assert.equal(matches.get('12'), idMetric)
  assert.equal(matches.get('13'), legacyMetric)
})

test('does not fall back to a display name when an identified income row has a conflicting ID', () => {
  const matches = joinDistrictByIdOrUniqueName([{ id: '12', name: 'النخيل' }], [
    { district_id: 'other', district_ar: 'النخيل', income_all: 1 },
  ])
  assert.equal(matches.has('12'), false)
})

test('does not fall back to a display name when the source explicitly marks its ID unresolved', () => {
  const matches = joinDistrictByIdOrUniqueName([{ id: '12', name: 'النخيل' }], [
    { district_id: null, district_ar: 'النخيل', income_all: 1 },
  ])
  assert.equal(matches.has('12'), false)
})
