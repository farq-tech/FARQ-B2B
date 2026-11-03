import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceMissing, audienceSummary, audienceWhere, comparePairs, competitorsSummary, densestDistrict, duration, placeSite, rankCompetition, sameActivity, territoriesSummary, weekSummary } from './tool-answers.ts'
import { answerSequence } from './use-answer.ts'

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
  // every district in view measured: the total is the city's, or the selection's
  assert.equal(audienceSummary({ selected: 0, scope: 2, segment: '', sizes: [1200.4, 800.2], unit: 'شخص', top: 'النرجس' }), 'حجم الجمهور في المدينة: 2,001 شخص · الأعلى: النرجس')
  assert.equal(audienceSummary({ selected: 2, scope: 2, segment: 'نساء', sizes: [500, 300], unit: 'شخص', top: null }), 'حجم الجمهور في حيّان محددة: نساء: 800 شخص')
  // nothing measured: «غير متاح», never 0
  assert.equal(audienceSummary({ selected: 3, scope: 3, segment: '', sizes: [], unit: 'منشأة', top: null }), 'حجم الجمهور: غير متاح')
})

test('a total over part of the districts says how many it covers, never «في المدينة»', () => {
  assert.equal(audienceSummary({ selected: 0, scope: 186, segment: '', sizes: Array(180).fill(1000), unit: 'شخص', top: 'طويق' }), 'حجم الجمهور في 180 من 186 حياً مقاسة: 180,000 شخص · الأعلى: طويق')
  assert.equal(audienceSummary({ selected: 3, scope: 3, segment: 'رجال', sizes: [400, 600], unit: 'شخص', top: null }), 'حجم الجمهور في 2 من 3 أحياء محددة مقاسة: رجال: 1,000 شخص')
  assert.equal(audienceWhere({ selected: 0, measured: 186, scope: 186 }), 'في المدينة')
  assert.equal(audienceWhere({ selected: 0, measured: 185, scope: 186 }), 'في 185 من 186 حياً مقاسة')
})

test('the week line agrees with the number of days', () => {
  assert.equal(weekSummary(96, 5), 'خطة الأسبوع: 96 زيارة على 5 أيام')
  assert.equal(weekSummary(18, 1), 'خطة الأسبوع: 18 زيارة على يوم واحد')
  assert.equal(weekSummary(40, 2), 'خطة الأسبوع: 40 زيارة على يومين')
})

test('«الأقل تنافساً» puts a populated district with no competitor first, and an unknown density last', () => {
  const at = (id: string, population: number | null, competitors: number, perKm2: number | null) => ({ row: { id, name: id, population }, competitors, perKm2 })
  const table = [at('a', 9000, 4, 2.5), at('b', 3000, 0, null), at('c', 12000, 0, null), at('d', 5000, 2, null), at('e', 7000, 1, 0.4), at('f', null, 0, null)]
  assert.deepEqual(rankCompetition(table, 'light').map((item) => item.row.id), ['c', 'b', 'e', 'a', 'd'])
  assert.deepEqual(rankCompetition(table, 'dense').map((item) => item.row.id), ['a', 'e', 'd'])
})

test('businesses over the whole city read the service city count, not the sum of its districts', () => {
  // 9,616 of 10,405 fell in a known district: the sum is part of the city, the line gives the city's count
  assert.equal(audienceSummary({ selected: 0, scope: 186, segment: '', sizes: [9000, 616], unit: 'منشأة', top: 'العليا', cityTotal: 10405 }), 'حجم الجمهور في المدينة: 10,405 منشأة · الأعلى: العليا')
  assert.equal(audienceSummary({ selected: 0, scope: 186, segment: '', sizes: [9000], unit: 'منشأة', top: null, cityTotal: null }), 'حجم الجمهور: غير متاح')
  // selected districts are summed as before: every business in them has a district
  assert.equal(audienceSummary({ selected: 2, scope: 2, segment: '', sizes: [40, 60], unit: 'منشأة', top: null, cityTotal: 10405 }), 'حجم الجمهور في حيّان محددة: 100 منشأة')
})

