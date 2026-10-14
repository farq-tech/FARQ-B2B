# Figma map — FARQ B2B post-login screens (design stage, before «ابدأ»)

File: Nucleus Pro `gxlY4uu8hzkUNrcN61uQZt` · page **«✦ Farq B2B: Screens» `18370:25`**
Open: https://www.figma.com/design/gxlY4uu8hzkUNrcN61uQZt/?node-id=18370-25
Prototype «Farq B2B — حملة موردين» (flow start `18374:366`):
https://www.figma.com/proto/gxlY4uu8hzkUNrcN61uQZt/?node-id=18374-366&starting-point-node-id=18374-366

Built 2026-10-14 on branch `design/b2b-kit-restyle`. No code changed. No component created
(«✦ Farq B2B: Components» page not created). Every sample-content frame carries a visible
Badge - Status (Info) «بيانات تجريبية».

## 1. Variables

| What | Id | Notes |
|---|---|---|
| Collection «Farq B2B — Brand» | `VariableCollectionId:18370:2` (mode «B2B» `18370:0`) | 36 variables |
| Nucleus collection, new mode «B2B» | `VariableCollectionId:1760:21728` mode `18370:1` | Light `1760:3` and Dark `1760:4` untouched |
| Consumer collection «Farq — Brand (owner palette)» | `VariableCollectionId:18147:19617` | not modified; B2B aliases only the shared lime (`color/gap/*`, `color/savings/confirmed`) |

B2B role tokens: `b2b/primary` 18370:3 · `b2b/canvas` 18370:4 · `b2b/canvas-end` 18370:5 · `b2b/surface` 18370:6 ·
`b2b/cta` 18370:7 · `b2b/on-cta` 18370:8 · `b2b/border` 18370:9 · `b2b/sage` 18370:10 · `b2b/olive-gold` 18370:11 ·
`b2b/rose` 18370:12 · `b2b/selected` 18370:13 · `b2b/status/success|warning|danger` 18370:14–16.
Aliases (same names as the consumer palette, so cloned consumer layers re-point by name): `color/brand/primary` 18370:17,
`color/text/base` :18, `color/text/muted` :19, `color/bg/canvas` :20, `color/bg/surface` :21, `color/border/subtle` :22,
`color/action/fill` :23, `color/action/text` :24, `color/bg/scrim` :2623, `color/bg/soft` :2624, `color/bg/sunken` :2625,
`color/bg/wash` :2626, `color/gap/fill` :2627 → consumer `color/gap/fill` (18274:30), `color/gap/tail` :2628,
`color/savings/confirmed` :2629, `color/text/on-deep` :2630, `color/text/on-primary` :2631, `color/text/subtle` :2632,
`color/border/strong` :2633, `color/status/success|warning|danger` :2634–2636.

Nucleus «B2B» mode overrides: `global/brand/10…100` = `#edf4dd #e4f2b8 #d8ee8c #b9d27a #8fae6f #5f8761 #3f6a4b #2f573d #254834 #1a3426`;
`semantic/accent/moderate → b2b/cta`, `accent/on-accent → b2b/on-cta`, `accent/bold → b2b/primary` (text of Secondary /
Tertiary / Text buttons and inactive chips), `accent/strong → brand/80`, `accent/subtle → b2b/selected`,
`fg/base|link|static-dark → b2b/primary`, `fg/subtle|disabled → b2b/sage`, `fg/success|warning|danger|error → b2b/status/*`,
`bg/canvas|surface → b2b/canvas|surface`, `bg/contrast → b2b/primary`, `border/subtle|muted|interactive-primary → b2b/border`.
Everything else copies Light (the new mode first copied Dark; it was reset from Light).

**Verified** on frame «B2B token check» `18370:26`: Button - Full width = `#d8ee8c` fill, `#254834` label; Badge - Status
success = `#22a55b` text on `#e8faf0`.

## 2. Screens

Ratio = kit instances ÷ (kit instances + hand-built layers), counted on the screen's own layers (instance internals not
counted, the sample tag excluded). Hand-built layers are mostly auto-layout containers and text; the specific
hand-built *pieces* are listed in §3.

### Mobile (393 × 852 unless noted)

