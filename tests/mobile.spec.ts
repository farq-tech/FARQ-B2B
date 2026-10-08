import { expect, test } from '@playwright/test'

// Phone layouts (Figma «Mobile — 390»): screenshots for comparison with M01–M04.
const SHOTS = 'docs/qa/m4/mobile'
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })

test('M03 tracking', async ({ page }) => {
  await page.goto('/?harness=tracking')
  await expect(page.getByRole('heading', { name: 'توريد كهرباء' })).toBeVisible() // app bar title
  await expect(page.getByRole('button', { name: 'رجوع' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/m03.png`, fullPage: true })
  // no horizontal scroll on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('M04 comparison', async ({ page }) => {
  await page.goto('/?harness=comparison')
  await expect(page.getByRole('heading', { name: 'وش الفرق؟' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/m04.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('M01 → M02 new request', async ({ page }) => {
  await page.goto('/?harness=new')
  await expect(page.getByRole('heading', { name: 'وش تبي نسعّر لك اليوم؟' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/m01.png` })
  await page.getByRole('radio', { name: /صوّرها/ }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /اسحب الملف هنا/ }).click()])
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByText('3 بند في الطلب')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/m01-lines.png`, fullPage: true })
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'مراجعة البنود' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/m02.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'التالي: التوصيل' }).click()
  await page.screenshot({ path: `${SHOTS}/m-delivery.png`, fullPage: true })
  await page.getByRole('button', { name: 'التالي: الإرسال' }).click()
  await page.screenshot({ path: `${SHOTS}/m-send.png`, fullPage: true })
})
