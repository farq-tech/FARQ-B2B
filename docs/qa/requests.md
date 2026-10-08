# Requests to the Lead (files outside a track's limits)

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
