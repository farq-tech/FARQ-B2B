import { expect, test, type Page } from '@playwright/test'

/*
 * «Saudi touch» on خريطة الفرص and حسابي, every response mocked in the browser (nothing leaves the machine):
 * popular market names on clusters and suggestions, market vocabulary, the prayer note and «وضع رمضان» beside the send step,
 * the server's prayer hold shown as it comes, the riyal sign with «قبل الضريبة», CR / VAT / national address checks,
 * and the occasions banner. Clocks are fixed (Saudi time = UTC+3).
 */
const SHOTS = 'docs/qa/saudi-touch'
const ksa = (y: number, m: number, d: number, h: number, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 3, min))
const row = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  poi_key: String(id), name_ar: name, name_en: null, category_ar: 'أقمشة', category: null, city_en: 'Riyadh', region_ar: 'الرياض',
  district_ar: 'الديرة', street_ar: 'شارع الإمام تركي', latitude: 24.63 + id / 400, longitude: 46.71 + id / 400,
  phone: `9665123456${10 + id}`, has_whatsapp: true, email: null, source_count: 1, sources: ['qa_fixture'], ...extra,
})
const ROWS = [row(1, 'محلات الزل للأقمشة', { cr_number: '1010123456' }), row(2, 'أقمشة الديرة', { sources: ['qa_fixture', 'firms_license'] }), row(3, 'معرض النسيج')]
const CLUSTERS = [
  { level: 'district', label_ar: 'أقمشة — الديرة', sub_id: 11, sub_ar: 'أقمشة', district_ar: 'الديرة', street_ar: null, n: 230, n_wholesale: 40, wholesale_pct: 17, lift: 5.2, lat: 24.632, lon: 46.713 },
  { level: 'street', label_ar: 'أقمشة — شارع الثميري، المرقب', sub_id: 11, sub_ar: 'أقمشة', district_ar: 'المرقب', street_ar: 'شارع الثميري', n: 48, n_wholesale: 9, wholesale_pct: 19, lift: 2.1, lat: 24.64, lon: 46.72 },
]

async function setup(page: Page, opts: { send?: boolean; at: Date; prayerBlock?: boolean }) {
  const writes: string[] = []
  const searches: Record<string, unknown>[] = []
  await page.clock.setFixedTime(opts.at)
  await page.addInitScript(QA_SESSION) // memory-only session (DEV seed); Riyadh is the default city
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/market-summary')) return route.fulfill({ json: { ok: true, summary: { total: 3, districts_count: 1, top_districts: [], densest_street: null, n_wholesale: 0, n_whatsapp: 3, n_specialties: 0, n_approx: 0, n_cr: 0, basis: 'اختبار' } } })
    if (path.endsWith('/district-counts')) return route.fulfill({ json: { ok: true, city: 'Riyadh', districts: [], total: 0, basis: 'اختبار' } })
    if (path.endsWith('/who-buys')) return route.fulfill({ json: { ok: true, buyers: [], subject: { sub_ids: [], label_ar: '' }, basis: 'اختبار' } })
    if (path.includes('/street-density')) return route.fulfill({ json: { type: 'FeatureCollection', features: [], mains: [] } })
    if (path.endsWith('/districts')) return route.fulfill({ status: 404, json: { error: 'not_found' } }) // no polygons: district chips
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_discover_ar_20261019', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates')) return route.fulfill({ json: { ok: true, data: [{ name: 'farq_discover_ar_20261019', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'السلام عليكم {{1}}،\n{{2}}' }] }] } })
    if (path.endsWith('/send-status')) return route.fulfill({ json: { send: Boolean(opts.send) } })
    if (path.endsWith('/search')) { const body = route.request().postDataJSON(); searches.push(body); return route.fulfill({ json: { total: ROWS.length, rows: ROWS, parsed: { keywords: ['أقمشة'] }, areas: { districts: [{ name: 'الديرة', n: 3 }], streets: [], wholesale: 0 } } }) }
    if (path.endsWith('/clusters')) return route.fulfill({ json: { clusters: CLUSTERS, wholesale: 0, basis: 'تجمّع النشاط مقارنة بباقي المدينة' } })
    if (path.endsWith('/send-farq') && opts.prayerBlock) {
      // what server.py answers during Asr (saudi_rhythm.block_for_cities)
      writes.push('send-farq (held)')
      return route.fulfill({ status: 409, json: { ok: false, error: 'PRAYER_WINDOW', prayer: 'asr', message_ar: 'الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة 3:23 م.', next_allowed: '2026-10-15T12:23:00.000Z', next_allowed_ar: '3:23 م' } })
    }
    writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 403, json: { error: 'QA_BLOCKED' } })
  })
  await page.route('**/_api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/whatsapp/pricing')) return route.fulfill({ json: { ok: true, data: { enabled: true, category: 'MARKETING', price_sar: 0.17, currency: 'SAR' } } })
    if (path.endsWith('/api/business/context')) return route.fulfill({ status: 404, json: { ok: false, errors: [{ code: 'OPPORTUNITY_REQUESTS_DISABLED' }] } })
    if (path.includes('/opportunity-requests')) return route.fulfill({ status: 404, json: { ok: false, errors: [{ code: 'OPPORTUNITY_REQUESTS_DISABLED' }] } })
    if (route.request().method() !== 'GET') writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 503, json: { ok: false, error: { message: 'QA: blocked' } } })
  })
  return { writes, searches }
}

