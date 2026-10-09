// Every route on the integration dev server (:5190), 1440 and 390: any 4xx/5xx or failed request outside /_api.
import { chromium } from '@playwright/test'
const BASE = process.env.BASE || 'http://localhost:5190'
const ID = '00000000-0000-4000-8000-000000000001'
const pages = ['/', '/landing', '/login', '/requests', '/new', '/inbox', `/requests/${ID}`, `/requests/${ID}/compare`, `/requests/${ID}/award`, `/requests/${ID}/review`, '/targeting', '/targeting/templates', '/targeting/templates/new', '/?harness=targeting', '/?harness=templates', '/?harness=template-new',
  '/ui', '/live-bg?tone=light', '/live-bg?tone=deep', '/live-bg?tone=accent',
  '/?harness=tracking', '/?harness=comparison', '/?harness=comparison-award', '/?harness=new',
  '/docs/qa/screens-b/harness.html?screen=award-sheet', '/docs/qa/screens-b/harness.html?screen=inbox']
const b = await chromium.launch({ channel: 'chrome' })
const bad = []
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp })
  for (const path of pages) {
    const p = await ctx.newPage()
    p.on('requestfailed', (r) => { const u = r.url(); if (!u.includes('/_api/')) bad.push(`${vp.width} ${path} FAILED ${r.failure()?.errorText} ${u}`) })
    p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_api/')) bad.push(`${vp.width} ${path} ${r.status()} ${r.url()}`) })
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch((e) => bad.push(`${vp.width} ${path} NAV ${e.message}`))
    await p.mouse.wheel(0, 20000); await p.waitForTimeout(1500)
    await p.close()
  }
  await ctx.close()
}
await b.close()
console.log(bad.length ? bad.join('\n') : 'no 4xx/5xx or failed requests')
