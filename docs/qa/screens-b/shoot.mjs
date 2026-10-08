// Full-page screenshots of the track-D harness. Usage: node docs/qa/screens-b/shoot.mjs <outdir> <width> <query>...
import { chromium } from '@playwright/test'
const [out, width, ...qs] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(width) < 600 ? 844 : 900 }, locale: 'ar-SA' })
for (const q of qs) {
  await page.goto(`http://localhost:5193/docs/qa/screens-b/harness.html?${q}`)
  await page.waitForTimeout(2000)
  const name = q.replace(/screen=/, '').replace(/[&=]/g, '-')
  await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true })
  console.log(`${out}/${name}-${width}.png`)
}
await browser.close()
