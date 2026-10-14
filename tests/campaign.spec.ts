import { expect, test, type Page } from '@playwright/test'

/*
 * Supplier campaign (Figma B2B M07 → M11c): map first with a collapsed list, summary bar with the
 * server price × recipients, review that says sending is closed before anything is pressed,
 * and «احفظ الحملة كمسودة». Every network write is blocked and recorded: nothing may be sent.
 */
const row = (id: string, name: string) => ({ poi_key: id, name_ar: name, name_en: null, category_ar: 'سباكة', category: null, city_en: 'Riyadh', region_ar: 'الرياض', district_ar: 'النرجس', latitude: 24.7 + Number(id) / 100, longitude: 46.7 + Number(id) / 100, phone: '966512345678', has_whatsapp: true, email: null, source_count: 1, sources: ['qa_fixture'], reason: 'بيانات اختبار معزولة' })

async function setup(page: Page) {
  const writes: string[] = []
  await page.addInitScript(() => {
    if (!localStorage.getItem('farq_construction_session_v1')) localStorage.setItem('farq_construction_session_v1', JSON.stringify({ accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 7200, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' } }))
  })
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 100 }] })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates') && route.request().method() === 'GET') return route.fulfill({ json: { ok: true, data: [{ name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', language: 'ar' }, { name: 'monthly_prices', status: 'REJECTED', category: 'UTILITY', language: 'ar', rejected_reason: 'INCORRECT_CATEGORY', components: [{ type: 'BODY', text: 'تحديث الأسعار الشهري' }] }] } })
    if (path.endsWith('/send-status')) return route.fulfill({ json: { send: false } })
    if (path.endsWith('/search')) return route.fulfill({ json: { total: 3, rows: [row('1', 'مؤسسة الأنابيب الحديثة'), row('2', 'مستودع الصناعية'), row('3', 'سباكة الخليج')], parsed: { keywords: ['سباكة'] } } })
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

test('campaign: map first → choose → review says sending is closed → save draft, nothing sent', async ({ page }) => {
  const writes = await setup(page)
  await page.goto('/targeting')
  await page.getByLabel('المدينة', { exact: true }).selectOption('Riyadh')
  await page.getByLabel('وش تبي توصل له؟').fill('سباكة')
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
  // collapsed sheet: the count and the hint, not the list
  await expect(page.getByText('اضغط الدبوس لتختار المورد')).toBeVisible()
  await expect(page.getByRole('checkbox').first()).toBeHidden()
  await page.getByRole('button', { name: /نتيجة · اسحب للأعلى للقائمة/ }).click()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('checkbox').nth(2).check()
  // summary bar: server price × recipients, before tax
  await expect(page.getByText('اخترت 3 موردين')).toBeVisible()
  await expect(page.getByText(/= 0\.51 ر\.س قبل الضريبة/)).toBeVisible()
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m07.png' })
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  // M08: the approved campaign template is chosen; the rejected one says why, in Arabic, with Meta's code kept
  const step = page.getByRole('dialog', { name: 'رسالة الحملة' })
  await expect(step.getByRole('heading', { name: 'اختر قالباً معتمداً من ميتا' })).toBeVisible()
  await expect(step.getByRole('radio').first()).toBeChecked()
  await expect(step.getByText(/التصنيف ما يناسب نص الرسالة/)).toBeVisible()
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m08.png', fullPage: true })
  await step.getByRole('button', { name: 'التالي', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
  await expect(review).toBeVisible()
  await expect(review.getByText('الإرسال غير مفعّل')).toBeVisible()
  await expect(review.getByRole('button', { name: /أرسل إلى 3 موردين · التكلفة 0\.51 ر\.س/ })).toBeDisabled()
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m11c.png' })
  await review.getByRole('button', { name: 'احفظ الحملة كمسودة' }).click()
  await expect(page.getByText(/حفظنا الحملة كمسودة/)).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('farq.targeting.draft') || '{}').keys?.length)).toBe(3)
  expect(writes).toEqual([])
})

test('campaign results (mocked in the browser, no network): each recipient shows its stage, nothing is resent', async ({ page }) => {
  const writes = await setup(page)
  const sends: string[] = []
  // Overrides only for this test, answered by Playwright inside the browser: no request leaves the machine.
  await page.route('**/_targeting/send-status', (route) => route.fulfill({ json: { send: true } }))
  await page.route('**/_targeting/send-farq', (route) => { sends.push(route.request().postDataJSON().mode || 'register'); return route.fulfill({ json: { ok: true, sent: [{ poi_key: '1' }, { poi_key: '2' }], failed: [{ poi_key: '3', error: 'رقم غير صالح' }] } }) })
  await page.goto('/targeting')
  await page.getByLabel('المدينة', { exact: true }).selectOption('Riyadh')
  await page.getByLabel('وش تبي توصل له؟').fill('سباكة')
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
  await page.getByRole('button', { name: /نتيجة · اسحب للأعلى للقائمة/ }).click()
  for (const i of [0, 1, 2]) await page.getByRole('checkbox').nth(i).check()
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await page.getByRole('dialog', { name: 'رسالة الحملة' }).getByRole('button', { name: 'التالي', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'المراجعة والتكلفة' })
  await sheet.getByRole('button', { name: /أرسل إلى 3 موردين/ }).click()
  const result = page.getByRole('dialog', { name: 'نتيجة الإرسال' })
  await expect(result.getByText('أُرسلت 2 من 3')).toBeVisible()
  await expect(result.getByText('ما وصلت: رقم غير صالح')).toBeVisible()
  await expect(result.getByRole('button', { name: /أعد|إعادة/ })).toHaveCount(0)
  await page.screenshot({ path: 'docs/qa/b2b/campaign-m12.png' })
  await result.getByRole('button', { name: 'تم' }).click()
  await expect(page.getByText(/أُرسلت 2 رسالة · ما وصلت 1/)).toBeVisible()
  expect(sends).toEqual(['register', 'template']) // one register + one send, never a retry
  expect(writes).toEqual([])
})
