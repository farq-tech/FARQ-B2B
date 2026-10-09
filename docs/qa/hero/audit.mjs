// Hero audit at 6 widths: screenshots (first screen, while animating) + measured problems:
// overlaps between headline/description/CTAs and cards, elements outside the viewport, clipped text, horizontal overflow.
import { chromium } from '@playwright/test'
const B = process.env.BASE || 'http://127.0.0.1:8099', OUT = process.argv[2] || 'docs/qa/hero/before', Q = process.argv[3] || ''
const SIZES = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [375, 812]]
const b = await chromium.launch({ channel: 'chrome' })
for (const [w, h] of SIZES) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(B + '/' + Q); await p.waitForTimeout(2500)
  for (const t of [0, 4, 9]) { if (t) await p.waitForTimeout(t === 4 ? 4000 : 5000); await p.screenshot({ path: `${OUT}/${w}-t${t}.png` }) }
  const r = await p.evaluate(() => {
    const hero = document.querySelector('#top'); const R = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] }
    const main = [...hero.querySelectorAll('h1, h1 + p, p, a')].filter((e) => !e.closest('[data-hero-scene], [aria-hidden="true"]') && e.getBoundingClientRect().width > 0)
    const cards = [...hero.querySelectorAll('[data-hero-card], [aria-hidden="true"] > div > div')].filter((e) => e.getBoundingClientRect().width > 40)
    const scene = hero.querySelector('[data-hero-scene]')
    const hit = (a, c) => a[0] < c[2] - 1 && a[2] > c[0] + 1 && a[1] < c[3] - 1 && a[3] > c[1] + 1
    const overlaps = []
    for (const m of main) for (const c of cards) if (hit(R(m), R(c))) overlaps.push((m.textContent || m.tagName).trim().slice(0, 24) + ' × card')
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (hit(R(cards[i]), R(cards[j]))) overlaps.push(`card${i} × card${j}`)
    if (scene) for (const m of main) if (hit(R(m), R(scene))) overlaps.push((m.textContent || m.tagName).trim().slice(0, 24) + ' × scene')
    // moving chips / Ahmad must stay inside the scene box
    const sb = scene ? R(scene) : null, escapes = scene ? [...scene.querySelectorAll('[aria-hidden="true"]')].filter((e) => { const b = R(e); return getComputedStyle(e).opacity !== '0' && b[2] - b[0] > 0 && (b[0] < sb[0] - 1 || b[2] > sb[2] + 1 || b[1] < sb[1] - 1 || b[3] > sb[3] + 1) }).length : 0
    const outside = [...hero.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > innerWidth + 1) }).length
    const clipped = [...hero.querySelectorAll('h1, p, a, span')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length
    return { overlaps: [...new Set(overlaps)], chipsOutsideScene: escapes, outsideViewport: outside, clippedText: clipped, hOverflow: document.documentElement.scrollWidth > innerWidth }
  })
  console.log(w, JSON.stringify(r))
  await p.close()
}
await b.close()
