import { expect, test, type Page } from '@playwright/test'

const rows = [
  {
    poi_key: 'supplier-1', name_ar: 'مؤسسة الأنابيب الحديثة', name_en: null,
    category_ar: 'أدوات صحية', category: null, city_en: 'Riyadh', region_ar: 'الرياض',
    district_ar: 'العليا', street_ar: 'طريق العليا العام', latitude: 24.71, longitude: 46.68,
    location_precision: 'point', phone: '966500000001', has_whatsapp: true,
    email: null, source_count: 1, sources: ['qa'], taxonomy_sub: 'build.plumbing_supply',
    role_badges: ['يبيع'], specialties: [],
  },
]

async function installMapFixtures(page: Page, options: { searchFailures?: number } = {}) {
  let remainingSearchFailures = options.searchFailures || 0
  const apiPosts: string[] = []
  const searches: Array<Record<string, unknown>> = []
  await page.addInitScript(() => {
    ;(window as unknown as Record<string, unknown>).__FARQ_QA_SESSION__ = {
      accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token',
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
      user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'اختبار' },
    }
    localStorage.setItem('farq:pricing-map-analytics-consent-v2', 'rejected')
  })
  await page.route('**/_targeting/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cities')) return route.fulfill({ json: [{ en: 'Riyadh', ar: 'الرياض', n: 1 }, { en: 'Jeddah', ar: 'جدة', n: 1 }] })
    if (path.endsWith('/market-summary')) return route.fulfill({ json: { ok: true, summary: { total: 1, districts_count: 1, top_districts: [{ district_ar: 'العليا', n: 1 }], main_activities: [{ main_id: 'build', main_ar: 'مواد بناء', n: 1 }], n_wholesale: 0, n_whatsapp: 1, n_specialties: 1, n_approx: 0, n_cr: 1, basis: 'اختبار' } } })
    if (path.endsWith('/district-counts')) return route.fulfill({ json: { ok: true, city: 'Riyadh', total: 1, districts: [{ district_ar: 'العليا', n: 1, n_wholesale: 0, n_whatsapp: 1 }], basis: 'اختبار' } })
    if (path.endsWith('/districts')) return route.fulfill({ json: { type: 'FeatureCollection', features: [] } })
    if (path.endsWith('/street-density/catalog')) return route.fulfill({ json: { mains: [] } })
    if (path.endsWith('/street-density')) return route.fulfill({ json: { type: 'FeatureCollection', features: [], basis: 'اختبار' } })
    if (path.endsWith('/template-status')) return route.fulfill({ json: { name: 'qa_template', status: 'APPROVED', holder: { holder_rfq_id: 'qa-holder' } } })
    if (path.endsWith('/templates')) return route.fulfill({ json: { ok: true, data: [] } })
    if (path.endsWith('/search')) {
      const body = route.request().postDataJSON() as Record<string, unknown>
      searches.push(body)
      if (remainingSearchFailures > 0 && String(body.q || '').trim()) { remainingSearchFailures -= 1; return route.fulfill({ status: 503, json: { error: 'QA_SEARCH_UNAVAILABLE' } }) }
      return route.fulfill({ json: { total: rows.length, rows, parsed: { keywords: ['مواسير'] }, areas: { districts: [{ name: 'العليا', n: 1 }], streets: [{ name: 'طريق العليا العام', district: 'العليا', n: 1 }], wholesale: 0, roles: [{ name: 'يبيع', n: 1 }], specialties: [] }, understood: {} } }) }
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/_api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST') apiPosts.push(path)
    if (path.endsWith('/whatsapp/pricing')) return route.fulfill({ json: { ok: true, data: { enabled: true, price_sar: 0.17, currency: 'SAR' } } })
    if (path.endsWith('/api/business/context')) return route.fulfill({ json: { ok: true, data: { organizations: [{ id: 'org-1', name: 'مؤسسة الاختبار', role: 'OWNER', subscriptions: [{ sectorCode: 'construction' }] }] } } })
    if (path.endsWith('/admin/marketing/campaigns')) return route.fulfill({ json: { ok: true, data: { id: 'campaign-1' } } })
    if (path.includes('/admin/marketing/campaigns/campaign-1/recipients/batch')) return route.fulfill({ json: { ok: true, data: { accepted: 1 } } })
    if (path.endsWith('/api/business/opportunity-requests')) return route.fulfill({ json: { ok: true, data: { request: { id: 'draft-1' } } } })
    return route.fulfill({ json: { ok: true, data: {} } })
  })
  return { apiPosts, searches }
}

