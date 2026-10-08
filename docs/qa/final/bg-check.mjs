// Live background on integration/today: 3 tones, head office never covered (desktop/phone), reduced motion = static mesh.
import { chromium } from '@playwright/test'
const B = process.env.BASE || 'http://localhost:5190', OUT = 'docs/qa/final/bg'
const b = await chromium.launch({ channel: 'chrome' })
const hubCheck = (key) => { const e = window.__liveBg[key]; const h = e.V[e.HUB]; const covered = e.boxes.filter((x) => h.x > x[0] && h.x < x[2] && h.y > x[1] && h.y < x[3]).length; const s = e.stats(); return { hub: [Math.round(h.x), Math.round(h.y)], covered, frames: s.frames, p95: s.p95, p99: s.p99, max: s.max, rounds: s.rounds, far: s.far, near: s.near, none: s.none, sync: s.sync } }
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const tone of ['light', 'deep', 'accent']) {
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(`${B}/live-bg?tone=${tone}&full=1`); await p.waitForFunction((t) => window.__liveBg?.[t]?.stats().frames > 0, tone, { timeout: 15000 }); await p.waitForTimeout(12000)
    await p.screenshot({ path: `${OUT}/${tone}-${w}.png` })
    console.log(JSON.stringify({ page: `live-bg ${tone}`, w, ...(await p.evaluate(hubCheck, tone)) })); await p.close()
  }
  for (const path of ['/login', '/?harness=tracking&bg=1', '/?harness=comparison&bg=1', '/?harness=new&bg=1']) {
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(B + path); await p.waitForFunction(() => window.__liveBg?.app, null, { timeout: 15000 }); await p.waitForTimeout(6000)
    console.log(JSON.stringify({ page: path, w, ...(await p.evaluate(hubCheck, 'app')) })); await p.close()
  }
  const p = await b.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' })
  await p.goto(`${B}/live-bg?tone=deep&full=1`); await p.waitForFunction(() => window.__liveBg?.deep, null, { timeout: 15000 }); await p.waitForTimeout(3000)
  const a = await p.screenshot({ path: `${OUT}/reduced-deep-${w}.png` }); await p.waitForTimeout(2000); const c = await p.screenshot()
  console.log(JSON.stringify({ page: 'reduced-motion deep', w, frames: await p.evaluate(() => window.__liveBg.deep.stats().frames), identicalAfter2s: a.equals(c) })); await p.close()
}
await b.close()
