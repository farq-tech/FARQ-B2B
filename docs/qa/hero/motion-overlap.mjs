import { chromium } from '@playwright/test'
const b = await chromium.launch({ channel: 'chrome' })
for (const [w, h] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [375, 812]])) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto("http://localhost:5190/", { timeout: 90000 }); await p.locator('[data-hero-scene]').scrollIntoViewIfNeeded()
  const r = await p.evaluate(async () => {
    const sc = document.querySelector('[data-hero-scene]'), status = sc.querySelector('[aria-live]'), bad = {}
    const R = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
    const cards = [...sc.querySelectorAll('[data-hero-card]')], sb = R(sc)
    let n = 0
    for (let k = 0; k < 160; k++) {
      const chips = [...sc.querySelectorAll('div[aria-hidden="true"].absolute')].filter((e) => getComputedStyle(e).opacity > 0.5 && e.style.backgroundImage === '')
      n += chips.length
      for (let i = 0; i < chips.length; i++) {
        const c0 = R(chips[i]); if (c0.left < sb.left - 1 || c0.right > sb.right + 1) bad['chip outside scene'] = (bad['chip outside scene'] || 0) + 1
        if (hit(c0, R(status))) bad['chip×status'] = (bad['chip×status'] || 0) + 1
        for (const c of cards) if (hit(c0, R(c))) bad['chip×card'] = (bad['chip×card'] || 0) + 1
        for (let j = i + 1; j < chips.length; j++) if (hit(c0, R(chips[j]))) bad['chip×chip'] = (bad['chip×chip'] || 0) + 1
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    return { chipSamples: n, ...bad }
  })
  console.log(w, JSON.stringify(r)); await p.close()
}
await b.close()
