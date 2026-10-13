import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
const out = process.env.FARQ_REVIEW_OUTPUT
if (!out || !path.isAbsolute(out)) throw new Error('EXPLICIT_LOCAL_OUTPUT_REQUIRED')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const records = []; const errors = []; let externalBlocked = 0
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { externalBlocked++; return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5194/commercial-review')
    await page.getByRole('heading', { name: 'وش هدف منشأتك؟' }).waitFor()
    const response = page.waitForResponse(r => r.url().endsWith('/commercial/discover'))
    await page.getByRole('button', { name: 'ابحث عن بائعين' }).click()
    const data = await (await response).json()
    await page.getByRole('heading', { name: /مرشحون للمراجعة/ }).waitFor()
    if (data.direct.concat(data.potential).some(row => !row.commercial_relationship || row.commercial_identity?.permanent_role !== null || row.reachability?.borrowed_from_other_branch)) throw new Error('CONTEXTUAL_CONTRACT_MISSING')
    if (data.execution_enabled !== false || data.messages_sent !== 0) throw new Error('DISPATCH_OR_UNSAFE_RESPONSE')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    if (overflow) throw new Error('HORIZONTAL_OVERFLOW')
    await page.screenshot({ path: path.join(out, `commercial-review-${width}.png`), fullPage: true })
    await page.locator('select').first().selectOption('marketing')
    await page.locator('textarea').fill('أبيع كراسي انتظار وأبحث عن عيادات')
    const buyers = page.waitForResponse(r => r.url().endsWith('/commercial/discover'))
    await page.getByRole('button', { name: 'ابحث عن مشترين' }).click()
    const buyerData = await (await buyers).json()
    if (buyerData.direct.length || buyerData.potential.some(r => r.role !== 'buyer' || r.verified)) throw new Error('BUYER_ROLE_OR_PROOF_REGRESSION')
    await page.getByRole('heading', { name: /مرشحون للمراجعة/ }).waitFor()
    records.push({ width, purchasePotential: data.potential.length, buyerPotential: buyerData.potential.length, overflow, messages_sent: 0 })
    await context.close()
  }
  if (errors.length) throw new Error(errors.join('; '))
  fs.writeFileSync(path.join(out, 'ui-validation.json'), JSON.stringify({ records, errors, externalBlocked, method: 'Actual local UI and local shared HTTP core; separate ephemeral headless profile; every external browser request aborted.' }, null, 2))
  console.log(JSON.stringify(records))
} finally { await browser.close() }
