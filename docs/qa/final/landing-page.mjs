// Landing, page mode: one layer for the whole page. Scroll screenshots (1440, 390) + checks:
// one head office · nothing over text · requests cross the sections and come back · p99.
import { chromium } from '@playwright/test'
const B = process.env.BASE || 'http://localhost:5190', OUT = 'docs/qa/final/landing-page'
const b = await chromium.launch({ channel: 'chrome' })
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(B + '/'); await p.waitForFunction(() => window.__liveBg?.page?.S, null, { timeout: 20000 })
  // load the lazy sections first so the world is the final page
  await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) })
  await p.waitForTimeout(2500)
  const info = await p.evaluate(() => {
    const e = window.__liveBg.page, S = e.S, hub = e.V[e.HUB]
    const inside = (x, y, m = 0) => e.UI.some((b) => x > b[0] - m && x < b[2] + m && y > b[1] - m && y < b[3] + m)
    const sections = Array.from(document.querySelectorAll('header, main section, footer')).filter((s) => !s.parentElement.closest('section')).map((s) => { const r = s.getBoundingClientRect(); return [r.top + scrollY, r.bottom + scrollY, s.getAttribute('data-tone') || 'light'] })
    const secOf = (y) => sections.findIndex((s) => y >= s[0] && y < s[1])
    return { hub: [Math.round(hub.x), Math.round(hub.y)], hubGap38: !inside(hub.x, hub.y, 38), hubInFirstHalf: hub.y < innerHeight / 2, canvases: document.querySelectorAll('.live-bg canvas').length, ahmadHome: S.ahmadHome,
      walkers: S.walkers.map((w) => ({ runner: w.runner, len: Math.round(w.len), to: [Math.round(e.V[w.target].x), Math.round(e.V[w.target].y)], supplierOnText: inside(e.V[w.target].x, e.V[w.target].y), down: e.V[w.target].y > hub.y, sectionsCrossed: new Set(w.pts.map((p) => secOf(p[1]))).size, tones: [...new Set(w.pts.map((p) => sections[secOf(p[1])]?.[2]))].join('/') })) }
  })
  console.log(w, JSON.stringify(info))
  const H = await p.evaluate(() => document.documentElement.scrollHeight)
  let n = 0
  for (let y = 0; y < H; y += Math.round(h * 0.85)) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${w}-${String(n++).padStart(2, '0')}.png` }) }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(10000)
  console.log(w, 'stats', JSON.stringify(await p.evaluate(() => { const s = window.__liveBg.page.stats(); return { frames: s.frames, p95: s.p95, p99: s.p99, max: s.max, sync: s.sync, rounds: s.rounds } })))
  await p.close()
}
await b.close()
