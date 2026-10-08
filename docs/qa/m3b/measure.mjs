// QA: live-bg frame times + Ahmad sit-out rate on the dev page. Usage: node docs/qa/m3b/measure.mjs [seconds]
import { chromium } from '@playwright/test'
const secs = Number(process.argv[2] || 60), base = process.env.BASE || 'http://localhost:5190'
const browser = await chromium.launch({ channel: 'chrome' })
const out = []
for (const [w, h] of [[1440, 900], [390, 844]]) for (const tone of ['light', 'deep', 'accent']) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${base}/live-bg?tone=${tone}&full=1`)
  await page.waitForFunction((t) => window.__liveBg?.[t], tone)
  const sim = await page.evaluate((t) => window.__liveBg[t].simulate(100), tone)
  await page.waitForTimeout(secs * 1000)
  const st = await page.evaluate((t) => window.__liveBg[t].stats(), tone)
  out.push({ viewport: `${w}x${h}`, tone, sim100: sim, frames: st.frames, avg: +st.avg.toFixed(3), p95: +st.p95.toFixed(3), max: +st.max.toFixed(3), rounds: st.rounds, near: st.near, sits: st.sits })
  await page.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 1))
