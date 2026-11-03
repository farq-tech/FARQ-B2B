import assert from 'node:assert/strict'
import test from 'node:test'
import { ACCESS_CATEGORIES, accessRequestBody, normalizeContact, safeNext, validateAccessRequest } from './access-request.ts'
import { LENS_GOALS } from '../components/lens/lenses.ts'

const good = { name: 'سارة', company: 'مطاعم الواحة', contact: '0551234567', city: 'Riyadh', category: 'shops', purpose: '' }

test('the categories are the landing goals, in their words, and the search card', () => {
  assert.deepEqual(ACCESS_CATEGORIES.slice(0, 5).map((item) => item.label), Object.values(LENS_GOALS))
  assert.equal(ACCESS_CATEGORIES.at(-1)?.label, 'أبحث عن مورد')
})

test('a Saudi mobile in its usual spellings, and an email, are one stored form', () => {
  for (const raw of ['0551234567', '551234567', '+966551234567', '00966551234567', '966 55 123 4567', '٠٥٥١٢٣٤٥٦٧', '۰۵۵۱۲۳۴۵۶۷']) {
    assert.deepEqual(normalizeContact(raw), { kind: 'mobile', value: '+966551234567' }, raw)
  }
  assert.deepEqual(normalizeContact(' Sara@Company.SA '), { kind: 'email', value: 'sara@company.sa' })
  for (const raw of ['0451234567', '12345', 'sara@', 'sara@company', '']) assert.equal(normalizeContact(raw), null, raw)
})

test('a complete request passes; each missing or wrong field says what to fix', () => {
  assert.deepEqual(validateAccessRequest(good, ['Riyadh', 'Jeddah']), {})
  const errors = validateAccessRequest({ name: ' ', company: 'ب', contact: 'sara@', city: 'Paris', category: 'spies', purpose: 'x'.repeat(501) }, ['Riyadh'])
  assert.deepEqual(Object.keys(errors).sort(), ['category', 'city', 'company', 'contact', 'name', 'purpose'])
  assert.match(errors.contact ?? '', /البريد/)
  assert.match(validateAccessRequest({ ...good, contact: '123' }).contact ?? '', /الجوال/)
  assert.equal(validateAccessRequest({ ...good, city: 'Jeddah' }).city, undefined, 'before the list loads, the service checks the city')
})

test('the body is cleaned and its return address stays inside Atlas', () => {
  const body = accessRequestBody({ ...good, name: ' سارة\n<b> ' }, '/map?lens=shops')
  assert.equal(body.name, 'سارة b')
  assert.equal(body.next, '/map?lens=shops')
  assert.equal(safeNext('//evil.example'), null)
  assert.equal(safeNext('https://evil.example'), null)
})
