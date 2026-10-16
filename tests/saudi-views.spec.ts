import { expect, test, type Page } from '@playwright/test'
import { RFQ_ID, comparison, outcomes, rfq } from '../src/dev/fixtures'

/*
 * «Saudi touch» on the B2B screens: riyal sign + VAT basis on prices, Hijri beside Gregorian dates,
 * the time-of-day greeting, and the Sunday–Thursday working week on the new-request date pickers.
 * Every network call is answered here; anything unmocked is refused (nothing leaves the machine).
 */
const SHOTS = 'docs/qa/saudi-touch'
// Sunday 18 Oct 2026, 09:00 Saudi time (06:00 UTC): a working day, morning.
const MORNING = new Date('2026-10-18T06:00:00Z')
const EVENING = new Date('2026-10-18T16:00:00Z') // 19:00 Saudi time

const summary = {
  id: RFQ_ID, status: 'SENT', created_at: '2026-10-08T07:00:00Z', supplier_count: 5, response_count: 0, opened_count: 4, expired_count: 0,
  line_count: 5, quote_deadline: '2026-10-22', received_base_quote_total: null,
  delivery: { city: 'الرياض', site_address: 'توريد كهرباء — فيلا النرجس — الرياض', required_date: '2026-10-29' },
}
const draft = { ...summary, id: '00000000-0000-4000-8000-000000000002', status: 'DRAFT_NOT_SENT', response_count: 0, delivery: { city: 'جدة', site_address: 'مستودع جدة — جدة' } }

async function setup(page: Page, at: Date) {
  const refused: string[] = []
  await page.clock.setFixedTime(at)
  await page.addInitScript(() => {
    localStorage.setItem('farq_construction_session_v1', JSON.stringify({ accessToken: 'qa-no-real-token', refreshToken: 'qa-no-real-token', expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, user: { id: 'qa-user', email: 'abdulrhman@farq.sa', emailVerified: true, displayName: 'سارة العتيبي' } }))
  })
  await page.route('**/_targeting/**', (route) => { refused.push(route.request().url()); return route.fulfill({ status: 403, json: { error: 'QA_BLOCKED' } }) })
  await page.route('**/_api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } })
    if (route.request().method() === 'GET') {
      if (path.endsWith('/construction/rfqs')) return ok({ rfqs: [summary, draft] })
      if (path.endsWith(`/rfqs/${RFQ_ID}/comparison`)) return ok(comparison)
      if (path.endsWith(`/rfqs/${RFQ_ID}/supplier-outcomes`)) return ok(outcomes)
      if (path.endsWith(`/rfqs/${RFQ_ID}`)) return ok(rfq)
    }
    refused.push(`${route.request().method()} ${path}`)
    return route.fulfill({ status: 503, json: { ok: false, error: { message: 'QA: unmocked request blocked' } } })
  })
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())
  return refused
}

test('home: morning greeting, Hijri beside the Gregorian date on each request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await setup(page, MORNING)
  await page.goto('/requests')
  await expect(page.getByRole('heading', { name: 'طلبات التسعير' })).toBeVisible()
  await expect(page.getByText('صباح الخير، سارة')).toBeVisible()
  // quote deadline 22 Oct 2026 = 11 Jumada al-Ula 1448 (Umm al-Qura); the draft's 8 Oct = 27 Rabi al-Akhir 1448
  await expect(page.getByRole('button', { name: /توريد كهرباء/ })).toContainText('آخر موعد 22 أكتوبر 2026 · 11 جمادى الأولى 1448 هـ')
  await expect(page.getByRole('button', { name: /مستودع جدة/ })).toContainText('8 أكتوبر 2026 · 27 ربيع الآخر 1448 هـ')
  await page.screenshot({ path: `${SHOTS}/views-desktop-requests.png`, fullPage: true })
})

test('home: evening greeting after 12:00 Saudi time', async ({ page }) => {
  await setup(page, EVENING)
  await page.goto('/requests')
  await expect(page.getByText('مساء النور، سارة')).toBeVisible()
})

