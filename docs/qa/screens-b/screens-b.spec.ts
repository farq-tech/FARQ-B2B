import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { RFQ_ID, rfqClosed, comparisonAward } from '../../../src/dev/fixtures'

/*
 * Track D — screens 03/04 phone, 05 Confirm Sheet, 06 inbox. Harness: docs/qa/screens-b/harness.html.
 * No request leaves the browser: in-page fixtures answer GETs, the harness refuses writes,
 * and the award-call test answers every /_api call through page.route.
 */
const H = '/docs/qa/screens-b/harness.html'
const OUT = 'docs/qa/screens-b'

async function tabTo(page: Page, match: (el: { text: string; tag: string; label: string | null }) => boolean, max = 80) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab')
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return { text: (a?.textContent || '').trim(), tag: a?.tagName || '', label: a?.getAttribute('aria-label') ?? null }
    })
    if (match(el)) return i
  }
  throw new Error('target never received focus via Tab')
}

async function expectFocusRing(page: Page) {
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element)
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
  })
  expect(ring.style).not.toBe('none')
  expect(ring.width).toBeGreaterThanOrEqual(2)
}

/** Records every non-GET request the page makes (must stay empty outside the routed award test). */
function watchWrites(page: Page) {
  const writes: string[] = []
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`) })
  return writes
}

// ── 05 · award calls: AwardDialog (before) vs Confirm Sheet (after), same clicks, intercepted ──

type Call = { method: string; path: string; body: unknown }
async function runAward(page: Page, screen: 'award-legacy' | 'award-sheet', scenario: 'existing' | 'new') {
  const calls: Call[] = []
  await page.addInitScript(() => { (window as unknown as { __PW_ROUTED__: boolean }).__PW_ROUTED__ = true })
  await page.route('**/_api/**', async (route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace(/^\/_api/, '') + u.search
    const raw = req.postData()
    calls.push({ method: req.method(), path, body: raw ? JSON.parse(raw) : null })
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
    if (req.method() === 'GET' && path === '/api/construction/projects') return ok({ projects: [{ id: 'p1', name: 'فيلا النرجس', site_address: 'الرياض' }] })
    if (req.method() === 'GET' && path === `/api/construction/rfqs/${RFQ_ID}/comparison`) return ok(comparisonAward)
    if (req.method() === 'GET' && path === `/api/construction/rfqs/${RFQ_ID}`) return ok(rfqClosed)
    if (req.method() === 'POST' && path === `/api/construction/rfqs/${RFQ_ID}/open-envelopes`) return ok({ id: RFQ_ID })
    if (req.method() === 'POST' && path === '/api/construction/projects') return ok({ id: 'p-new', name: 'x' })
    if (req.method() === 'POST' && path === '/api/construction/awards') return ok({ id: 'award-1' })
    return route.abort()
  })
  await page.goto(`${H}?screen=${screen}&routed=1`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const select = dialog.getByRole('combobox')
  await expect(select).toBeEnabled()
  if (scenario === 'existing') {
    await select.selectOption('p1')
    await dialog.getByRole('button', { name: 'أفضل سعر', exact: true }).click()
  } else {
    await select.selectOption('NEW')
    await dialog.getByRole('button', { name: 'أخرى', exact: true }).click()
    await dialog.locator('textarea').fill('توريد أسرع للموقع')
  }
  const partial = dialog.getByRole('checkbox')
  if (await partial.count()) await partial.check()
  const confirm = screen === 'award-legacy' ? dialog.getByRole('button', { name: 'تأكيد وتسجيل الترسية' }) : dialog.getByRole('button', { name: /^نعم، رسِّ/ })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __CALLS__?: unknown[] }).__CALLS__ || []))).toContain('award-1')
  return calls
}

/** The two reads before the write run in parallel (Promise.all): order them for comparison. */
const normalise = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path} ${c.body == null ? '' : JSON.stringify(c.body)}`)
  .map((s, i, all) => ({ s, i, k: s.startsWith('GET') && all.slice(0, i).every((p) => p.startsWith('GET')) ? `0 ${s}` : `1 ${String(i).padStart(3, '0')}` }))
  .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.s)

test('05 · Confirm Sheet sends the same API calls as AwardDialog (existing project / new project + other reason)', async ({ browser }) => {
  const report: string[] = ['# المسار D — إثبات استدعاءات الترسية: AwardDialog (قبل) مقابل Confirm Sheet (بعد)', '',
    'الطريقة: نفس الضغطات على الشاشتين في `harness.html?screen=award-legacy|award-sheet&routed=1`؛ كل طلب إلى `/_api` يُعترض في Playwright (`page.route`) ويُرد عليه من fixtures. ما يطلع أي طلب للشبكة.',
    'الطلبات المتوازية (`Promise.all` لقراءة الطلب والمقارنة) تُرتّب قبل المقارنة؛ الكتابات تُقارن بترتيبها.', '']
  for (const scenario of ['existing', 'new'] as const) {
    const a = await browser.newPage(); const before = await runAward(a, 'award-legacy', scenario); await a.close()
    const b = await browser.newPage(); const after = await runAward(b, 'award-sheet', scenario); await b.close()
    report.push(`## السيناريو: ${scenario === 'existing' ? 'مشروع موجود + «أفضل سعر»' : 'مشروع جديد + «أخرى» بنص'}`, '', '| # | قبل (AwardDialog) | بعد (Confirm Sheet) |', '|---|---|---|')
    const n = Math.max(before.length, after.length)
    for (let i = 0; i < n; i++) report.push(`| ${i + 1} | \`${before[i] ? `${before[i].method} ${before[i].path}` : '—'}\` | \`${after[i] ? `${after[i].method} ${after[i].path}` : '—'}\` |`)
    report.push('', '<details><summary>الأجسام (payload) كاملة</summary>', '', '```', ...normalise(after), '```', '</details>', '')
    const same = JSON.stringify(normalise(before)) === JSON.stringify(normalise(after))
    report.push(`**النتيجة: ${same ? 'متطابقة (نفس الطرق والمسارات والأجسام)' : 'مختلفة'}**`, '')
    expect(normalise(after)).toEqual(normalise(before))
    expect(after.some((c) => c.method === 'POST' && c.path === '/api/construction/awards')).toBe(true)
  }
  writeFileSync(`${OUT}/award-calls.md`, report.join('\n') + '\n')
})

