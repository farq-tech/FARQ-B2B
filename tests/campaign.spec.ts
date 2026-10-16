import { expect, test, type Page } from '@playwright/test'

/*
 * Supplier campaign on خريطة الفرص v2 (phone): choose recipients → the campaign tray appears under the map with the
 * server price × recipients → review that says sending is closed before anything is pressed → «احفظ الحملة كمسودة»
 * (this page only: nothing on the device). Every network write is blocked and recorded: nothing may be sent.
 */
const row = (id: string, name: string) => ({ poi_key: id, name_ar: name, name_en: null, category_ar: 'سباكة', category: null, city_en: 'Riyadh', region_ar: 'الرياض', district_ar: 'النرجس', latitude: 24.7 + Number(id) / 100, longitude: 46.7 + Number(id) / 100, phone: '966512345678', has_whatsapp: true, email: null, source_count: 1, sources: ['qa_fixture'], reason: 'بيانات اختبار معزولة' })

async function setup(page: Page) {
  const writes: string[] = []
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__FARQ_QA_SESSION__ = { accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }
  })
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/street-density')) return route.fulfill({ json: { type: 'FeatureCollection', features: [] } })
    if (path.endsWith('/districts')) return route.fulfill({ status: 404, json: { error: 'not_found' } })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates') && route.request().method() === 'GET') return route.fulfill({ json: { ok: true, data: [{ name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', language: 'ar' }, { name: 'monthly_prices', status: 'REJECTED', category: 'UTILITY', language: 'ar', rejected_reason: 'INCORRECT_CATEGORY', components: [{ type: 'BODY', text: 'تحديث الأسعار الشهري' }] }] } })
    if (path.endsWith('/send-status')) return route.fulfill({ json: { send: false } })
    if (path.endsWith('/search')) return route.fulfill({ json: { total: 3, rows: [row('1', 'مؤسسة الأنابيب الحديثة'), row('2', 'مستودع الصناعية'), row('3', 'سباكة الخليج')], parsed: { keywords: ['سباكة'] } } })
    // reads (POST only because of the body): trade clusters and specialty suggestions
    if (path.endsWith('/clusters')) return route.fulfill({ json: { clusters: [], wholesale: 0, basis: '' } })
    if (path.endsWith('/suggest-specialties')) return route.fulfill({ json: { suggestions: [] } })
    writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 403, json: { error: 'QA_BLOCKED' } })
  })
  await page.route('**/_api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/whatsapp/pricing')) return route.fulfill({ json: { ok: true, data: { enabled: true, category: 'MARKETING', price_sar: 0.17, currency: 'SAR' } } })
    if (route.request().method() !== 'GET') writes.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 503, json: { ok: false, error: { message: 'QA: blocked' } } })
  })
  return writes
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test('campaign: choose → tray under the map → review says sending is closed → draft in this page only, nothing sent', async ({ page }) => {
  const writes = await setup(page)
  await page.goto('/targeting')
  await expect(page.getByLabel('المدينة', { exact: true })).toHaveValue('Riyadh')
  await page.getByLabel('وش تبي توصل له؟').fill('سباكة')
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
  // the tray is hidden until a recipient is chosen
  await expect(page.getByTestId('campaign-tray')).toHaveCount(0)
  for (const name of ['مؤسسة الأنابيب الحديثة', 'مستودع الصناعية', 'سباكة الخليج']) await page.getByRole('checkbox', { name: `اختر ${name} للحملة` }).check()
  const tray = page.getByTestId('campaign-tray')
  // summary: server price × recipients, before tax
  await expect(tray.getByText('اخترت 3 منشأة')).toBeVisible()
  await expect(tray.getByText(/0\.51\s*قبل الضريبة/)).toBeVisible()
  await expect(tray.getByRole('img', { name: 'ريال' }).first()).toBeVisible()
  await tray.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m07.png' })
  await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
  // the approved campaign template is chosen; the rejected one is not offered (only approved ones are listed)
  await expect(tray.getByLabel('القالب (المعتمدة من ميتا)')).toHaveValue('farq_outreach_ar')
  await expect(tray.getByLabel('القالب (المعتمدة من ميتا)').locator('option[value="monthly_prices"]')).toHaveCount(0)
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m08.png', fullPage: true })
  await tray.getByRole('button', { name: 'أرسل الحملة' }).click()
  const review = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
  await expect(review).toBeVisible()
  await expect(review.getByText('الإرسال غير مفعّل')).toBeVisible()
  await expect(review.getByRole('button', { name: /أرسل إلى 3 موردين · التكلفة 0\.51 ريال قبل الضريبة/ })).toBeDisabled()
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m11c.png' })
  await review.getByRole('button', { name: 'احفظ الحملة كمسودة' }).click()
  await expect(page.getByText(/الحملة محفوظة كمسودة في هذه الصفحة/)).toBeVisible()
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  expect(writes).toEqual([])
})

test('campaign results (mocked in the browser, no network): each recipient shows its stage, nothing is resent', async ({ page }) => {
  const writes = await setup(page)
  const sends: string[] = []
  // Overrides only for this test, answered by Playwright inside the browser: no request leaves the machine.
  await page.route('**/_targeting/send-status', (route) => route.fulfill({ json: { send: true } }))
  await page.route('**/_targeting/send-farq', (route) => { sends.push(route.request().postDataJSON().mode || 'register'); return route.fulfill({ json: { ok: true, sent: [{ poi_key: '1' }, { poi_key: '2' }], failed: [{ poi_key: '3', error: 'رقم غير صالح' }] } }) })
  await page.goto('/targeting')
  await page.getByLabel('وش تبي توصل له؟').fill('سباكة')
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
  for (const i of [0, 1, 2]) await page.getByRole('checkbox').nth(i).check()
  const tray = page.getByTestId('campaign-tray')
  await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
  await tray.getByRole('button', { name: 'أرسل الحملة' }).click()
  const sheet = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
  await sheet.getByRole('button', { name: /أرسل إلى 3 موردين/ }).click()
  const result = page.getByRole('dialog', { name: 'نتيجة الإرسال' })
  await expect(result.getByText('أُرسلت 2 من 3')).toBeVisible()
  await expect(result.getByText('ما وصلت: رقم غير صالح')).toBeVisible()
  await expect(result.getByRole('button', { name: /أعد|إعادة/ })).toHaveCount(0)
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m12.png' })
  await result.getByRole('button', { name: 'تم' }).click()
  await expect(page.getByText(/تم بحمد الله، أرسلنا 2 رسالة · ما وصلت 1/)).toBeVisible()
  expect(sends).toEqual(['register', 'template']) // one register + one send, never a retry
  expect(writes).toEqual([])
})
