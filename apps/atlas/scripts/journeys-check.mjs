// Journey check: walks each group's journey on the real map page against fixed, made-up data (three districts, no
// production data, no network), on a phone (390px) and a desktop (1440px). Not part of the build: run it against a
// running server.
//
//   pnpm dev -p 3473                                          # in one shell
//   ATLAS_URL=http://localhost:3473 node scripts/journeys-check.mjs   # in another
//
// Every /api call is answered here: the tables a city's districts join from, the steps' own answers (one of them slow,
// one failing), and 503 for anything else. Nothing is sent anywhere. Exit code 1 when any check fails.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE = process.env.ATLAS_URL ?? 'http://localhost:3473'

// ── fixed data ────────────────────────────────────────────────────────────────────────────────────────────────────
const square = (lon, lat) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.02, lat], [lon + 0.02, lat + 0.02], [lon, lat + 0.02], [lon, lat]]] })
const DISTRICTS = [
  { id: 'd1', ar: 'حي الأول', lon: 46.66, lat: 24.70, population: 120000, n: 9000, built: [40, 60] },
  { id: 'd2', ar: 'حي الثاني', lon: 46.69, lat: 24.70, population: 80000, n: 3000, built: [500, 700] },
  { id: 'd3', ar: 'حي الثالث', lon: 46.72, lat: 24.70, population: 280000, n: 22000, built: [10, 5] },
]
const GET = {
  '/api/market/cities': [{ en: 'Riyadh', ar: 'الرياض', districts: 3, n: 34000 }],
  '/api/market/districts': { type: 'FeatureCollection', features: DISTRICTS.map((d) => ({ type: 'Feature', properties: { id: d.id, ar: d.ar }, geometry: square(d.lon, d.lat) })) },
  '/api/market/population-districts': { districts: DISTRICTS.map((d) => ({ district_id: d.id, district_ar: d.ar, population: d.population, source: 'census' })) },
}
const POST = {
  'district-counts': (body) => (body.q || body.main_id
    ? { districts: DISTRICTS.map((d) => ({ district_ar: d.ar, n: Math.round(d.n / 100), per_km2: 3 })), total: 340, located: 340 }
    : { districts: DISTRICTS.map((d) => ({ district_ar: d.ar, n: d.n, area_km2: 4, residents_per: d.population / d.n, per_km2: d.n / 4, density: d.population / 4 })), total: 34000 }),
  growth: () => ({ districts: DISTRICTS.map((d) => ({ district_ar: d.ar, under_construction: d.built[0], new_buildings: d.built[1] })) }),
  'district-audience': () => ({ districts: DISTRICTS.map((d) => ({ district_ar: d.ar, men: d.population / 2, women: d.population / 2, saudi: d.population / 2, non_saudi: d.population / 2 })) }),
  'market-gaps': () => ({
    residents_per_business: 700,
    districts: [
      { district_ar: 'حي الثالث', businesses: 300, expected_businesses: 400, shortfall: 100, population: 280000 },
      { district_ar: 'حي الأول', businesses: 170, expected_businesses: 171, shortfall: 1, population: 120000 },
      { district_ar: 'حي الثاني', businesses: 200, expected_businesses: 114, shortfall: -86, population: 80000 },
    ],
  }),
  'real-estate-listings': () => ({
    available: true, total: 2,
    listings: [
      { id: 'l1', url: null, lon: 46.70, lat: 24.71, district_id: 'd2', district_ar: 'حي الثاني', kind: 'rent', deal: 'rent_year', group: 'residential', type: 'apartment', price_sar: 30000, area_sqm: 100, sar_per_sqm: 300, vs_district_pct: -20, check: false, city: 'Riyadh', photo: '/brand/farq-b2b-light.svg', photos: ['/brand/farq-b2b-light.svg'], address: null },
      { id: 'l2', url: null, lon: 46.67, lat: 24.71, district_id: 'd1', district_ar: 'حي الأول', kind: 'rent', deal: 'rent_year', group: 'residential', type: 'apartment', price_sar: 50000, area_sqm: 120, sar_per_sqm: 416, vs_district_pct: 5, check: false, city: 'Riyadh', photo: '/brand/farq-b2b-light.svg', photos: ['/brand/farq-b2b-light.svg'], address: null },
    ],
  }),
  territories: () => ({ territories: [] }),
}
const WAIT = (await import('node:fs')).readFileSync(new URL('../components/lens/journey-logic.ts', import.meta.url), 'utf8')
const gapsWhy = WAIT.match(/gaps: \{ why: '([^']+)'/)[1]

// ── the checks ────────────────────────────────────────────────────────────────────────────────────────────────────
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

