// QA: Ahmad sit-out rate + frame times behind real screens (dev harness with fixtures, ?bg=1). node docs/qa/m3b/measure-screens.mjs [seconds]
import { chromium } from '@playwright/test'
const secs = Number(process.argv[2] || 30), base = process.env.BASE || 'http://localhost:5190'
const browser = await chromium.launch({ channel: 'chrome' })
for (const [w, h] of [[1440, 900], [390, 844]]) for (const which of ['tracking', 'comparison', 'new']) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${base}/?harness=${which}&bg=1`)
  await page.waitForFunction(() => window.__liveBg?.app, null, { timeout: 15000 })
  await page.waitForTimeout(1500)
  const sim = await page.evaluate(() => window.__liveBg.app.simulate(100))
  await page.waitForTimeout(secs * 1000)
  const st = await page.evaluate(() => window.__liveBg.app.stats())
  console.log(JSON.stringify({ viewport: `${w}x${h}`, screen: which, sim100: { long: sim.long, near: sim.near, sit: sim.sit, anyClear: sim.anyClear, planMaxMs: +sim.maxMs.toFixed(2) }, frames: st.frames, avg: +st.avg.toFixed(3), p95: +st.p95.toFixed(3), max: +st.max.toFixed(3), rounds: st.rounds, sits: st.sits }))
  await page.close()
}
await browser.close()