// ── 05 · keyboard and dialog semantics ──

test('05 · «ترسية» opens the sheet: role=dialog + aria-modal, focus inside, Tab trapped, Escape closes and returns focus', async ({ page }) => {
  const writes = watchWrites(page)
  await page.goto(`${H}?screen=comparison-award`)
  await tabTo(page, (e) => e.text === 'ترسية')
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'تأكيد الترسية' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.getByRole('heading', { name: 'تأكيد الترسية' })).toBeFocused()
  await page.screenshot({ path: `${OUT}/after/05-sheet-1440.png` })
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'ترسية', exact: true }).first()).toBeFocused()
  expect(writes).toEqual([])
})

test('05 · phone: bottom sheet, «رجوع» by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const writes = watchWrites(page)
  await page.goto(`${H}?screen=comparison-award`)
  // phone layout (955a96d) labels the award button «رسِّ على <المورد>»
  const opener = page.getByRole('button', { name: /^رسِّ على / }).first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'تأكيد الترسية' })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: `${OUT}/after/05-sheet-390.png` })
  await tabTo(page, (e) => e.text === 'رجوع')
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  expect(writes).toEqual([])
})

// ── 04 · one complete offer ──

test('04/05 · one complete offer: «أوفر مورد واحد» and the disabled «ترسية» explain that two complete offers are needed', async ({ page }) => {
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(`${H}?screen=comparison`)
    const summary = page.getByRole('region', { name: 'ملخص الأسعار' })
    await expect(summary.getByText('عرض كامل واحد', { exact: true })).toBeVisible()
    await expect(summary.getByText(/نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد/)).toBeVisible()
    // 05 entry: «ترسية» stays off (rule unchanged) and says why, as text.
    await expect(page.getByRole('button', { name: 'ترسية', exact: true }).first()).toBeDisabled()
    await expect(page.getByText('نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد', { exact: true }).first()).toBeVisible()
    await summary.screenshot({ path: `${OUT}/after/04-one-complete-offer-${w}.png` })
  }
})

// ── 06 · inbox (incoming messages only, nothing is sent) ──

test('06 · inbox: keyboard opens a thread, messages shown, composer disabled, no write request', async ({ page }) => {
  const writes = watchWrites(page)
  await page.goto(`${H}?screen=inbox`)
  await expect(page.getByRole('heading', { name: 'صندوق الوارد' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'المحادثات' }).getByRole('button')).toHaveCount(3) // the DISPATCH-only row is hidden
  await tabTo(page, (e) => e.text.startsWith('مستودع الرياض للكهرباء'))
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('list', { name: 'الرسائل' }).getByRole('listitem').filter({ hasText: 'للحبة. والتوصيل علينا للرياض' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'أرسل', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'الرد على المورد' })).toBeDisabled()
  await page.screenshot({ path: `${OUT}/after/06-inbox-1440.png` })
  await tabTo(page, (e) => e.text === 'تحتاج رد')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'تحتاج رد' })).toHaveAttribute('aria-pressed', 'true')
  expect(writes).toEqual([])
})

test('06 · inbox phone: list → conversation → back; empty and error states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const writes = watchWrites(page)
  await page.goto(`${H}?screen=inbox`)
  await page.screenshot({ path: `${OUT}/after/06-inbox-list-390.png`, fullPage: true })
  await page.getByRole('button', { name: /^مستودع الرياض للكهرباء/ }).click()
  await expect(page.getByRole('button', { name: 'رجوع' })).toBeVisible()
  await expect(page.locator('#conv-h')).toBeFocused()
  await page.screenshot({ path: `${OUT}/after/06-inbox-thread-390.png`, fullPage: true })
  await page.getByRole('button', { name: 'رجوع' }).press('Enter')
  await expect(page.getByRole('heading', { name: 'صندوق الوارد' })).toBeFocused()
  await page.goto(`${H}?screen=inbox&state=empty`)
  await expect(page.getByText('ما وصلت ردود من الموردين بعد')).toBeVisible()
  await page.goto(`${H}?screen=inbox&state=error`)
  await expect(page.getByText('تعذر تحميل المحادثات')).toBeVisible()
  await expect(page.getByRole('button', { name: 'أعد المحاولة' })).toBeVisible()
  expect(writes).toEqual([])
})
