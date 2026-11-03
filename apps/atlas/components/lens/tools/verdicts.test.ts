import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attractionScores, audienceVerdict, brandsVerdict, competitorsVerdict, corridorVerdict, gapsVerdict, listingVerdict, opportunityVerdict,
  pairsVerdict, siteCardVerdict, sitesVerdict, territoriesVerdict, weekFitHint, type VerdictText,
} from './tool-answers.ts'

const metres = (value: number) => `${value} م`
/** Every verdict is English digits and «%», never Hindi digits, «٪» or a bare 0 standing for a missing figure. */
function clean(verdict: VerdictText | null) {
  const text = JSON.stringify(verdict)
  assert.doesNotMatch(text, /[٠-٩٪]/)
  assert.doesNotMatch(text, /NaN|undefined|null منشأة|Infinity/)
}

test('the gaps verdict leads with the largest shortfall, what it has against what it needs, and the next two', () => {
  const short = [
    { district_ar: 'النرجس', businesses: 4, expected_businesses: 16.2, shortfall: 12.2 },
    { district_ar: 'الملقا', businesses: 3, expected_businesses: 11.6, shortfall: 8.6 },
    { district_ar: 'الياسمين', businesses: 5, expected_businesses: 11.9, shortfall: 6.9 },
    { district_ar: 'المصانع', businesses: 0, expected_businesses: 20, shortfall: 20, caveat: 'industrial' as const },
  ]
  const verdict = gapsVerdict(short, 'صيدلية', 2300)!
  assert.equal(verdict.lead, 'أكبر نقص في «صيدلية»: النرجس، ينقصه 12 منشأة')
  assert.equal(verdict.why[0], 'فيه 4 منشآت ويحتاج 16 بمعدل المدينة (منشأة لكل 2,300 ساكن).')
  // the next are residential, as the top is: an industrial district never stands beside a residential one
  assert.equal(verdict.why[1], 'يليه الملقا (ناقص 9) والياسمين (ناقص 7).')
  assert.equal(verdict.caution, null)
  clean(verdict)
})

test('a thin shortfall, or only industrial districts short, is said as a caution', () => {
  const thin = gapsVerdict([{ district_ar: 'العليا', businesses: 9, expected_businesses: 10.4, shortfall: 1.4 }], 'مخبز', 4000)!
  assert.match(thin.caution!, /منشأة واحدة فقط/)
  assert.equal(thin.why.length, 1, 'no «يليه» without a next district')
  const industrial = gapsVerdict([{ district_ar: 'الصناعية الثانية', businesses: 0, expected_businesses: 6, shortfall: 6, caveat: 'industrial' }], 'بقالة', 900)!
  assert.match(industrial.caution!, /مناطق صناعية/)
  assert.equal(gapsVerdict([], 'بقالة', 900), null)
})

test('the competitors verdict follows the chosen order, and a partly located city count is a caution', () => {
  const row = (name: string, population: number | null, competitors: number, perKm2: number | null, residentsPer: number | null = null) => ({ row: { id: name, name, population }, competitors, perKm2, residentsPer })
  const dense = competitorsVerdict([row('العليا', 30000, 42, 6.27, 714)], 'dense', 'صيدلية', 1200, 1180)!
  assert.equal(dense.lead, 'أشد منافسة على «صيدلية»: العليا')
  assert.equal(dense.why[0], '42 منشأة · 6.3 لكل كم² · ساكن لكل منافس: 714.')
  assert.equal(dense.caution, null)
  const light = competitorsVerdict([row('طويق', 81000, 0, null), row('عكاظ', 20000, 0, null), row('النسيم', 50000, 3, 0.5)], 'light', 'صيدلية', 1200, 900)!
  assert.equal(light.lead, 'أخف منافسة على «صيدلية»: طويق')
  assert.equal(light.why[0], 'لا منافس فيه، وفيه 81,000 ساكن.')
  assert.equal(light.why[1], 'حيّان مأهولة بلا أي منافس، والأكثر سكاناً أولاً.')
  assert.equal(light.caution, '900 فقط من 1,200 منشأة «صيدلية» بحي معروف، فأعداد الأحياء أقل من الحقيقة.')
  assert.equal(competitorsVerdict([row('النسيم', 50000, 3, 0.5)], 'light', 'صيدلية', null, null)!.why[0], '3 منشآت فقط · 0.5 لكل كم² · 50,000 ساكن.')
  clean(light)
})

