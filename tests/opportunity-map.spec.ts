import { expect, test, type Page } from '@playwright/test'

/*
 * خريطة الفرص (was «حملات الموردين»): area filters (جملة فقط / الحي / الشارع), trade clusters on the drawn map
 * and in «تجمعات هذا النشاط», «طلب جديد» start sheet (booklet / selling / free search), template choice,
 * «طلباتي» with its audit drawer. Every response is mocked in the browser: nothing leaves the machine,
 * and no write may reach a send path.
 */
const SHOTS = 'docs/qa/opportunity-map'
const row = (id: number, name: string, district: string, street: string, wholesale = false) => ({
  poi_key: String(id), name_ar: name, name_en: null, category_ar: 'أدوات صحية', category: null, city_en: 'Riyadh', region_ar: 'الرياض',
  district_ar: district, street_ar: street, is_wholesale: wholesale, latitude: 24.62 + (id % 7) / 120, longitude: 46.70 + (id % 5) / 90,
  phone: '9665123456' + String(10 + id).slice(-2), has_whatsapp: true, email: null, source_count: 1, sources: ['qa_fixture'],
})
const ALL = [
  row(1, 'مؤسسة الأنابيب الحديثة', 'الملك فيصل', 'شارع خالد بن الوليد', true), row(2, 'مستودع السباكة الكبير', 'الملك فيصل', 'شارع خالد بن الوليد', true),
  row(3, 'سباكة الخليج', 'الفيصلية', 'شارع الأمير مشعل'), row(4, 'أدوات صحية النخبة', 'الملك فيصل', 'شارع الحسن بن علي'),
  row(5, 'معرض الماء الصافي', 'العليا', 'طريق العليا العام'), row(6, 'مركز الخلاطات', 'الفيصلية', 'شارع الأمير مشعل', true),
]
const AREAS = {
  districts: [{ name: 'الملك فيصل', n: 3 }, { name: 'الفيصلية', n: 2 }, { name: 'العليا', n: 1 }],
  streets: [{ name: 'شارع خالد بن الوليد', district: 'الملك فيصل', n: 2 }, { name: 'شارع الحسن بن علي', district: 'الملك فيصل', n: 1 }, { name: 'شارع الأمير مشعل', district: 'الفيصلية', n: 2 }, { name: 'طريق العليا العام', district: 'العليا', n: 1 }],
  wholesale: 3,
}
const CLUSTERS = [
  { level: 'street', label_ar: 'أدوات صحية وسباكة — شارع خالد بن الوليد، الملك فيصل', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', district_ar: 'الملك فيصل', street_ar: 'شارع خالد بن الوليد', n: 37, n_wholesale: 14, wholesale_pct: 38, lift: 4.1, lat: 24.64, lon: 46.72 },
  { level: 'district', label_ar: 'أدوات صحية وسباكة — الفيصلية', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', district_ar: 'الفيصلية', street_ar: null, n: 22, n_wholesale: 3, wholesale_pct: 14, lift: 2.6, lat: 24.66, lon: 46.74 },
  { level: 'street', label_ar: 'أدوات صحية وسباكة — طريق العليا العام، العليا', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', district_ar: 'العليا', street_ar: 'طريق العليا العام', n: 11, n_wholesale: 1, wholesale_pct: 9, lift: 1.9, lat: 24.68, lon: 46.70 },
]
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333'
// shape of farq-b2b-api api/lib/business/opportunity-requests.js present()
const REQUESTS = [
  { id: U1, organizationId: 'org-1', createdBy: 'qa-user', kind: 'BOOKLET', title: 'مواسير PPR — الرياض', payload: { city: 'الرياض' }, status: 'ACTIVE', hidden: false, createdAt: '2026-10-14T09:30:00Z' },
  { id: U2, organizationId: 'org-1', createdBy: 'other-user', kind: 'SELLER_CATALOG', title: 'مشترين لخلاطات المغاسل', payload: { city: 'جدة' }, status: 'ACTIVE', hidden: true, createdAt: '2026-10-12T15:10:00Z' },
  { id: U3, organizationId: 'org-1', createdBy: 'qa-user', kind: 'SEARCH', title: 'سخانات مياه', payload: { city: 'الرياض' }, status: 'CANCELLED', hidden: false, cancelledAt: '2026-10-11T08:00:00Z', cancelReason: 'لقينا مورد', createdAt: '2026-10-10T11:00:00Z' },
]

async function setup(page: Page, opts: { requestsOff?: boolean; role?: string } = {}) {
  const writes: string[] = []
  const saved: Record<string, unknown>[] = []
  const orgHeaders: (string | undefined)[] = []
  const listQueries: string[] = []
  const searches: Record<string, unknown>[] = []
  await page.addInitScript(() => {
    localStorage.setItem('farq_construction_session_v1', JSON.stringify({ accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }))
    localStorage.setItem('farq.targeting.city', 'Riyadh')
  })
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates')) return route.fulfill({ json: { ok: true, data: [
      { name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'السلام عليكم {{1}}،\n{{2}}' }] },
      { name: 'monthly_offer', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'هلا {{1}}، عندنا عرض الشهر: {{2}}' }] },
      { name: 'order_update', status: 'APPROVED', category: 'UTILITY', language: 'ar', components: [{ type: 'BODY', text: 'طلبك {{1}} وصل' }] },
      { name: 'logo_offer', status: 'APPROVED', category: 'UTILITY', language: 'ar', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'هلا {{1}}، {{2}}' }] },
    ] } })
    if (path.endsWith('/send-status')) return route.fulfill({ json: { send: false } })
    if (path.endsWith('/search')) {
      const body = route.request().postDataJSON(); searches.push(body)
      const f = body.filters || {}
      const rows = ALL.filter((r) => (!f.wholesale || r.is_wholesale) && (!f.district || r.district_ar === f.district) && (!f.street || r.street_ar.includes(f.street)))
      return route.fulfill({ json: { total: rows.length, rows, parsed: { keywords: ['أدوات صحية'] }, areas: AREAS, understood: { wholesale: /جمل/.test(body.q), sub_ids: [7] } } })
    }
    if (path.endsWith('/clusters')) return route.fulfill({ json: { clusters: CLUSTERS, wholesale: 3, basis: 'تجمّع النشاط مقارنة بباقي المدينة · من بيانات المحلات المسجلة' } })
    if (path.endsWith('/suggest-specialties')) return route.fulfill({ json: { suggestions: [
      { specialty_id: 1, specialty_ar: 'مواسير وتمديدات', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', main_ar: 'مواد بناء' },
      { specialty_id: 2, specialty_ar: 'خلاطات وأدوات صحية', sub_id: 7, sub_ar: 'أدوات صحية وسباكة', main_ar: 'مواد بناء' },
      { specialty_id: 3, specialty_ar: 'سخانات مياه', sub_id: 9, sub_ar: 'أجهزة كهربائية', main_ar: 'كهرباء' },
    ] } })
    writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 403, json: { error: 'QA_BLOCKED' } })
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
        { id: '2', auditLogId: '2', action: 'HIDE', actorUserId: '9f2c41aa-0000-4000-8000-000000000000', organizationId: 'org-1', organizationName: 'مؤسسة الاختبار', membershipId: 'm2', membershipRole: 'MEMBER', via: 'membership', planCode: 'pro', createdAt: '2026-10-15T08:05:00Z' },
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
  return { writes, searches, saved, orgHeaders, listQueries }
}

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('filters, clusters, «طلب جديد», template choice, «طلباتي»', async ({ page }) => {
    const { writes, searches, saved, orgHeaders, listQueries } = await setup(page)
    await page.goto('/targeting') // old link → /opportunity-map
    await expect(page).toHaveURL(/\/opportunity-map$/)
    await expect(page.getByRole('button', { name: 'خريطة الفرص' })).toBeVisible()
    await expect(page.getByText('السوق', { exact: true })).toBeVisible()
    await page.getByLabel('وش تبي توصل له؟').fill('أدوات صحية جملة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    // «جملة» in the request: the filter is on from the first search
    expect(searches[0].filters).toEqual({ wholesale: true })
    await expect(page.getByRole('button', { name: 'جملة فقط · 3', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('تجمعات هذا النشاط')).toBeVisible()
    await expect(page.getByRole('button', { name: /^شارع خالد بن الوليد، الملك فيصل — 37 محل/ })).toBeVisible()
    await expect(page.getByText('شارع خالد بن الوليد · الملك فيصل · الرياض').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-1-search.png` })
    // wholesale off, then a district from the picker
    await page.getByRole('button', { name: 'جملة فقط · 3', exact: true }).click()
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({})
    await page.getByLabel('الحي', { exact: true }).selectOption('الفيصلية')
    await expect.poll(() => searches.length).toBe(3)
    expect(searches[2].filters).toEqual({ district: 'الفيصلية' })
    await expect(page.getByRole('button', { name: 'الحي: الفيصلية', exact: true })).toBeVisible()
    // a street cluster sets district + street
    await page.getByRole('button', { name: /^شارع خالد بن الوليد، الملك فيصل — 37 محل/ }).click()
    await expect.poll(() => searches.length).toBe(4)
    expect(searches[3].filters).toEqual({ district: 'الملك فيصل', street: 'شارع خالد بن الوليد' })
    await expect(page.getByRole('button', { name: 'الشارع: شارع خالد بن الوليد', exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-2-cluster-picked.png` })
    // removing the district clears the street too
    await page.getByRole('button', { name: 'إزالة الحي: الملك فيصل' }).click()
    await expect.poll(() => searches.length).toBe(5)
    expect(searches[4].filters).toEqual({})
    // template choice in the campaign panel: the fitting approved ones; the one with other variables is disabled
    const tpl = page.getByLabel('القالب (المعتمدة من ميتا)')
    await expect(tpl.locator('option[value="order_update"]')).toHaveAttribute('disabled', '')
    await expect(tpl.locator('option[value="logo_offer"]')).toHaveAttribute('disabled', '') // image header: the send path sends body values only
    await tpl.selectOption('monthly_offer')
    await expect(page.getByText(/معاينة: هلا \{اسم المنشأة\}، عندنا عرض الشهر/)).toBeVisible()
    // «طلباتي»: filter + cancel with a reason + audit drawer
    await page.getByText('طلباتي').click()
    // the Gregorian date with the Umm al-Qura date beside it (14 Oct 2026 = 3 Jumada al-Ula 1448)
    await expect(page.getByRole('listitem').filter({ hasText: 'مواسير PPR — الرياض' }).getByText(/2026.* · 3 جمادى الأولى 1448 هـ/)).toBeVisible()
    await page.getByRole('button', { name: 'إلغاء الطلب', exact: true }).first().click()
    await page.getByLabel('السبب (اختياري)').fill('تغيّرت الكمية')
    await page.screenshot({ path: `${SHOTS}/desktop-3-my-requests-cancel.png` })
    await page.getByRole('button', { name: 'تأكيد الإلغاء' }).click()
    await expect(page.getByText('ملغي').first()).toBeVisible()
    // MEMBER: no actions on a colleague's request (r2), only «السجل»
    const r2 = page.getByRole('listitem').filter({ hasText: 'مشترين لخلاطات المغاسل' })
    await expect(r2.getByRole('button', { name: 'إظهار' })).toHaveCount(0)
    await expect(r2.getByRole('button', { name: 'السجل' })).toBeVisible()
    expect(listQueries[0]).toBe('?hidden=include&archived=include')
    expect(orgHeaders.every((h) => h === 'org-1')).toBe(true)
    await page.getByRole('button', { name: 'السجل', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: /السجل/ })).toContainText('أنت · مالك · مؤسسة الاختبار · باقة pro')
    await expect(page.getByRole('dialog', { name: /السجل/ })).toContainText('السبب: تغيّرت الكمية')
    await page.screenshot({ path: `${SHOTS}/desktop-4-audit.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByText(/حذف/)).toHaveCount(0)
    // «طلب جديد» → selling → suggestions → buyer search for the first specialty
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    const sheet = page.getByRole('dialog', { name: 'طلب جديد', exact: true })
    await expect(sheet.getByRole('button', { name: /طلب تسعير من الموردين/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-5-start.png` })
    await sheet.getByRole('button', { name: /أبي أبيع منتجاتي/ }).click()
    await page.getByPlaceholder(/مواسير PPR/).fill('مواسير PPR\nخلاطات مغاسل\nسخانات')
    await page.getByRole('button', { name: 'اقترح التخصصات' }).click()
    await expect(page.getByRole('button', { name: 'سخانات مياه', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'سخانات مياه', exact: true }).click()
    await page.screenshot({ path: `${SHOTS}/desktop-6-sell-suggestions.png` })
    await page.getByRole('button', { name: 'ابحث عن مشترين (2)' }).click()
    await expect.poll(() => searches.length).toBe(6)
    expect(searches[5]).toMatchObject({ q: 'مواسير وتمديدات', objective: 'marketing' })
    await expect(page.getByRole('button', { name: /خلاطات وأدوات صحية/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-7-sell-lines.png` })
    // the confirmed products were saved as a request (references only)
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
    await page.getByLabel('وش تبي توصل له؟').fill('أدوات صحية')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await page.getByText('طلباتي').click()
    await expect(page.getByText(/قريباً: تتابع هنا طلباتك/)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-8-requests-soon.png` })
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
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('filters row, clusters in the sheet, start sheet', async ({ page }) => {
    const { writes, searches } = await setup(page)
    await page.goto('/opportunity-map')
    await page.getByLabel('وش تبي توصل له؟').fill('أدوات صحية')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByRole('button', { name: 'جملة فقط · 3', exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-1-map.png` })
    await page.getByRole('button', { name: /نتيجة · اسحب للأعلى للقائمة/ }).click()
    await expect(page.getByText('تجمعات هذا النشاط')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-2-sheet.png` })
    await page.getByRole('button', { name: /^شارع خالد بن الوليد، الملك فيصل — 37 محل/ }).click()
    await expect.poll(() => searches.length).toBe(2)
    expect(searches[1].filters).toEqual({ district: 'الملك فيصل', street: 'شارع خالد بن الوليد' })
    await page.screenshot({ path: `${SHOTS}/mobile-3-cluster-picked.png` })
    await page.getByRole('button', { name: 'طلب جديد', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: 'طلب جديد', exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-4-start.png` })
    expect(writes).toEqual([])
  })
})