/** حسابي / occasions: the session is memory-only (DEV seed) and the company profile lives on the server, never on the device. */
const QA_SESSION = () => { (window as unknown as Record<string, unknown>).__FARQ_QA_SESSION__ = { accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } } }
async function companyProfileApi(page: Page, mode: 'on' | 'off') {
  const puts: Record<string, unknown>[] = []
  await page.addInitScript(QA_SESSION)
  await page.route('**/_api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (mode === 'on' && path.endsWith('/api/business/context')) return route.fulfill({ json: { ok: true, data: { organizations: [{ id: 'org-1', name: 'مؤسسة الاختبار', role: 'OWNER', subscriptions: [{ sectorCode: 'construction' }] }] } } })
    if (path.endsWith('/api/business/company-profile')) {
      if (mode === 'off') return route.fulfill({ status: 404, json: { ok: false, error: 'NOT_FOUND' } })
      expect(route.request().headers()['authorization']).toBeUndefined() // the browser holds no token: server.py adds it from the session cookie
      expect(route.request().headers()['x-farq-organization-id']).toBe('org-1')
      if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); puts.push(body); return route.fulfill({ json: { ok: true, data: { profile: body } } }) }
      return route.fulfill({ json: { ok: true, data: { profile: { name: 'مؤسسة الاختبار', phone: '0500000000', email: 'qa@example.com', city: 'الرياض' } } } })
    }
    return route.fallback()
  })
  return puts
}

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('task chooser exposes buying, selling, exploration, and targeting starts', async ({ page }) => {
    const { writes } = await setup(page, { at: ksa(2026, 10, 15, 10) })
    await page.goto('/opportunity-map')
    const chooser = page.getByRole('dialog', { name: 'وش هدفك؟' })
    await expect(chooser.getByRole('button', { name: /بحث حر عن مورد/ })).toBeVisible()
    await expect(chooser.getByRole('button', { name: 'أبحث عن مشتري' })).toBeVisible()
    await expect(chooser.getByRole('button', { name: /استكشف السوق/ })).toBeVisible()
    await expect(chooser.getByRole('button', { name: /استهدف جهات/ })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('selection becomes a saved review list before any commercial action', async ({ page }) => {
    const { writes } = await setup(page, { at: ksa(2026, 10, 15, 10) })
    const created: Record<string, unknown>[] = []
    await page.route('**/_api/api/business/context', (route) => route.fulfill({ json: { ok: true, data: { organizations: [{ id: 'org-1', name: 'مؤسسة الاختبار', role: 'OWNER', subscriptions: [{ sectorCode: 'construction' }] }] } } }))
    await page.route('**/_api/api/business/opportunity-requests**', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>
        created.push(body)
        return route.fulfill({ json: { ok: true, data: { request: { id: 'review-1', ...body, organizationId: 'org-1', createdBy: 'qa-user', status: 'ACTIVE', hidden: false, createdAt: new Date().toISOString() } } } })
      }
      return route.fulfill({ json: { ok: true, data: { requests: [] } } })
    })
    await page.goto('/opportunity-map')
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: 'إغلاق' }).click()
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'قائمة مراجعة الجهات' })).toBeVisible()
    await expect(page.getByText(/لماذا ظهرت:/).first()).toBeVisible()
    await expect(page.getByText(/الموقع يحتاج تحقق|مصدر واحد|بيانات كافية للمراجعة/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'الأقرب للطلب' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('checkbox', { name: /أضف محلات الزل للأقمشة إلى قائمة المراجعة/ }).check()
    const tray = page.getByLabel('قائمة المراجعة المختارة')
    await expect(tray).toContainText('الحفظ لا يرسل شيئاً')
    await tray.getByRole('button', { name: 'حفظ القائمة' }).click()
    await expect.poll(() => created.length).toBe(1)
    await expect(tray.getByRole('button', { name: 'فتح الطلبات' })).toBeVisible()
    expect(created[0]).toMatchObject({ kind: 'SEARCH', payload: { filters: { review: true, source: 'OPPORTUNITY_MAP', objective: 'purchase', selectedCount: 1 } } })
    expect(writes).toEqual([])
  })

  test('targeting assistant is available from the task chooser and does not send while analysing', async ({ page }) => {
    const { writes } = await setup(page, { at: ksa(2026, 10, 15, 10) })
    const marketingWrites: string[] = []
    await page.route('**/_api/admin/marketing/**', (route) => {
      const path = new URL(route.request().url()).pathname
      marketingWrites.push(path)
      if (path.endsWith('/campaigns')) return route.fulfill({ json: { ok: true, data: { id: 'campaign-1' } } })
      return route.fulfill({ json: { ok: true, data: {} } })
    })
    await page.route('**/_api/api/business/context', (route) => route.fulfill({ json: { ok: true, data: { organizations: [{ id: 'org-1', name: 'مؤسسة الاختبار', role: 'OWNER', subscriptions: [{ sectorCode: 'construction' }] }] } } }))
    await page.route('**/_api/api/business/opportunity-requests**', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>
        return route.fulfill({ json: { ok: true, data: { request: { id: 'draft-1', ...body, organizationId: 'org-1', createdBy: 'qa-user', status: 'ACTIVE', hidden: false, createdAt: new Date().toISOString() } } } })
      }
      return route.fulfill({ json: { ok: true, data: { requests: [] } } })
    })
    await page.goto('/opportunity-map')
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: 'استهدف جهات' }).click()
    const dialog = page.getByRole('dialog', { name: 'استهداف ذكي' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('طلب الاستهداف').fill('استهدف 30 شركة مقاولات في الرياض للتعريف بفرق')
    await dialog.getByRole('button', { name: 'حلّل طلبي' }).click()
    await expect(dialog.getByText(/سأستهدف شركات المقاولات/)).toBeVisible()
    await dialog.getByRole('button', { name: 'جهّز مسودة الحملة' }).click()
    await expect(dialog.getByText(/تم تجهيز مسودة لـ/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'فتح المسودة' })).toBeVisible()
    expect(marketingWrites).toEqual(['/_api/admin/marketing/campaigns', '/_api/admin/marketing/campaigns/campaign-1/recipients/batch'])
    expect(writes).toEqual([])
  })

  test('a saved selection can move to the RFQ wizard without sending', async ({ page }) => {
    const { writes } = await setup(page, { at: ksa(2026, 10, 15, 10) })
    await page.goto('/opportunity-map')
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: 'إغلاق' }).click()
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await page.getByRole('checkbox', { name: /أضف محلات الزل للأقمشة إلى قائمة المراجعة/ }).check()
    await page.getByLabel('قائمة المراجعة المختارة').getByRole('button', { name: 'إنشاء طلب تسعير' }).click()
    await expect(page.getByRole('heading', { name: 'وش تبي تسعّر؟' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('task start hides city-wide statistics until market exploration is chosen', async ({ page }) => {
    // Thursday 15 Oct 2026, 15:05 Riyadh: inside Asr's window (Asr ≈ 2:58 م + 25 min)
    const { searches, writes } = await setup(page, { at: ksa(2026, 10, 15, 15, 5) })
    await page.goto('/opportunity-map')
    await expect(page.getByLabel('وش تبي توصل له؟')).toHaveAttribute('placeholder', 'وش تبي تسعّر؟ مثل: حدايد وبويات، بلاط، مليس')
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: 'إغلاق' }).click()
    await expect(page.getByText('ابدأ بالبحث عن مورد')).toBeVisible()
    await expect(page.getByText('سوق الرياض')).toHaveCount(0)
    await page.getByRole('button', { name: 'غيّر الهدف' }).click()
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: /استكشف السوق/ }).click()
    await expect(page.getByText('سوق الرياض')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-1-start.png` })
    // Search from the supplier task; no example click is required to populate the results.
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect.poll(() => searches.at(-1)?.q).toBe('أقمشة')
    expect(searches.at(-1)).toMatchObject({ q: 'أقمشة', city: 'Riyadh' })
    // Narrow to the district, then inspect its confirmed popular market name and cluster.
    const district = page.getByLabel('الحي')
    const districtValue = await district.locator('option').filter({ hasText: 'الديرة' }).getAttribute('value')
    await district.selectOption(districtValue!)
    await expect.poll(() => (searches.at(-1)?.filters as Record<string, unknown> | undefined)?.district).toBe('الديرة')
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — الديرة · (?:230) محل/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^شارع الثميري، المرقب — (?:48) محل/ })).toBeVisible()
    // map label (drawn map) carries the popular name too
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — أقمشة — الديرة — (?:230) محل/ })).toBeVisible()
    // «منشأة سعودية»: CR on row 1, trade-licence registry on row 2, nothing on row 3
    await expect(page.getByText('منشأة سعودية')).toHaveCount(2)
    // the send step: riyal sign, before tax, prayer note, usual window
    await page.getByRole('button', { name: 'حدد اللي عندهم واتساب' }).click()
    const compose = page.getByTestId('campaign-tray')
    await compose.getByRole('button', { name: 'اكتب الرسالة' }).click()
    await expect(compose.getByRole('img', { name: 'ريال' })).toBeVisible()
    await expect(compose.getByText('قبل الضريبة')).toBeVisible()
    await expect(compose.getByText(/الردود قد تتأخر وقت الصلاة\. الإرسال ينتظر صلاة العصر، ويفتح الساعة 3:2\d م\./)).toBeVisible()
    await expect(compose.getByText(/أنسب وقت للإرسال: الأحد إلى الخميس/)).toBeVisible()
    await expect(compose.getByText('وضع رمضان')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/desktop-2-clusters-prayer.png` })
    expect(writes).toEqual([])
  })

  test('Ramadan: «وضع رمضان» and the after-taraweeh window', async ({ page }) => {
    await setup(page, { at: ksa(2027, 2, 20, 10) })
    await page.goto('/opportunity-map')
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await page.getByRole('button', { name: 'حدد اللي عندهم واتساب' }).click()
    const compose = page.getByTestId('campaign-tray')
    await compose.getByRole('button', { name: 'اكتب الرسالة' }).click()
    await expect(compose.getByText('وضع رمضان')).toBeVisible()
    await expect(compose.getByText('أنسب وقت للإرسال في رمضان: بعد التراويح، من 9:30 م إلى 1:00 ص')).toBeVisible()
    await expect(compose.getByText(/الردود قد تتأخر/)).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/desktop-3-ramadan.png` })
  })

  test('the server holds a send during prayer: its Arabic message and next time are shown', async ({ page }) => {
    const { writes } = await setup(page, { at: ksa(2026, 10, 15, 15, 3), send: true, prayerBlock: true })
    await page.goto('/opportunity-map')
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await page.getByRole('button', { name: 'حدد اللي عندهم واتساب' }).click()
    await page.getByTestId('campaign-tray').getByRole('button', { name: 'اكتب الرسالة' }).click()
    await page.getByRole('button', { name: 'أرسل الحملة' }).click()
    const sheet = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
    await expect(sheet.getByText(/الردود قد تتأخر وقت الصلاة/)).toBeVisible()
    await sheet.getByRole('button', { name: /أرسل إلى 3 موردين · التكلفة 0\.51 ريال قبل الضريبة/ }).click()
    await expect(sheet.getByRole('alert')).toHaveText('الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة 3:23 م.')
    await page.screenshot({ path: `${SHOTS}/desktop-4-send-held.png` })
    expect(writes).toEqual(['send-farq (held)'])
  })

  test('حسابي: CR, VAT and national address are checked before saving', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 15, 10) })
    const puts = await companyProfileApi(page, 'on')
    await page.goto('/account')
    await expect(page.getByLabel('اسم المنشأة')).toHaveValue('مؤسسة الاختبار') // read from GET /api/business/company-profile
    await page.getByLabel('اسم المنشأة').fill('مؤسسة الاختبار')
    await page.getByLabel('رقم التواصل').fill('0500000000')
    await page.getByLabel('البريد الإلكتروني').fill('qa@example.com')
    await page.getByLabel('مدينة المنشأة').fill('الرياض')
    await page.getByLabel('السجل التجاري').fill('12345')
    await page.getByLabel('الرقم الضريبي').fill('210123456700003')
    await page.getByLabel('العنوان المختصر').fill('RRD29')
    await page.getByRole('button', { name: 'حفظ بيانات المنشأة' }).click()
    await expect(page.getByText('السجل التجاري 10 أرقام.')).toBeVisible()
    expect(puts).toHaveLength(0) // invalid fields never reach the server
    await expect(page.getByText('الرقم الضريبي يبدأ بـ 3 وينتهي بـ 3.')).toBeVisible()
    await expect(page.getByText('العنوان المختصر 4 حروف إنجليزية ثم 4 أرقام، مثل RRRD2929.')).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('راجع الخانات المعلّمة بالأحمر قبل الحفظ.')
    await page.screenshot({ path: `${SHOTS}/desktop-5-account-errors.png`, fullPage: true })
    await page.getByLabel('السجل التجاري').fill('١٠١٠١٢٣٤٥٦')
    await page.getByLabel('الرقم الضريبي').fill('310123456700003')
    await page.getByLabel('العنوان المختصر').fill('rrrd2929')
    await page.getByLabel('رقم المبنى').fill('2929')
    await page.getByLabel('الشارع').fill('شارع الأمير محمد بن عبدالعزيز')
    await page.getByLabel('الحي').fill('العليا')
    await page.getByLabel('المدينة', { exact: true }).fill('الرياض')
    await page.getByLabel('الرمز البريدي').fill('12241')
    await page.getByRole('button', { name: 'حفظ بيانات المنشأة' }).click()
    await expect(page.getByRole('status')).toHaveText('تم بحمد الله، حفظنا بيانات منشأتك في حسابك.')
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ name: 'مؤسسة الاختبار', crNumber: '1010123456', vatNumber: '310123456700003', nationalAddress: 'RRRD2929 · 2929 شارع الأمير محمد بن عبدالعزيز · حي العليا · الرياض 12241', nationalAddressParts: { shortAddress: 'RRRD2929', buildingNo: '2929', postalCode: '12241' } })
    expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith('farq.b2b')))).toEqual([]) // nothing on the device
  })

  test('حسابي before the server has the endpoint (404): «قريباً», read-only', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 15, 10) })
    await companyProfileApi(page, 'off')
    await page.goto('/account')
    await expect(page.getByText('قريباً')).toBeVisible()
    await expect(page.getByLabel('السجل التجاري')).toBeDisabled()
    await expect(page.getByLabel('الرقم الضريبي')).toBeDisabled()
    await expect(page.getByLabel('العنوان المختصر')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'حفظ بيانات المنشأة' })).toHaveCount(0)
  })

  test('occasions: a quiet, dismissible greeting on National Day', async ({ page }) => {
    await setup(page, { at: ksa(2026, 9, 23, 10) })
    await companyProfileApi(page, 'off')
    await page.goto('/account')
    const banner = page.getByRole('complementary', { name: 'اليوم الوطني السعودي' })
    await expect(banner).toContainText('كل عام والوطن بخير.')
    await page.screenshot({ path: `${SHOTS}/desktop-6-national-day.png` })
    await banner.getByRole('button', { name: 'إخفاء التهنئة' }).click()
    await expect(banner).toHaveCount(0)
    // dismissed for this visit only: nothing is stored on the device, so a reload may greet again
    expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith('farq.occasion')))).toEqual([])
    await page.reload()
    await expect(page.getByRole('complementary', { name: 'اليوم الوطني السعودي' })).toBeVisible()
  })
})

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('vocabulary chips, popular name in the list, prayer note in the campaign tray', async ({ page }) => {
    const { searches } = await setup(page, { at: ksa(2026, 10, 16, 12, 0) }) // Friday prayer
    await page.goto('/opportunity-map')
    await page.getByRole('dialog', { name: 'وش هدفك؟' }).getByRole('button', { name: 'إغلاق' }).click()
    await expect(page.getByRole('tab', { name: 'ابدأ البحث' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('ابدأ بالبحث عن مورد')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'أكثر الشوارع كثافة في الرياض' })).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/mobile-1-start.png` })
    await page.getByLabel('وش تبي توصل له؟').fill('أقمشة')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect.poll(() => searches.at(-1)?.q).toBe('أقمشة')
    const district = page.getByLabel('الحي')
    const districtValue = await district.locator('option').filter({ hasText: 'الديرة' }).getAttribute('value')
    await district.selectOption(districtValue!)
    await expect.poll(() => (searches.at(-1)?.filters as Record<string, unknown> | undefined)?.district).toBe('الديرة')
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — الديرة · (?:230) محل/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-2-sheet.png` })
    await page.getByRole('button', { name: 'حدد واتساب' }).click()
    const step = page.getByTestId('campaign-tray')
    await step.getByRole('button', { name: 'اكتب الرسالة' }).click()
    await expect(step.getByText(/الإرسال ينتظر صلاة الجمعة، ويفتح الساعة 1:30 م\./)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-3-message-friday.png` })
  })

  test('حسابي on a phone', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 15, 10) })
    await companyProfileApi(page, 'on')
    await page.goto('/account')
    await expect(page.getByLabel('العنوان المختصر')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-4-account.png`, fullPage: true })
  })
})
