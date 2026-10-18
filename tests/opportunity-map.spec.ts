import { expect, test, type Page } from '@playwright/test'

/*
 * خريطة الفرص v2 (owner-approved redesign 2026-10-16): live counters, three layers, district selection (GET /districts,
 * mocked), the guide tree, role / specialty / wholesale filters («جملة» in the request never narrows), trade clusters,
 * the business profile drawer (never a contact field), the campaign tray (hidden until a choice, never over the map,
 * send now / schedule), «طلب جديد», «طلباتي» and its audit. Every response is mocked in the browser: nothing leaves
 * the machine and no write may reach a send path. Nothing may be stored on the device.
 */
const SHOTS = 'docs/qa/opportunity-map-v2'
const SHOTS3 = 'docs/qa/opportunity-map-v3'
const SHOTS4 = 'docs/qa/opportunity-map-v4'
type Extra = Record<string, unknown>
const row = (id: number, name: string, district: string, street: string, lat: number | null, lon: number | null, extra: Extra = {}) => ({
  poi_key: String(id), name_ar: name, name_en: null, category_ar: 'أدوات صحية', category: null, city_en: 'Riyadh', region_ar: 'الرياض',
  district_ar: district, street_ar: street, latitude: lat, longitude: lon, location_precision: lat == null ? 'district' : 'point',
  phone: '9665123456' + String(10 + id).slice(-2), has_whatsapp: true, email: `shop${id}@example.com`, source_count: 2, sources: ['qa_fixture'],
  taxonomy_sub: 'build.plumbing_supply', role_badges: ['يبيع'], specialties: [], ...extra,
})
const ALL = [
  row(1, 'مؤسسة الأنابيب الحديثة 0551234567', 'الملك فيصل', 'شارع خالد بن الوليد', 24.630, 46.712, { is_wholesale: true, role_badges: ['يبيع', 'جملة'], specialties: ['مواسير وتمديدات', 'خلاطات'], saudi_registered: true, completeness: 82, rating: 4.4, source_count: 3 }),
  row(2, 'مستودع السباكة الكبير', 'الملك فيصل', 'شارع خالد بن الوليد', 24.640, 46.722, { is_wholesale: true, role_badges: ['جملة', 'مصنع'], specialties: ['مواسير وتمديدات'] }),
  row(3, 'سباكة الخليج', 'الفيصلية', 'شارع الأمير مشعل', 24.635, 46.745, { taxonomy_sub: 'contract.plumbing', role_badges: ['خدمات وتنفيذ'], specialties: ['صيانة سباكة'] }),
  row(4, 'أدوات صحية النخبة', 'العليا', 'شارع الحسن بن علي', 24.660, 46.720, { is_wholesale: false, role_badges: ['يبيع', 'جملة', 'تجزئة'] }),
  row(5, 'معرض الماء الصافي', 'العليا', 'طريق العليا العام', null, null, { rating: 17772 }),
  row(6, 'مركز الخلاطات', 'العليا', 'طريق العليا العام', 24.670, 46.750, { specialties: ['خلاطات'], phone: null, has_whatsapp: false, email: null }),
]
const rect = (id: number, ar: string, w: number, s: number, e: number, n: number) => ({ type: 'Feature', properties: { id, ar, en: ar, city_en: 'Riyadh' }, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } })
const DISTRICTS = { type: 'FeatureCollection', features: [rect(11, 'الملك فيصل', 46.70, 24.62, 46.73, 24.65), rect(12, 'الفيصلية', 46.73, 24.62, 46.76, 24.65), rect(13, 'العليا', 46.70, 24.65, 46.76, 24.68)] }
const MAIN_BUILD = 'مواد بناء وتشطيب (بيع)', MAIN_ELEC = 'إلكترونيات وأجهزة'
const line = (street: string, district: string, coords: number[][], n: number, per: number, wholesale = 0, sub = 'أدوات صحية وسباكة', sub_id = 'build.plumbing_supply', main = MAIN_BUILD, main_id = 'build') => ({ type: 'Feature', main_id, geometry: { type: 'LineString', coordinates: coords },
  properties: { sub_id, sub_ar: sub, main_ar: main, district_ar: district, street_ar: street, n, n_wholesale: wholesale, length_m: Math.round(n / per * 100), per_100m: per, lift: 2.1, label_ar: `${street} — ${n} محل ${sub} على ${Math.round(n / per * 100)} م` } })
