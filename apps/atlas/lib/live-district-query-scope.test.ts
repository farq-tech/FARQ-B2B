import assert from 'node:assert/strict'
import test from 'node:test'
import { districtAreaForQuery, findDistrictByName } from './live-district.ts'

const districts = [{ id: 'rabie', properties: { name_ar: 'الربيع' } }]
const selected = { kind: 'district' as const, districtId: 'rabie', label: 'حي الربيع' }

test('an activity search keeps the selected district when it names no other district', () => {
  assert.deepEqual(districtAreaForQuery(selected, undefined, null), selected)
})

test('an explicit district in the new query replaces the current map area', () => {
  const feature = findDistrictByName(districts, 'الربيع')
  assert.deepEqual(districtAreaForQuery(null, 'الربيع', feature), selected)
})