| Screen | Node | Base pattern | Kit instances (source page) | Data source (code) | Ratio |
|---|---|---|---|---|---|
| M01 Login | `18370:22532` | consumer Auth / Sign in `18340:1766` | Status Bar, Top Bar - Center, Text Field ×2, Buttons - Full width, Home Indicator | `farqSession.signIn` | 50 % |
| M01 Login — خطأ | `18370:22663` | ↑ | + Badge - Status Error, Text Field State=Error | FarqAuthError | 54 % |
| M01 Login — جارٍ الدخول | `18370:22705` | ↑ | Button State=Loading | — | 50 % |
| M01 Login — الحساب غير مصرّح | `18370:22747` | ↑ | Button Secondary | `VITE_ALLOWED_EMAILS` gate | 57 % |
| M01a New request · input | `18378:1091` | built from Nucleus | List - Has Padding (Icon+Text, Radio) ×3, Buttons - Full width ×2, Progress Bar | NewRequestV2 step 0 | 43 % |
| M01b New request · review lines | `18378:1253` | built | Chips ×4, List (Text, Checkbox) ×4, Badge ×2, Basket bar (Buttons - Small) | `matchConstructionBoqCatalog` | 44 % |
| M02 RFQ list | `18371:22940` | consumer Orders `18323:1230` | Farq / Food (from Foodie) Order Card Progress ×2 / Finished ×2, Top Bar, Tab Bars (4) | `GET /api/construction/rfqs` | 80 % |
| M03 Request tracking | `18371:23094` | consumer Orders / Detail `18342:2046` | Badge, Progress Bar (RTL), Dividers, Buttons - Full width, Tab Bars | `getConstructionRfq` + comparison + outcomes | 13 % |
| M04 Comparison | `18371:23206` | consumer Taseer / Request `18314:558` | Badge ×3 («الأرخص المكتمل», «عرض ناقص»), Avatars ×3, Buttons - Full width | `getConstructionComparison` | 17 % |
| M05 Award — تمت الترسية | `18377:977` | consumer Billing / Success `18343:2435` (3D check) | Buttons - Full width ×2 | `createConstructionAward` | 56 % |
| M05a Award — confirm sheet | `18377:1020` | M04 + handoff-sheet construction | + sheet Badge, Buttons ×2 | AwardConfirmSheet | 15 % |
| M06 Inbox thread (read-only) | `18377:1131` | consumer Taseer / Chat `18320:763` | Avatars, Text Field State=Disabled, Buttons - Small | inbox threads (read only) | 27 % |
| M07 Segment | `18374:366` | built from Nucleus | Search Bar, Chips ×5, Buttons - Small (Text) «تحديد الكل المطابق», List (Avatar+Text, Checkbox) ×3 + 1 without channel (Badge Warning «بلا قناة مؤكدة»), Basket bar, Progress Bar, Tab Bars | `POST /_targeting/search`, `GET /cities` | 47 % |
| M08 Message (templates) | `18375:467` | built | List (Icon+Text, Radio) ×3 each with Badge (معتمد / قيد المراجعة / مرفوض), Buttons - Full width «قالب جديد», chat-bubble preview, Basket bar | `GET /_targeting/templates` | 32 % |
| M09 Template editor (1659 tall) | `18375:23080` | built | Text Field ×4, Dropdown ×2, Text Area, Chips ×5 ({{n}} variables, quick replies), List rows ×4 (checks), Buttons ×2 | `POST /_targeting/templates` | 47 % |
| M10 Meta approval — Pending | `18375:23452` | built | Badge Warning, Buttons Secondary «حدّث الحالة» + Primary Disabled | `GET /templates` (re-read) | 38 % |
| M10 — Rejected | `18375:23553` | ↑ | Badge Error, Meta reason verbatim, «عدّل القالب» | `rejected_reason` | 33 % |
| M10 — Approved | `18375:23649` | ↑ | Badge Success, «التالي» | — | 37 % |
| M10 — Offline | `18375:23743` | ↑ | «خدمة الاستهداف غير متصلة», Primary Disabled | TargetingError | 40 % |
| M11 Review & cost (sheet) | `18375:23935` | M10 Approved + handoff-sheet construction `18342:2227` | Badge Info «غير متوفر» (VAT/balance), Buttons ×2 «أرسل إلى 3 موردين · التكلفة 0.51 ر.س» | price_sar × recipients (owner decision) | 21 % |
| M12 Result — SEND_DISABLED | `18376:845` | built | Badge Warning «الإرسال مقفل حتى يفعّله المالك», List ×3 + Badge «لم يُرسل» | `SEND_DISABLED` 403 | 44 % |
| M12 Result — Delivery evidence | `18376:933` | built | List ×3 + Badge (ردّ / وصل / غير مؤكد) + Buttons - Small «تحقق» | **GAP D2** (not in API) | 46 % |
| M13a Supplier · invitation (614 tall) | `18379:1191` | built | Buttons Primary «قدّم عرضك» + Text | `getPublicSupplierInvite` | 31 % |
| M13b Supplier · quote form (864 tall) | `18379:1277` | built | Badge Warning «عرض ناقص · 2 من 3», Text Field ×3, Chips «ما عندي هذا البند», Stepper (LTR), Dropdown, Buttons | `submitPublicSupplierQuote` | 37 % |

