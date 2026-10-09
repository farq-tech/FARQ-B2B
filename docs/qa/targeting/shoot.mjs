// Screens 07–10 on a local targeting service (BASE=http://localhost:5191 → service on :8767; the dev server and this script both block sends). `node docs/qa/targeting/shoot.mjs`
// template-status is answered APPROVED in the browser so the confirm sheet (10) can open; the send endpoint is
// aborted in the browser and counted — the test fails if anything reaches it.
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5190'
const OUT = new URL('./shots/', import.meta.url).pathname
const Q = 'محلات أدوات صحية وسباكة في الرياض'
const browser = await chromium.launch({ channel: 'chrome' })
let sendHits = 0
const report = []
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => report.push(`pageerror ${w}: ${e.message}`))
  await page.route('**/_targeting/send**', (r) => { sendHits++; return r.abort() })
  await page.route('**/_targeting/template-status', (r) => r.fulfill({ json: { name: 'farq_outreach_ar', status: 'APPROVED', category: 'MARKETING', holder: { holder_rfq_id: 'qa-holder' } } }))
  await page.goto(`${BASE}/?harness=targeting`)
  await page.waitForSelector('#targeting-q')
  await page.screenshot({ path: `${OUT}07-empty-${w}.png`, fullPage: w < 768 })
  await page.fill('#targeting-q', Q)
  await page.selectOption('#targeting-city', 'Riyadh')
  await page.click('button[type=submit]')
  await page.waitForSelector('ul li[data-key]', { timeout: 180000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}07-results-${w}.png`, })
  const stats = await page.$$eval('.grid > div > :first-child', (els) => els.map((e) => e.textContent))
  const picked = await page.$$eval('ul li[data-key] input:checked', (els) => els.length)
  report.push(`${w}: stats ${stats.join(' / ')} · checked rows shown ${picked}`)
  await page.getByRole("button", { name: "حدد المناسبين" }).click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}07-selected-${w}.png` })
  if (w < 768) { await page.getByRole("button", { name: /اكتب رسالة الحملة/ }).click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}07-compose-${w}.png` }) }
  await page.getByRole("button", { name: "أرسل الحملة" }).click()
  await page.waitForSelector('[role=dialog]')
  await page.screenshot({ path: `${OUT}10-confirm-${w}.png` })
  await page.getByRole('button', { name: /نعم، أرسل/ }).click()
  await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 30000 })
  report.push(`${w}: after yes → ${await page.textContent('[role=dialog] [role=alert]')}`)
  await page.screenshot({ path: `${OUT}10-blocked-${w}.png` })
  for (const s of ['templates', 'template-new']) {
    await page.goto(`${BASE}/?harness=${s}`)
    await page.waitForTimeout(800)
    if (s === 'template-new') {
      await page.fill('input[placeholder="supplier_invite_plumbing"]', 'supplier_invite_plumbing')
      await page.fill('textarea[aria-label="نص الرسالة"]', 'هلا {{1}}، معك أحمد من فرق.\nيوصلنا طلبات تسعير {{2}} من مقاولين وشركات في {{3}}.')
      const ex = await page.$$('input[placeholder="مثال"]')
      for (const [i, v] of ['أدوات صحية المصدر', 'السباكة', 'الرياض'].entries()) await ex[i]?.fill(v)
    }
    await page.screenshot({ path: `${OUT}${s === 'templates' ? '09' : '08'}-${s}-${w}.png`, fullPage: true })
    if (s === 'template-new' && w < 768) { await page.getByRole('tab', { name: 'المعاينة' }).click(); await page.screenshot({ path: `${OUT}08-preview-${w}.png`, fullPage: true }) }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  report.push(`${w}: horizontal overflow on 08 = ${overflow}px`)
  await page.close()
}
await browser.close()
report.push(`send endpoint requests: ${sendHits}`)
console.log(report.join('\n'))
if (sendHits) process.exit(1)
