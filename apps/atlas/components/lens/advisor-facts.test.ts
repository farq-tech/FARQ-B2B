import assert from 'node:assert/strict'
import test from 'node:test'
import { districtPairs, factsLine } from './advisor-facts.ts'

const row = {
  population: 12400.4, businesses: 310, residentsPerBusiness: null, income: 15250, villaShare: 42, underConstruction: 0,
  realEstate: { rent_year_residential: { median: 640 } },
} as unknown as Parameters<typeof districtPairs>[0]

test('a district is handed over with its figures in 0-9 digits, and a missing one as «غير متاح», never 0', () => {
  const facts = districtPairs(row)
  const value = (label: string) => facts.find((fact) => fact.label === label)?.value
  assert.equal(value('السكان'), '12,400')
  assert.equal(value('ساكن لكل منشأة'), 'غير متاح')
  assert.equal(value('مبانٍ تحت الإنشاء'), '0')
  assert.equal(value('حصة الفلل من المساكن'), '42%')
  assert.equal(value('وسيط إيجار السكن السنوي للمتر'), '640 ريال')
  assert.equal(value('وسيط سعر الأرض للمتر'), 'غير متاح')
  assert.ok(factsLine(facts).startsWith('السكان 12,400 | المنشآت 310 | ساكن لكل منشأة غير متاح'))
})