### Web (1440 × 900; shell from Nucleus «Web: Dashboard Patterns» `2865:345`, mirrored to RTL)

| Screen | Node | Notes | Ratio |
|---|---|---|---|
| W00 Shell | `18371:99` | Sidebar + Page Heading pattern `4612:12406`; Farq wordmark (from `src/ui/Logo.tsx`); nav: طلبات التسعير · طلب جديد · صندوق الوارد · الاستهداف · قوالب واتساب; no Night toggle | 13 % |
| W01 Login | `18380:26518` | Dashboard «Log in» `4612:13340`; photo panel replaced by `b2b/primary` brand panel | 14 % |
| W01b New request · review | `18391:2905` | M01b in a 720 column | 30 % |
| W02 RFQ list | `18371:288` | Dashboard table; Badge - Status per row | 17 % |
| W03 Request tracking | `18391:1994` | M03 content | 15 % |
| W04 Comparison | `18391:2220` | M04 content | 18 % |
| W05a Award confirm | `18391:2459` | M05a sheet as centred modal | 16 % |
| W06 Inbox thread | `18391:2730` | M06 content, read-only composer | 22 % |
| W07 Segment (two-pane) | `18391:3124` | list pane 440 + Mapbox slot | 31 % |
| W08 Message | `18380:1506` | | 25 % |
| W09 Template editor (1619 tall) | `18380:1732` | | 34 % |
| W10 Approval — Pending / Rejected | `18380:1984` / `18380:2165` | | 25 % / 23 % |
| W11 Review & cost (modal) | `18391:3369` | | 20 % |
| W12 Result — SEND_DISABLED / Evidence | `18391:3584` / `18391:3784` | | 28 % / 29 % |

Prototype links: M07 «التالي» → M08 · M08 «قالب جديد» → M09 · M08 «التالي» → M10 Approved · M09 «أرسل للاعتماد» → M10 Pending ·
M10 Pending «حدّث الحالة» → Approved · M10 Rejected «عدّل القالب» → M09 · M10 Approved «التالي» → M11 ·
M11 «أرسل إلى…» → M12 SEND_DISABLED · M11 «رجوع» → M10 Approved.

## 3. Built by hand (and why)

- **Layout containers and text** on every screen (Body, Steps, Column (720), Two-pane, card frames). The brief allows these;
  they carry no colour of their own except bound tokens and Nucleus radius/spacing variables.
- **Step labels** under Progress Indicator - Bar (four text nodes); the kit bar has one label only. RTL fill is the
  consumer «Progress (RTL)» wrapper.
- **Chat bubbles** (M06, M08, M09, M13a): cloned from the consumer Taseer / Chat frames (Foodie chat pattern),
  not a component → GAP C2.
- **Bottom sheet** (M05a, M11): cloned from the consumer handoff-sheet frames (scrim + Sheet + Line rows) → GAP C4.
- **Status card** (M10) and **request card** (M13a): frame + Nucleus radius `corner-radius/lg` + tokens → GAP C5.
- **Badge + List row wrapper** (M07 no-channel row, M08 templates, M12 recipients, M01b): List - Has Padding has no
  badge slot → GAP C6.
- **Map slot** (M07/W07): placeholder frame for the existing `MapboxMap.tsx` (not redesigned).
- **Farq wordmark**: SVG from `src/ui/Logo.tsx`, fills bound to `b2b/primary` / `b2b/sage` (web shell, W01).
- **Line rows in M03** (supplier status list + counters): consumer Order-detail frames; nearest kit candidate: Shoppay Tables.

## 4. GAPS — owner decision needed (STOP 1)

