// Accessibility check for every Atlas page outside the map, at phone width (390px) and on a desktop (1366px).
// Not part of the build: run it against a running server.
//
//   pnpm exec playwright install chromium             # once per machine
//   pnpm dev -p 3473                                  # in one shell
//   ATLAS_URL=http://localhost:3473 pnpm a11y          # in another
//
// ATLAS_API=https://atlas.farq.sa answers the pages' /api calls from that server (read only), so lists hold real
// data. The workspace (requests and inbox) is seeded with the sample requests on this device's storage only, so the
// request, quote and message screens are checked filled, not only empty. Playwright itself is the one already on the
// project dependencies; axe is the devDependency @axe-core/playwright.
// Exit code 1 when any page has a serious or critical violation; every violation is printed.
import { createRequire } from 'node:module'
import { AxeBuilder } from '@axe-core/playwright'
import { SEED_INBOX, SEED_REQUESTS } from '../lib/mock-data.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.env.ATLAS_URL ?? 'http://localhost:3473'
const API = process.env.ATLAS_API ?? ''
const PAGES = [
  ['/price?district=396&area=180', 'سعّر عقارك (رابط بإجابات)'],
  ['/', 'الرئيسية'],
  ['/homes', 'العقار'],
  ['/price', 'سعّر عقارك'],
  ['/requests', 'الطلبات'],
  // one request in each status, so every editor (quote items, campaign, list notes) and every summary is checked
  ...SEED_REQUESTS.map((request) => [`/requests/${request.id}`, `طلب (${request.status})`]),
  ['/inbox', 'الوارد'],
  [`/inbox?m=${SEED_INBOX[0].id}`, 'رسالة'],
  ['/login', 'الدخول'],
  ['/request-access', 'اطلب حساباً'],
  ['/request-access/delete', 'احذف بيانات طلبك'],
  ['/no-such-page', 'غير موجودة'],
]
const VIEWPORTS = [['phone', 390, 844], ['desktop', 1366, 900]]
const WORKSPACE = JSON.stringify({ requests: SEED_REQUESTS, inbox: SEED_INBOX })

const browser = await chromium.launch()
let serious = 0
for (const [name, width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: name === 'phone', hasTouch: name === 'phone' })
  await context.addInitScript((data) => { try { localStorage.setItem('farq-atlas-workspace-v3', data) } catch {} }, WORKSPACE)
  if (API) {
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      if (!url.href.startsWith(BASE)) return route.continue()
      try { await route.fulfill({ response: await route.fetch({ url: API + url.pathname + url.search }) }) } catch { await route.abort() }
    })
  }
  const page = await context.newPage()
  for (const [path, label] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 })
    await page.waitForTimeout(4000)
    // the map itself (canvas, tiles) is the map agent's and is checked there; this script checks the page around it
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).exclude('.mapboxgl-map').analyze()
    for (const violation of result.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') serious++
      console.log(`[${name}] ${label} ${path} · ${violation.impact} · ${violation.id}: ${violation.help}`)
      for (const node of violation.nodes.slice(0, 6)) console.log(`    ${node.target.join(' ')}  ${node.failureSummary?.split('\n').slice(1, 2).join(' ').trim() ?? ''}`)
    }
    if (!result.violations.length) console.log(`[${name}] ${label} ${path} · ok`)
  }
  await context.close()
}
await browser.close()
console.log(serious ? `${serious} serious or critical violation(s)` : 'no serious or critical violations')
process.exit(serious ? 1 : 0)
