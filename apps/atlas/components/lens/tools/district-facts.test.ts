import assert from 'node:assert/strict'
import test from 'node:test'
import { corridorFacts, homesFacts, homesMedianKey, opportunityFacts, territoryFacts } from './district-facts.ts'

const ids = new Map([['العليا', '1'], ['الملز', '2'], ['النرجس', '3']])

test('a district reads the corridor with most shops among the streets running through it', () => {
  const facts = corridorFacts([
    { street_ar: 'طريق نجد', district_ar: 'العليا', districts_ar: ['العليا', 'الملز'], n: 45 },
    { street_ar: 'شارع الستين', district_ar: 'الملز', n: 60 },
    { street_ar: 'شارع التحلية', district_ar: 'العليا', n: 12 },
  ], ids)
  assert.equal(facts.get('1'), 'أقوى شارع: طريق نجد (45 محلاً)')
  assert.equal(facts.get('2'), 'أقوى شارع: شارع الستين (60 محلاً)')
  // a district no corridor runs through is left out, so the card says «غير متاح»
  assert.equal(facts.has('3'), false)
})

test('a district reads the street opportunity the service scores highest there', () => {
  const facts = opportunityFacts([
    { street_ar: 'طريق الملك فهد', districts_ar: ['العليا'], score: 82 },
    { street_ar: 'شارع العروبة', districts_ar: ['العليا', 'غير معروف'], score: 90 },
  ], ids)
  assert.equal(facts.get('1'), 'أقوى فرصة: شارع العروبة (90/100)')
  assert.equal(facts.size, 1)
})

test('a district reads the rep whose territory holds it, with the share the split balanced', () => {
  const groups = [
    { weight: 1250, districts: [{ district_ar: 'العليا', district_id: 1 }] },
    { weight: 980.4, districts: [{ district_ar: 'حي جديد', district_id: 9 }] },
  ]
  const facts = territoryFacts(groups, ids, 'businesses')
  assert.equal(facts.get('1'), 'المندوب 1 · منطقته 1,250 منشأة')
  assert.equal(facts.get('9'), 'المندوب 2 · منطقته 980 منشأة')
  assert.equal(territoryFacts(groups, ids, 'population').get('1'), 'المندوب 1 · منطقته 1,250 ساكن')
})

test('the homes search reads one district median, or none when it has no single one', () => {
  assert.equal(homesMedianKey('rent', 'rent_year', 'apartment'), 'rent_year_residential')
  assert.equal(homesMedianKey('sale', 'sale', 'land'), 'sale_land')
  // a shop rent of every period is read against its yearly median; a home's mixed periods have no single one
  assert.equal(homesMedianKey('rent', null, 'store'), 'rent_year_commercial')
  assert.equal(homesMedianKey('rent', null, 'apartment'), null)
  assert.equal(homesMedianKey('rent', 'rent_month', 'room'), null)

  const rows = [
    { id: '1', realEstate: { rent_year_residential: { median: 452.6, listings: 12 } } },
    { id: '2', realEstate: {} },
  ]
  const facts = homesFacts(rows, 'rent_year_residential')!
  assert.equal(facts.get('1'), 'وسيط إيجار المتر السنوي: 453 ريال (12 عرضاً)')
  assert.equal(facts.has('2'), false)
  assert.equal(homesFacts(rows, null), null)
})