const LINES = [
  line('شارع خالد بن الوليد', 'الملك فيصل', [[46.703, 24.636], [46.712, 24.637], [46.726, 24.638]], 37, 4.1, 14),
  line('شارع الأمير مشعل', 'الفيصلية', [[46.734, 24.641], [46.745, 24.642], [46.757, 24.642]], 22, 9.5, 3),
  line('طريق العليا العام', 'العليا', [[46.708, 24.664], [46.73, 24.666], [46.752, 24.667]], 31, 2.4, 1),
  line('يوسف بن عبدالعزيز', 'العليا', [[46.712, 24.672], [46.735, 24.674]], 26, 5.0, 2, 'إنارة', 'elec.lighting', MAIN_ELEC, 'elec'),
]
const BASIS = 'محلات النشاط على امتداد الشارع مقارنة بطوله · من بيانات المحلات المسجلة'
/** What the fake service answers for a body: a request = its trade only; main / subs; districts narrow. */
function streetsFor(body: { q?: string; main_id?: string; sub_ids?: string[]; districts?: string[] }) {
  return LINES.filter((l) => (!body.q || l.main_id === 'build') && (!body.main_id || l.main_id === body.main_id) && (!body.sub_ids || body.sub_ids.includes(l.properties.sub_id)) && (!body.districts || body.districts.includes(l.properties.district_ar)))
    .sort((a, b) => b.properties.n - a.properties.n)
}
function catalogFor(body: { districts?: string[] }) {
  const ls = streetsFor({ districts: body.districts })
  return ['build', 'elec'].map((id) => {
    const mine = ls.filter((l) => l.main_id === id)
    const subs = [...new Set(mine.map((l) => l.properties.sub_id))].map((sid) => { const s = mine.filter((l) => l.properties.sub_id === sid); return { sub_id: sid, sub_ar: s[0].properties.sub_ar, streets: s.length, shops: s.reduce((t, l) => t + l.properties.n, 0) } })
    return { main_id: id, main_ar: id === 'build' ? MAIN_BUILD : MAIN_ELEC, streets: mine.length, shops: mine.reduce((t, l) => t + l.properties.n, 0), subs }
  }).filter((m) => m.streets)
}
const AREAS = {
  districts: [{ name: 'الملك فيصل', n: 2 }, { name: 'العليا', n: 3 }, { name: 'الفيصلية', n: 1 }],
  streets: [{ name: 'شارع خالد بن الوليد', district: 'الملك فيصل', n: 2 }, { name: 'شارع الحسن بن علي', district: 'العليا', n: 1 }, { name: 'شارع الأمير مشعل', district: 'الفيصلية', n: 1 }, { name: 'طريق العليا العام', district: 'العليا', n: 2 }],
  wholesale: 2,
  roles: [{ name: 'يبيع', n: 5 }, { name: 'جملة', n: 2 }, { name: 'مصنع', n: 1 }, { name: 'خدمات وتنفيذ', n: 1 }, { name: 'تجزئة', n: 1 }],
  specialties: [{ name: 'مواسير وتمديدات', n: 2 }, { name: 'خلاطات', n: 2 }, { name: 'صيانة سباكة', n: 1 }],
}
const CLUSTERS = [
  { level: 'street', label_ar: 'أدوات صحية وسباكة — شارع خالد بن الوليد، الملك فيصل', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', district_ar: 'الملك فيصل', street_ar: 'شارع خالد بن الوليد', n: 37, n_wholesale: 14, wholesale_pct: 38, lift: 4.1, lat: 24.635, lon: 46.716 },
  { level: 'district', label_ar: 'أدوات صحية وسباكة — الفيصلية', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', district_ar: 'الفيصلية', street_ar: null, n: 22, n_wholesale: 3, wholesale_pct: 14, lift: 2.6, lat: 24.64, lon: 46.745 },
]
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333'
const REQUESTS = [
  { id: U1, organizationId: 'org-1', createdBy: 'qa-user', kind: 'BOOKLET', title: 'مواسير PPR — الرياض', payload: { city: 'الرياض' }, status: 'ACTIVE', hidden: false, createdAt: '2026-10-14T09:30:00Z' },
  { id: U2, organizationId: 'org-1', createdBy: 'other-user', kind: 'SELLER_CATALOG', title: 'مشترين لخلاطات المغاسل', payload: { city: 'جدة' }, status: 'ACTIVE', hidden: true, createdAt: '2026-10-12T15:10:00Z' },
  { id: U3, organizationId: 'org-1', createdBy: 'qa-user', kind: 'SEARCH', title: 'سخانات مياه', payload: { city: 'الرياض' }, status: 'CANCELLED', hidden: false, cancelledAt: '2026-10-11T08:00:00Z', cancelReason: 'لقينا مورد', createdAt: '2026-10-10T11:00:00Z' },
]

async function setup(page: Page, opts: { requestsOff?: boolean; role?: string; districts?: 'ok' | 'none'; districtsDelayMs?: number; streets?: 'ok' | 'none'; catalogOff?: boolean; specialtiesCount?: number; marketSummaryFailures?: number; schedule?: 404 | 200; send?: boolean; malformedDistrict?: boolean; analyticsConsent?: 'accepted' | 'rejected' } = {}) {
  const writes: string[] = []
  const saved: Record<string, unknown>[] = []
  const searches: Record<string, unknown>[] = []
  const searchRequests: Record<string, unknown>[] = []
  const schedules: Record<string, unknown>[] = []
  const densities: Record<string, unknown>[] = []
  const catalogs: Record<string, unknown>[] = []
  const buyerQueries: Record<string, unknown>[] = []
  const marketQueries: Record<string, unknown>[] = []
  const marketSummaryStatuses: number[] = []
  const orgHeaders: (string | undefined)[] = []
  const listQueries: string[] = []
  let marketSummaryFailuresRemaining = opts.marketSummaryFailures ?? 0
  await page.addInitScript((analyticsConsent: 'accepted' | 'rejected') => {
    (window as unknown as Record<string, unknown>).__FARQ_QA_SESSION__ = { accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }
    // Keep map telemetry declined by default; tests may opt in explicitly to verify the consent-gated stream.
    localStorage.setItem('farq:pricing-map-analytics-consent-v1', analyticsConsent)
  }, opts.analyticsConsent || 'rejected')
  await page.route('**/_targeting/**', async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }, { en: 'Jeddah', ar: 'جدة', n: 80 }] })
    if (path.endsWith('/market-summary')) {
      const body = route.request().postDataJSON(); marketQueries.push(body)
      if (marketSummaryFailuresRemaining > 0) {
        marketSummaryFailuresRemaining -= 1
        marketSummaryStatuses.push(503)
        return route.fulfill({ status: 503, json: { error: 'QA_TRANSIENT_MARKET_SUMMARY_FAILURE' } })
      }
      marketSummaryStatuses.push(200)
      return route.fulfill({ json: { ok: true, summary: { total: 6, districts_count: 3, top_districts: [{ district_ar: 'الملك فيصل', n: 2 }, { district_ar: 'العليا', n: 3 }], densest_street: { street_ar: 'شارع خالد بن الوليد', district_ar: 'الملك فيصل', n: 37, length_m: 900, per_100m: 4.1, sub_ar: 'أدوات صحية وسباكة' }, main_activities: [{ main_id: 'build', main_ar: 'مواد بناء وتشطيب', n: 3 }], n_wholesale: 2, n_whatsapp: 5, n_specialties: opts.specialtiesCount ?? 3, n_approx: 1, n_cr: 1, basis: 'نقاط دقيقة فقط' } } })
    }
    if (path.endsWith('/district-counts')) return route.fulfill({ json: { ok: true, city: 'Riyadh', total: 6, basis: 'نقاط دقيقة فقط', districts: [{ district_ar: 'الملك فيصل', n: 2, n_wholesale: 2, n_whatsapp: 2 }, { district_ar: 'العليا', n: 3, n_wholesale: 0, n_whatsapp: 2 }, { district_ar: 'الفيصلية', n: 1, n_wholesale: 0, n_whatsapp: 1 }] } })
    if (path.endsWith('/district-insights')) return route.fulfill({ json: { ok: true, city: 'Riyadh', districts: [], basis: 'اختبار' } })
    if (path.endsWith('/who-buys')) {
      const body = route.request().postDataJSON(); buyerQueries.push(body)
      return route.fulfill({ json: { ok: true, subject: { sub_ids: ['build.plumbing_supply'], label_ar: 'أدوات صحية وسباكة' }, basis: 'اختبار', buyers: [
        { sub_id: 'contract.plumbing', sub_ar: 'سباكة وتنفيذ', main_id: 'contract', main_ar: 'مقاولات', strength: 'core', n: 7, n_whatsapp: 3 },
        { sub_id: 'hotel', sub_ar: 'فنادق', main_id: 'tourism', main_ar: 'سياحة', strength: 'common', n: 4, n_whatsapp: 1 },
      ] } })
    }
    if (path.endsWith('/street-density/catalog')) {
      const body = route.request().postDataJSON(); catalogs.push(body)
      if (opts.catalogOff) return route.fulfill({ status: 503, json: { error: 'QA_CATALOG_UNAVAILABLE' } })
      return route.fulfill({ json: { mains: opts.streets === 'none' ? [] : catalogFor(body) } })
    }
    if (path.endsWith('/street-density')) {
      const body = route.request().postDataJSON(); densities.push(body)
      expect(body).toMatchObject({ city: expect.stringMatching(/^(Riyadh|Jeddah)$/) })
      return route.fulfill({ json: { type: 'FeatureCollection', basis: BASIS, features: opts.streets === 'none' ? [] : streetsFor(body) } })
    }
    if (path.endsWith('/districts')) {
      expect(url.searchParams.get('city')).toMatch(/^(Riyadh|Jeddah)$/)
      if (opts.districtsDelayMs) await new Promise((resolve) => setTimeout(resolve, opts.districtsDelayMs))
      return opts.districts === 'none' ? route.fulfill({ status: 404, json: { error: 'not_found' } }) : route.fulfill({ json: DISTRICTS })
    }
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates')) return route.fulfill({ json: { ok: true, data: [
      { name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'السلام عليكم {{1}}،\n{{2}}' }] },
      { name: 'monthly_offer', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'هلا {{1}}، عندنا عرض الشهر: {{2}}' }] },
      { name: 'order_update', status: 'APPROVED', category: 'UTILITY', language: 'ar', components: [{ type: 'BODY', text: 'طلبك {{1}} وصل' }] },
      { name: 'logo_offer', status: 'APPROVED', category: 'UTILITY', language: 'ar', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'هلا {{1}}، {{2}}' }] },
    ] } })
    if (path.endsWith('/send-status')) return route.fulfill({ json: { send: Boolean(opts.send) } })
    if (path.endsWith('/search')) {
      const body = route.request().postDataJSON(); searchRequests.push(body); if (body.q) searches.push(body)
      const f = body.filters || {}
      const source = opts.malformedDistrict ? [...ALL, row(7, 'مؤسسة بلا حي', '{"id": null, "name_ar": null, "name_en": null}', '', 24.65, 46.72)] : ALL
      const rows = source.filter((r) => (!f.wholesale || r.is_wholesale) && (!f.district || r.district_ar === f.district) && (!f.street || r.street_ar.includes(f.street)) && (!f.role || (r.role_badges as string[]).includes(f.role)) && (!f.specialty || (r.specialties as string[]).includes(f.specialty)))
      const areas = opts.malformedDistrict ? { ...AREAS, districts: [...AREAS.districts, { name: '{"id": null, "name_ar": null, "name_en": null}', n: 1 }] } : AREAS
      return route.fulfill({ json: { total: rows.length, rows, parsed: { keywords: ['أدوات صحية'] }, areas, understood: { wholesale: /جمل/.test(body.q), sub_ids: ['build.plumbing_supply'] } } })
    }
    if (path.endsWith('/clusters')) return route.fulfill({ json: { clusters: CLUSTERS, wholesale: 2, basis: 'تجمّع النشاط مقارنة بباقي المدينة · من بيانات المحلات المسجلة' } })
    if (path.endsWith('/suggest-specialties')) return route.fulfill({ json: { suggestions: [
      { specialty_id: 1, specialty_ar: 'مواسير وتمديدات', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', main_ar: 'مواد بناء' },
      { specialty_id: 2, specialty_ar: 'خلاطات وأدوات صحية', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', main_ar: 'مواد بناء' },
      { specialty_id: 3, specialty_ar: 'سخانات مياه', sub_id: 9, sub_ar: 'أجهزة كهربائية', main_ar: 'كهرباء' },
    ] } })
    writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 403, json: { error: 'QA_BLOCKED' } })
  })
  await page.route('**/api/targeting/schedule', async (route) => {
    schedules.push(route.request().postDataJSON())
    return opts.schedule === 200 ? route.fulfill({ json: { ok: true, id: 'sch-1' } }) : route.fulfill({ status: 404, json: { error: 'not_found' } })
  })
  await page.route('**/_api/**', async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname
    if (path.endsWith('/whatsapp/pricing')) return route.fulfill({ json: { ok: true, data: { enabled: true, category: 'MARKETING', price_sar: 0.17, currency: 'SAR' } } })
    if (path.endsWith('/api/business/context')) return route.fulfill({ json: { ok: true, data: { organizations: [{ id: 'org-1', name: 'مؤسسة الاختبار', role: opts.role || 'MEMBER', subscriptions: [{ sectorCode: 'construction' }] }] } } })
    if (path.includes('/api/business/opportunity-requests')) {
      if (opts.requestsOff) return route.fulfill({ status: 404, json: { ok: false, errors: [{ code: 'OPPORTUNITY_REQUESTS_DISABLED', message: 'Not found' }] } })
      orgHeaders.push(route.request().headers()['x-farq-organization-id'])
      const method = route.request().method()
      if (method === 'DELETE') { writes.push('DELETE'); return route.fulfill({ status: 405, json: { ok: false } }) }
      if (path.endsWith('/audit')) return route.fulfill({ json: { ok: true, data: { events: [
        { id: '1', auditLogId: '1', action: 'CREATE', actorUserId: 'qa-user', organizationId: 'org-1', organizationName: 'مؤسسة الاختبار', membershipId: 'm1', membershipRole: 'OWNER', via: 'membership', planCode: 'pro', createdAt: '2026-10-14T09:30:00Z' },
        { id: '3', auditLogId: '3', action: 'CANCEL', actorUserId: 'qa-user', organizationId: 'org-1', organizationName: 'مؤسسة الاختبار', membershipId: 'm1', membershipRole: 'OWNER', via: 'membership', planCode: 'pro', details: { reason: 'تغيّرت الكمية' }, createdAt: '2026-10-15T10:40:00Z' },
      ] } } })
      if (method === 'GET') { listQueries.push(url.search); return route.fulfill({ json: { ok: true, data: { requests: REQUESTS } } }) }
      if (method === 'POST' && /\/opportunity-requests\/?$/.test(path)) { const body = route.request().postDataJSON(); saved.push(body); return route.fulfill({ status: 201, json: { ok: true, data: { request: { ...REQUESTS[0], id: '44444444-4444-4444-8444-444444444444', ...body, createdBy: 'qa-user', createdAt: '2026-10-16T09:00:00Z' } } } }) }
      const m = /\/opportunity-requests\/([^/]+)\/(cancel|hide|unhide|archive|restore)$/.exec(path)
      const r = REQUESTS.find((x) => x.id === m?.[1])
      if (m && r) return route.fulfill({ json: { ok: true, data: { request: { ...r, status: m[2] === 'cancel' ? 'CANCELLED' : m[2] === 'archive' ? 'ARCHIVED' : r.status, hidden: m[2] === 'hide' ? true : m[2] === 'unhide' ? false : r.hidden } } } })
    }
    if (route.request().method() !== 'GET') writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 503, json: { ok: false, error: { message: 'QA: blocked' } } })
  })
  return { writes, searches, searchRequests, saved, schedules, orgHeaders, listQueries, densities, catalogs, buyerQueries, marketQueries, marketSummaryStatuses, setMarketSummaryFailuresRemaining: (count: number) => { marketSummaryFailuresRemaining = count } }
}

