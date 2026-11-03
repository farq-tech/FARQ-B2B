import assert from 'node:assert/strict'
import test from 'node:test'
import { boldRuns, districtPairs, factsLine, replyBlocks } from './advisor-facts.ts'

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

test('a reply reads as paragraphs and points, with every line kept', () => {
  const reply = 'الخيار أ أرخص.\nلكن مساحته أقل.\n\n- سكان أكثر في ب\n- دخل أعلى في أ\nالخلاصة: يعتمد على أولويتك.\n\n1. أولاً\n2) ثانياً'
  assert.deepEqual(replyBlocks(reply), [
    { kind: 'p', text: 'الخيار أ أرخص.\nلكن مساحته أقل.' },
    { kind: 'list', items: ['سكان أكثر في ب', 'دخل أعلى في أ'] },
    { kind: 'p', text: 'الخلاصة: يعتمد على أولويتك.' },
    { kind: 'list', items: ['أولاً', 'ثانياً'] },
  ])
  assert.deepEqual(replyBlocks('سطر واحد'), [{ kind: 'p', text: 'سطر واحد' }])
})

test('bold markers become bold runs and are not shown', () => {
  assert.deepEqual(boldRuns('الأفضل **الخيار ب** للعائلة'), [['الأفضل ', false], ['الخيار ب', true], [' للعائلة', false]])
  assert.deepEqual(boldRuns('بلا تمييز'), [['بلا تمييز', false]])
})

test('a listing median in the comparison table carries the ads it rests on', () => {
  const facts = districtPairs({ population: 1, businesses: 1, residentsPerBusiness: 1, income: null, villaShare: null, underConstruction: null,
    realEstate: { rent_year_residential: { median: 640, listings: 25 }, sale_residential: { median: 5200, listings: 1 } } } as unknown as Parameters<typeof districtPairs>[0])
  assert.equal(facts.find((fact) => fact.label === 'وسيط إيجار السكن السنوي للمتر')?.value, '640 ريال من 25 عرضاً')
  assert.equal(facts.find((fact) => fact.label === 'وسيط سعر بيع السكن للمتر')?.value, '5,200 ريال من عرض واحد')
  assert.equal(facts.find((fact) => fact.label === 'وسيط سعر الأرض للمتر')?.value, 'غير متاح')
})
