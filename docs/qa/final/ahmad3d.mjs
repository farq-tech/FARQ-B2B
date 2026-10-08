// Ahmad 3D on the landing: first screen while he runs / stops (1440, 390) with a zoomed crop around him, p99; ?ahmad=2d still works.
import { chromium } from '@playwright/test'
const B = process.env.BASE || 'http://localhost:5190', O = 'docs/qa/final/ahmad3d'
const b = await chromium.launch({ channel: 'chrome' })
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await p.goto(B + '/'); await p.waitForFunction(() => window.__liveBg?.page?.S, null, { timeout: 20000 })
  const shots = []
  for (let k = 0; k < 40 && shots.length < 4; k++) {
    await p.waitForTimeout(600)
    const st = await p.evaluate(() => { const e = window.__liveBg.page, w = e.S.walkers.find((x) => x.runner); if (!w) return null
      const t = e.simT, ph = t < w.start ? 'wait' : t < w.arrive ? 'run-out' : t < w.tc ? 'at-supplier' : t < w.home ? 'run-back' : 'home'
      const d = ph === 'run-out' ? e.outD(w, t)[0] : ph === 'run-back' ? e.backD(w, t)[0] : ph === 'at-supplier' ? w.len : 0
      const [x, y] = e.at(w, d); return { ph, x, y: y - window.scrollY, dir: e.RS.bucket } })
    if (st && (shots.length === 0 || shots[shots.length - 1].ph !== st.ph) && st.ph !== 'wait') {
      const f = `${O}/${w}-${shots.length}-${st.ph}.png`; await p.screenshot({ path: f })
      await p.screenshot({ path: `${O}/${w}-${shots.length}-${st.ph}-zoom.png`, clip: { x: Math.max(0, st.x - 70), y: Math.max(0, st.y - 120), width: 140, height: 150 } })
      shots.push(st)
    }
  }
  console.log(w, JSON.stringify(shots.map((s) => s.ph + ':' + s.dir)))
  await p.waitForTimeout(6000)
  console.log(w, 'stats', JSON.stringify(await p.evaluate(() => { const s = window.__liveBg.page.stats(); return { frames: s.frames, p95: s.p95, p99: s.p99, max: s.max } })))
  await p.close()
}
const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } }); await p2.goto(B + '/?ahmad=2d'); await p2.waitForTimeout(6000); await p2.screenshot({ path: `${O}/1440-ahmad2d-flag.png` }); await p2.close()
await b.close()