test('the activity pair verdict counts the districts with the first and none of the second', () => {
  const at = (name: string, a: number, b: number) => ({ row: { id: name, name }, a, b })
  const verdict = pairsVerdict([at('النرجس', 6, 0), at('العليا', 10, 9), at('الملقا', 2, 0), at('الروضة', 2, 4)], 'صيدلية', 'عيادة')!
  assert.equal(verdict.lead, 'أحياء فيها «صيدلية» بلا «عيادة»: 2')
  assert.equal(verdict.why[0], 'أوسع فرق في النرجس: 6 «صيدلية» مقابل 0 «عيادة».')
  assert.equal(pairsVerdict([at('الروضة', 2, 4)], 'صيدلية', 'عيادة')!.lead, 'لا حي يزيد فيه «صيدلية» على «عيادة»')
  assert.equal(pairsVerdict([], 'صيدلية', 'عيادة'), null)
})

test('the audience verdict names the top district and how concentrated the audience is', () => {
  const ranked = [40, 30, 20, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5].map((size, index) => ({ name: `حي ${index + 1}`, size: size * 1000 }))
  const verdict = audienceVerdict(ranked, 'شخص', 'نساء')!
  assert.equal(verdict.lead, 'أعلى حي لجمهورك (نساء): حي 1')
  assert.equal(verdict.why[0], 'فيه 40,000 شخص، ويليه حي 2 وحي 3.')
  // 110,000 of 160,000
  assert.equal(verdict.why[1], 'أعلى 5 أحياء تجمع 69% من الجمهور، فحملة مركّزة عليها تصل إلى أكثره.')
  assert.equal(audienceVerdict([{ name: 'أ', size: 0 }], 'شخص', ''), null, 'no audience: no verdict, never «0 شخص»')
  assert.equal(audienceVerdict(ranked.slice(0, 2), 'منشأة', '')!.why.length, 1, 'no concentration line over five districts or fewer')
  clean(verdict)
})

test('the attraction score scales each factor to the best site and needs two complete sites', () => {
  const scores = attractionScores([
    { id: 1, audience: 100000, spending: 12000, density: 10 },
    { id: 2, audience: 50000, spending: 12000, density: 5 },
    { id: 3, audience: 80000, spending: null, density: 4 },
  ])
  assert.equal(scores.get(1), 83)   // (100 + 100 + 50) / 3
  assert.equal(scores.get(2), 83)   // (50 + 100 + 100) / 3
  assert.equal(scores.has(3), false)
  assert.equal(attractionScores([{ id: 1, audience: 1, spending: 1, density: 1 }]).size, 0)
})

test('the sites verdict names the most attractive site and why, or that two are level, and the site without a score', () => {
  const site = (id: number, audience: number | null, spending: number | null, density: number | null) => ({ id, label: String(id), audience, spending, density, population: audience })
  const sites = [site(1, 120000, 15000, 3), site(2, 60000, 9000, 6), site(3, 90000, null, 2)]
  const verdict = sitesVerdict(sites, attractionScores(sites), true)!
  assert.equal(verdict.lead, 'الموقع 1 هو الأجذب: 100 من 100')
  assert.equal(verdict.why[0], 'سكان أكثر (120,000)، دخل حيه أعلى، منافسة أخف.')
  assert.equal(verdict.caution, 'بلا درجة: الموقع 3 (دخل حيه غير متاح).')
  const level = [site(1, 100000, 12000, 10), site(2, 50000, 12000, 5)]
  assert.match(sitesVerdict(level, attractionScores(level), false)!.lead, /^الموقعان 1 و2 متقاربان: 83 و83 من 100$/)
  assert.equal(sitesVerdict([site(1, 1, 1, 1)], new Map(), true)!.lead, 'أضف موقعاً ثانياً لتعرف أيهما أجذب')
  // one complete site and one without its income: no score for either, and only the missing factor is named
  const half = [site(1, 90000, null, 3), site(2, 60000, 9000, 6)]
  assert.deepEqual(sitesVerdict(half, attractionScores(half), true), { lead: 'جاذبية المواقع غير متاحة للمقارنة', why: ['الدرجة تحتاج موقعين لكل منهما عوامله الثلاثة.'], caution: 'بلا درجة: الموقع 1 (دخل حيه غير متاح).' })
  assert.equal(sitesVerdict([], new Map(), true), null)
  // the best site trailing on one factor says so
  const mixed = [site(1, 50000, 20000, 1), site(2, 100000, 8000, 4)]
  assert.equal(sitesVerdict(mixed, attractionScores(mixed), false)!.why[0], 'فلل أكثر في حيه، منافسة أخف، لكن سكان أقل (50,000).')
})

test('the site card verdict counts the competitors in range and the nearest', () => {
  assert.deepEqual(siteCardVerdict({ n: 0, nearest: [] }, null, 23400, 'صيدلية', metres), { lead: 'لا منافس من «صيدلية» في هذا النطاق', why: ['وفيه 23,400 ساكن.'] })
  const some = siteCardVerdict({ n: 4, nearest: [{ name: 'صيدلية النهدي', distance_m: 220 }] }, 2310.4, 9000, 'صيدلية', metres)!
  assert.equal(some.lead, '4 منشآت من «صيدلية» في النطاق، أقربها على 220 م')
  assert.equal(some.why[0], 'ساكن لكل منافس: 2,310 · الأقرب: صيدلية النهدي.')
  assert.equal(siteCardVerdict(null, null, null, 'صيدلية', metres), null, 'no activity chosen: the card says so itself')
})

