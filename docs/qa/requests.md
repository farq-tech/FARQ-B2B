# Requests to the Lead (files outside a track's limits)

## Track B (design/landing) — landing page

Branch `design/landing`. Page: `src/pages/landing/index.tsx` (default export `LandingPage`).

### B1. Route «/» → LandingPage (routing file, Lead)
- Mount `LandingPage` at `/` with a lazy import so it stays its own public chunk:
  `const LandingPage = lazy(() => import('./pages/landing'))`.
- The page imports nothing from `src/api`, `src/views`, `src/lib` or `procurementContext` (checked by
  `src/pages/landing/__tests__/landing.spec.ts`). A landing-only build is 45 modules: `dev-*.js` 82.6 kB gz (React + hero),
  `Below-*.js` 9.1 kB gz, CSS 10 kB gz.
- «دخول» links to `/requests` (the app home from ba28798; it shows the login when signed out). Change
  `APP_LOGIN_HREF` in `src/pages/landing/contact.ts` if the app moves.
- In-page anchors used by the nav: `#main #how #how-we-price #difference #audience #pricing #faq`.

### B2. server.py — the landing must be reachable without the site password (decision 1)
- Today `do_GET` returns the password form for every path when `PRICING_PASSWORD` is set (server.py:43).
- Needed: serve `/` (and the static assets it loads: `/assets/*`, fonts) without the gate; keep the gate and the
  Farq login for the app routes (`/requests`, `/new`, `/requests/:id…`) and keep `/_api/*` protected as now.

### B3. index.html — static head for crawlers (JS-less)
The page applies these at runtime (`applySeo()` in `src/pages/landing/seo.ts`), but crawlers need them in the HTML.
Replace `<meta name="robots" content="noindex, nofollow" />` and `<title>` for the landing response with the block
below (`seoHeadHtml(url)` prints it). If the same index.html also serves the app, either serve a landing-specific HTML
for `/` from server.py or keep `noindex` on app routes only.

```html
<title>فرق تسعير — قبل ما تشتري، شوف الفرق</title>
<meta name="description" content="ارفع الكراسة أو اكتب الطلبات أو صوّرها، ونجيب لك عروض أسعار من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر." />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="فرق تسعير" />
<meta property="og:locale" content="ar_SA" />
<meta property="og:title" content="فرق تسعير — قبل ما تشتري، شوف الفرق" />
<meta property="og:description" content="ارفع الكراسة أو اكتب الطلبات أو صوّرها، ونجيب لك عروض أسعار من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر." />
<meta property="og:url" content="https://[النطاق-يُحدَّد]/" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="فرق تسعير — قبل ما تشتري، شوف الفرق" />
<meta name="twitter:description" content="ارفع الكراسة أو اكتب الطلبات أو صوّرها، ونجيب لك عروض أسعار من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر." />
<link rel="canonical" href="https://[النطاق-يُحدَّد]/" />
```
- `<html lang="ar" dir="rtl">` is already in index.html.
- The production domain is not decided: set `SITE_URL` in `seo.ts` and the two URLs above once it is.
- No `og:image` yet — needs a 1200×630 share image (not in Figma).

### B4. index.html — font preconnect (LCP)
`src/index.css` loads Tajawal / Readex Pro through a CSS `@import` (render-blocking chain). Add to `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
```
Measured without it: LCP ≈ 2.0 s (see docs/qa/landing/README.md). Self-hosting the two fonts would remove the
third-party hop entirely.

### B5. Living background (Lead)
Every `<div data-live-bg="deep|accent|light">` is an empty, absolutely positioned (`inset-0`), `aria-hidden`,
`pointer-events-none` slot sized to its section; mount `<LiveBackground tone=…>` there. Slots:
hero (deep) · «كل الردود في مكان واحد» (deep) · «شوف الفرق قبل ما تقرر» (accent) · ثلاث طرق (light) ·
«كيف نسعّر لك؟» rounded frame (light, inside the 24px-radius frame) · وش الفرق؟ (light) · trust strip (light) ·
audience (light) · inbox showcase (deep) · pricing (light) · FAQ (light) · final CTA (accent).
Sections already carry `data-tone="deep|accent"`, so `--live-*` colours resolve per tone from tokens.css.

## Track D (design/screens-b) — screens 05 and 06

### R-D1 · Route `/inbox` → `src/pages/inbox/index.tsx` (default export `InboxPage`)
Add to the routing file from ba28798 (not a second routing file). Props:

```ts
type InboxPageProps = {
  onOpenRequest?: (rfqId: string) => void        // open screen 03 for that request → navigate to /requests/:rfqId
  initialInviteId?: string | null                // e.g. /inbox?thread=<inviteId>
  onSelectThread?: (inviteId: string | null) => void // mirror the open thread in the URL (optional)
}
```
The page renders its own heading and three columns (desktop) or list → conversation (phone, uses `MobileAppBar`).
Inside the app shell put it in `<main>` next to the sidebar; it sizes itself with `h-dvh`.

### R-D2 · Sidebar / bottom nav item «صندوق الوارد» (src/App.tsx)
`<NavItem icon="inbox" label="صندوق الوارد" …/>` and the same tab in `MobileBottomNav`. No counter (no endpoint used for it; open-issues §3).

### R-D3 · Route `/requests/:id/award` → `src/pages/award/index.tsx` (default export `AwardPage`)
```ts
type AwardPageProps = {
  rfqId: string                       // :id
  supplierId?: string | null          // optional ?supplier=; default = matrixTotals().lowest (needs ≥ 2 complete offers)
  onBack: () => void                  // → /requests/:id/compare
  onDone: (award: Record<string, unknown>) => void  // → /requests/:id (screen 03 shows «تمت الترسية»)
}
```
Screen 04 already opens the same sheet in place (no route needed for the normal flow); the route is only a deep link.

### R-D4 · Legacy `src/components/procurement/AwardDialog.tsx`
No longer used by any screen; kept only as the «before» reference of the award-call proof
(`docs/qa/screens-b/harness.html?screen=award-legacy`). Delete it after the proof is accepted (also drop its LEGACY entry in scripts/lint-tokens.mjs).

### R-D5 · Test runner
Track D tests live in `docs/qa/screens-b/screens-b.spec.ts` (+ `playwright.config.ts`, port 5193, no web server).
If you want them in `tests/`, move the file and point it at `/docs/qa/screens-b/harness.html` through baseURL.
One repo test was changed because the dialog behaviour changed on purpose: `tests/keyboard.spec.ts` «04 · enabled «ترسية»…»
(now asserts focus inside, Escape closes, focus returns).

### R-D6 · Live inbox check (needs a signed-in session)
The owner sends WhatsApp «اختبار صندوق الوارد» to +966 51 019 7017; open `/inbox` signed in and note: shown? after how many seconds (list polls every 15 s, «آخر تحديث» time is on screen)? row text and conversation bubble. Do not reply (the composer is disabled anyway).