### Components (nothing was drawn as a new component)
| # | Need | Used now | Nearest kit candidate |
|---|---|---|---|
| C1 | BOQ upload / drop zone (NewRequest) | Radio list + «اختر ملف الكراسة» button only | none found in Nucleus; Shoppay Field-verification `14659:18568` is closest visually |
| C2 | Chat bubble (sent / received) | consumer frames | Foodie Chat pattern `13650:6387` (frames, not a component) |
| C3 | Stat tile (counters in tracking / targeting) | text rows | Nucleus Dashboard «Stats & Charts» Column `3049:4432` |
| C4 | Bottom sheet / modal | consumer handoff-sheet frames | Shoppay Bottom Sheets set `fdb16886…` (not imported yet) |
| C5 | Status card | frame + tokens | Shoppay Confirmation `14675:11360` |
| C6 | List row with a status badge | wrapper [Badge + List row] | List - Has Padding Action=Label (text only) |
| C7 | Data table (web RFQ list) | Dashboard table pattern (frames) | Shoppay Tables set `1554a596…` |

### Data (API / service — not patched; for the owner)
| # | Need in the brief | What exists |
|---|---|---|
| D1 | VAT, credits, «يُخصم N من رصيدك (المتبقي M)», «الرصيد لا يكفي» | only `GET /api/construction/whatsapp/pricing` → `price_sar`; M11 says «غير متوفر» |
| D2 | Per-recipient وصل / قُرئ / ردّ / عولج for a campaign | `POST /send-farq` returns `sent[]` / `failed[]` only (provider acceptance) |
| D3 | Send with any approved template | `sendCampaign` always uses `farq_outreach_ar` |
| D4 | Filters «ردّ سابقاً», «آخر رد قبل N يوم», Haraj channel, wholesale evidence | not in `TargetRow`; M07 shows only category, city, WhatsApp, e-mail, AI fit |
| D5 | Supplier invitation / quote screens | client functions exist (`getPublicSupplierInvite`, `submitPublicSupplierQuote`), no page in this repo |
| D6 | «خدمة الاستهداف غير متصلة» vs missing `TARGETING_PASSWORD` | the client cannot tell them apart today |
| D7 | Reconcile an unknown send («تحقق») | no status endpoint for a sent message |

### Visual risks found while building
- `b2b/sage` `#93A89F` as text on canvas ≈ 2.4 : 1 (fails WCAG AA). Secondary text on the screens uses Nucleus
  `semantic/fg/muted` (`#4c6052`) instead; sage kept for dividers, disabled and the wordmark.
- Badge text on its tinted background: success `#22a55b`/`#e8faf0` ≈ 2.9 : 1, warning `#ff652f` on yellow-10 ≈ 2.8 : 1, danger `#c94f66` on red-10 ≈ 4.0 : 1 —
  below AA for 12–14 px text. Needs an owner call (darker status text in B2B mode, or accept for badges).
- Landing CTA radius is 14; Nucleus buttons are pill (`corner-radius/full`). Kept the kit pill.

## 5. Not designed yet
Delivery and send steps of the new-request wizard (steps 3–4), the inbox thread list, a standalone templates page
with status filters (M08 covers the list inside the journey), web versions of M05 success and M13a/b, loading
skeletons per screen (Text Field / Button Skeleton states exist and are used on Login only).

## 6. Update — rebuild on the specified kit components (2026-10-14, evening)

Owner feedback: the first pass did not use the components the brief named. Changes since:

**New page «✦ Farq B2B: Components» `18390:2`** (owner approved RTL copies of LTR Foodie/Shoppay parts, 2026-10-14):
- `Farq B2B / Row (from Foodie Views / Tables)` — set `18390:54`, key `016e01b32ffe6d5ea38b5798d3cb8f64a00e27f4`.
  Variants `Type=Entity` (Nucleus initial Avatar + Title + Caption + Value), `Type=Total` (Title + Value),
  `Type=Entity Badge` (Value replaced by an exposed Badge - Status). Text properties `Title#18390:5`,
  `Caption#18390:7`, `Value#18390:6`. Same metrics as Foodie (375 wide, padding 24, gap 12, min height 64), RTL,
  Huwiya + `Farq/*` text styles, colours bound to «Farq B2B — Brand».
- Why copies: Foodie/Shoppay components are LTR and Figma blocks re-ordering inside an instance (verified:
  «Cannot move node … inside of an instance»). Detaching inside screens is forbidden, so the RTL copy lives on this
  page only, as the consumer side did with «Farq / Food (from Foodie)».

