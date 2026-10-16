import { expect, test, type Page } from '@playwright/test'

/*
 * خريطة الفرص v2 (owner-approved redesign 2026-10-16): live counters, three layers, district selection (GET /districts,
 * mocked), the guide tree, role / specialty / wholesale filters («جملة» in the request never narrows), trade clusters,
 * the business profile drawer (never a contact field), the campaign tray (hidden until a choice, never over the map,
 * send now / schedule), «طلب جديد», «طلباتي» and its audit. Every response is mocked in the browser: nothing leaves
 * the machine and no write may reach a send path. Nothing may be stored on the device.
 */
const SHOTS = 'docs/qa/opportunity-map-v2'
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
  row(4, 'أدوات صحية النخبة', 'العليا', 'شارع الحسن بن علي', 24.660, 46.720, { role_badges: ['يبيع', 'تجزئة'] }),
  row(5, 'معرض الماء الصافي', 'العليا', 'طريق العليا العام', null, null),
  row(6, 'مركز الخلاطات', 'العليا', 'طريق العليا العام', 24.670, 46.750, { specialties: ['خلاطات'], phone: null, has_whatsapp: false, email: null }),
]
const rect = (id: number, ar: string, w: number, s: number, e: number, n: number) => ({ type: 'Feature', properties: { id, ar, en: ar, city_en: 'Riyadh' }, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } })
const DISTRICTS = { type: 'FeatureCollection', features: [rect(11, 'الملك فيصل', 46.70, 24.62, 46.73, 24.65), rect(12, 'الفيصلية', 46.73, 24.62, 46.76, 24.65), rect(13, 'العليا', 46.70, 24.65, 46.76, 24.68)] }
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

async function setup(page: Page, opts: { requestsOff?: boolean; role?: string; districts?: 'ok' | 'none'; schedule?: 404 | 200; send?: boolean } = {}) {
  const writes: string[] = []
  const saved: Record<string, unknown>[] = []
  const searches: Record<string, unknown>[] = []
  const schedules: Record<string, unknown>[] = []
  const orgHeaders: (string | undefined)[] = []
  const listQueries: string[] = []
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__FARQ_QA_SESSION__ = { accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }
  })
  await page.route('**/_targeting/**', async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/districts')) {
      expect(url.searchParams.get('city')).toBe('Riyadh')
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
      const body = route.request().postDataJSON(); searches.push(body)
      const f = body.filters || {}
      const rows = ALL.filter((r) => (!f.wholesale || r.is_wholesale) && (!f.district || r.district_ar === f.district) && (!f.street || r.street_ar.includes(f.street)) && (!f.role || (r.role_badges as string[]).includes(f.role)) && (!f.specialty || (r.specialties as string[]).includes(f.specialty)))
      return route.fulfill({ json: { total: rows.length, rows, parsed: { keywords: ['أدوات صحية'] }, areas: AREAS, understood: { wholesale: /جمل/.test(body.q), sub_ids: ['build.plumbing_supply'] } } })
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
  return { writes, searches, saved, schedules, orgHeaders, listQueries }
}

