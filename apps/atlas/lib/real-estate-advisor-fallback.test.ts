import test from 'node:test'
import assert from 'node:assert/strict'
import { realEstateAdvisorFallback } from './real-estate-advisor-fallback.ts'

const facts = [
  'الخيار أ: شقة للإيجار في العليا | 48,000 ريال سنوياً | 120 م² | 400 ريال للمتر سنوياً | غرف النوم 2 | دورات المياه 2 | عرض الشارع غير متاح',
  'حي العليا | السكان 2000 | المنشآت 300 | ساكن لكل منشأة 7 | متوسط الدخل الشهري غير متاح | حصة الفلل من المساكن 20% | مبانٍ تحت الإنشاء 3',
  '',
  'الخيار ب: شقة للإيجار في النخيل | 60,000 ريال سنوياً | 150 م² | 400 ريال للمتر سنوياً | غرف النوم 3 | دورات المياه 2 | عرض الشارع غير متاح',
  'حي النخيل | السكان 1500 | المنشآت 200 | ساكن لكل منشأة 7 | متوسط الدخل الشهري غير متاح | حصة الفلل من المساكن 35% | مبانٍ تحت الإنشاء 2',
].join('\n')

test('fallback compares only stated listing facts against the chosen priority', () => {
  const reply = realEstateAdvisorFallback(facts, 'الأهم: مساحة أكبر')
  assert.match(reply, /الخيار ب أكبر مساحةً \(150 م² مقابل 120 م²\)/)
  assert.match(reply, /^استناداً إلى بيانات أطلس المتاحة:/)
  assert.doesNotMatch(reply, /المستشار الذكي غير متاح|تعذر إعداد اقتراح/)
  assert.match(reply, /لا تثبت توفر العرض أو حالته/)
})

test('fallback does not compare rent prices with different periods', () => {
  const differentPeriods = facts.replace('60,000 ريال سنوياً', '5,500 ريال شهرياً')
  const reply = realEstateAdvisorFallback(differentPeriods, 'الأهم: السعر الأقل')
  assert.match(reply, /مدة الإيجار غير مكتملة أو مختلفة/)
})

test('fallback does not turn villa share into a promise of family suitability', () => {
  const reply = realEstateAdvisorFallback(facts, 'الأهم: حي عائلي (فلل أكثر)')
  assert.match(reply, /حصة الفلل أعلى في حي الخيار ب \(35% مقابل 20%\)/)
  assert.match(reply, /لا يثبت وحده أن الحي أنسب للعائلة/)
})

test('fallback compares real-estate districts using only shared measured facts', () => {
  const districts = [
    'الخيار أ: حي العليا | السكان 20,000 | المنشآت 2,000 | ساكن لكل منشأة 10 | متوسط الدخل الشهري 8,000 ريال | حصة الفلل من المساكن 20% | مبانٍ تحت الإنشاء 30 | وسيط إيجار السكن السنوي للمتر 500 ريال | وسيط إيجار السكن الشهري للمتر غير متاح | وسيط سعر بيع السكن للمتر 7,000 ريال | وسيط إيجار المحل السنوي للمتر غير متاح | وسيط إيجار المحل للمتر (المدة غير مذكورة) غير متاح | وسيط سعر الأرض للمتر 4,000 ريال',
    'الخيار ب: حي النخيل | السكان 15,000 | المنشآت 1,000 | ساكن لكل منشأة 15 | متوسط الدخل الشهري غير متاح | حصة الفلل من المساكن غير متاح | مبانٍ تحت الإنشاء 20 | وسيط إيجار السكن السنوي للمتر 600 ريال | وسيط إيجار السكن الشهري للمتر 35 ريال | وسيط سعر بيع السكن للمتر غير متاح | وسيط إيجار المحل السنوي للمتر غير متاح | وسيط إيجار المحل للمتر (المدة غير مذكورة) غير متاح | وسيط سعر الأرض للمتر 5,000 ريال',
  ].join('\n')

  const familyReply = realEstateAdvisorFallback(districts, 'الأهم: حي عائلي (فلل أكثر)')
  assert.match(familyReply, /حصة الفلل غير متاحة للمقارنة في الحيين/)
  assert.match(familyReply, /متوسط دخل العامل الشهري غير متاح/)
  assert.doesNotMatch(familyReply, /السعر في الإعلان ليس صفقة مكتملة/)

  const priceReply = realEstateAdvisorFallback(districts, 'الأهم: السعر الأقل')
  assert.match(priceReply, /وسيط إيجار السكن السنوي للمتر أقل في حي العليا \(500 مقابل 600 ريال\)/)
  assert.doesNotMatch(priceReply, /وسيط سعر بيع السكن للمتر (?:أقل|متساوٍ)/)
  assert.doesNotMatch(priceReply, /وسيط إيجار السكن الشهري للمتر (?:أقل|متساوٍ)/)
})