**Screens changed**
| Screen | Change | Kit ratio now |
|---|---|---|
| M04 Comparison `18371:23206` | offers = `Farq / Comparison Card` State=Partial (`18299:59`): «الأرخص المكتمل», «عرض ناقص», Difference indicator `+175 ر.س (7.5%)` | 21 % |
| M03 Tracking `18371:23094` | supplier rows = Row Entity Badge ×3, counters = Row Total ×3 | 36 % (was 13 %) |
| M06 Inbox `18377:1131` | seller header = Row Entity | 35 % (was 27 %) |
| M07 Segment `18374:366` | «بلا قناة مؤكدة» row = Row Entity Badge (wrapper removed) | 47 % |
| M12 Results `18376:845` / `18376:933` | recipients = Row Entity Badge | 43 % / 43 % |
| M01b Review lines `18378:1253` | lines needing a decision = Row Entity Badge (avatar hidden) | 43 % |
| M11 Review & cost `18375:23935`, M05a Award confirm `18377:1020` | sheet = Shoppay `Views / Bottom Sheets` Mode=Light (key `fdb16886…`), surface bound to `b2b/surface` | 24 % / 16 % |
| W05a `18391:2459`, W11 `18391:3369` | web modal = Nucleus Dashboard «Modal» overlay + Dialog (`4621:2195`), mirrored RTL | 17 % / 20 % |
| W03, W04, W06, W01b, W07, W12 ×2 | regenerated from the updated mobile screens (ids in §2) | 19–30 % |
| all frames | «بيانات تجريبية» tag moved off the top bar; active tab label/icon bound to `b2b/primary` (was lime) | — |

**GAPS after this pass**
- C2 chat bubble — still frames (the Foodie Chat pattern itself has no bubble component).
- C4 sheet — resolved (Shoppay Bottom Sheets on mobile, Nucleus Modal pattern on web).
- C6 list row with status badge — resolved (Row Entity Badge). M08 template rows keep Nucleus List + Badge wrapper
  because they also need a Radio; candidate: add `Type=Entity Radio` to the Row set (needs your OK).
- C7 data table — Shoppay `Views / Tables` key `1554a596…` is not published from the Shoppay file
  (`importComponentSetByKeyAsync` → not found); Foodie `Views / Tables` is used through the Row copy instead.
- New finding: Shoppay patterns run on Shoppay's own Buttons / Text Fields / Nav Bars (navy/coral, LTR, not covered by
  the Nucleus B2B mode). Nucleus primitives stay the base; Foodie/Shoppay are used for screen-specific parts.

## 7. Update — the targeting map (2026-10-14, night)

The first pass had only an empty «Map slot». The map is now designed as the core of the targeting step.

| Screen | Node | Content |
|---|---|---|
| M07 Segment (map) | `18396:2027` | full-bleed map of north Riyadh; floating Search Bar + Chips; pins by channel (Nucleus solid `marker-pin` `4013:1153`: WhatsApp `b2b/status/success`, e-mail `b2b/olive-gold`, no channel `b2b/sage`); selected pin `b2b/primary` 44 px + Nucleus `Pointer` (key `1a3e5354…`) with the supplier name; clusters = Avatars lg initial with the count; segment outline (dashed `b2b/primary`, fill `b2b/selected`); «حدد منطقة» Buttons - Small; zoom Buttons - Small icon-only; legend; Shoppay Bottom Sheet with results, «تحديد الكل المطابق», summary bar «اخترت N»; Tab Bars. Prototype flow now starts here. |
| M07b Draw area | `18396:24860` | drawing mode: user polygon with 7 vertices, «وضع الرسم: اضغط لتضيف نقطة», sheet «داخل المنطقة 23 · واتساب 17», «امسح», «اعتمد المنطقة» |
| W07 Segment (web) | `18391:3124` | list pane + 548×740 map pane with the same layers |

Base map: OpenStreetMap tiles (z13, north Riyadh: الياسمين، الربيع، الملقا، الغدير…), stitched and tinted to the B2B
greens, uploaded as images (`72dd0133…` mobile, `73645801…` web). **Design only** — the app keeps `MapboxMap.tsx`
(Mapbox shows its own attribution). The © OpenStreetMap line is the tiles' licence attribution, not a supplier data
source. Pin positions are illustrative (frames are tagged «بيانات تجريبية»).

Data the map design assumes and the API does not give yet (GAP D4): «آخر رد قبل N يوم», «ردّ سابقاً», Haraj channel,
area query (the service searches by city + text; a polygon filter would be new).