const counter = (page: Page, key: string) => page.locator(`[data-counter="${key}"] > span[aria-hidden]`)
async function searchFor(page: Page, text: string) {
  await page.getByLabel('وش تبي توصل له؟').fill(text)
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
}
/** A district on the drawn map, by keyboard (a cluster circle or a pin may sit on its centre). */
async function pickDistrict(page: Page, name: string) {
  const d = page.getByRole('button', { name: `حي ${name}` })
  await d.focus()
  await d.press('Enter')
}
async function nothingStored(page: Page) {
  const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, idb: (await indexedDB.databases?.() || []).length }))
  expect(stored).toEqual({ local: 0, session: 0, idb: 0 })
}

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })

  test('«جملة» ranks only, districts, counters, layers, guide, filters, drawer without contacts', async ({ page }) => {
    const { writes, searches } = await setup(page)
    await page.goto('/targeting') // old link → /opportunity-map
    await expect(page).toHaveURL(/\/opportunity-map$/)
    await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('Riyadh') // Riyadh by default, nothing remembered
    await expect(page.getByRole('radio', { name: 'بائعون — أبي أشتري' })).toBeChecked()
    await searchFor(page, 'جملة مواد نظافة')
    // «جملة» in the request: no auto filter, every result kept, the chip stays available with its count
    expect(searches[0].filters).toEqual({})
    await expect(page.getByRole('button', { name: 'جملة فقط · 2', exact: true })).toHaveAttribute('aria-pressed', 'false')
    expect(searches.length).toBe(1) // no «retry with wholesale»
    // before a district: no pins, the hint, every result listed; counters over all results
    await expect(page.getByText('اختر حياً لعرض محلاته')).toBeVisible()
    await expect(page.locator('[data-pin]')).toHaveCount(0)
    await expect(counter(page, 'n')).toHaveText('6')
    await expect(page.locator('li[data-key]')).toHaveCount(6)
    await expect(page.locator('li[data-key="5"]')).toContainText('موقع تقريبي')
    // badges on the rows: roles and specialties
    await expect(page.locator('li[data-key="1"] [data-testid="row-badges"]')).toContainText('جملة')
    await expect(page.locator('li[data-key="1"] [data-testid="row-badges"]')).toContainText('مواسير وتمديدات')
    // the digits in a business name are never shown
    await expect(page.locator('li[data-key="1"]')).not.toContainText('0551234567')
    // choose a district on the map → its pins and the counters
    await pickDistrict(page, 'الملك فيصل')
    await expect(page.getByRole('button', { name: 'حي الملك فيصل' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('اختر حياً لعرض محلاته')).toHaveCount(0)
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2)
    await expect(counter(page, 'n')).toHaveText('2')
    await expect(counter(page, 'districts')).toHaveText('1')
    await expect(counter(page, 'subs')).toHaveText('1')
    await expect(counter(page, 'specs')).toHaveText('2')
    await expect(counter(page, 'wholesale')).toHaveText('2')
    await expect(counter(page, 'factory')).toHaveText('1')
    await expect(counter(page, 'whatsapp')).toHaveText('2')
    await expect(counter(page, 'cr')).toHaveText('1')
    // multi-select: العليا adds 2 pins (row 5 has no point) and 3 rows
    await pickDistrict(page, 'العليا')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(4)
    await expect(counter(page, 'n')).toHaveText('5')
    await expect(counter(page, 'districts')).toHaveText('2')
    await page.screenshot({ path: `${SHOTS}/desktop-1-districts.png` })
    // layers, one at a time
    await page.getByRole('radio', { name: /الأنشطة الفرعية/ }).click()
    await expect(page.locator('[data-pin="sub"]')).toHaveCount(4)
    await expect(page.locator('[data-pin="main"]')).toHaveCount(0)
    await page.getByRole('radio', { name: /التخصصات/ }).click()
    await expect(page.locator('[data-pin="spec"]')).toHaveCount(3) // rows 1, 2, 6 have a specialty
    await expect(page.locator('[data-pin="spec"]').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-2-specialties-layer.png` })
    // «كل الأحياء» / «إزالة الكل»
    await page.getByRole('button', { name: 'كل الأحياء' }).click()
    await expect(counter(page, 'districts')).toHaveText('3')
    await expect(counter(page, 'n')).toHaveText('6')
    // guide tree: main ▸ sub ▸ specialty; a pick filters and switches the layer
    await page.getByRole('tab', { name: 'الدليل' }).click()
    await page.getByRole('button', { name: /^مقاولات وخدمات إنشائية/ }).click()
    await expect(page.getByRole('radio', { name: /الأنشطة الرئيسية/ })).toHaveAttribute('aria-checked', 'true')
    await expect(counter(page, 'n')).toHaveText('1')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(1)
    await page.getByRole('button', { name: /^مواد بناء وتشطيب \(بيع\)/ }).click()
    await page.getByRole('button', { name: 'أدوات صحية وسباكة 5', exact: true }).click()
    await expect(page.getByRole('radio', { name: /الأنشطة الفرعية/ })).toHaveAttribute('aria-checked', 'true')
    await expect(counter(page, 'n')).toHaveText('5')
    await page.getByRole('button', { name: 'خلاطات 2', exact: true }).click()
    await expect(page.getByRole('radio', { name: /التخصصات/ })).toHaveAttribute('aria-checked', 'true')
    await expect(counter(page, 'n')).toHaveText('2')
    await expect(page.locator('[data-pin="spec"]')).toHaveCount(2)
    await page.screenshot({ path: `${SHOTS}/desktop-3-guide.png` })
    await page.getByRole('button', { name: 'خلاطات 2', exact: true }).click() // second tap clears
    await expect(counter(page, 'n')).toHaveText('6')
    await page.getByRole('tab', { name: /النتائج/ }).click()
    await page.getByRole('button', { name: 'إزالة الكل' }).click()
    await expect(page.locator('[data-pin]')).toHaveCount(0)
    // role and specialty filters re-run the search
    await page.getByLabel('الدور', { exact: true }).selectOption('مصنع')
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({ role: 'مصنع' })
    await expect(page.getByRole('button', { name: 'الدور: مصنع', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'إزالة الدور: مصنع' }).click()
    await expect.poll(() => searches.length).toBe(3)
    expect(searches[2].filters).toEqual({})
    await page.getByLabel('التخصص', { exact: true }).selectOption('خلاطات')
    await expect.poll(() => searches.length).toBe(4)
    expect(searches[3].filters).toEqual({ specialty: 'خلاطات' })
    await page.getByRole('button', { name: 'إزالة التخصص: خلاطات' }).click()
    await expect.poll(() => searches.length).toBe(5)
    // «جملة فقط» only when pressed
    await page.getByRole('button', { name: 'جملة فقط · 2', exact: true }).click()
    await expect.poll(() => searches.length).toBe(6)
    expect(searches[5].filters).toEqual({ wholesale: true })
    await page.getByRole('button', { name: 'جملة فقط · 2', exact: true }).click()
    await expect.poll(() => searches.length).toBe(7)
    // profile drawer from a row: path, roles, specialties, place, rating, completeness, sources, channel; no contact at all
    await page.locator('li[data-key="1"]').getByRole('button').first().click()
    const drawer = page.getByTestId('profile-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('heading', { name: 'مؤسسة الأنابيب الحديثة' })).toBeVisible()
    await expect(drawer).toContainText('مواد بناء وتشطيب (بيع) ▸ أدوات صحية وسباكة')
    for (const t of ['يبيع', 'جملة', 'مواسير وتمديدات', 'خلاطات', 'الملك فيصل', 'شارع خالد بن الوليد', '4.4 من 5', '82٪', '3 مصادر', 'منشأة سعودية', 'قناة واتساب متاحة للإرسال عبر فرق']) await expect(drawer).toContainText(t)
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

  test('counters animate to the new value', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await expect(counter(page, 'n')).toHaveText('6')
    await pickDistrict(page, 'الملك فيصل')
    // mid-way the number is between 6 and 2, then it settles (≤ 700 ms)
    await expect(counter(page, 'n')).toHaveText('2', { timeout: 2000 })
    await expect(page.locator('[data-counter="n"]')).toContainText('المنشآت')
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

  test('trade clusters and the project site radius', async ({ page }) => {
    const { searches } = await setup(page)
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    await expect(page.getByText('تجمعات هذا النشاط')).toBeVisible()
    // a street cluster: district + street filter, and its district chosen on the map
    await page.getByRole('button', { name: /^شارع خالد بن الوليد، الملك فيصل — 37 محل/ }).click()
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({ district: 'الملك فيصل', street: 'شارع خالد بن الوليد' })
    await expect(page.getByRole('button', { name: 'حي الملك فيصل' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'إزالة الحي: الملك فيصل' }).click()
    await expect.poll(() => searches.length).toBe(3)
    expect(searches[2].filters).toEqual({})
    // the site: a tap on the map places it, the radius narrows the cohort
    await pickDistrict(page, 'الفيصلية')
    await expect(counter(page, 'n')).toHaveText('3')
    await page.getByRole('button', { name: 'موقع المشروع' }).click()
    const map = page.getByRole('application')
    const b = (await map.boundingBox())!
    await map.click({ position: { x: b.width - 40, y: b.height / 2 } })
    await expect(page.getByLabel('موقع المشروع · نطاق التوصيل')).toHaveValue('10')
    await page.getByLabel('موقع المشروع · نطاق التوصيل').selectOption('100')
    await expect(counter(page, 'n')).toHaveText('3')
    await page.getByRole('button', { name: 'إزالة موقع المشروع' }).click()
    await expect(page.getByRole('button', { name: 'موقع المشروع' })).toBeVisible()
  })

  test('a city without polygons: district chips from the search answer', async ({ page }) => {
    await setup(page, { districts: 'none' })
    await page.goto('/opportunity-map')
    await searchFor(page, 'أدوات صحية')
    const chips = page.getByRole('group', { name: 'الأحياء' })
    await expect(chips.getByRole('button', { name: /العليا · 3/ })).toBeVisible()
    await chips.getByRole('button', { name: /الملك فيصل · 2/ }).click()
    await expect(counter(page, 'n')).toHaveText('2')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2) // pins by district name, framed on the rows
  })

  test('«طلب جديد», «طلباتي» with audit, selling flow', async ({ page }) => {
    const { writes, searches, saved, orgHeaders, listQueries } = await setup(page)
    await page.goto('/opportunity-map')
    await page.getByText('طلباتي').click()
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
    const sheet = page.getByRole('dialog', { name: 'طلب جديد', exact: true })
    await expect(sheet.getByRole('button', { name: /طلب تسعير من الموردين/ })).toBeVisible()
    await sheet.getByRole('button', { name: /أبي أبيع منتجاتي/ }).click()
    await page.getByPlaceholder(/مواسير PPR/).fill('مواسير PPR\nخلاطات مغاسل\nسخانات')
    await page.getByRole('button', { name: 'اقترح التخصصات' }).click()
    await page.getByRole('button', { name: 'سخانات مياه', exact: true }).click()
    await page.getByRole('button', { name: 'ابحث عن مشترين (2)' }).click()
    await expect.poll(() => searches.length).toBe(1)
    expect(searches[0]).toMatchObject({ q: 'مواسير وتمديدات', objective: 'marketing' })
    await expect(page.getByRole('radio', { name: 'مشترون — أبي أبيع' })).toBeChecked()
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toMatchObject({ kind: 'SELLER_PRODUCTS', payload: { city: 'الرياض', products: ['مواسير وتمديدات', 'خلاطات وأدوات صحية'] } })
    expect(writes).toEqual([])
  })

  test('«طلب جديد» in the sidebar opens the start sheet; «طلباتي» says قريباً when the API is off', async ({ page }) => {
    await setup(page, { requestsOff: true })
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    await expect(page).toHaveURL(/\/opportunity-map\/new$/)
    await expect(page.getByRole('dialog', { name: 'طلب جديد', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'إغلاق' }).click()
    await expect(page).toHaveURL(/\/opportunity-map$/)
    await page.getByText('طلباتي').click()
    await expect(page.getByText(/قريباً: تتابع هنا طلباتك/)).toBeVisible()
  })
})

test.describe('desktop 1440 viewer', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })
  test('VIEWER reads «طلباتي» and its audit but has no actions', async ({ page }) => {
    await setup(page, { role: 'VIEWER' })
    await page.goto('/opportunity-map')
    await page.getByText('طلباتي').click()
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
    await page.screenshot({ path: `${SHOTS}/mobile-1-start.png` })
    await searchFor(page, 'جملة أدوات صحية')
    await expect(page.getByRole('button', { name: 'جملة فقط · 2', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(counter(page, 'n')).toHaveText('6')
    await pickDistrict(page, 'الملك فيصل')
    await expect(page.locator('[data-pin="main"]')).toHaveCount(2)
    await expect(counter(page, 'n')).toHaveText('2')
    await page.screenshot({ path: `${SHOTS}/mobile-2-district.png` })
    await page.locator('li[data-key="1"]').getByRole('button').first().click()
    const drawer = page.getByTestId('profile-drawer')
    await expect(drawer).toContainText('قناة واتساب متاحة للإرسال عبر فرق')
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
})
