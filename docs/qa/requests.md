# Requests from track B (landing page) — files outside this track's bounds

Branch `design/landing`. Page: `src/pages/landing/index.tsx` (default export `LandingPage`).

## 1. Route «/» → LandingPage (routing file, Lead)
- Mount `LandingPage` at `/` with a lazy import so it stays its own public chunk:
  `const LandingPage = lazy(() => import('./pages/landing'))`.
- The page imports nothing from `src/api`, `src/views`, `src/lib` or `procurementContext` (checked by
  `src/pages/landing/__tests__/landing.spec.ts`). A landing-only build is 45 modules: `dev-*.js` 82.6 kB gz (React + hero),
  `Below-*.js` 9.1 kB gz, CSS 10 kB gz.
- «دخول» links to `/requests` (the app home from ba28798; it shows the login when signed out). Change
  `APP_LOGIN_HREF` in `src/pages/landing/contact.ts` if the app moves.
- In-page anchors used by the nav: `#main #how #how-we-price #difference #audience #pricing #faq`.

## 2. server.py — the landing must be reachable without the site password (decision 1)
- Today `do_GET` returns the password form for every path when `PRICING_PASSWORD` is set (server.py:43).
- Needed: serve `/` (and the static assets it loads: `/assets/*`, fonts) without the gate; keep the gate and the
  Farq login for the app routes (`/requests`, `/new`, `/requests/:id…`) and keep `/_api/*` protected as now.

## 3. index.html — static head for crawlers (JS-less)
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

## 4. index.html — font preconnect (LCP)
`src/index.css` loads Tajawal / Readex Pro through a CSS `@import` (render-blocking chain). Add to `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
```
Measured without it: LCP ≈ 2.0 s (see docs/qa/landing/README.md). Self-hosting the two fonts would remove the
third-party hop entirely.

## 5. Living background (Lead)
Every `<div data-live-bg="deep|accent|light">` is an empty, absolutely positioned (`inset-0`), `aria-hidden`,
`pointer-events-none` slot sized to its section; mount `<LiveBackground tone=…>` there. Slots:
hero (deep) · «كل الردود في مكان واحد» (deep) · «شوف الفرق قبل ما تقرر» (accent) · ثلاث طرق (light) ·
«كيف نسعّر لك؟» rounded frame (light, inside the 24px-radius frame) · وش الفرق؟ (light) · trust strip (light) ·
audience (light) · inbox showcase (deep) · pricing (light) · FAQ (light) · final CTA (accent).
Sections already carry `data-tone="deep|accent"`, so `--live-*` colours resolve per tone from tokens.css.
