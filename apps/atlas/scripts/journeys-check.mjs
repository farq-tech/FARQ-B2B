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
// Riyadh: three districts with every figure. Jeddah: a second city the way most cities are today: no income (the
// site score falls back on villa share), and one district without a population (its figures read «غير متاح»)
const CITIES = {
  Riyadh: [
    { id: 'd1', ar: 'حي الأول', lon: 46.66, lat: 24.70, population: 120000, n: 9000, built: [40, 60], income: 6000, incomeMale: 9000, incomeFemale: 18000, incomeSaudi: 15000, incomeNonSaudi: 7000 },
    { id: 'd2', ar: 'حي الثاني', lon: 46.69, lat: 24.70, population: 80000, n: 3000, built: [500, 700], income: 8000, incomeMale: 12000, incomeFemale: 16000, incomeSaudi: 13000, incomeNonSaudi: 6000 },
    { id: 'd3', ar: 'حي الثالث', lon: 46.72, lat: 24.70, population: 280000, n: 22000, built: [10, 5], income: 10000, incomeMale: 14000, incomeFemale: 6000, incomeSaudi: 11000, incomeNonSaudi: 5000 },
  ],
  Jeddah: [
    { id: 'j1', ar: 'حي البحر', lon: 39.16, lat: 21.54, population: 150000, n: 8000, built: [30, 20], villa: 12 },
    { id: 'j2', ar: 'حي السوق', lon: 39.19, lat: 21.54, population: null, n: 6000, built: [5, 5], villa: 2 },
    { id: 'j3', ar: 'حي الجبل', lon: 39.22, lat: 21.54, population: 210000, n: 12000, built: [60, 90], villa: 30 },
  ],
  // Abha: a city as most cities are today, with no district population at all
  Abha: [
    { id: 'a1', ar: 'حي الربوة', lon: 42.49, lat: 18.21, population: null, n: 3000, built: [10, 12] },
    { id: 'a2', ar: 'حي المنهل', lon: 42.52, lat: 18.21, population: null, n: 2000, built: [3, 4] },
  ],
}
const SNAPSHOT = '2026-11-03T05:15:00+00:00'
const VERSION = { 'x-data-version': SNAPSHOT }
const cityOf = (url, body) => {
  const named = url.searchParams.get('city') ?? body?.city
  return CITIES[named] ? named : 'Riyadh'
}
const GET = {
  '/api/market/cities': () => [{ en: 'Riyadh', ar: 'الرياض', districts: 3, n: 34000 }, { en: 'Jeddah', ar: 'جدة', districts: 3, n: 26000 }, { en: 'Abha', ar: 'أبها', districts: 2, n: 5000 }],
  '/api/market/districts': (D) => ({ type: 'FeatureCollection', features: D.map((d) => ({ type: 'Feature', properties: { id: d.id, ar: d.ar }, geometry: square(d.lon, d.lat) })) }),
  '/api/market/population-districts': (D) => ({ districts: D.map((d) => ({ district_id: d.id, district_ar: d.ar, population: d.population, source: d.population == null ? null : 'census' })) }),
}
const POST = {
  'district-counts': (D, body) => (body.q || body.main_id
    ? { districts: D.map((d) => ({ district_ar: d.ar, n: Math.round(d.n / 100), per_km2: 3 })), total: 340, located: 340, ...(body.q ? { understood: { labels: ['سبا ومساج'], more: 0 } } : {}) }
    : { districts: D.map((d) => ({ district_ar: d.ar, n: d.n, area_km2: 4, residents_per: d.population == null ? null : d.population / d.n, per_km2: d.n / 4, density: d.population == null ? null : d.population / 4 })), total: D.reduce((sum, d) => sum + d.n, 0) }),
  growth: (D) => ({ districts: D.map((d) => ({ district_ar: d.ar, under_construction: d.built[0], new_buildings: d.built[1] })) }),
  'district-audience': (D) => ({ districts: D.filter((d) => d.population != null).map((d) => ({ district_ar: d.ar, men: d.population / 2, women: d.population / 2, saudi: d.population / 2, non_saudi: d.population / 2 })) }),
  // the activity is short most in the most populous district, as the service orders it
  'market-gaps': (D) => {
    const people = D.filter((d) => d.population != null).sort((a, b) => b.population - a.population)
    const short = [100, 1, -80]
    // no district with people: the service has no city rate to measure a shortfall against
    if (!people.length) return { residents_per_business: null, districts: [] }
    return { residents_per_business: 700, districts: people.map((d, index) => ({ district_ar: d.ar, businesses: 200, expected_businesses: 200 + short[index], shortfall: short[index], population: d.population })) }
  },
  'real-estate-listings': (D) => ({
    available: true, total: 2,
    listings: [D[1], D[0]].map((d, index) => ({ id: `l${index + 1}${d.id}`, url: null, lon: d.lon + 0.01, lat: d.lat + 0.01, district_id: d.id, district_ar: d.ar, kind: 'rent', deal: 'rent_year', group: 'residential', type: 'apartment', price_sar: index ? 50000 : 30000, area_sqm: index ? 120 : 100, sar_per_sqm: index ? 416 : 300, vs_district_pct: index ? 5 : -20, check: false, city: 'Riyadh', photo: '/brand/farq-b2b-light.svg', photos: ['/brand/farq-b2b-light.svg'], address: null })),
  }),
  territories: () => ({ territories: [] }),
  // Riyadh publishes income; Jeddah does not (the villa share stands in)
  'district-income': (D) => ({ districts: D.filter((d) => d.income != null).map((d) => ({ district_ar: d.ar, income_all: d.income, income_male: d.incomeMale ?? null, income_female: d.incomeFemale ?? null, income_saudi: d.incomeSaudi ?? null, income_non_saudi: d.incomeNonSaudi ?? null })) }),
  'housing-level': (D) => ({ districts: D.filter((d) => d.villa != null).map((d) => ({ district_ar: d.ar, villa_share_pct: d.villa })) }),
  // the people inside a site's reach: the east site of each city has more
  'population-within': (D, body) => {
    const east = (body.geometry?.coordinates?.[0]?.[0]?.[0] ?? 0) > D[1].lon + 0.01
    return east ? { population: 52000, dwellings: 9000, businesses: 400, residents_per: 130, top_activities: [] } : { population: 30000, dwellings: 6000, businesses: 900, residents_per: 33, top_activities: [] }
  },
  'street-density': () => ({ type: 'FeatureCollection', features: [] }),
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
    const D = CITIES[cityOf(url, body)]
    if (request.method() === 'GET' && GET[url.pathname]) return route.fulfill({ json: GET[url.pathname](D), headers: VERSION })
    if (resource === 'market-gaps' && gaps === 'slow') await new Promise((resolve) => setTimeout(resolve, 10000))
    if (resource === 'market-gaps' && gaps === 'fail') return route.fulfill({ status: 500, json: { error: 'down' } })
    // the streets answer takes a while, so the step can be opened while the map's ask-ahead is still on its way
    if (resource === 'street-density') await new Promise((resolve) => setTimeout(resolve, 3000))
    if (request.method() === 'POST' && POST[resource]) return route.fulfill({ json: POST[resource](D, body ?? {}), headers: VERSION })
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
    // the slow answer is kept for the visit: leaving the step and coming back shows it at once, with no second request
    const gapsAsked = () => asked.filter((item) => item.path === '/api/market/market-gaps').length
    const before = gapsAsked()
    const streetsAsked = () => asked.filter((item) => item.path === '/api/market/street-density').length
    await tab(page, 'المنافسون'); await settle(page, 1800)
    check(streetsAsked() === 1, 'the next step\'s slow answer is asked ahead once, when idle (streets, after competitors answered)')
    // opened while that request is still on its way (it takes 3 seconds here): the step waits for it, asks nothing
    await tab(page, 'شوارع النشاط'); await settle(page, 3500)
    check(streetsAsked() === 1, 'the step opened mid-ask shares the ask-ahead\'s request (no second one)')
    await tab(page, 'أين ينقص نشاطي؟'); await settle(page, 800)
    check(gapsAsked() === before && (await text(page)).includes('حي الثالث'), 'a slow answer is kept for the visit (no second wait)')
    check(await page.evaluate(() => sessionStorage.getItem('atlas.answer.version')) === `snapshot:${SNAPSHOT}`, 'kept answers are versioned by the service\'s snapshot time (X-Data-Version)')
    // two candidate sites, through the step's own «ابدأ من هنا» (the map itself needs a token here)
    await tab(page, 'قارن المواقع'); await settle(page, 800)
    await panel(page).getByRole('button', { name: /ابدأ من هنا/ }).click(); await settle(page, 3000)
    await tab(page, 'محلات للإيجار'); await settle(page, 2500)
    const homes = await text(page)
    check(homes.includes('ابدأ من حي الثالث'), 'the rentals step starts from the district step 1 found short')
    await shoot(page, 'shops-desktop')
    check(homes.includes('خلاصة رحلتك') && homes.includes('أين تفتح «صيدلية»') && /أجذب موقع: الموقع \d/.test(homes), 'the shop owner\'s journey closes on its decision, the best site first')
    check(homes.includes('الجاذبية') && homes.includes('السكان في') && homes.includes('منشآت لكل كم²'), 'the candidate sites are side by side in the closing card')
    check(homes.includes('نتيجة جزئية: تعذّر تحميل «السلاسل»'), 'a partial answer (the competitors without their chains) is marked in the summary, not a plain ✓')
    check(new URL(page.url()).searchParams.get('sites')?.split(';').length === 2, 'the compared sites are in the address')
    await panel(page).getByRole('button', { name: 'احفظ المقارنة' }).click(); await settle(page, 800)
    const saved = panel(page).locator('section[aria-label="المقارنات المحفوظة"] li button', { hasText: 'الموقع' }).first()
    check(await saved.count() > 0, 'the side-by-side is saved by name in «المقارنات المحفوظة»')
    const entry = await saved.innerText().catch(() => '')
    check(entry.includes('1 كم') && entry.includes('صيدلية'), 'the saved comparison names its reach and its activity')
    if (await saved.count()) { await saved.click(); await settle(page, 3500) }
    const reopened = new URL(page.url())
    check(reopened.searchParams.get('tool') === 'around' && reopened.searchParams.get('sites')?.split(';').length === 2 && !reopened.searchParams.has('close') && (await text(page)).includes('الموقع 2'),
      'a saved site comparison reopens on «قارن المواقع» with its sites, measured again')
    const back = await text(page)
    check(back.includes('خلاصة رحلتك') && /أجذب موقع: الموقع \d/.test(back) && back.includes('الجاذبية'), 'reopening a saved comparison brings its decision back, the sites side by side')
    // and from a fresh page (the saved link opened anew, as a colleague would)
    // the saved link is this view's address with its one-time «close» (kept off the address once read)
    const href = `${reopened.pathname}${reopened.search}&close=1`
    if (href) { await page.goto(`${BASE}${href}`); await settle(page, 4000) }
    const fresh = await text(page)
    check(fresh.includes('خلاصة رحلتك') && /أجذب موقع/.test(fresh), 'the saved link opened anew lands on its decision')
    await context.close()
  }
  // marketer, phone: the peek says the step, step 2 starts from step 1's top district, the close opens the businesses
  {
    const { context, page, asked } = await open(browser, { phone: true })
    await page.goto(`${BASE}/map?goal=target`); await settle(page, 3500)
    await raise(page)
    await panel(page).getByRole('button', { name: 'نساء' }).click(); await settle(page, 1200)
    const rankedWomen = await panel(page).locator('ol > li').first().innerText().catch(() => '')
    check(rankedWomen.includes('حي الأول') && rankedWomen.includes('60,000 شخص') && rankedWomen.includes('18,000 ر.س') && rankedWomen.includes('71/100'), 'women: the balanced ranking includes the segment count and the women workers\' income, not just the largest population')
    await panel(page).getByRole('button', { name: 'أستهدف منشآت' }).click(); await settle(page, 800)
    const exactActivity = panel(page).getByRole('textbox', { name: 'التخصص الدقيق للمنشآت' })
    await exactActivity.fill('مساج'); await exactActivity.press('Enter'); await settle(page, 1200)
    const massageRequest = asked.find((item) => item.path === '/api/market/district-counts' && item.body?.q === 'مساج')
    check(massageRequest != null && !Object.hasOwn(massageRequest.body, 'objective'), 'marketers: the exact specialty reaches the taxonomy resolver unchanged as «مساج»')
    check((await text(page)).includes('سبا ومساج') && (await text(page)).includes('340 منشأة'), 'marketers: a typed specialty shows the taxonomy interpretation and its measured count')
    await panel(page).getByRole('button', { name: 'أستهدف أفراداً' }).click(); await settle(page, 800)
    const peek = await page.locator('[aria-label^="اللوحة"]').first().innerText()
    check(/حجم الجمهور|اختر جمهورك|جارٍ حساب/.test(peek), 'phone: the peeking sheet says the step\'s answer or what to do')
    await tab(page, 'منشآت الأحياء'); await settle(page)
    const line = page.locator('aside[aria-label="لوحة الخريطة"] button', { hasText: 'حي الأول' }).first()
    check(await line.count() > 0, 'phone: at the last step the peeking sheet says the decision')
    if (await line.count()) { await line.click(); await settle(page, 1500) }
    const card = await page.locator('#journey-summary').boundingBox().catch(() => null)
    check(card != null && card.y >= 0 && card.y < 844, 'phone: a tap on the decision opens the closing card')
    check((await text(page)).includes('ابدأ من حي الأول'), 'the businesses step starts from the top balanced audience district')
    const listAsked = () => asked.filter((item) => item.path === '/api/market/entities').length
    const close = panel(page).getByRole('button', { name: /جهّز حملة لمنشآت/ })
    check(await close.count() > 0, 'the marketer\'s journey closes on «جهّز حملة»')
    await shoot(page, 'marketers-phone')
    if (await close.count()) { await close.first().click(); await settle(page, 2000) }
    check((await text(page)).includes('منشآت حي الأول'), 'the decision opens the businesses list of the district, where the campaign is made after review')
    check(listAsked() > 0, 'the campaign decision opens the list already searched (no extra tap on «كل الأنشطة»)')
    const wide = await page.evaluate(() => document.documentElement.scrollWidth)
    check(wide <= 390, 'phone: no sideways scroll')
    await context.close()
  }
  // Jeddah, desktop: no published income (the site score stands on villa share) and a district without population
  {
    const { context, page, asked } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?city=Jeddah&goal=expand`); await settle(page, 3500)
    await panel(page).getByRole('button', { name: 'صيدلية' }).first().click(); await settle(page, 2500)
    check((await text(page)).includes('حي الجبل'), 'Jeddah: the gaps answer names its most populous district')
    await tab(page, 'قارن المواقع'); await settle(page, 800)
    await panel(page).getByRole('button', { name: /ابدأ من هنا/ }).click(); await settle(page, 3000)
    await tab(page, 'محلات للإيجار'); await settle(page, 2500)
    const close = await text(page)
    check(close.includes('حصة الفلل') && !close.includes('دخل الحي'), 'Jeddah: the side-by-side scores on villa share where no income is published')
    check(/أجذب موقع: الموقع \d/.test(close), 'Jeddah: the shop owner\'s close still decides on the scored sites')
    await page.goto(`${BASE}/map?city=Jeddah&lens=analysts&district=j2`); await settle(page, 3500)
    check((await text(page)).includes('غير متاح'), 'Jeddah: a district without population reads «غير متاح», not 0')
    await context.close()
  }
  // Jeddah, phone: the same journey at 390px, to its decision, with no sideways scroll
  {
    const { context, page, asked } = await open(browser, { phone: true })
    await page.goto(`${BASE}/map?city=Jeddah&goal=expand`); await settle(page, 3500)
    await raise(page)
    await panel(page).getByRole('button', { name: 'صيدلية' }).first().click(); await settle(page, 2500)
    check((await text(page)).includes('حي الجبل'), 'Jeddah phone: the gaps answer names its most populous district')
    await tab(page, 'قارن المواقع'); await settle(page, 800)
    await raise(page)
    await panel(page).getByRole('button', { name: /ابدأ من هنا/ }).click(); await settle(page, 3000)
    await tab(page, 'محلات للإيجار'); await settle(page, 2500)
    const line = page.locator('aside[aria-label="لوحة الخريطة"] button', { hasText: 'أجذب موقع' }).first()
    check(await line.count() > 0, 'Jeddah phone: the peeking sheet says the decision')
    if (await line.count()) { await line.click(); await settle(page, 1500) }
    const card = await page.locator('#journey-summary').boundingBox().catch(() => null)
    check(card != null && card.y >= 0 && card.y < 844 && (await text(page)).includes('حصة الفلل'), 'Jeddah phone: a tap opens the card, the sites scored on villa share')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/journey-jeddah-phone.png` })
    check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Jeddah phone: no sideways scroll')
    await context.close()
  }
  // distributor, desktop: the growth step answers with its ranking first and the journey closes without a forced tap
  // (the tour's hints wait while the map cannot open, as here without a map token: they are checked on real data)
  {
    const { context, page, asked } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?lens=distributors`); await settle(page, 3500)
    const splits = () => asked.filter((item) => item.path === '/api/market/territories').length
    check(splits() === 0 && (await text(page)).includes('اختر نشاط عملائك فتُقسَّم'), 'distributors are asked for their customers\' activity before the city is split')
    await panel(page).getByRole('button', { name: 'قسّم على كل المنشآت' }).click(); await settle(page, 1500)
    check(splits() === 1, '«قسّم على كل المنشآت» splits on purpose, once')
    await tab(page, 'أين يُبنى'); await settle(page, 2500)
    const growth = await text(page)
    check(growth.indexOf('الأعلى في مبانٍ جديدة') >= 0 && growth.indexOf('الأعلى في مبانٍ جديدة') < growth.indexOf('مطاعم التوصيل'), '«أين يُبنى الآن؟» leads with its ranking, the city\'s general figures after it')
    check(growth.includes('خلاصة رحلتك') && growth.includes('أكثر حي يُبنى فيه الآن: حي الثاني'), 'the distributor\'s journey closes on its ranking, without a forced tap')
    await context.close()
  }
  // analyst, desktop: the one-tap pair is right under «اختر حيين», and no empty saved list stands in the way
  {
    const { context, page, asked } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?lens=analysts&tool=compare`); await settle(page, 3500)
    const compare = await text(page)
    check(compare.includes('أو قارن مباشرة') && !compare.includes('لا مقارنة محفوظة بعد'), 'compare: the one-tap pair, and no empty saved list')
    check(compare.indexOf('أو قارن مباشرة') < compare.indexOf('خلاصة رحلتك') || !compare.includes('خلاصة رحلتك'), 'compare: the shortcut comes before the rest of the panel')
    await context.close()
  }
  // shop owner, phone: the peeking sheet's ask is a button that raises the sheet to the step's chips
  {
    const { context, page, asked } = await open(browser, { phone: true })
    await page.goto(`${BASE}/map?goal=expand`); await settle(page, 3000)
    const ask = page.locator('aside[aria-label="لوحة الخريطة"] button', { hasText: 'اختر نشاطك' }).first()
    check(await ask.count() > 0, 'phone: the step\'s ask on the peeking sheet is a button')
    if (await ask.count()) { await ask.click(); await settle(page, 900) }
    check(await page.locator('[aria-label^="اللوحة نصف"]').count() > 0 && await panel(page).getByRole('button', { name: 'صيدلية' }).first().isVisible(), 'phone: tapping it raises the sheet to the activity chips')
    await context.close()
  }
  // Abha, desktop: a city with no district population: gaps say why there is no shortfall, figures read «غير متاح»
  {
    const { context, page, asked } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?city=Abha&goal=expand`); await settle(page, 3500)
    await panel(page).getByRole('button', { name: 'صيدلية' }).first().click(); await settle(page, 2500)
    const gaps = await text(page)
    check(!/ناقص \d/.test(gaps) && /غير متاح|لا يُحسب|غير متاحين/.test(gaps), 'Abha: no shortfall is invented where no district has people')
    await page.goto(`${BASE}/map?city=Abha&lens=analysts&district=a1`); await settle(page, 3500)
    const district = await text(page)
    check(district.includes('حي الربوة') && district.includes('غير متاح') && !/السكان\s*0\b/.test(district), 'Abha: a district\'s population reads «غير متاح», never 0')
    await page.goto(`${BASE}/map?city=Abha&lens=marketers`); await settle(page, 3500)
    check(/غير متاح/.test(await text(page)), 'Abha: the audience size reads «غير متاح» where no people are measured')
    await context.close()
  }
  // a failing step, phone: the peek says it failed and offers the retry
  {
    const { context, page, asked } = await open(browser, { phone: true, gaps: 'fail' })
    await page.goto(`${BASE}/map?goal=expand&activity=${encodeURIComponent('مخبز')}`); await settle(page, 5000)
    const top = await page.locator('aside[aria-label="لوحة الخريطة"]').innerText()
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/journey-failed-phone.png` })
    check(top.includes('تعذّر حساب «أين ينقص نشاطي؟»') && top.includes('أعد المحاولة'), 'phone: a failed step says so where its line goes, with a retry')
    await context.close()
  }
  // property seeker, desktop: the district step starts from the best listing's district, the close links on
  {
    const { context, page, asked } = await open(browser, { phone: false })
    await page.goto(`${BASE}/map?goal=property`); await settle(page, 3500)
    await panel(page).getByRole('button', { name: 'فيلا' }).first().click(); await settle(page, 1200)
    await panel(page).locator('select[aria-label="الميزانية"]').selectOption('50000'); await settle(page, 1500)
    await tab(page, 'تعرّف على الحي'); await settle(page)
    check((await text(page)).includes('ابدأ من حي الثاني'), 'the district step starts from the best listing\'s district')
    const link = await panel(page).locator('a[href^="/homes?"]').first().getAttribute('href').catch(() => null)
    check(link === '/homes?type=villa&district=d2&max=50000', 'the property seeker\'s close links to the district\'s listings with the type and budget searched')
    const price = await panel(page).locator('a[href^="/price?"]').first().getAttribute('href').catch(() => null)
    check(price === '/price?district=d2&type=villa', 'and to «سعّر عقارك» with the type searched')
    // «العقار» opens on that budget
    if (link) { await page.goto(`${BASE}${link}`); await settle(page, 3000) }
    check(new URL(page.url()).searchParams.get('max') === '50000', '«العقار» keeps the budget the link carried')
    await context.close()
  }
} finally {
  await browser.close()
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\nall journey checks passed')
