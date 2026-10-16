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
  await page.addInitScript(() => {
    localStorage.setItem('farq_construction_session_v1', JSON.stringify({ accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }))
    localStorage.setItem('farq.targeting.city', 'Riyadh')
  })
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates')) return route.fulfill({ json: { ok: true, data: [{ name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', language: 'ar', components: [{ type: 'BODY', text: 'السلام عليكم {{1}}،\n{{2}}' }] }] } })
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

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('vocabulary, market suggestion, popular cluster name, Saudi badge, riyal, prayer note', async ({ page }) => {
    // Thursday 15 Oct 2026, 15:05 Riyadh: inside Asr's window (Asr ≈ 2:58 م + 25 min)
    const { searches, writes } = await setup(page, { at: ksa(2026, 10, 15, 15, 5) })
    await page.goto('/opportunity-map')
    await expect(page.getByLabel('وش تبي توصل له؟')).toHaveAttribute('placeholder', 'وش تبي تسعّر؟ مثل: حدايد وبويات، بلاط، مليس')
    const examples = page.getByRole('group', { name: 'أمثلة للبحث' })
    for (const t of ['حدايد وبويات', 'بلاط', 'مليس', 'قطع غيار كوري وصيني', 'أدوات صحية جملة وقطاعي']) await expect(examples.getByRole('button', { name: t, exact: true })).toBeVisible()
    await expect(examples.getByRole('button', { name: 'سوق الزل للأقمشة', exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/desktop-1-start.png` })
    // the market chip searches its trade inside its district
    await examples.getByRole('button', { name: 'سوق الزل للأقمشة', exact: true }).click()
    await expect.poll(() => searches.length).toBe(1)
    expect(searches[0]).toMatchObject({ q: 'أقمشة', city: 'Riyadh', filters: { district: 'الديرة' } })
    // the cluster list: popular name first, then where and how many
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — الديرة · 230 محل/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^شارع الثميري، المرقب — 48 محل/ })).toBeVisible()
    // map label (drawn map) carries the popular name too
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — أقمشة — الديرة — 230 محل/ })).toBeVisible()
    // «منشأة سعودية»: CR on row 1, trade-licence registry on row 2, nothing on row 3
    await expect(page.getByText('منشأة سعودية')).toHaveCount(2)
    // the send step: riyal sign, before tax, prayer note, usual window
    await page.getByRole('button', { name: 'حدد اللي عندهم واتساب' }).click()
    const compose = page.getByRole('region', { name: 'رسالة الحملة' })
    await expect(compose.getByRole('img', { name: 'ريال سعودي' })).toBeVisible()
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
    const compose = page.getByRole('region', { name: 'رسالة الحملة' })
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
    await page.getByRole('button', { name: 'أرسل الحملة' }).click()
    const sheet = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
    await expect(sheet.getByText(/الردود قد تتأخر وقت الصلاة/)).toBeVisible()
    await sheet.getByRole('button', { name: /أرسل إلى 3 موردين · التكلفة 0\.51 ريال سعودي قبل الضريبة/ }).click()
    await expect(sheet.getByRole('alert')).toHaveText('الحين وقت صلاة العصر، فما أرسلنا الحملة. تقدر ترسلها من الساعة 3:23 م.')
    await page.screenshot({ path: `${SHOTS}/desktop-4-send-held.png` })
    expect(writes).toEqual(['send-farq (held)'])
  })

  test('حسابي: CR, VAT and national address are checked before saving', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 15, 10) })
    await page.goto('/account')
    await page.getByLabel('اسم المنشأة').fill('مؤسسة الاختبار')
    await page.getByLabel('رقم التواصل').fill('0500000000')
    await page.getByLabel('البريد الإلكتروني').fill('qa@example.com')
    await page.getByLabel('مدينة المنشأة').fill('الرياض')
    await page.getByLabel('السجل التجاري').fill('12345')
    await page.getByLabel('الرقم الضريبي').fill('210123456700003')
    await page.getByLabel('العنوان المختصر').fill('RRD29')
    await page.getByRole('button', { name: 'حفظ بيانات المنشأة' }).click()
    await expect(page.getByText('السجل التجاري ١٠ أرقام.')).toBeVisible()
    await expect(page.getByText('الرقم الضريبي يبدأ بـ 3 وينتهي بـ 3.')).toBeVisible()
    await expect(page.getByText('العنوان المختصر ٤ حروف إنجليزية ثم ٤ أرقام، مثل RRRD2929.')).toBeVisible()
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
    await expect(page.getByRole('status')).toHaveText('تم بحمد الله، حفظنا بيانات منشأتك على هذا الجهاز.')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('farq.b2b.qa-user.profile.v1') || '{}'))
    expect(saved).toMatchObject({ crNumber: '1010123456', vatNumber: '310123456700003', nationalAddress: 'RRRD2929 · 2929 شارع الأمير محمد بن عبدالعزيز · حي العليا · الرياض 12241' })
  })

  test('occasions: a quiet, dismissible greeting on National Day', async ({ page }) => {
    await setup(page, { at: ksa(2026, 9, 23, 10) })
    await page.goto('/account')
    const banner = page.getByRole('complementary', { name: 'اليوم الوطني السعودي' })
    await expect(banner).toContainText('كل عام والوطن بخير.')
    await page.screenshot({ path: `${SHOTS}/desktop-6-national-day.png` })
    await banner.getByRole('button', { name: 'إخفاء التهنئة' }).click()
    await expect(banner).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('complementary', { name: 'اليوم الوطني السعودي' })).toHaveCount(0)
  })
})

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('vocabulary chips, popular name in the sheet, prayer note in the message step', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 16, 12, 0) }) // Friday prayer
    await page.goto('/opportunity-map')
    await expect(page.getByRole('group', { name: 'أمثلة للبحث' }).getByRole('button', { name: 'حدايد وبويات', exact: true })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-1-start.png` })
    await page.getByRole('group', { name: 'أمثلة للبحث' }).getByRole('button', { name: 'سوق الزل للأقمشة', exact: true }).click()
    await page.getByRole('button', { name: /نتيجة · اسحب للأعلى للقائمة/ }).click()
    await expect(page.getByRole('button', { name: /^سوق الزل للأقمشة — الديرة · 230 محل/ })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-2-sheet.png` })
    await page.getByRole('button', { name: 'حدد واتساب' }).click()
    await page.getByRole('button', { name: 'التالي', exact: true }).click()
    const step = page.getByRole('dialog', { name: 'رسالة الحملة' })
    await expect(step.getByText(/الإرسال ينتظر صلاة الجمعة، ويفتح الساعة 1:30 م\./)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-3-message-friday.png` })
  })

  test('حسابي on a phone', async ({ page }) => {
    await setup(page, { at: ksa(2026, 10, 15, 10) })
    await page.goto('/account')
    await expect(page.getByLabel('العنوان المختصر')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/mobile-4-account.png`, fullPage: true })
  })
})
