import { expect, test, type Page } from '@playwright/test'

const SHOTS = 'docs/qa/m2/keyboard'

/** Presses Tab until `match` holds for the focused element; returns the number of presses. */
async function tabTo(page: Page, match: (el: { role: string | null; text: string; tag: string; disabled: boolean }) => boolean, max = 60) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab')
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return { role: a?.getAttribute('role') ?? null, text: (a?.textContent || '').trim(), tag: a?.tagName || '', disabled: Boolean((a as HTMLButtonElement | null)?.disabled) }
    })
    if (match(el)) return i
  }
  throw new Error('target never received focus via Tab')
}

/** The focused element draws a visible focus ring (outline), as the Figma «Focus» state. */
async function expectFocusRing(page: Page) {
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element)
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
  })
  expect(ring.style).not.toBe('none')
  expect(ring.width).toBeGreaterThanOrEqual(2)
}

test('03 · tabs: Tab reaches the tablist, arrows follow RTL, Home/End, list filters', async ({ page }) => {
  await page.goto('/?harness=tracking')
  await expect(page.getByRole('tab', { name: 'الكل 5' })).toBeVisible()
  await tabTo(page, (e) => e.role === 'tab')
  await expect(page.getByRole('tab', { name: 'الكل 5' })).toBeFocused()
  await expectFocusRing(page)
  await page.screenshot({ path: `${SHOTS}/03-tabs-focus.png` })

  await page.keyboard.press('ArrowLeft') // RTL: left = next
  await expect(page.getByRole('tab', { name: 'أرسلوا سعر 3' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'أرسلوا سعر 3' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('section[aria-labelledby="suppliers-h"] li')).toHaveCount(3)
  await page.keyboard.press('ArrowRight') // previous
  await expect(page.getByRole('tab', { name: 'الكل 5' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'اعتذروا 1' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('section[aria-labelledby="suppliers-h"] li')).toHaveCount(1)
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: 'الكل 5' })).toBeFocused()
  // only the selected tab is in the Tab order (roving tabindex)
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
})

test('03 · «قارن العروض» is reachable by Tab with a visible focus ring', async ({ page }) => {
  await page.goto('/?harness=tracking')
  await tabTo(page, (e) => e.text.startsWith('قارن العروض'))
  await expectFocusRing(page)
  await page.screenshot({ path: `${SHOTS}/03-compare-button-focus.png` })
})

test('04 · chips toggle with Enter and announce aria-pressed', async ({ page }) => {
  await page.goto('/?harness=comparison')
  await tabTo(page, (e) => e.text.startsWith('فيها فرق كبير'))
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /فيها فرق كبير/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /كل البنود/ })).toHaveAttribute('aria-pressed', 'false')
})

test('04 · disabled «ترسية» is skipped by Tab and its reason is shown as text', async ({ page }) => {
  await page.goto('/?harness=comparison')
  // header «ترسية» (the recommendation card repeats it when no single supplier is named)
  const award = page.getByRole('button', { name: 'ترسية', exact: true }).first()
  await expect(award).toBeDisabled()
  const reason = await award.getAttribute('title')
  expect(reason).toBeTruthy()
  await expect(page.locator('aside[aria-label="التوصية"]').getByText(reason!, { exact: true })).toBeVisible()
  await tabTo(page, (e) => e.text === 'تصدير')
  await page.keyboard.press('Tab')
  const next = await page.evaluate(() => (document.activeElement?.textContent || '').trim())
  expect(next).not.toBe('ترسية')
})

test('04 · enabled «ترسية»: focus ring, Enter opens the award dialog, keyboard can cancel', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`) })
  await page.goto('/?harness=comparison-award')
  await expect(page.getByRole('button', { name: 'ترسية', exact: true }).first()).toBeEnabled()
  await tabTo(page, (e) => e.text === 'ترسية')
  await expectFocusRing(page)
  await page.screenshot({ path: `${SHOTS}/04-award-focus.png` })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/04-award-dialog.png` })
  // Confirm Sheet (track D): focus moves inside, Escape closes, focus returns to «ترسية».
  await expect(page.getByRole('heading', { name: 'تأكيد الترسية' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'ترسية', exact: true }).first()).toBeFocused()
  expect(writes).toEqual([]) // nothing was submitted
})

test('/ui · Dropzone: Tab focus, Enter opens the file chooser, file is accepted', async ({ page }) => {
  await page.goto('/ui')
  await tabTo(page, (e) => e.text.includes('اسحب الملف هنا'), 120)
  await expectFocusRing(page)
  await page.locator(':focus').screenshot({ path: `${SHOTS}/ui-dropzone-focus.png` })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')])
  await chooser.setFiles({ name: 'BOQ-test.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') })
  await expect(page.getByRole('button', { name: /تم رفع الملف · BOQ-test\.xlsx/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'تم رفع الملف · BOQ-test.xlsx' })).toHaveCount(1) // announced
  // Space works too
  await page.locator(':focus').blur()
  await tabTo(page, (e) => e.text.includes('تم رفع الملف'), 120)
  const [again] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')])
  expect(again).toBeTruthy()
})