test('tracking: delivery date and creation date carry the Hijri date', async ({ page }) => {
  await setup(page, MORNING)
  await page.goto(`/requests/${RFQ_ID}`)
  await expect(page.getByText(/قبل 20 أكتوبر 2026/)).toBeVisible()
  await expect(page.getByText(/أُنشئ الطلب .*1448 هـ/)).toBeVisible()
})

for (const [width, height, name] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']] as const) {
  test(`comparison: riyal sign and VAT basis on every price (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const refused = await setup(page, MORNING)
    await page.goto(`/requests/${RFQ_ID}/compare`)
    const offers = page.getByRole('region', { name: 'العروض المستلمة' })
    await expect(offers).toBeVisible()
    const best = offers.getByRole('listitem').first()
    await expect(best.getByRole('img', { name: 'ريال' }).first()).toBeVisible()
    await expect(best).toContainText('67,942') // l1 … l5 of s1, all tax-inclusive
    await expect(best).toContainText('شامل الضريبة ١٥٪')
    await expect(best).toContainText('1448 هـ') // when the quote was submitted, with its Hijri date
    await expect(page.getByText('ر.س')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/views-${name}-comparison.png`, fullPage: true })
    await page.getByRole('button', { name: 'قارن البنود بنداً بنداً' }).click()
    await expect(page.getByRole('img', { name: 'ريال' }).first()).toBeVisible()
    await expect(page.getByText('شامل الضريبة ١٥٪').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/views-${name}-comparison-lines.png`, fullPage: true })
    expect(refused).toEqual([])
  })

  test(`requests list screenshot (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await setup(page, MORNING)
    await page.goto('/requests')
    await expect(page.getByText('صباح الخير، سارة')).toBeVisible()
    if (name === 'mobile') await page.screenshot({ path: `${SHOTS}/views-mobile-requests.png`, fullPage: true })
  })
}

test.describe('new request: the Saudi working week', () => {
  for (const [width, height, name] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']] as const) {
    test(`Friday deadline moves to Sunday with a weekend note (${name})`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      // Sunday 18 Oct: the default quote deadline (+5 days) is Friday 23 Oct, so it opens on Sunday 25 Oct.
      await page.clock.setFixedTime(MORNING)
      await page.goto('/?harness=new')
      await expect(page.getByRole('heading', { name: 'وش تبي تسعّر؟' })).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/views-${name}-new-request.png`, fullPage: true })
      await page.getByRole('radio', { name: /اكتب احتياجاتك/ }).click()
      await page.getByLabel('البند').fill('كيبل نحاس 4×16 مم²')
      await page.getByLabel('الكمية').fill('500')
      await page.getByLabel('الكمية').press('Enter')
      await page.getByRole('button', { name: 'التالي', exact: true }).click()
      await page.getByRole('button', { name: 'التالي: التوصيل' }).click()
      await expect(page.getByRole('heading', { name: 'وين ومتى التوريد؟' })).toBeVisible()
      const deadline = page.getByLabel('آخر موعد للعروض')
      await expect(deadline).toHaveValue('2026-10-25')
      await expect(page.getByLabel('موعد التوريد')).toHaveValue('2026-11-01') // +14 days, a Sunday
      await page.getByLabel('موعد التوريد').fill('2026-11-12') // Thursday: a working day, stays
      await expect(page.getByLabel('موعد التوريد')).toHaveValue('2026-11-12')
      // picking a Friday lands on the Sunday after, and says why
      await deadline.fill('2026-10-30')
      await expect(deadline).toHaveValue('2026-11-01')
      await expect(page.getByText('الجمعة إجازة نهاية الأسبوع، وأقرب يوم عمل الأحد 1 نوفمبر 2026.')).toBeVisible()
      await expect(page.getByText(/1448 هـ/).first()).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/views-${name}-new-request-delivery.png`, fullPage: true })
    })
  }
})
