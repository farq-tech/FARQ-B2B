import assert from 'node:assert/strict'
import test from 'node:test'
import { GUEST_PREVIEW, guestPreview } from './guest-preview.ts'

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  poi_key: `poi-${i}`, name_ar: `مورد قهوة ${i}`, district_ar: 'العليا', category_ar: 'تجارة قهوة', latitude: 24.7, longitude: 46.6,
  phone_norm: '966500000000', phone: '0500000000', has_whatsapp: true, email: 'private@example.test', website: 'https://example.test',
  instagram: 'private_ig', full_address_ar: 'شارع خاص', extra_phones: '966511111111', ...extra,
})

test('a guest sees the count and at most three businesses: name, district, activity only', () => {
  const preview = guestPreview(Array.from({ length: 10 }, (_, i) => row(i)), 245)
  assert.equal(preview.guest, true)
  assert.equal(preview.total, 245)
  assert.equal(preview.rows.length, GUEST_PREVIEW)
  assert.deepEqual(preview.rows[0], { name: 'مورد قهوة 0', district: 'العليا', category: 'تجارة قهوة' })
  for (const item of preview.rows) assert.deepEqual(Object.keys(item).sort(), ['category', 'district', 'name'])
  const json = JSON.stringify(preview)
  for (const secret of ['9665', '0500', 'private', 'example.test', 'شارع خاص', 'poi-', '24.7', 'whatsapp']) assert.equal(json.includes(secret), false, secret)
})

test('closed businesses are skipped and a missing total falls back to what was found', () => {
  const preview = guestPreview([row(1, { status: 'closed_permanent' }), row(2), null, 'x'], undefined)
  assert.deepEqual(preview.rows.map((item) => item.name), ['مورد قهوة 2'])
  assert.equal(preview.total, 1)
  assert.deepEqual(guestPreview(null, 0), { guest: true, total: 0, rows: [] })
})