const counter = (page: Page, key: string) => page.locator(`[data-counter="${key === 'n' ? 'supplier-matches' : key === 'districts' ? 'supplier-districts' : key}"] span[aria-hidden]`)
async function searchFor(page: Page, text: string) {
  await page.getByLabel('وش تبي توصل له؟').fill(text)
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
}
async function chooseFilter(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: option, exact: true }).click()
}
/** The saved-request panel belongs to the supplier-results workspace, not the market overview. */
async function openMyRequests(page: Page) {
  await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
  await page.getByText('طلباتي').click()
}
/** A district on the drawn map, by keyboard (a cluster circle or a pin may sit on its centre). */
async function pickDistrict(page: Page, name: string) {
  const d = page.getByRole('button', { name: `حي ${name}` })
  await d.focus()
  await d.press('Enter')
}
async function pickStreetMain(page: Page, name: string) {
  await page.getByTestId('street-picker').getByRole('button').first().click()
  await page.locator('#street-activity-options').getByRole('option', { name: new RegExp(name) }).click()
}
async function clearStreetActivity(page: Page) {
  await page.getByTestId('street-picker').getByRole('button').first().click()
  await page.locator('#street-activity-options').getByRole('option', { name: 'كل الأنشطة' }).click()
}
async function nothingStored(page: Page) {
  const stored = await page.evaluate(async () => ({ local: localStorage.length - Number(localStorage.getItem('farq:pricing-map-analytics-consent-v1') !== null), session: sessionStorage.length, idb: (await indexedDB.databases?.() || []).length }))
  expect(stored).toEqual({ local: 0, session: 0, idb: 0 })
}

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })

  test('profile only presents ratings on the five-star scale', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'مواسير')

    const validProfile = page.locator('li[data-key="1"]').getByRole('button').first()
    await validProfile.click()
    const drawer = page.getByTestId('profile-drawer')
    await expect(drawer).toContainText('4.4 من 5')
    await drawer.getByRole('button', { name: 'إغلاق ملف المنشأة' }).click()

    await page.locator('li[data-key="5"]').getByRole('button').first().click()
    await expect(page.getByTestId('profile-drawer')).not.toContainText(/من 5|17,772/)
  })

  test('a supplier profile seeds the purchase request with that supplier and an editable search line', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'مواسير PPR')
    await page.locator('li[data-key="2"]').getByRole('button').first().click()
    const profile = page.getByTestId('profile-drawer')
    await expect(profile.getByRole('button', { name: 'جهّز طلب تسعير لهذا المورد' })).toBeVisible()
    await profile.getByRole('button', { name: 'جهّز طلب تسعير لهذا المورد' }).click()
    await expect(page).toHaveURL(/\/new$/)
    await expect(page.getByRole('heading', { name: 'وش تبي تسعّر؟' })).toBeVisible()
    await expect(page.getByText('مواسير PPR', { exact: true })).toBeVisible()
    await page.getByLabel('الكمية لـ مواسير PPR').fill('25')
    await page.getByLabel('وحدة مواسير PPR').selectOption('حبة')
    await page.getByRole('button', { name: 'التالي', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1 بند في الطلب' })).toBeVisible()
    await expect(page.getByText('1 من 1 مورد')).toBeVisible()
    await page.getByRole('button', { name: '1 من 1 مورد' }).click()
    await expect(page.getByText('مستودع السباكة الكبير', { exact: true })).toBeVisible()
  })

  test('main map lenses record only generic events after analytics consent', async ({ page }) => {
    const batches: { events: { event_type: string; session_id: string; path: string; element_label: string }[] }[] = []
    await setup(page)
    await page.route('**/_api/events/track', async (route) => {
      const body = route.request().postDataJSON()
      batches.push(body)
      await route.fulfill({ json: { ok: true, accepted: body.events.length } })
    })
    await page.goto('/opportunity-map')
    const lenses = page.getByRole('tablist', { name: 'عدسات خريطة السوق' })
    await lenses.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    expect(batches).toEqual([])
    await page.evaluate(() => localStorage.setItem('farq:pricing-map-analytics-consent-v1', 'accepted'))
    await lenses.getByRole('tab', { name: 'ابحث عن مشترين' }).click()
    await lenses.getByRole('tab', { name: 'افهم السوق' }).click()

    await expect.poll(() => batches.flatMap((batch) => batch.events.map((event) => event.element_label)), { timeout: 15_000 }).toEqual([
      'pricing_map_map_lens_buyers',
      'pricing_map_map_lens_market',
    ])
    const events = batches.flatMap((batch) => batch.events)
    expect(events.every((event) => event.event_type === 'click' && event.path === '/opportunity-map')).toBe(true)
    expect(events.every((event) => /^pricing-map-[0-9a-f-]{36}$/.test(event.session_id))).toBe(true)
    expect(events.every((event) => Object.keys(event).sort().join(',') === 'element_label,event_type,path,session_id')).toBe(true)
  })

  test('guide-tree focus records consent-gated source events without activity values', async ({ page }) => {
    const batches: { events: { event_type: string; session_id: string; path: string; element_label: string }[] }[] = []
    await setup(page, { analyticsConsent: 'rejected' })
    await page.route('**/_api/events/track', async (route) => {
      const body = route.request().postDataJSON()
      batches.push(body)
      await route.fulfill({ json: { ok: true, accepted: body.events.length } })
    })
    await page.goto('/opportunity-map')
    await searchFor(page, 'مواسير PPR')
    await page.getByRole('tab', { name: 'الدليل' }).click()
    const main = page.getByRole('button', { name: /^مواد بناء وتشطيب \(بيع\)/ })
    await expect(main).toBeVisible()
    await main.click()
    expect(batches).toEqual([])

    await page.evaluate(() => localStorage.setItem('farq:pricing-map-analytics-consent-v1', 'accepted'))
    const sub = page.getByRole('button', { name: 'أدوات صحية وسباكة 5', exact: true })
    await sub.click()
    await sub.click()
    await expect.poll(() => batches.flatMap((batch) => batch.events.map((event) => event.element_label)), { timeout: 15_000 })
      .toEqual(expect.arrayContaining([
        'pricing_map_map_guide_focus_select',
        'pricing_map_map_guide_focus_clear',
      ]))
    const events = batches.flatMap((batch) => batch.events)
    expect(events.every((event) => event.event_type === 'click' && event.path === '/opportunity-map')).toBe(true)
    expect(events.every((event) => Object.keys(event).sort().join(',') === 'element_label,event_type,path,session_id')).toBe(true)
    expect(events.some((event) => /مواد بناء|أدوات صحية|مواسير/.test(event.element_label))).toBe(false)
  })

  test('market first open, three lenses, and core buyers by default', async ({ page }) => {
    const { buyerQueries, marketQueries } = await setup(page)
    await page.goto('/opportunity-map')
    await expect(page.getByRole('tab', { name: 'افهم السوق' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'ملخص سوق الرياض' })).toBeVisible()
    await expect(page.locator('[data-counter="market-size"]')).toContainText('منشآت مرصودة')
    await expect(page.locator('[data-counter="market-whatsapp"]')).toContainText('واتساب مسجل بالدليل')
    await expect(page.locator('[data-counter="market-unlocated"]')).toContainText('بلا موقع دقيق')
    await expect(page.getByText('منشآت لديها تخصصات مسجلة')).toBeVisible()
    await page.getByRole('button', { name: 'توسيع الخريطة' }).click()
    await expect(page.getByText(/منشآت مرصودة ·/)).toBeVisible()
    await page.getByRole('button', { name: 'العودة لتخطيط الصفحة' }).click()
    await expect(page.getByTestId('street-picker')).toBeVisible()
    expect(marketQueries[0]).toEqual({ city: 'Riyadh' })

    await page.getByRole('tab', { name: 'ابحث عن مشترين' }).click()
    await pickStreetMain(page, 'مواد بناء وتشطيب')
    await page.getByRole('group', { name: 'الأنشطة الفرعية وعدد الشوارع لكل نشاط' }).getByRole('button', { name: /أدوات صحية وسباكة/ }).click()
    await expect.poll(() => buyerQueries.length).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { name: 'من يشتري عادةً؟' })).toBeVisible()
    await expect(page.getByText('سباكة وتنفيذ')).toBeVisible()
    await expect(page.getByText('فنادق')).toHaveCount(0)
    await page.getByRole('button', { name: 'عرض احتمالات أقل تأكيداً' }).click()
    await expect(page.getByText('فنادق')).toBeVisible()
    await expect(page.getByRole('note')).toContainText('راجع نشاط المنشأة قبل التواصل')

    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await expect(page.getByRole('tab', { name: 'ابحث عن موردين' })).toHaveAttribute('aria-selected', 'true')
  })

  test('market activity counter replaces other filters but keeps the selected district', async ({ page }) => {
    const { marketQueries, searchRequests } = await setup(page)
    await page.goto('/opportunity-map')
    await pickDistrict(page, 'الملك فيصل')
    await page.getByRole('button', { name: /تفصيل التصنيفات الرئيسية/ }).click()
    await page.locator('[data-counter="market-main-build"]').click()
    await expect.poll(() => marketQueries.some((query) => JSON.stringify(query).includes('الملك فيصل') && query.main_id === 'build')).toBe(true)
    await expect.poll(() => searchRequests.some((request) => {
      const filters = request.filters as Record<string, unknown> | undefined
      return request.q === '' && Boolean(filters) && filters!.district === 'الملك فيصل' && Object.keys(filters!).length === 1
    })).toBe(true)
    await page.getByRole('button', { name: /تفصيل التصنيفات الرئيسية/ }).click()
    await expect(page.locator('[data-counter="market-main-build"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('recovers a transient market-summary failure without a manual retry', async ({ page }) => {
    const { marketQueries, marketSummaryStatuses } = await setup(page, { marketSummaryFailures: 1, districtsDelayMs: 1200 })
    await page.goto('/opportunity-map')
    await expect(page.locator('[data-counter="market-size"]')).toContainText('منشآت مرصودة')
    await expect(page.getByText('تعذّر تحميل ملخص السوق.')).toHaveCount(0)
    await expect(page.getByText('منشآت لديها تخصصات مسجلة')).toBeVisible()
    expect(marketQueries).toHaveLength(2)
    expect(marketSummaryStatuses).toEqual([503, 200])
  })

  test('keeps the manual market-summary retry after the automatic retry is exhausted', async ({ page }) => {
    const { marketSummaryStatuses, setMarketSummaryFailuresRemaining } = await setup(page, { marketSummaryFailures: 20, districtsDelayMs: 1200 })
    await page.goto('/opportunity-map')
    await expect(page.getByRole('alert')).toContainText('تعذّر تحميل ملخص السوق.')
    expect(marketSummaryStatuses.length).toBeGreaterThanOrEqual(2)
    expect(marketSummaryStatuses.every((status) => status === 503)).toBe(true)

    setMarketSummaryFailuresRemaining(0)
    await page.getByRole('button', { name: 'أعد المحاولة' }).click()
    await expect(page.locator('[data-counter="market-size"]')).toContainText('منشآت مرصودة')
    await expect(page.getByText('تعذّر تحميل ملخص السوق.')).toHaveCount(0)
    expect(marketSummaryStatuses.at(-1)).toBe(200)
    expect(marketSummaryStatuses.slice(0, -1).every((status) => status === 503)).toBe(true)
  })

  test('does not present business specialty records as available activity filters', async ({ page }) => {
    await setup(page, { catalogOff: true, specialtiesCount: 99 })
    await page.goto('/opportunity-map')
    const mapCounters = page.getByRole('region', { name: 'مؤشرات الخريطة' })
    await expect(mapCounters.getByText('تصنيفات فرعية متاحة')).toHaveCount(0)
    await expect(page.getByTestId('street-picker')).toHaveCount(0)
    const summary = page.locator('dl').filter({ hasText: 'منشآت لديها تخصصات مسجلة' })
    await expect(summary).toContainText('99')
  })

  test('changing city repeats the active search instead of showing city-wide results under the old phrase', async ({ page }) => {
    const { searchRequests } = await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'مواسير سباكة')
    await expect.poll(() => searchRequests.some((request) => request.q === 'مواسير سباكة' && request.city === 'Riyadh')).toBe(true)

    await page.getByLabel('المدينة', { exact: true }).selectOption('Jeddah')
    await expect(page.getByLabel('وش تبي توصل له؟')).toHaveValue('مواسير سباكة')
    await expect.poll(() => searchRequests.some((request) => request.q === 'مواسير سباكة' && request.city === 'Jeddah' && request.objective === 'purchase')).toBe(true)
    await expect.poll(() => searchRequests.filter((request) => request.city === 'Jeddah').length).toBe(1)
    await expect(page.getByRole('heading', { name: 'ملخص سوق جدة' })).toHaveCount(0)
  })

  test('choosing a district zooms into it and a result refresh does not zoom back out', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    const district = page.locator('path[data-district="الملك فيصل"]')
    const before = await district.boundingBox()
    expect(before).not.toBeNull()

    await pickDistrict(page, 'الملك فيصل')
    await expect(page.getByRole('button', { name: 'عرض كل الأحياء' })).toBeVisible()
    const zoomed = await district.boundingBox()
    expect(zoomed).not.toBeNull()
    expect(zoomed!.width).toBeGreaterThan(before!.width * 1.15)

    await page.waitForTimeout(700)
    const afterRefresh = await district.boundingBox()
    expect(afterRefresh).not.toBeNull()
    expect(afterRefresh!.width).toBeGreaterThan(zoomed!.width * 0.9)

    await page.getByRole('button', { name: 'عرض كل الأحياء' }).click()
    const cityView = await district.boundingBox()
    expect(cityView).not.toBeNull()
    expect(cityView!.width).toBeLessThan(afterRefresh!.width * 0.9)
  })

  test('focus map fills the viewport and its results panel can be shown or hidden', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: 'توسيع الخريطة' }).click()

    const focus = page.getByTestId('map-focus-shell')
    await expect(focus).toBeVisible()
    const mapBounds = await focus.getByRole('region', { name: 'خريطة الفرص' }).boundingBox()
    expect(mapBounds?.height).toBeGreaterThanOrEqual(950)
    expect(mapBounds?.width).toBeGreaterThanOrEqual(1400)
    await expect(focus.getByRole('search')).toBeVisible()
    await expect(focus.getByRole('tab', { name: 'افهم السوق' })).toBeVisible()
    await expect(focus.getByRole('button', { name: 'العودة لتخطيط الصفحة' })).toBeVisible()
    await expect(page.getByLabel('التنقل الرئيسي')).toHaveCount(0)

    const panelToggle = focus.locator('button[aria-controls="map-focus-panel"]')
    await panelToggle.click()
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(focus.locator('#map-focus-panel')).toBeVisible()
    await panelToggle.click()
    await expect(focus.locator('#map-focus-panel')).toHaveCount(0)

    await focus.getByRole('button', { name: 'العودة لتخطيط الصفحة' }).click()
    await expect(page.getByTestId('map-focus-shell')).toHaveCount(0)
    await expect(page.getByLabel('التنقل الرئيسي')).toBeVisible()
  })

  test('supplier neighborhood counter follows the selected district', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'أدوات صحية')
    await chooseFilter(page, 'الحي', 'الملك فيصل (2)')

    await expect(page.getByRole('tab', { name: /النتائج · 2/ })).toBeVisible()
    await expect(counter(page, 'supplier-districts')).toHaveText('1')
    await page.getByRole('button', { name: 'إزالة الحي: الملك فيصل' }).click()
    await expect(counter(page, 'supplier-districts')).toHaveText('3')
  })

  test('switching buyer and seller lenses keeps the phrase and updates the search direction', async ({ page }) => {
    const { searches } = await setup(page)
    await page.goto('/opportunity-map')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'أدوات صحية')
    await expect.poll(() => searches.some((s) => s.q === 'أدوات صحية' && s.objective === 'purchase')).toBe(true)

    await page.getByRole('tab', { name: 'ابحث عن مشترين' }).click()
    await expect.poll(() => searches.some((s) => s.q === 'أدوات صحية' && s.objective === 'marketing')).toBe(true)
    await expect(page.getByLabel('وش تبي توصل له؟')).toHaveValue('أدوات صحية')

    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await expect.poll(() => searches.filter((s) => s.q === 'أدوات صحية' && s.objective === 'purchase').length).toBeGreaterThan(1)
  })

  test('a stale load-more response cannot clear the newer search loading state or replace its results', async ({ page }) => {
    await setup(page)

    let releaseOldPage!: () => void
    let releaseNewSearch!: () => void
    let oldPageStarted!: () => void
    let newSearchStarted!: () => void
    const oldPageGate = new Promise<void>((resolve) => { releaseOldPage = resolve })
    const newSearchGate = new Promise<void>((resolve) => { releaseNewSearch = resolve })
    const oldStarted = new Promise<void>((resolve) => { oldPageStarted = resolve })
    const newStarted = new Promise<void>((resolve) => { newSearchStarted = resolve })
    const firstPage = Array.from({ length: 150 }, (_, i) => row(1000 + i, `نتيجة قديمة ${i + 1}`, 'الملك فيصل', `شارع ${i + 1}`, 24.63, 46.71))
    const oldTail = row(1999, 'نتيجة قديمة متأخرة', 'الملك فيصل', 'شارع متأخر', 24.63, 46.71)
    const currentRow = row(2999, 'نتيجة البحث الجديد', 'العليا', 'شارع العليا', 24.66, 46.72)

    // Registered after setup, so this route deterministically controls only the three search calls.
    await page.route('**/_targeting/search', async (route) => {
      const body = route.request().postDataJSON() as { q: string; offset?: number; objective?: string }
      if (body.q === 'بحث قديم' && (body.offset || 0) === 0 && body.objective !== 'marketing') {
        return route.fulfill({ json: { total: 151, rows: firstPage, next_offset: 150, has_more: true, parsed: { keywords: ['بحث قديم'] }, areas: AREAS, understood: {} } })
      }
      if (body.q === 'بحث قديم' && (body.offset || 0) > 0) {
        oldPageStarted()
        await oldPageGate
        return route.fulfill({ json: { total: 151, rows: [oldTail], next_offset: null, has_more: false, parsed: { keywords: ['بحث قديم'] }, areas: AREAS, understood: {} } })
      }
      if (body.q === 'بحث قديم' && body.objective === 'marketing') {
        newSearchStarted()
        await newSearchGate
        return route.fulfill({ json: { total: 1, rows: [currentRow], next_offset: null, has_more: false, parsed: { keywords: ['بحث جديد'] }, areas: AREAS, understood: {} } })
      }
      return route.fallback()
    })

    await page.goto('/opportunity-map')
    await searchFor(page, 'بحث قديم')
    await expect(page.locator('li[data-key]')).toHaveCount(150)
    await page.getByRole('button', { name: /حمّل .* أكثر/ }).click()
    await oldStarted

    // Changing direction starts a new search while the pagination request is still pending.
    await page.getByRole('tab', { name: 'ابحث عن مشترين' }).click()
    await newStarted

    // Completing the old request while the new one is pending must not unlock its submit button.
    releaseOldPage()
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    releaseNewSearch()

    await expect(page.locator('li[data-key]')).toHaveCount(1)
    await expect(page.getByText('نتيجة البحث الجديد')).toBeVisible()
    await expect(page.getByText('نتيجة قديمة متأخرة')).toHaveCount(0)
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  test('«جملة» ranks only, districts, counters, layers, guide, filters, drawer without contacts', async ({ page }) => {
    const { writes, searches } = await setup(page)
    await page.goto('/targeting') // old link → /opportunity-map
    await expect(page).toHaveURL(/\/opportunity-map$/)
    await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('Riyadh') // Riyadh by default, nothing remembered
    await expect(page.getByRole('tab', { name: 'افهم السوق' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'ابحث عن موردين' }).click()
    await searchFor(page, 'جملة مواد نظافة')
    // «جملة» in the request: no auto filter, every result kept, the chip stays available with its count
    expect(searches[0].filters).toEqual({})
    await expect(page.getByRole('button', { name: 'جملة فقط · 2', exact: true })).toHaveAttribute('aria-pressed', 'false')
    expect(searches.length).toBe(1) // no «retry with wholesale»
    // before a district: no pins, the hint, every result listed; counters over all results
    await expect(page.getByTestId('map-hint')).toHaveText(/الخطوط الخضراء أكثف الشوارع، والأحياء الأغمق فيها منشآت أكثر/)
    await expect(page.locator('[data-pin]')).toHaveCount(0)
    await expect(counter(page, 'n')).toHaveText('6')
    await expect(page.locator('li[data-key]')).toHaveCount(6)
    await expect(page.locator('li[data-key="5"]')).toContainText('موقع تقريبي')
    // badges on the rows: roles and specialties
    await expect(page.locator('li[data-key="1"] [data-testid="row-badges"]')).toContainText('جملة')
    await expect(page.locator('li[data-key="1"] [data-testid="row-badges"]')).toContainText('مواسير وتمديدات')
    await expect(page.locator('li[data-key="4"] [data-testid="row-badges"]')).not.toContainText('جملة') // explicit place flag overrides the family role hint
    // the digits in a business name are never shown
    await expect(page.locator('li[data-key="1"]')).not.toContainText('0551234567')
    // choose a district on the map → its pins and the counters
    await pickDistrict(page, 'الملك فيصل')
    await expect(page.getByRole('button', { name: 'حي الملك فيصل' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('map-hint')).toHaveCount(0)
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2)
    const linkedResult = page.locator('li[data-key="1"]')
    await linkedResult.hover()
    await expect(page.locator('[data-pin-key="1"]')).toHaveAttribute('data-highlighted', 'true')
    await page.locator('h1').hover()
    await expect(page.locator('[data-pin-key="1"]')).not.toHaveAttribute('data-highlighted', 'true')
    await linkedResult.getByRole('button').focus()
    await expect(page.locator('[data-pin-key="1"]')).toHaveAttribute('data-highlighted', 'true')
    await expect(counter(page, 'n')).toHaveText('2')
    await expect(counter(page, 'districts')).toHaveText('1')
    await expect(counter(page, 'supplier-whatsapp')).toHaveText('2')
    await expect(counter(page, 'supplier-located')).toHaveText('2')
    // Choosing another district replaces the first and keeps results scoped to one area.
    await pickDistrict(page, 'العليا')
    await expect(page.getByRole('button', { name: 'حي العليا' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2)
    await expect(counter(page, 'n')).toHaveText('3')
    await page.screenshot({ path: `${SHOTS}/desktop-1-districts.png` })
    // map depth follows the selected category; users do not switch layers manually
    await expect(page.getByRole('radiogroup', { name: 'طبقة الخريطة' })).toHaveCount(0)
    // Clear the district and restore the full city result set.
    await page.getByRole('button', { name: 'عرض كل الأحياء' }).click()
    await expect(counter(page, 'districts')).toHaveText('3')
    await expect(counter(page, 'n')).toHaveText('6')
    // guide tree: main ▸ sub ▸ specialty; a pick filters and switches the layer
    await page.getByRole('tab', { name: 'الدليل' }).click()
    await page.getByRole('button', { name: /^مقاولات وخدمات إنشائية/ }).click()
    await expect(page.getByText(/^النشاط الرئيسي:/)).toBeVisible()
    await expect(page.locator('[data-pin="main"]')).toHaveCount(1)
    await page.getByRole('button', { name: /^مواد بناء وتشطيب \(بيع\)/ }).click()
    await page.getByRole('button', { name: 'أدوات صحية وسباكة 5', exact: true }).click()
    await expect(page.getByText(/^النشاط الفرعي:/)).toBeVisible()
    await expect(page.locator('[data-specialty-icon="droplet"]')).toHaveCount(2)
    await page.getByRole('button', { name: 'خلاطات 2', exact: true }).click()
    await expect(page.getByText(/^التخصص:/)).toBeVisible()
    await expect(page.locator('[data-pin="spec"]')).toHaveCount(2)
    await page.screenshot({ path: `${SHOTS}/desktop-3-guide.png` })
    await page.getByRole('button', { name: 'خلاطات 2', exact: true }).click() // second tap clears
    await page.getByRole('tab', { name: /النتائج/ }).click()
    await expect(page.locator('[data-pin]')).toHaveCount(0)
    // role and specialty filters re-run the search
    await chooseFilter(page, 'الدور', 'مصنع (1)')
    await expect.poll(() => searches.length).toBe(5)
    expect(searches[4].filters).toEqual({ role: 'مصنع' })
    await expect(page.getByRole('button', { name: 'الدور: مصنع', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'إزالة الدور: مصنع' }).click()
    await expect.poll(() => searches.length).toBe(6)
    expect(searches[5].filters).toEqual({})
    await chooseFilter(page, 'التخصص', 'خلاطات (2)')
    await expect.poll(() => searches.length).toBe(7)
    expect(searches[6].filters).toEqual({ specialty: 'خلاطات' })
    await page.getByRole('button', { name: 'إزالة التخصص: خلاطات' }).click()
    await expect.poll(() => searches.length).toBe(8)
    // «جملة فقط» only when pressed
    await page.getByRole('button', { name: 'جملة فقط · 2', exact: true }).click()
    await expect.poll(() => searches.length).toBe(9)
    expect(searches[8].filters).toEqual({ wholesale: true })
    await page.getByRole('button', { name: 'جملة فقط · 2', exact: true }).click()
    await expect.poll(() => searches.length).toBe(10)
    // profile drawer from a row: path, roles, specialties, place, rating, completeness, sources, channel; no contact at all
    await page.locator('li[data-key="1"]').getByRole('button').first().click()
    const drawer = page.getByTestId('profile-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('heading', { name: 'مؤسسة الأنابيب الحديثة' })).toBeVisible()
    await expect(drawer).toContainText('مواد بناء وتشطيب (بيع) ▸ أدوات صحية وسباكة')
    for (const t of ['يبيع', 'جملة', 'مواسير وتمديدات', 'خلاطات', 'الملك فيصل', 'شارع خالد بن الوليد', '4.4 من 5', '82٪', '3 مصادر', 'منشأة سعودية', 'واتساب متاح عبر فرق']) await expect(drawer).toContainText(t)
    const text = await drawer.innerText()
    expect(text).not.toMatch(/\d{7,}|@|9665|0551234567|example\.com|هاتف|جوال|بريد|إيميل/)
    await expect(drawer.locator('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/desktop-4-profile.png` })
    await drawer.getByRole('button', { name: 'إغلاق ملف المنشأة' }).click()
    // no WhatsApp yet / approximate location
    await page.locator('li[data-key="6"]').getByRole('button').first().click()
    await expect(page.getByTestId('profile-drawer')).toContainText('لا توجد قناة واتساب بعد')
    await page.locator('li[data-key="5"]').getByRole('button').first().click()
    await expect(page.getByTestId('profile-drawer')).toContainText('موقع تقريبي')
    expect(await page.getByTestId('profile-drawer').innerText()).not.toMatch(/\d{7,}|@/)
    // a map pin opens the drawer too
    await page.getByTestId('profile-drawer').getByRole('button', { name: 'إغلاق ملف المنشأة' }).click()
    await pickDistrict(page, 'الفيصلية')
    await page.locator('[data-pin]').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('profile-drawer').getByRole('heading', { name: 'سباكة الخليج' })).toBeVisible()
    expect(writes).toEqual([])
    await nothingStored(page)
  })

  test('dense streets on open, activity picker, districts narrow them, then the request', async ({ page }) => {
    const { searches, writes, densities, catalogs } = await setup(page)
    await page.goto('/opportunity-map')
    // on open: the densest streets of ALL activities in the city, no search needed
    await expect(page.getByRole('heading', { name: 'أكثر الشوارع كثافة في الرياض' })).toBeVisible()
    await expect(page.locator('[data-street]')).toHaveCount(4)
    expect(densities[0]).toEqual({ city: 'Riyadh' })
    expect(catalogs[0]).toEqual({ city: 'Riyadh' })
    await expect(page.getByTestId('map-hint')).toContainText('الخطوط الخضراء أكثف الشوارع')
    // Market discovery has its own browse guidance and does not show the supplier journey strip.
    await expect(page.getByTestId('map-steps')).toHaveCount(0)
    await expect(page.getByTestId('map-legend')).toContainText('تجمع تجاري · عدد المنشآت')
    // Show a compact district point on open; the street cluster covered by a density line is deduplicated.
    await expect(page.locator('[data-interest="district"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^أدوات صحية وسباكة — الفيصلية/ })).toBeVisible()
    await expect(page.getByTestId('map-legend')).toContainText('شارع كثيف بهذا النشاط')
    const list = page.getByTestId('dense-streets')
    await expect(list.getByRole('button').first()).toContainText('شارع خالد بن الوليد · الملك فيصل · أدوات صحية وسباكة — 37 منشأة')
    await page.screenshot({ path: `${SHOTS4}/desktop-1-open.png` })
    // the activity picker: a main, then its sub, then «الكل»
    await pickStreetMain(page, MAIN_ELEC)
    await expect.poll(() => densities.at(-1)).toEqual({ city: 'Riyadh', main_id: 'elec' })
    await expect(page.locator('[data-street]')).toHaveCount(1)
    await page.getByRole('group', { name: 'الأنشطة الفرعية وعدد الشوارع لكل نشاط' }).getByRole('button', { name: /إنارة · 1 شارع/ }).click()
    await expect.poll(() => densities.at(-1)).toEqual({ city: 'Riyadh', sub_ids: ['elec.lighting'] })
    await expect(list.getByRole('button').first()).toContainText('يوسف بن عبدالعزيز · العليا · إنارة — 26 منشأة')
    await clearStreetActivity(page)
    await expect(page.locator('[data-street]')).toHaveCount(4)
    // districts narrow the streets and the catalog
    await pickDistrict(page, 'العليا')
    await expect.poll(() => densities.at(-1)).toEqual({ city: 'Riyadh', districts: ['العليا'] })
    await expect.poll(() => catalogs.at(-1)).toEqual({ city: 'Riyadh', districts: ['العليا'] })
    await expect(page.getByRole('heading', { name: 'أكثر الشوارع كثافة في العليا' })).toBeVisible()
    await expect(page.locator('[data-street]')).toHaveCount(2)
    await pickDistrict(page, 'الملك فيصل')
    await expect(page.getByRole('heading', { name: 'أكثر الشوارع كثافة في الملك فيصل' })).toBeVisible()
    await expect(page.locator('[data-street]')).toHaveCount(1)
    await page.screenshot({ path: `${SHOTS4}/desktop-2-districts.png` })
    await page.getByRole('button', { name: 'عرض كل الأحياء' }).click()
    await expect(page.locator('[data-street]')).toHaveCount(4)
    // the request: its own dense streets, the districts tinted by density, no pins yet
    await searchFor(page, 'أدوات صحية')
    await expect.poll(() => densities.at(-1)).toEqual({ city: 'Riyadh', q: 'أدوات صحية', objective: 'purchase' })
    await expect(page.locator('[data-street]')).toHaveCount(3)
    await expect(page.getByText('الشوارع حسب طلبك: «أدوات صحية»')).toBeVisible()
    await expect(page.getByTestId('map-steps').locator('[aria-current="step"]')).toContainText('اختر الحي أو الشارع')
    await expect(page.locator('[data-pin]')).toHaveCount(0)
    await expect(page.locator('path[data-district="العليا"]')).toHaveAttribute('data-density', '4')
    await expect(page.getByRole('group', { name: 'أكثر الأحياء' }).getByRole('button', { name: /العليا · 3/ })).toBeVisible()
    // a line on the map: zoom, its district chosen, results narrowed, its card
    const l = page.locator('[data-street="طريق العليا العام"]')
    await l.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({ street: 'طريق العليا العام' })
    await expect(page.getByRole('button', { name: /^حي العليا/ })).toHaveAttribute('aria-pressed', 'true')
    const card = page.getByTestId('street-card')
    for (const t of ['طريق العليا العام', `العليا · ${MAIN_BUILD} ▸ أدوات صحية وسباكة`, '31 منشأة', '1٫3 كم', '2٫4 منشأة لكل 100 م', '1 منشأة']) await expect(card).toContainText(t)
    await expect(page.getByTestId('map-steps').locator('[aria-current="step"]')).toContainText('راجع المنشآت وتواصل')
    await page.screenshot({ path: `${SHOTS4}/desktop-3-street-picked.png` })
    await page.getByRole('button', { name: 'إغلاق بطاقة الشارع' }).click()
    await expect.poll(() => searches.length).toBe(3)
    expect(searches[2].filters).toEqual({})
    await expect(page.getByTestId('street-card')).toHaveCount(0)
    // from the list, after clearing the districts
    await page.getByRole('button', { name: 'عرض كل الأحياء' }).click()
    await list.getByRole('button', { name: /شارع الأمير مشعل/ }).click()
    await expect.poll(() => searches.length).toBe(5)
    expect(searches[4].filters).toEqual({ street: 'شارع الأمير مشعل' })
    await expect(page.getByTestId('street-card')).toContainText('9٫5 منشأة لكل 100 م')
    await expect(page.locator('[data-pin]')).toHaveCount(1)
    await page.getByRole('checkbox', { name: /اختر سباكة الخليج/ }).check()
    await expect(page.getByTestId('map-steps').locator('[aria-current="step"]')).toContainText('راجع المنشآت وتواصل')
    expect(writes).toEqual([])
    await nothingStored(page)
  })

  test('a street picked before any search stays the active scope for market category filters', async ({ page }) => {
    const { searches, searchRequests, marketQueries } = await setup(page)
    await page.goto('/opportunity-map')
    const street = page.locator('[data-street="يوسف بن عبدالعزيز"]')
    await street.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => searches.length).toBe(1)
    expect(searches[0]).toMatchObject({ q: 'إنارة', filters: { street: 'يوسف بن عبدالعزيز' } })
    await expect(page.getByTestId('street-card')).toContainText('26 منشأة')
    await expect(page.locator('[data-street]')).toHaveCount(1) // the street filter keeps the selected street only
    await expect(page.getByRole('heading', { name: 'أكثر الشوارع كثافة في يوسف بن عبدالعزيز' })).toBeVisible()
    await expect(page.locator('#map-scope-street')).toHaveAttribute('data-active', 'true')
    await expect(page.getByRole('button', { name: 'حي العليا' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('tab', { name: 'افهم السوق' }).click()
    await page.getByRole('button', { name: /تفصيل التصنيفات الرئيسية/ }).click()
    await page.locator('[data-counter="market-main-build"]').click()
    await expect.poll(() => marketQueries.some((query) => query.main_id === 'build' && JSON.stringify(query).includes('العليا'))).toBe(true)
    await expect(searchRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ q: '', filters: expect.objectContaining({ district: 'العليا', street: 'يوسف بن عبدالعزيز' }) }),
    ]))
  })

  test('counters animate to the new value', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await expect(counter(page, 'n')).toHaveText('6')
    await pickDistrict(page, 'الملك فيصل')
    // mid-way the number is between 6 and 2, then it settles (≤ 700 ms)
    await expect(counter(page, 'n')).toHaveText('2', { timeout: 2000 })
    await expect(page.locator('[data-counter="supplier-matches"]')).toContainText('موردون محتملون')
  })

  test('campaign tray: hidden until a choice, under the map, send now unchanged, schedule says قريباً on 404', async ({ page }) => {
    const { writes, schedules } = await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await expect(page.getByTestId('campaign-tray')).toHaveCount(0)
    await page.getByRole('checkbox', { name: /اختر مؤسسة الأنابيب الحديثة/ }).check()
    await page.getByRole('checkbox', { name: /اختر مستودع السباكة الكبير/ }).check()
    const tray = page.getByTestId('campaign-tray')
    await expect(tray).toBeVisible()
    await expect(tray).toContainText('اخترت 2 منشأة')
    await expect(tray.getByRole('img', { name: 'ريال' })).toBeVisible()
    await expect(tray.getByLabel('نص الرسالة')).toHaveCount(0) // collapsed
    // never over the map
    const map = await page.getByRole('region', { name: 'خريطة الفرص' }).boundingBox()
    let box = await tray.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(map!.y + map!.height - 1)
    await page.screenshot({ path: `${SHOTS}/desktop-5-tray-collapsed.png` })
    await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
    box = await tray.boundingBox()
    const map2 = await page.getByRole('region', { name: 'خريطة الفرص' }).boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(map2!.y + map2!.height - 1)
    const tpl = tray.getByLabel('القالب (المعتمدة من ميتا)')
    await expect(tpl.locator('option[value="order_update"]')).toHaveAttribute('disabled', '')
    await expect(tpl.locator('option[value="logo_offer"]')).toHaveAttribute('disabled', '')
    await tpl.selectOption('monthly_offer')
    await expect(tray.getByText(/معاينة: هلا \{اسم المنشأة\}، عندنا عرض الشهر/)).toBeVisible()
    await expect(tray.getByTestId('send-timing')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-6-tray-open.png` })
    // send now → the same review sheet as before; sending is closed in this environment
    await tray.getByRole('button', { name: 'أرسل الحملة' }).click()
    const review = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
    await expect(review.getByText('الإرسال غير مفعّل')).toBeVisible()
    await review.getByRole('button', { name: 'احفظ الحملة كمسودة' }).click()
    await expect(page.getByText(/الحملة محفوظة كمسودة في هذه الصفحة/)).toBeVisible()
    // schedule: a default time in Saudi time, then 404 → «الجدولة قريباً» and only that option off
    await tray.getByText('جدولة', { exact: true }).click()
    await expect(tray.getByLabel('موعد الإرسال (بتوقيت السعودية)')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/)
    await tray.getByRole('button', { name: 'جدول الحملة' }).click()
    await expect(tray.getByText('الجدولة قريباً. تقدر ترسل الآن.')).toBeVisible()
    await expect(tray.getByRole('radio', { name: 'جدولة' })).toBeDisabled()
    await expect(tray.getByRole('radio', { name: 'إرسال الآن' })).toBeChecked()
    await expect(tray.getByRole('button', { name: 'أرسل الحملة' })).toBeEnabled()
    expect(schedules).toHaveLength(1)
    expect(schedules[0]).toMatchObject({ keys: ['1', '2'], template: 'monthly_offer' })
    expect(String(schedules[0].message)).toContain('معك أحمد من فرق')
    expect(String(schedules[0].send_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
    await page.screenshot({ path: `${SHOTS}/desktop-7-schedule-soon.png` })
    // clearing the choice hides the tray
    await tray.getByRole('button', { name: 'إلغاء التحديد' }).click()
    await expect(page.getByTestId('campaign-tray')).toHaveCount(0)
    expect(writes).toEqual([])
    await nothingStored(page)
  })

  test('schedule accepted by the server', async ({ page }) => {
    const { schedules } = await setup(page, { schedule: 200 })
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 9, 18, 6, 0))) // Sunday 09:00 Saudi time
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await page.getByRole('checkbox', { name: /اختر سباكة الخليج/ }).check()
    const tray = page.getByTestId('campaign-tray')
    await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
    await tray.getByText('جدولة', { exact: true }).click()
    // the next allowed slot: 09:15 (Dhuhr is later), Sunday
    await expect(tray.getByLabel('موعد الإرسال (بتوقيت السعودية)')).toHaveValue('2026-10-18T09:15')
    await tray.getByLabel('موعد الإرسال (بتوقيت السعودية)').fill('2026-10-18T10:30')
    await tray.getByRole('button', { name: 'جدول الحملة' }).click()
    await expect(page.getByText(/جدولنا الحملة لـ 1 منشأة/)).toBeVisible()
    expect(schedules[0]).toMatchObject({ keys: ['3'], send_at: '2026-10-18T07:30:00.000Z' })
  })

  test('trade clusters (no street lines for this request) and the project site radius', async ({ page }) => {
    const { searches } = await setup(page, { streets: 'none' })
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await expect(page.getByText('تجمعات هذا النشاط')).toBeVisible()
    // a street cluster: district + street filter, and its district chosen on the map
    await page.getByRole('button', { name: /^شارع خالد بن الوليد، الملك فيصل — 37 منشأة/ }).click()
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({ district: 'الملك فيصل', street: 'شارع خالد بن الوليد' })
    await expect(page.getByRole('button', { name: 'حي الملك فيصل' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'إزالة الحي: الملك فيصل' }).click()
    await expect.poll(() => searches.length).toBe(3)
    expect(searches[2].filters).toEqual({})
    // the site: a tap on the map places it, the radius narrows the cohort
    await pickDistrict(page, 'الفيصلية')
    await expect(counter(page, 'n')).toHaveText('1')
    await page.getByRole('button', { name: 'موقع المشروع' }).click()
    const map = page.getByRole('application')
    const b = (await map.boundingBox())!
    await map.click({ position: { x: b.width - 40, y: b.height / 2 } })
    const radius = page.getByRole('button', { name: 'نطاق التوصيل · 10 كم', exact: true })
    await expect(radius).toBeVisible()
    await radius.click()
    await page.getByRole('button', { name: '100 كم', exact: true }).click()
    await expect(counter(page, 'n')).toHaveText('1')
    await page.getByRole('button', { name: 'إزالة موقع المشروع' }).click()
    await expect(page.getByRole('button', { name: 'موقع المشروع' })).toBeVisible()
  })

  test('a city without polygons: district chips from the search answer', async ({ page }) => {
    await setup(page, { districts: 'none' })
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    const chips = page.getByRole('group', { name: 'الأحياء', exact: true })
    await expect(chips.getByRole('button', { name: /العليا · 3/ })).toBeVisible()
    await chips.getByRole('button', { name: /الملك فيصل · 2/ }).click()
    await expect(counter(page, 'n')).toHaveText('2')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2) // pins by district name, framed on the rows
  })

  test('«طلب جديد», «طلباتي» with audit, selling flow', async ({ page }) => {
    const { writes, searches, saved, orgHeaders, listQueries } = await setup(page)
    await page.goto('/opportunity-map')
    await openMyRequests(page)
    await expect(page.getByRole('listitem').filter({ hasText: 'مواسير PPR — الرياض' }).getByText(/2026.* · 3 جمادى الأولى 1448 هـ/)).toBeVisible()
    await page.getByRole('button', { name: 'إلغاء الطلب', exact: true }).first().click()
    await page.getByLabel('السبب (اختياري)').fill('تغيّرت الكمية')
    await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click()
    await expect(page.getByText('ملغي').first()).toBeVisible()
    const r2 = page.getByRole('listitem').filter({ hasText: 'مشترين لخلاطات المغاسل' })
    await expect(r2.getByRole('button', { name: 'إظهار' })).toHaveCount(0)
    expect(listQueries[0]).toBe('?hidden=include&archived=include')
    expect(orgHeaders.every((h) => h === 'org-1')).toBe(true)
    await page.getByRole('button', { name: 'السجل', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: /السجل/ })).toContainText('السبب: تغيّرت الكمية')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    let sheet = page.getByRole('dialog', { name: 'وش هدفك؟', exact: true })
    await sheet.getByRole('button', { name: /بحث حر عن مورد/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'ابحث عن موردين' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('وش تبي توصل له؟')).toBeFocused()
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    sheet = page.getByRole('dialog', { name: 'وش هدفك؟', exact: true })
    await sheet.getByRole('button', { name: 'أبحث عن مشتري', exact: true }).click()
    await sheet.getByRole('button', { name: /أضف منتجاتك/ }).click()
    await page.getByPlaceholder(/مواسير PPR/).fill('مواسير PPR\nخلاطات مغاسل\nسخانات')
    await page.getByRole('button', { name: 'اقترح التخصصات' }).click()
    await page.getByRole('button', { name: 'سخانات مياه', exact: true }).click()
    await page.getByRole('button', { name: 'ابحث عن مشترين (2)' }).click()
    await expect.poll(() => searches.length).toBe(1)
    expect(searches[0]).toMatchObject({ q: 'مواسير وتمديدات', objective: 'marketing' })
    await expect(page.getByRole('tab', { name: 'ابحث عن مشترين' })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toMatchObject({ kind: 'SELLER_PRODUCTS', payload: { city: 'الرياض', products: ['مواسير وتمديدات', 'خلاطات وأدوات صحية'] } })
    expect(writes).toEqual([])
  })

  test('«طلب جديد» in the sidebar opens the start sheet; «طلباتي» says قريباً when the API is off', async ({ page }) => {
    await setup(page, { requestsOff: true })
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    await expect(page).toHaveURL(/\/opportunity-map\/new$/)
    await expect(page.getByRole('dialog', { name: 'وش هدفك؟', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'إغلاق' }).click()
    await expect(page).toHaveURL(/\/opportunity-map$/)
    await openMyRequests(page)
    await expect(page.getByText(/قريباً: تتابع هنا طلباتك/)).toBeVisible()
  })
})

test.describe('desktop 1440 viewer', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })
  test('VIEWER reads «طلباتي» and its audit but has no actions', async ({ page }) => {
    await setup(page, { role: 'VIEWER' })
    await page.goto('/opportunity-map')
    await openMyRequests(page)
    await expect(page.getByText('صلاحيتك مشاهدة فقط.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'السجل', exact: true }).first()).toBeVisible()
    for (const name of ['إلغاء الطلب', 'إخفاء', 'إظهار', 'أرشفة', 'استرجاع']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  })
})

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })

  test('counters, map, district, drawer sheet, tray', async ({ page }) => {
    const { writes } = await setup(page)
    await page.goto('/opportunity-map')
    await expect(page.getByTestId('map-steps')).toHaveCount(0)
    // the map gets most of the screen; the sheet opens on the dense streets, not on the results
    const mapBox = (await page.getByRole('region', { name: 'خريطة الفرص' }).boundingBox())!
    expect(mapBox.height).toBeGreaterThanOrEqual(400)
    await expect(page.getByRole('tab', { name: 'الشوارع' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('dense-streets').getByRole('button')).toHaveCount(4)
    await expect(page.locator('[data-street]')).toHaveCount(4)
    await page.screenshot({ path: `${SHOTS4}/mobile-1-open.png` })
    await page.getByTestId('dense-streets').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS4}/mobile-2-streets-list.png` })
    await pickStreetMain(page, MAIN_ELEC)
    await expect(page.locator('[data-street]')).toHaveCount(1)
    await page.getByTestId('street-picker').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS4}/mobile-3-activity.png` })
    await clearStreetActivity(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${SHOTS}/mobile-1-start.png` })
    await page.screenshot({ path: `${SHOTS3}/mobile-1-start.png` })
    await searchFor(page, 'جملة أدوات صحية')
    await expect(page.getByRole('button', { name: 'جملة فقط · 2', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(counter(page, 'n')).toHaveText('6')
    await expect(page.getByTestId('map-steps')).toHaveText(/الخطوة 2 من 3/)
    await expect(page.locator('[data-street]')).toHaveCount(3)
    await page.screenshot({ path: `${SHOTS3}/mobile-2-dense-streets.png` })
    await pickDistrict(page, 'الملك فيصل')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2)
    await page.screenshot({ path: `${SHOTS3}/mobile-3-district.png` })
    await expect(counter(page, 'n')).toHaveText('2')
    await page.screenshot({ path: `${SHOTS}/mobile-2-district.png` })
    await page.screenshot({ path: `${SHOTS4}/mobile-4-district.png` })
    await page.getByRole('tab', { name: /النتائج/ }).click()
    await page.locator('li[data-key="1"]').getByRole('button').first().click()
    const drawer = page.getByTestId('profile-drawer')
    await expect(drawer).toContainText('واتساب متاح عبر فرق')
    expect(await drawer.innerText()).not.toMatch(/\d{7,}|@/)
    await page.screenshot({ path: `${SHOTS}/mobile-3-profile.png` })
    await drawer.getByRole('button', { name: 'أضف للحملة' }).click()
    await drawer.getByRole('button', { name: 'إغلاق ملف المنشأة' }).click()
    const tray = page.getByTestId('campaign-tray')
    await expect(tray).toContainText('اخترت 1 منشأة')
    // the tray sits in the page flow right under the map, never on top of it
    await tray.scrollIntoViewIfNeeded()
    const map = (await page.getByRole('region', { name: 'خريطة الفرص' }).boundingBox())!
    const t = (await tray.boundingBox())!
    expect(t.y).toBeGreaterThanOrEqual(map.y + map.height - 1)
    await page.screenshot({ path: `${SHOTS}/mobile-4-tray.png` })
    await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
    await expect(tray.getByLabel('نص الرسالة')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-5-tray-open.png` })
    expect(writes).toEqual([])
    await nothingStored(page)
  })

  test('search filters wrap into the viewport and remain reachable without horizontal page overflow', async ({ page }) => {
    await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')

    const filters = page.getByRole('group', { name: 'تضييق النتائج' })
    await filters.scrollIntoViewIfNeeded()
    await expect(filters).toBeVisible()
    const geometry = await filters.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
    await expect(filters.locator('button[aria-haspopup="true"]')).toHaveCount(4)
    for (const control of await filters.locator('button[aria-haspopup="true"]').all()) {
      await expect(control).toBeVisible()
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(391)
    }
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(pageWidth).toBeLessThanOrEqual(391)
  })
})

test.describe('map responsive edge cases', () => {
  test('filter controls fit the narrow desktop browser pane without horizontal page scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 682, height: 965 })
    await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')

    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1)
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1)
  })

  test('malformed district objects never leak into filters, result cards, or the profile', async ({ page }) => {
    await setup(page, { malformedDistrict: true })
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')

    const rawDistrict = '{"id": null, "name_ar": null, "name_en": null}'
    await expect(page.getByRole('group', { name: 'تضييق النتائج' })).not.toContainText(rawDistrict)
    const malformedRow = page.locator('li[data-key="7"]')
    await expect(malformedRow).toBeVisible()
    await expect(malformedRow).not.toContainText(rawDistrict)
    await malformedRow.getByRole('button').click()
    await expect(page.getByTestId('profile-drawer')).not.toContainText(rawDistrict)
  })
})
