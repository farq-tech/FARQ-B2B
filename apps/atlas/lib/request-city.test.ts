import assert from 'node:assert/strict'
import test from 'node:test'
import { requestCity } from './format.ts'

const cities = [{ en: 'Riyadh', ar: 'الرياض' }, { en: 'Makkah', ar: 'مكة المكرمة' }, { en: 'Al Khobar', ar: 'الخبر' }]

test('a request names its city from what it saved, then from the shared city list, never from sample data', () => {
  assert.equal(requestCity({ cityId: 'makkah', cityName: 'مكة' }, cities), 'مكة', 'the saved name wins')
  assert.equal(requestCity({ cityId: 'makkah' }, cities), 'مكة المكرمة')
  assert.equal(requestCity({ cityId: 'al khobar' }, cities), 'الخبر', 'ids are the English name lower-cased')
  assert.equal(requestCity({ cityId: 'Riyadh' }, cities), 'الرياض')
  assert.equal(requestCity({ cityId: 'abha' }, cities), undefined, 'an unknown city is left to the caller to say «غير متاح»')
  assert.equal(requestCity({ cityId: 'makkah' }, []), undefined, 'before the list loads')
})
