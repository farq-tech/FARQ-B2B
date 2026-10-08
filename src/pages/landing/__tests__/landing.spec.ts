import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path' // paths relative to the repo root (cwd)

const URL = '/src/pages/landing/dev.html'
const WA = 'https://wa.me/966510197017?text=' + encodeURIComponent('هلا، أبي أجرب فرق تسعير')

/** Never let the browser reach WhatsApp/mail during tests — hrefs are checked, not followed. */
async function guardOutbound(page: Page) {
  await page.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort())
}

async function focused(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    const s = a ? getComputedStyle(a) : null
    return { tag: a?.tagName ?? '', text: (a?.textContent ?? '').trim(), href: a?.getAttribute('href') ?? null, outline: s ? `${s.outlineStyle} ${parseFloat(s.outlineWidth)}` : '', outlineColor: s?.outlineColor ?? '' }
  })
}

async function tabUntil(page: Page, pred: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const f = await focused(page)
    if (pred(f)) return f
  }
  throw new Error('target never focused')
}

test.beforeEach(async ({ page }) => {
  await guardOutbound(page)
})

test('RTL, lang, landmarks, one h1, SEO tags applied', async ({ page }) => {
  await page.goto(URL)
  await expect(page.locator('#faq')).toBeVisible()
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['ar', 'rtl'])
  await expect(page.locator('header')).toHaveCount(1)
  await expect(page.locator('main#main')).toHaveCount(1)
  await expect(page.locator('footer')).toHaveCount(1)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page).toHaveTitle('فرق تسعير — قبل ما تشتري، شوف الفرق')
  for (const sel of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[name="twitter:card"]', 'link[rel="canonical"]']) {
    await expect(page.locator(sel)).toHaveCount(1)
  }
  // No horizontal scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test('contact: every WhatsApp link has the ready message, opens a new tab safely; number and email are LTR', async ({ page }) => {
  await page.goto(URL)
  await expect(page.locator('footer')).toBeVisible()
  const links = page.locator('a[href^="https://wa.me"]')
  expect(await links.count()).toBeGreaterThanOrEqual(5)
  for (const a of await links.all()) {
    await expect(a).toHaveAttribute('href', WA)
    await expect(a).toHaveAttribute('target', '_blank')
    await expect(a).toHaveAttribute('rel', /noopener/)
  }
  await expect(page.locator('a[href="mailto:info@farq.sa"]')).toHaveCount(1)
  const phone = page.locator('footer bdi', { hasText: '+966 51 019 7017' })
  await expect(phone).toHaveAttribute('dir', 'ltr')
})

test('keyboard: skip link, nav links, hero CTA with a visible focus ring on the dark hero', async ({ page }) => {
  await page.goto(URL)
  await expect(page.locator('#faq')).toBeVisible()
  await page.keyboard.press('Tab')
  let f = await focused(page)
  expect(f.text).toBe('تخطَّ إلى المحتوى')
  await expect(page.getByText('تخطَّ إلى المحتوى')).toBeVisible()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => location.hash)).toBe('#main')

  await page.goto(URL)
  await expect(page.locator('#faq')).toBeVisible()
  f = await tabUntil(page, (x) => x.text === 'كيف تعمل' && x.href === '#how')
  expect(f.outline).toMatch(/solid [2-9]/)
  f = await tabUntil(page, (x) => x.text.includes('ابدأ التسعير') && x.href === WA)
  expect(f.outline).toMatch(/solid [2-9]/)
  // On the deep (charcoal) bands the ring switches to mint so it stays visible.
  const mint = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--brand-accent)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })
  expect(f.outlineColor).toBe(mint)
  await page.screenshot({ path: 'docs/qa/landing/after-keyboard-focus-1440.png' })
})

test('keyboard: FAQ items open and close with Enter and Space', async ({ page }) => {
  await page.goto(URL)
  const second = page.locator('#faq details').nth(1)
  await expect(second).not.toHaveAttribute('open', '')
  await second.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(second).toHaveAttribute('open', '')
  await expect(second).toContainText('الإجابة قيد الإعداد')
  await page.keyboard.press(' ')
  await expect(second).not.toHaveAttribute('open', '')
})

test.describe('phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('menu button: Enter opens, Escape closes and returns focus', async ({ page }) => {
    await page.goto(URL)
    const btn = page.getByRole('button', { name: 'فتح القائمة' })
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await btn.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'إغلاق القائمة' })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('navigation', { name: 'القائمة' })).toBeVisible()
    await page.screenshot({ path: 'docs/qa/landing/after-390-menu-open.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('navigation', { name: 'القائمة' })).toBeHidden()
    expect((await focused(page)).tag).toBe('BUTTON')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

test('loading state while the lower sections load, then content', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route(/sections\/Below\.tsx/, async (route) => {
    await gate
    await route.continue()
  })
  await page.goto(URL)
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.locator('output', { hasText: 'جارٍ تحميل باقي الصفحة' })).toBeAttached()
  release()
  await expect(page.locator('#faq')).toBeVisible()
  await expect(page.locator('output')).toHaveCount(0)
})

test('error state: lower sections fail to load → alert with reload + WhatsApp; hero still usable', async ({ page }) => {
  await page.route(/sections\/Below\.tsx/, (r) => r.abort())
  await page.goto(URL)
  await expect(page.locator('h1')).toBeVisible()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('ما قدرنا نحمّل باقي الصفحة')
  await expect(alert.getByRole('button', { name: 'حدّث الصفحة' })).toBeVisible()
  await expect(alert.locator(`a[href="${WA}"]`)).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(1)
  await page.screenshot({ path: 'docs/qa/landing/after-error-state-1440.png' })
})

test('the landing chunk imports nothing from src/api, src/views, src/lib or procurementContext', () => {
  const root = resolve('src/pages/landing')
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === '__tests__' ? [] : walk(join(d, f))) : [join(d, f)]))
  const bad = walk(root)
    .filter((f) => /\.tsx?$/.test(f))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => /^\s*import .*from ['"].*(\/api\/|\/views\/|\/lib\/|procurementContext)/.test(l)).map((l) => `${f}: ${l}`))
  expect(bad).toEqual([])
})
