// One layer on every background: the three tones open at different moments, then are drawn at the SAME clock second.
// Proof: same round number, same prices / timeline, and the effects layer (paths, chips, Ahmad) pixel-identical.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
const B = process.env.BASE || 'http://localhost:5190', OUT = 'docs/qa/final/same-layer'
const b = await chromium.launch({ channel: 'chrome' })
const res = []
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const pages = {}
  for (const tone of ['light', 'deep', 'accent']) { // staggered loads: «لحظة تحميل الصفحة» must not matter
    const p = await b.newPage({ viewport: { width: w, height: h } })
    await p.goto(`${B}/live-bg?tone=${tone}&full=1`); await p.waitForFunction((t) => window.__liveBg?.[t]?.stats().frames > 0, tone, { timeout: 20000 })
    pages[tone] = p; await new Promise((r) => setTimeout(r, 1700))
  }
  // one shared instant (wall clock), drawn on all three, then read back the effects layer
  const T = Date.now() / 1000 + 0.5
  for (const [tone, p] of Object.entries(pages)) {
    const r = await p.evaluate(([t, T]) => {
      const e = window.__liveBg[t]; cancelAnimationFrame(e.raf); e.raf = 0
      e.sync(T, false); e.draw(T)
      const fx = e.fx, hub = e.V[e.HUB]
      return { k: e.S.k, best: e.S.best, prices: e.S.walkers.map((w) => w.price), starts: e.S.walkers.map((w) => +(w.start % 24).toFixed(3)), ahmad: e.counts.far + '/' + e.counts.near + '/' + e.counts.none,
        hub: [Math.round(hub.x), Math.round(hub.y)], fx: fx.toDataURL('image/png') }
    }, [tone, T])
    await p.screenshot({ path: `${OUT}-${tone}-${w}.png` })
    res.push({ w, tone, ...r, fx: createHash('sha1').update(r.fx).digest('hex').slice(0, 12) })
  }
  for (const p of Object.values(pages)) await p.close()
}
await b.close()
for (const r of res) console.log(JSON.stringify(r))
for (const w of [1440, 390]) { const g = res.filter((r) => r.w === w); console.log(w, 'same round', new Set(g.map((r) => r.k)).size === 1, '| same prices', new Set(g.map((r) => r.prices.join())).size === 1, '| effects layer pixel-identical', new Set(g.map((r) => r.fx)).size === 1) }
