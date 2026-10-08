// Final QA shots on integration/today (dev server :5190, fixtures only — no network writes). node docs/qa/final/shoot.mjs
import { chromium } from '@playwright/test'
const B = process.env.BASE || 'http://localhost:5190', OUT = 'docs/qa/final/app'
const browser = await chromium.launch({ channel: 'chrome' })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('request', (r) => { if (r.method() !== 'GET' && !r.url().includes('localhost')) console.log('!! non-GET', r.url()) })
  const shot = async (name, full = true) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: full }) }
  await page.goto(`${B}/`); await page.waitForTimeout(1500); await page.mouse.wheel(0, 20000); await page.waitForTimeout(1500); await page.mouse.wheel(0, -20000); await shot('landing')
  await page.goto(`${B}/login`); await shot('login', false)
  await page.goto(`${B}/?harness=new&bg=1`); await shot('01')
  await page.getByRole('radio', { name: /صوّرها/ }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /اسحب الملف هنا/ }).click()])
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG })
  await page.getByText('3 بند في الطلب').waitFor(); await shot('01-lines')
  await page.getByRole('button', { name: 'التالي', exact: true }).click(); await shot('02')
  await page.getByRole('button', { name: 'التالي: التوصيل' }).click(); await shot('02b-delivery')
  await page.getByRole('button', { name: 'التالي: الإرسال' }).click(); await shot('02c-send')
  await page.goto(`${B}/?harness=tracking&bg=1`); await shot('03')
  await page.goto(`${B}/?harness=comparison&bg=1`); await shot('04')
  await page.goto(`${B}/docs/qa/screens-b/harness.html?screen=award-sheet`); await shot('05', false)
  await page.goto(`${B}/docs/qa/screens-b/harness.html?screen=inbox`); await shot('06', false)
  await page.close()
}
await browser.close()
