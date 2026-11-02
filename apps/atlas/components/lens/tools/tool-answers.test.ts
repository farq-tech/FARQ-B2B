import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceSummary, comparePairs, competitorsSummary, densestDistrict, weekSummary } from './tool-answers.ts'

const district = (id: string, name: string) => ({ id, name })

test('the densest district is the one with the most competitors per km², among those that have any', () => {
  const table = [
    { row: district('1', 'العليا'), competitors: 12, perKm2: 3.4 },
    { row: district('2', 'النرجس'), competitors: 0, perKm2: 9 },     // no competitor: never the densest
    { row: district('3', 'الملقا'), competitors: 5, perKm2: null },   // no area: no density
    { row: district('4', 'الروضة'), competitors: 8, perKm2: 5.1 },
  ]
  assert.equal(densestDistrict(table)?.row.id, '4')
  assert.equal(densestDistrict([{ row: district('3', 'الملقا'), competitors: 5, perKm2: null }]), null)
})

test('the competitors line reads the service total, or «غير متاح» when it has none', () => {
  const top = { row: district('4', 'الروضة'), competitors: 8, perKm2: 5.1 }
  assert.equal(competitorsSummary(1234, 'صيدلية', top), '1,234 منشأة «صيدلية» في المدينة · الأكثر تنافساً: الروضة')
  assert.equal(competitorsSummary(null, 'صيدلية', null), 'عدد منشآت «صيدلية» غير متاح')
})

test('two activities pair by district, a missing count is none, and the gap order puts the widest lead first', () => {
  const rows = [district('1', 'العليا'), district('2', 'النرجس'), district('3', 'الملقا'), district('4', 'الروضة')]
  const pharmacies = [{ district_ar: 'العليا', n: 10 }, { district_ar: 'النرجس', n: 6 }, { district_ar: 'الروضة', n: 2 }]
  const clinics = [{ district_ar: 'العليا', n: 9 }, { district_ar: 'الروضة', n: 4 }]
  const gap = comparePairs(rows, pharmacies, clinics, 'gap')
  assert.deepEqual(gap.map((item) => [item.row.name, item.a, item.b]), [['النرجس', 6, 0], ['العليا', 10, 9], ['الروضة', 2, 4]])
  const first = comparePairs(rows, pharmacies, clinics, 'first')
  assert.deepEqual(first.map((item) => item.row.name), ['العليا', 'النرجس', 'الروضة'])
  // a district with neither activity is left out
  assert.ok(!gap.some((item) => item.row.name === 'الملقا'))
})

test('the audience line sums the service segment figures and names the top district', () => {
  assert.equal(audienceSummary({ selected: 0, segment: '', sizes: [1200.4, 800.2], unit: 'شخص', top: 'النرجس' }), 'حجم الجمهور في المدينة: 2,001 شخص · الأعلى: النرجس')
  assert.equal(audienceSummary({ selected: 2, segment: 'نساء', sizes: [500], unit: 'شخص', top: null }), 'حجم الجمهور في حيّان محددة: نساء: 500 شخص')
  assert.equal(audienceSummary({ selected: 3, segment: '', sizes: [], unit: 'منشأة', top: null }), 'حجم الجمهور في 3 أحياء محددة: غير متاح')
})

test('the week line agrees with the number of days', () => {
  assert.equal(weekSummary(96, 5), 'خطة الأسبوع: 96 زيارة على 5 أيام')
  assert.equal(weekSummary(18, 1), 'خطة الأسبوع: 18 زيارة على يوم واحد')
  assert.equal(weekSummary(40, 2), 'خطة الأسبوع: 40 زيارة على يومين')
})
