import assert from 'node:assert/strict'
import test from 'node:test'
import { districtNameById, findDistrictByName, stableDistrictId } from './live-district.ts'

test('district identifiers accept provider variants and keep canonical Arabic names', () => {
  const features = [
    { id: 3, properties: { district_id: 'olaya-v1', name_ar: 'العليا' } },
    { properties: { district_en: 'al-malqa', ar: 'الملقا' } },
  ]
  assert.equal(stableDistrictId(features[0]), 'olaya-v1')
  assert.equal(districtNameById(features).get('al-malqa'), 'الملقا')
  assert.equal(findDistrictByName(features, 'حي العليا')?.properties?.name_ar, 'العليا')
})