test.describe('خريطة الفرص: التدفق الحالي', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })

  test('البحث الحر يبدأ من اختيار الهدف وينتج قائمة قابلة للمراجعة', async ({ page }) => {
    await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^بحث حر عن مورد/ }).click()
    await expect(page.getByRole('dialog', { name: 'وش هدفك؟', exact: true })).toBeHidden()
    await page.getByLabel('وش تبي توصل له؟').fill('مواسير PPR')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByText('مؤسسة الأنابيب الحديثة', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /حدد اللي عندهم واتساب/ })).toBeVisible()
  })

  test('فشل البحث لا يجمّد الخريطة ويتيح إعادة المحاولة', async ({ page }) => {
    await installMapFixtures(page, { searchFailures: 2 })
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^بحث حر عن مورد/ }).click()
    const input = page.getByLabel('وش تبي توصل له؟')
    await input.fill('مواسير')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('خدمة الاستهداف ما ردّت')
    await expect(input).toBeEnabled()
    await expect(page.getByRole('button', { name: 'ابحث', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByText('مؤسسة الأنابيب الحديثة', { exact: true })).toBeVisible()
  })

  test('تغيير المدينة يقيّد البحث بالمدينة المختارة', async ({ page }) => {
    const { searches } = await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^بحث حر عن مورد/ }).click()
    await page.getByRole('button', { name: 'الرياض', exact: true }).click()
    await page.getByRole('option', { name: 'جدة', exact: true }).click()
    await page.getByLabel('وش تبي توصل له؟').fill('مواسير')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect.poll(() => searches.some((body) => body.city === 'Jeddah' && body.q === 'مواسير')).toBe(true)
  })

  test('اختيار الحي ثم الشارع يقيّد المطابقة بالنطاقين', async ({ page }) => {
    const { searches } = await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^بحث حر عن مورد/ }).click()
    await page.getByLabel('وش تبي توصل له؟').fill('مواسير')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByText('مؤسسة الأنابيب الحديثة', { exact: true })).toBeVisible()

    const scope = page.getByRole('group', { name: 'اختر مدينة أو حياً أو شارعاً للخريطة' })
    await scope.getByRole('button', { name: 'الحي', exact: true }).click()
    await page.getByRole('option', { name: 'العليا', exact: true }).click()
    await expect.poll(() => searches.some((body) => (body.filters as { district?: string })?.district === 'العليا')).toBe(true)

    await scope.getByRole('button', { name: 'الشارع', exact: true }).click()
    await page.getByRole('option', { name: /طريق العليا العام · العليا/ }).click()
    await expect.poll(() => searches.some((body) => {
      const filters = body.filters as { district?: string; street?: string } | undefined
      return filters?.district === 'العليا' && filters.street === 'طريق العليا العام'
    })).toBe(true)
  })

  test('اختيار مورد يحفظ قائمة مراجعة أو ينشئ طلب تسعير، من دون حملة', async ({ page }) => {
    const { apiPosts } = await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^بحث حر عن مورد/ }).click()
    await page.getByLabel('وش تبي توصل له؟').fill('مواسير')
    await page.getByRole('button', { name: 'ابحث', exact: true }).click()
    await expect(page.getByText('مؤسسة الأنابيب الحديثة', { exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: /أضف مؤسسة الأنابيب الحديثة إلى قائمة المراجعة/ }).check()
    const review = page.getByRole('region', { name: 'قائمة المراجعة المختارة' })
    await expect(review.getByRole('button', { name: 'حفظ القائمة', exact: true })).toBeVisible()
    await expect(review.getByRole('button', { name: 'إنشاء طلب تسعير', exact: true })).toBeVisible()
    await review.getByRole('button', { name: 'حفظ القائمة', exact: true }).click()
    await expect(page).toHaveURL(/#review=draft-1/)
    expect(apiPosts.some((path) => path.includes('/send-farq'))).toBe(false)
  })

  test('الاستهداف الذكي يحفظ مسودة قابلة للمراجعة من دون إرسال', async ({ page }) => {
    const { apiPosts } = await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^استهدف جهات/ }).click()
    const dialog = page.getByRole('dialog', { name: 'استهداف ذكي', exact: true })
    await dialog.getByLabel('طلب الاستهداف').fill('استهدف شركات المقاولات في الرياض للتعريف بخدمة فرق')
    await dialog.getByRole('button', { name: 'حلّل طلبي', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'جهّز مسودة الحملة', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'جهّز مسودة الحملة', exact: true }).click()
    await expect(dialog.getByText(/لم تُرسل أي رسالة/)).toBeVisible()
    await dialog.getByRole('button', { name: 'فتح المسودة', exact: true }).click()
    await expect(page.getByTestId('campaign-tray')).toBeVisible()
    await expect(page.getByRole('button', { name: 'راجع الإرسال', exact: true })).toBeVisible()
    expect(apiPosts.some((path) => path.includes('/send-farq'))).toBe(false)
  })

  test('استكشاف السوق يغلق اختيار الهدف ويبقي عناصر الخريطة قابلة للاستخدام', async ({ page }) => {
    await installMapFixtures(page)
    await page.goto('/opportunity-map')
    await page.getByRole('button', { name: /^استكشف السوق/ }).click()
    await expect(page.getByRole('dialog', { name: 'وش هدفك؟', exact: true })).toBeHidden()
    await expect(page.getByRole('heading', { name: 'سوق الرياض' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'توسيع الخريطة' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'الرياض', exact: true })).toBeVisible()
  })
})
