# Landing page QA (track B)

Figma: Landing Desktop 33:2 · Mobile 60:728 · «كيف نسعّر لك؟» 85:1351 / 86:629.
Preview (dev only): `npx vite --port 5191 --strictPort` → http://localhost:5191/src/pages/landing/dev.html

## Screenshots (Figma ↔ code)
| Section | 1440 | 390 |
|---|---|---|
| Full page | figma-1440-full.png ↔ after-1440-full.png | figma-390-full.png ↔ after-390-full.png |
| Hero | figma-1440-hero.png ↔ after-1440-hero.png | figma-390-hero.png ↔ after-390-hero.png |
| كيف نسعّر لك؟ | figma-1440-how-we-price.png ↔ after-1440-how-we-price.png | figma-390-how-we-price.png ↔ after-390-how-we-price.png |
| Footer / contact | figma-1440-footer.png ↔ after-1440-footer.png | figma-390-footer.png ↔ after-390-footer.png |
| States | after-keyboard-focus-1440.png · after-error-state-1440.png · after-390-menu-open.png | |

Known differences: the living background is an empty slot (`data-live-bg`) until the Lead mounts `<LiveBackground>`,
so sections show their flat tone colour and the «كيف نسعّر لك؟» frame is empty. Mobile keeps every desktop section
(stacked) — the mobile frame in Figma shows a subset. Trust/pricing figures are placeholders (open-issues §5).

## Tests
`npx playwright test -c src/pages/landing/__tests__/playwright.config.ts` — 8 passed: RTL/lang/landmarks/SEO,
WhatsApp/mail hrefs (never followed; wa.me requests are aborted), keyboard (skip link, nav, CTA focus ring on dark,
FAQ Enter/Space, phone menu Enter/Escape + focus return), loading state, error state, import boundary.

## LCP
Method: Playwright + Chrome, production build of the landing entry only (served by a local static server without
gzip), phone viewport 390×844 DPR 2, CDP `Network.emulateNetworkConditions` = Slow 4G (150 ms RTT, 1.6 Mbps down,
750 kbps up), cache disabled, CDP `Emulation.setCPUThrottlingRate` ×4, `PerformanceObserver('largest-contentful-paint')`.
Lighthouse was not used (not installed; not downloaded to save disk).

| Run | FCP | LCP | LCP element |
|---|---|---|---|
| 1 | 2068 ms | 2068 ms | `h1#hero-title` |
| 2 | 1980 ms | 1980 ms | `h1#hero-title` |
| 3 | 1992 ms | 1992 ms | `h1#hero-title` |

Median LCP ≈ 1.99 s (< 2.5 s target). No images above the fold; the lower sections are a separate lazy chunk.
Not measured: real network latency to the production host, and the app's index.html (the Lead's route) instead of the dev entry.
