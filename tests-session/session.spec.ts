import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { STUB } from './playwright.config'

/*
 * The login survives a refresh and a new tab, with no app data on the device: server.py keeps the Farq session in a
 * sealed HttpOnly / Secure / SameSite=Lax cookie and adds the Authorization header itself. The browser never sees a
 * token. Real proxy (production build) in front of a fake Farq API that rotates single-use refresh tokens.
 */
type State = { seen: [string, string, string][]; events: string[]; refresh: string | null; access: string[] }
const state = async (page: Page): Promise<State> => (await page.request.get(`${STUB}/__stub/state`)).json()
const sessionCookie = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === 'farq_session')

async function signIn(page: Page, password = 'right') {
  await page.goto('/requests')
  await page.getByLabel('البريد الإلكتروني').fill('abdulrhman@farq.sa')
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
}
const signedIn = (page: Page) => expect(page.getByRole('button', { name: 'تسجيل الخروج' }).first()).toBeVisible()
const signedOut = (page: Page) => expect(page.getByLabel('كلمة المرور')).toBeVisible()

async function nothingOnTheDevice(page: Page) {
  const r = await page.evaluate(async () => ({
    cookie: document.cookie, local: localStorage.length, session: sessionStorage.length, idb: (await indexedDB.databases?.() || []).length,
    html: document.documentElement.outerHTML,
  }))
  expect(r.cookie).not.toContain('farq_session')
  expect([r.local, r.session, r.idb]).toEqual([0, 0, 0])
  expect(r.html).not.toMatch(/acc-\d|ref-\d/)
}

test.beforeEach(async ({ page }) => { await page.request.post(`${STUB}/__stub/reset`) })

test('login → HttpOnly sealed cookie, the proxy adds the bearer, nothing on the device', async ({ page, context }) => {
  await signIn(page, 'wrong')
  await expect(page.getByRole('alert')).toContainText('البريد أو كلمة المرور غير صحيحة')
  expect(await sessionCookie(context)).toBeUndefined()
  await page.getByLabel('كلمة المرور').fill('right')
  await page.getByRole('button', { name: 'دخول' }).click()
  await signedIn(page)
  const c = (await sessionCookie(context))!
  expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
  expect(c.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400) // the refresh token's 30 days
  expect(c.value).not.toMatch(/acc-|ref-|abdulrhman/) // sealed: no token, no email in clear
  await nothingOnTheDevice(page)
  // calls from the page reach the API with this account's bearer, added by server.py
  expect(await page.evaluate(async () => (await fetch('/_api/api/business/context')).status)).toBe(200)
  const s = await state(page)
  expect(s.seen.filter(([, p]) => p === '/api/business/context').map(([, , auth]) => auth)).toEqual(['Bearer acc-1'])
  // the token routes are closed through /_api: a token never comes back to the browser
  const blocked = await page.evaluate(async () => (await fetch('/_api/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
  expect(blocked).toBe(404)
  // /_session/me answers the user, never a token
  const me = await page.evaluate(async () => (await fetch('/_session/me')).text())
  expect(me).toContain('abdulrhman@farq.sa')
  expect(me).not.toMatch(/acc-|ref-|token/)
})

test('a refresh and a new tab stay signed in', async ({ page, context }) => {
  await signIn(page)
  await signedIn(page)
  await page.reload()
  await signedIn(page)
  const tab = await context.newPage()
  await tab.goto('/opportunity-map')
  await signedIn(tab)
  await nothingOnTheDevice(tab)
  expect((await state(page)).events).toEqual(['login']) // no re-login, no needless rotation
})

test('an access token rejected mid-session: the proxy renews once and retries; the cookie follows the rotation', async ({ page, context }) => {
  await signIn(page)
  await signedIn(page)
  const before = (await sessionCookie(context))!.value
  await page.request.post(`${STUB}/__stub/revoke-access`)
  const status = await page.evaluate(async () => (await fetch('/_api/api/business/context')).status)
  expect(status).toBe(200)
  const s = await state(page)
  expect(s.events).toEqual(['login', 'refresh'])
  expect(s.seen.filter(([, p]) => p === '/api/business/context').map(([, , a]) => a).slice(-2)).toEqual(['Bearer acc-1', 'Bearer acc-2'])
  const after = (await sessionCookie(context))!.value
  expect(after).not.toBe(before)
  // parallel calls with the rotated cookie: one family, no reuse
  await page.request.post(`${STUB}/__stub/revoke-access`)
  const codes = await page.evaluate(async () => Promise.all([1, 2, 3, 4].map(async () => (await fetch('/_api/api/business/context')).status)))
  expect(codes).toEqual([200, 200, 200, 200])
  expect((await state(page)).events).not.toContain('reuse')
  await page.reload()
  await signedIn(page)
})

test('logout clears the cookie, revokes on the API, and a reload or another tab asks for the password', async ({ page, context }) => {
  await signIn(page)
  await signedIn(page)
  const tab = await context.newPage()
  await tab.goto('/requests')
  await signedIn(tab)
  await page.getByRole('button', { name: 'تسجيل الخروج' }).first().click()
  await signedOut(page)
  expect(await sessionCookie(context)).toBeUndefined()
  expect((await state(page)).events).toEqual(['login', 'logout:ref-1'])
  await page.reload()
  await signedOut(page)
  await tab.reload()
  await signedOut(tab)
})

test('CSRF: a state-changing call with the cookie from another origin is refused', async ({ page }) => {
  await signIn(page)
  await signedIn(page)
  for (const path of ['/_api/api/business/opportunity-requests', '/_targeting/search', '/_session/logout']) {
    const r = await page.request.post(path, { headers: { Origin: 'https://evil.example', 'content-type': 'application/json' }, data: {} })
    expect(r.status(), path).toBe(403)
  }
  // the same call from the site itself goes through
  const ok = await page.evaluate(async () => (await fetch('/_api/api/business/opportunity-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
  expect(ok).toBe(200)
  // the session survived the refused attempts
  await page.reload()
  await signedIn(page)
})

test('landing → app while signed in: still signed in, the chosen goal opens Explore', async ({ page }) => {
  await signIn(page)
  await signedIn(page)
  await page.goto('/')
  await page.goto('/requests?goal=marketing')
  await signedIn(page)
  await expect(page.getByRole('heading', { name: 'وش تقدّم لعملائك؟' })).toBeVisible()
})
