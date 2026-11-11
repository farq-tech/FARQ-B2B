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

test('v13 enrichment columns map to the public entity; unknown values are dropped', () => {
  const entity = sanitizeLiveDirectoryEntity({
    poi_key: 'poi-2', name_ar: 'مقهى الصباح', category_ar: 'مقاهي', district_ar: 'النخيل',
    status_voted: 'open', status_voted_confidence: 'low', last_seen_at: '2026-10-01', is_stale: true,
    hours_week: '{"mon":[["09:00","17:00"]]}', whatsapp_state: 'source_flag_unverified', has_whatsapp: true,
  })
  assert.equal(entity.statusVoted, 'open')
  assert.equal(entity.statusConfidence, 'low')
  assert.equal(entity.lastSeenAt, '2026-10-01')
  assert.equal(entity.isStale, true)
  assert.equal(entity.hoursWeek, '{"mon":[["09:00","17:00"]]}')
  assert.equal(entity.whatsappState, 'source_flag_unverified')
})

test('invalid or absent enrichment values are left off entirely (never guessed)', () => {
  const entity = sanitizeLiveDirectoryEntity({
    poi_key: 'poi-3', name_ar: 'ورشة', status_voted: 'garbage', status_voted_confidence: '7',
    is_stale: false, whatsapp_state: 'not_available',
  })
  assert.equal('statusVoted' in entity, false)
  assert.equal('statusConfidence' in entity, false)
  assert.equal('isStale' in entity, false) // only an explicit true is carried
  assert.equal('lastSeenAt' in entity, false)
  assert.equal('hoursWeek' in entity, false)
  assert.equal(entity.whatsappState, 'not_available')
})

test('listing content columns map to the public entity when present', () => {
  const entity = sanitizeLiveDirectoryEntity({
    poi_key: 'poi-4', name_ar: 'مطعم الذواقة', category_ar: 'مطاعم',
    website: 'example.sa', instagram: '@dhawaqa', facebook: 'https://facebook.com/dhawaqa', snapchat: 'dhawaqa',
    tiktok: '@dhawaqa', x_link: 'https://x.com/dhawaqa', linkedin: 'https://linkedin.com/company/dhawaqa',
    menu_link: 'https://menus.example/d', order_link: 'https://order.example/d', reservation_link: 'https://book.example/d',
    reviews_count: '1,240', full_address_ar: 'شارع الملك، النخيل، الرياض', full_address_en: 'King St, Al Nakheel, Riyadh',
    national_address: 'RRRA2929', postal_code: '12345', description_en: 'A fine dining restaurant.',
    extra_phones: '0551234567, 0119876543;0551234567',
  })
  assert.equal(entity.website, 'example.sa')
  assert.equal(entity.instagram, '@dhawaqa')
  assert.equal(entity.facebook, 'https://facebook.com/dhawaqa')
  assert.equal(entity.snapchat, 'dhawaqa')
  assert.equal(entity.tiktok, '@dhawaqa')
  assert.equal(entity.xLink, 'https://x.com/dhawaqa')
  assert.equal(entity.linkedin, 'https://linkedin.com/company/dhawaqa')
  assert.equal(entity.menuLink, 'https://menus.example/d')
  assert.equal(entity.orderLink, 'https://order.example/d')
  assert.equal(entity.reservationLink, 'https://book.example/d')
  assert.equal(entity.reviewsCount, 1240) // varchar «1,240» → 1240
  assert.equal(entity.fullAddressAr, 'شارع الملك، النخيل، الرياض')
  assert.equal(entity.fullAddressEn, 'King St, Al Nakheel, Riyadh')
  assert.equal(entity.nationalAddress, 'RRRA2929')
  assert.equal(entity.postalCode, '12345')
  assert.equal(entity.descriptionEn, 'A fine dining restaurant.')
  assert.deepEqual(entity.extraPhones, ['0551234567', '0119876543']) // split + de-duplicated, blanks dropped
})

test('empty or placeholder content values are left off the entity entirely (no «غير متاح» row)', () => {
  const entity = sanitizeLiveDirectoryEntity({
    poi_key: 'poi-5', name_ar: 'محل', website: '  ', instagram: 'no information', facebook: 'N/A',
    menu_link: '-', order_link: 'null', description_en: '   ', reviews_count: 'abc', extra_phones: ' , ; ',
    national_address: '', postal_code: 'n/a',
  })
  for (const key of ['website', 'instagram', 'facebook', 'menuLink', 'orderLink', 'descriptionEn', 'reviewsCount',
    'extraPhones', 'nationalAddress', 'postalCode', 'tiktok', 'xLink', 'linkedin', 'snapchat', 'reservationLink',
    'fullAddressAr', 'fullAddressEn'] as const) {
    assert.equal(key in entity, false, `${key} should be absent`)
  }
})

test('map query must be an opaque 32-character hexadecimal token', () => {
  assert.equal(isMapQuery('0123456789abcdef0123456789abcdef'), true)
  assert.equal(isMapQuery('not-a-map-token'), false)
  assert.equal(isMapQuery('../secret'), false)
})