async function open(browser, { phone, gaps = 'ok' }) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone })
  await context.addInitScript(() => { try { localStorage.setItem('atlas.whats-new', 'seen-all'); localStorage.setItem('atlas.onboarding.map', 'completed') } catch {} })
  const asked = []
  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON?.() ?? null
    asked.push({ path: url.pathname, body })
    const resource = url.pathname.replace('/api/market/', '')
    if (request.method() === 'GET' && GET[url.pathname]) return route.fulfill({ json: GET[url.pathname] })
    if (resource === 'market-gaps' && gaps === 'slow') await new Promise((resolve) => setTimeout(resolve, 10000))
    if (resource === 'market-gaps' && gaps === 'fail') return route.fulfill({ status: 500, json: { error: 'down' } })
    if (request.method() === 'POST' && POST[resource]) return route.fulfill({ json: POST[resource](body ?? {}) })
    return route.fulfill({ status: 503, json: { error: 'غير متاح' } })
  })
  const page = await context.newPage()
  return { context, page, asked }
}
const panel = (page) => page.locator('[aria-label="لوحة الخريطة"]')
const tab = (page, name) => page.locator('[role="tab"]', { hasText: name }).first().click()
const raise = async (page) => {
  for (let i = 0; i < 2; i++) {
    const handle = page.locator('[aria-label^="اللوحة مصغّرة"], [aria-label^="اللوحة نصف"]').first()
    if (!(await handle.count())) return
    await handle.click(); await page.waitForTimeout(500)
  }
}
const text = async (page) => panel(page).innerText()
const settle = (page, ms = 1500) => page.waitForTimeout(ms)
// SHOTS=<folder> keeps a screenshot of each journey's close, scrolled into view
const shoot = async (page, name) => {
  if (!process.env.SHOTS) return
  await page.locator('#journey-summary').scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: `${process.env.SHOTS}/journey-${name}.png` })
}

const browser = await chromium.launch()
try {
  // shop owner, desktop: five steps fit, nothing computed on an unpicked activity, a slow step says why, the close decides
  {
    const { context, page, asked } = await open(browser, { phone: false, gaps: 'slow' })
    await page.goto(`${BASE}/map?goal=expand`); await settle(page, 3000)
    const box = await panel(page).boundingBox()
    const tabs = await page.locator('[role="tab"]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.right] }))
    check(tabs.length === 5 && tabs.every(([left, right]) => left >= box.x - 1 && right <= box.x + box.width + 1), 'desktop: the five steps of «أصحاب المتاجر» all sit inside the panel')
    await tab(page, 'المنافسون'); await settle(page)
    await tab(page, 'شوارع النشاط'); await settle(page)
    const activityAsked = asked.filter((item) => ['/api/market/street-density', '/api/market/brands', '/api/market/market-gaps'].includes(item.path) || (item.path === '/api/market/district-counts' && (item.body?.q || item.body?.main_id)))
    check(activityAsked.length === 0, 'nothing is computed on an activity nobody picked (competitors, streets)')
    check((await text(page)).includes('اختر النشاط'), 'the streets step asks for the activity')
    await tab(page, 'أين ينقص نشاطي؟'); await settle(page, 800)
    await panel(page).getByRole('button', { name: 'صيدلية' }).first().click()
    await page.waitForTimeout(9200)
    check((await text(page)).includes(gapsWhy), 'a slow step says why it takes long and what to do')
    await page.waitForTimeout(2500)
    check((await text(page)).includes('حي الثالث'), 'the slow step answers once its request lands')
    await tab(page, 'محلات للإيجار'); await settle(page, 2500)
    const homes = await text(page)
    check(homes.includes('ابدأ من حي الثالث'), 'the rentals step starts from the district step 1 found short')
    await shoot(page, 'shops-desktop')
    check(homes.includes('خلاصة رحلتك') && homes.includes('أين تفتح «صيدلية»') && homes.includes('أكثر حي ينقصه نشاطك: حي الثالث'), 'the shop owner\'s journey closes on its decision')
    await context.close()
  }
  // marketer, phone: the peek says the step, step 2 starts from step 1's top district, the close opens the businesses
  {
    const { context, page } = await open(browser, { phone: true })
    await page.goto(`${BASE}/map?goal=target`); await settle(page, 3500)
    const peek = await page.locator('[aria-label^="اللوحة"]').first().innerText()
    check(/حجم الجمهور|اختر جمهورك|جارٍ حساب/.test(peek), 'phone: the peeking sheet says the step\'s answer or what to do')
    await tab(page, 'منشآت الأحياء'); await settle(page)
    await raise(page)
    check((await text(page)).includes('ابدأ من حي الثالث'), 'the businesses step starts from the top audience district')
    const close = panel(page).getByRole('button', { name: /جهّز حملة لمنشآت/ })
    check(await close.count() > 0, 'the marketer\'s journey closes on «جهّز حملة»')
    await shoot(page, 'marketers-phone')
    if (await close.count()) { await close.first().click(); await settle(page, 2000) }
    check((await text(page)).includes('منشآت حي الثالث'), 'the decision opens the businesses list of the district, where the campaign is made after review')
    const wide = await page.evaluate(() => document.documentElement.scrollWidth)
    check(wide <= 390, 'phone: no sideways scroll')
    await context.close()
  }
  // a failing step, phone: the peek says it failed and offers the retry
  {
    const { context, page } = await open(browser, { phone: true, gaps: 'fail' })
    await page.goto(`${BASE}/map?goal=expand&activity=${encodeURIComponent('مخبز')}`); await settle(page, 5000)
    const top = await page.locator('aside[aria-label="لوحة الخريطة"]').innerText()
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/journey-failed-phone.png` })
    check(top.includes('تعذّر حساب «أين ينقص نشاطي؟»') && top.includes('أعد المحاولة'), 'phone: a failed step says so where its line goes, with a retry')
    await context.close()
  }
  // property seeker, desktop: the district step starts from the best listing's district, the close links on
  {
    const { context, page } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?goal=property`); await settle(page, 3500)
    await tab(page, 'تعرّف على الحي'); await settle(page)
    check((await text(page)).includes('ابدأ من حي الثاني'), 'the district step starts from the best listing\'s district')
    const link = await panel(page).locator('a[href^="/homes?"]').first().getAttribute('href').catch(() => null)
    check(link === '/homes?district=d2', 'the property seeker\'s close links to the district\'s listings')
    await context.close()
  }
} finally {
  await browser.close()
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\nall journey checks passed')
