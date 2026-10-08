import { expect, test } from '@playwright/test'

const SHOTS = 'docs/qa/m4/after'

test.use({ viewport: { width: 1440, height: 900 } })

test('01→02→التوصيل→الإرسال: typed items, photo scan, review, delivery (no network)', async ({ page }) => {
  const refused: string[] = []
  page.on('console', (m) => { if (m.text().startsWith('[harness] refused')) refused.push(m.text()) })
  await page.goto('/?harness=new')
  await expect(page.getByRole('heading', { name: 'وش تبي نسعّر لك اليوم؟' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01-method.png` })

  // photo: scan answers three lines
  await page.getByRole('radio', { name: /صوّرها/ }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /اسحب الملف هنا/ }).click()])
  await chooser.setFiles({ name: 'page1.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByText('3 بند في الطلب')).toBeVisible()

  // typed: one more line by keyboard
  await page.getByRole('radio', { name: /اكتب الطلبات/ }).click()
  await page.getByLabel('البند').fill('صبة خرسانة جاهزة')
  await page.getByLabel('الكمية').fill('12')
  await page.getByLabel('الكمية').press('Enter')
  await expect(page.getByText('4 بند في الطلب')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01-lines.png` })

  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByRole('heading', { name: /قرأنا 4 بند من الصور/ })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/02-review.png`, fullPage: true })

  // a line with no supplier is flagged and listed under «تحتاج تأكيد»
  await page.getByRole('tab', { name: /تحتاج تأكيد/ }).click()
  await page.getByRole('button', { name: 'تأكد' }).first().click()
  await page.screenshot({ path: `${SHOTS}/02-confirm-open.png`, fullPage: true })
  await page.getByRole('tab', { name: /كل البنود/ }).click()
  await page.getByRole('button', { name: /من .* مورد/ }).first().click()
  await page.screenshot({ path: `${SHOTS}/02-suppliers-open.png`, fullPage: true })

  await page.getByRole('button', { name: 'التالي: التوصيل' }).click()
  await expect(page.getByRole('heading', { name: 'وين ومتى التوريد؟' })).toBeVisible()
  await expect(page.getByLabel('اسم المشروع')).toHaveValue('فيلا النرجس')
  await page.screenshot({ path: `${SHOTS}/03-delivery.png` })

  await page.getByRole('button', { name: 'التالي: الإرسال' }).click()
  await expect(page.getByRole('heading', { name: 'جاهز للإرسال' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'أرسل الطلب' })).toBeEnabled()
  await page.screenshot({ path: `${SHOTS}/04-send.png` })
  // Sending is not pressed here: create/dispatch are real writes and stay out of the harness.
  expect(refused).toEqual([])
})