test('the street verdicts lead with the strongest street and say what the score rests on', () => {
  const corridor = corridorVerdict([{ street_ar: 'طريق الملك فهد', n: 42, per_100m: 3.5, road_class: 'main' }, { street_ar: 'شارع العليا', n: 20, per_100m: 2 }], 'أدوات صحية')!
  assert.equal(corridor.lead, 'أقوى شارع لـ«أدوات صحية»: طريق الملك فهد')
  assert.deepEqual(corridor.why, ['42 محلاً منه، 3.5 لكل 100 م، على شارع رئيسي.', 'يليه شارع العليا (20 محلاً).'])
  const opportunity = opportunityVerdict([{ street_ar: 'شارع التخصصي', total: 120, score: 82, requested_n: 0, requested_below: null, nearest: { street_ar: 'شارع العروبة', distance_m: 900 } }], 'صيدلية', false, metres)!
  assert.equal(opportunity.lead, 'أقوى فرصة لـ«صيدلية»: شارع التخصصي (82 من 100)')
  assert.deepEqual(opportunity.why, ['120 محلاً على الشارع ولا محل «صيدلية» عليه.', 'أقرب تجمع لـ«صيدلية»: شارع العروبة على 900 م.'])
  assert.match(opportunity.caution!, /سكان الأحياء غير متاحين/)
  assert.equal(corridorVerdict([], 'x'), null)
})

test('the territories verdict says how even the shares are, and the week hint names the change that fits everyone', () => {
  assert.deepEqual(territoriesVerdict([2100, 2000, 1950], 'businesses'), { lead: 'تقسيم متوازن: 3 مناطق بالمنشآت', why: ['أكبر حصة 2,100 منشأة وأصغرها 1,950 منشأة.'], caution: null })
  const uneven = territoriesVerdict([90000, 40000], 'population')!
  assert.equal(uneven.lead, 'تقسيم غير متساوٍ: منطقتان بالسكان')
  assert.match(uneven.caution!, /لا يُقسم/)
  assert.equal(weekFitHint(130, 30, 5, 20), 'لتتسع كلها: زد زيارات اليوم إلى 26.', 'seven days is past the week')
  assert.equal(weekFitHint(110, 10, 5, 20), 'لتتسع كلها: زد زيارات اليوم إلى 22 أو أيام العمل إلى 6.')
  assert.equal(weekFitHint(9000, 8000, 5, 20), 'لا تتسع في أسبوع واحد: زد عدد المندوبين لتصغر كل منطقة.')
  assert.equal(weekFitHint(100, 0, 5, 20), null)
})

test('the listing verdict leads with the first listing and flags one without a district median', () => {
  const verdict = listingVerdict({ type: 'شقة', district: 'النرجس', price: '45,000 ريال سنوياً', versus: 'أقل من وسيط النرجس بـ 12%', area: 140, away: null }, false)!
  assert.equal(verdict.lead, 'أنسب عرض: شقة في النرجس بـ 45,000 ريال سنوياً')
  assert.deepEqual(verdict.why, ['أقل من وسيط النرجس بـ 12% · 140 م².'])
  assert.equal(verdict.caution, null)
  const bare = listingVerdict({ type: 'محل', district: null, price: null, versus: null, area: null, away: null }, false)!
  assert.equal(bare.lead, 'أنسب عرض: محل، السعر غير مذكور')
  assert.deepEqual(bare.why, [])
  assert.match(bare.caution!, /بلا وسيط/)
  assert.equal(listingVerdict(null, false), null)
})

test('the chains verdict says who holds the market, with the chains\' share as the line under it reads it', () => {
  const brands = (in_chains: number, list: { brand: string; branches: number; districts: number }[]) => ({ total: 1000, chains: list.length, in_chains, brands: list })
  assert.deepEqual(brandsVerdict(brands(640, [{ brand: 'النهدي', branches: 310, districts: 120 }])), { lead: 'السلاسل تملك أكثر السوق: 64%', why: ['أكبرها النهدي: 310 فرع في 120 حياً.'] })
  assert.equal(brandsVerdict(brands(120, [{ brand: 'أ', branches: 40, districts: 30 }]))!.lead, 'أكثر السوق محلات مستقلة: السلاسل 12% فقط')
  assert.equal(brandsVerdict(brands(0, []))!.lead, 'السوق كله محلات مستقلة')
  assert.equal(brandsVerdict({ total: 0, chains: 0, in_chains: 0, brands: [] }), null)
})