test('the territories peek line never reads 0: nothing while loading or empty, «تعذر التقسيم» on failure', () => {
  assert.equal(territoriesSummary('loading', null, 'businesses'), null)
  assert.equal(territoriesSummary('loading', 5, 'businesses'), null, 'the last split is not shown as the new one')
  assert.equal(territoriesSummary('idle', 0, 'businesses'), null)
  assert.equal(territoriesSummary('idle', null, 'businesses'), null)
  assert.equal(territoriesSummary('error', null, 'businesses'), 'تعذر التقسيم')
  assert.equal(territoriesSummary('error', 5, 'population'), 'تعذر التقسيم')
  assert.equal(territoriesSummary('idle', 5, 'businesses'), '5 مناطق متوازنة بالمنشآت')
  assert.equal(territoriesSummary('idle', 4, 'population'), '4 مناطق متوازنة بالسكان')
})

test('a drive or route time reads in minutes, then hours, and a whole hour has no «0 دقيقة»', () => {
  assert.equal(duration(45 * 60), '45 دقيقة')
  assert.equal(duration(120 * 60), '2 ساعة')
  assert.equal(duration(80 * 60 + 10), '1 ساعة 20 دقيقة')
  assert.doesNotMatch(duration(3600), /0 دقيقة/)
  assert.doesNotMatch(duration(12345), /[٠-٩]/)
})

test('the same activity is the same words, the same main activity, or the same name', () => {
  assert.equal(sameActivity({ q: 'صيدلية ', label: 'صيدلية' }, { q: 'صيدلية', label: 'صيدلية' }), true)
  assert.equal(sameActivity({ q: 'عيادة', label: 'عيادة' }, { q: 'صيدلية', label: 'صيدلية' }), false)
  assert.equal(sameActivity({ main_id: '12', label: 'مطاعم' }, { main_id: '12', label: 'مطاعم' }), true)
  assert.equal(sameActivity({ main_id: '12', label: 'مطاعم' }, { q: 'مطاعم', label: 'مطاعم' }), true, 'typed as the main activity\'s name')
  assert.equal(sameActivity({ main_id: '12', label: 'مطاعم' }, { main_id: '13', label: 'مقاهي' }), false)
})

test('the audience panel names what the city cannot measure, and nothing while a district has a figure', () => {
  const measured = [{ population: 9000, income: null }, { population: 12000, income: null }]
  const base = { rows: measured, scored: 0, sex: 'all', nationality: 'all', minIncome: 0 }
  assert.equal(audienceMissing({ ...base, scored: 2 }), null)
  assert.equal(audienceMissing({ ...base, rows: [] }), null, 'no districts yet: nothing to say')
  assert.equal(audienceMissing({ ...base, rows: [{ population: null, income: null }] })?.what, 'سكان الأحياء')
  assert.equal(audienceMissing({ ...base, minIncome: 8000 })?.what, 'دخل الأحياء')
  assert.equal(audienceMissing({ ...base, sex: 'women' })?.what, 'الجنس')
  assert.equal(audienceMissing({ ...base, nationality: 'saudi' })?.what, 'الجنسية')
  assert.equal(audienceMissing({ ...base, sex: 'men', nationality: 'saudi' })?.what, 'الجنس والجنسية')
  assert.doesNotMatch(JSON.stringify(audienceMissing({ ...base, sex: 'women' })), /\b0\b/)
})

test('a compared site keeps its number and colour: the lowest free slot, and a fourth replaces the oldest in its slot', () => {
  let sites: { id: number; slot: number }[] = []
  for (const id of [1, 2, 3]) sites = placeSite(sites, { id }, 3)
  assert.deepEqual(sites.map((site) => [site.id, site.slot]), [[1, 0], [2, 1], [3, 2]])
  // removing site 1 leaves 2 and 3 where they were; the next one takes slot 0
  sites = sites.filter((site) => site.id !== 1)
  assert.deepEqual(sites.map((site) => site.slot), [1, 2])
  sites = placeSite(sites, { id: 4 }, 3)
  assert.deepEqual(sites.map((site) => [site.id, site.slot]).sort((a, b) => a[1] - b[1]), [[4, 0], [2, 1], [3, 2]])
  // all three taken: the oldest (2) gives its slot to the new one
  sites = placeSite(sites, { id: 5 }, 3)
  assert.deepEqual(sites.map((site) => [site.id, site.slot]).sort((a, b) => a[1] - b[1]), [[4, 0], [5, 1], [3, 2]])
})

test('only the latest request may land: an older answer, or one left by an unmount, is dropped', () => {
  const sequence = answerSequence()
  const first = sequence.next()
  const second = sequence.next()
  assert.equal(sequence.isLatest(first), false)
  assert.equal(sequence.isLatest(second), true)
  sequence.drop()
  assert.equal(sequence.isLatest(second), false, 'dropped on unmount or a cleared question')
})
