import { expect, test, type Page } from '@playwright/test'

test.setTimeout(20_000)

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
    if (path.endsWith('/market-summary')) return route.fulfill({ json: { ok: true, summary: { total: 3, districts_count: 1, top_districts: [], densest_street: null, n_wholesale: 0, n_whatsapp: 3, n_specialties: 0, n_approx: 0, n_cr: 0, basis: 'اختبار' } } })
    if (path.endsWith('/district-counts')) return route.fulfill({ json: { ok: true, city: 'Riyadh', districts: [], total: 0, basis: 'اختبار' } })
    if (path.endsWith('/who-buys')) return route.fulfill({ json: { ok: true, buyers: [], subject: { sub_ids: [], label_ar: '' }, basis: 'اختبار' } })
    if (path.includes('/street-density')) return route.fulfill({ json: { type: 'FeatureCollection', features: [], mains: [] } })
    if (path.endsWith('/districts')) return route.fulfill({ status: 404, json: { error: 'not_found' } })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'farq_discover_ar_20261019', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates') && route.request().method() === 'GET') return route.fulfill({ json: { ok: true, data: [{ name: 'farq_discover_ar_20261019', status: 'APPROVED', category: 'MARKETING', language: 'ar' }, { name: 'monthly_prices', status: 'REJECTED', category: 'UTILITY', language: 'ar', rejected_reason: 'INCORRECT_CATEGORY', components: [{ type: 'BODY', text: 'تحديث الأسعار الشهري' }] }] } })
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

test('campaign: preview the approved template before review; no message is sent', async ({ page }) => {
  const writes = await setup(page)
  await page.goto('/targeting')
  await expect(page.getByRole('button', { name: 'الرياض', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('وش تبي توصل له؟').fill('سباكة')
  await page.getByRole('button', { name: 'ابحث', exact: true }).click()
  await page.getByRole('button', { name: 'حدد واتساب', exact: true }).click()

  const tray = page.getByTestId('campaign-tray')
  await expect(tray.getByText('اخترت 3 منشأة')).toBeVisible()
  await tray.getByRole('button', { name: 'اكتب الرسالة' }).click()
  await expect(tray.getByLabel('القالب (المعتمدة من ميتا)')).toHaveValue('farq_discover_ar_20261019')

  const preview = tray.getByTestId('campaign-message-preview')
  await expect(preview).toContainText('معاينة الرسالة قبل الإرسال')
  await expect(preview).toContainText('السلام عليكم {اسم المنشأة}،')
  await tray.getByLabel('نص الرسالة').fill('عرض خاص للموردين هذا الأسبوع.')
  await expect(preview).toContainText('عرض خاص للموردين هذا الأسبوع.')
  await expect(tray).toHaveCSS('overflow-y', 'hidden')

  await tray.getByRole('button', { name: 'أرسل الحملة' }).click()
  const review = page.locator('[role="dialog"]')
  await expect(review).toBeVisible()
  await expect(review.getByText('الإرسال غير مفعّل')).toBeVisible()
  await expect(review.getByRole('button', { name: /أرسل إلى 3 موردين/ })).toBeDisabled()
  expect(writes).toEqual([])
})
