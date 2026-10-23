import assert from 'node:assert/strict'
import test from 'node:test'
import { isMapQuery, sanitizeLiveDirectoryEntity } from './live-directory.ts'

test('directory map profile returns only the basic entity fields', () => {
  const entity = sanitizeLiveDirectoryEntity({
    poi_key: 'poi-1', name_ar: 'شركة مقاولات', category_ar: 'مقاولات عامة', district_ar: 'الربيع', street_ar: 'طريق الملك',
    latitude: 24.8, longitude: 46.7, has_whatsapp: true, phone_norm: '966500000000', email: 'private@example.test', sources: ['private'],
  })
  assert.deepEqual(entity, {
    id: 'poi-1', name: 'شركة مقاولات', category: 'مقاولات عامة', district: 'الربيع', street: 'طريق الملك', latitude: 24.8, longitude: 46.7,
    wholesale: false, whatsapp: true, verification: null, roles: [], specialties: [], reason: '', fit: null, status: null,
  })
  assert.equal(JSON.stringify(entity).includes('9665'), false)
  assert.equal(JSON.stringify(entity).includes('private@example'), false)
})

test('map query must be an opaque 32-character hexadecimal token', () => {
  assert.equal(isMapQuery('0123456789abcdef0123456789abcdef'), true)
  assert.equal(isMapQuery('not-a-map-token'), false)
  assert.equal(isMapQuery('../secret'), false)
})
