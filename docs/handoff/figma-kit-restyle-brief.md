# Brief — FARQ B2B (pricing.farq.sa): post-login screens on the purchased Figma kits

Audience: the agent (Claude Code / Codex / Cursor) that will redesign and then implement the
post-login screens of FARQ B2B. Written 2026-10-14 by the owner's design session. Read it fully
before touching Figma or code. Stop and ask the owner wherever this brief says STOP.

---

## 0. Goal in one paragraph

FARQ B2B lives in this repository (`/Users/m4pro/farq-pricing`, branch `design/figma-sync`,
no GitHub remote; production = Railway project «farq-pricing» 0ac19065, service `farq-pricing`
5644efed, domain pricing.farq.sa, deployed with `railway up` from the local checkout). The landing
page stays as it is. **Every screen after sign-in — buyer and supplier — must be rebuilt from the
design system the owner bought** (Nucleus Pro, Foodie, Shoppay, in Figma file
`gxlY4uu8hzkUNrcN61uQZt` and its two sibling files) **in the B2B brand colours the landing actually renders** (section 2), and the supplier-campaign journey must read end to end: pick the
target segment with one hand → write the message → Farq submits the WhatsApp template to Meta for
approval → once approved, send with the cost shown before the tap and the delivery evidence after.
All of that already exists as logic (section 3); you restyle and complete it. **No new component
is created without the owner's written approval.**

## 1. Hard rules (non-negotiable)

1. **Components come only from the purchased kits.** Instances of the Nucleus Pro file
   `gxlY4uu8hzkUNrcN61uQZt` (already Farq-ified: Huwiya, RTL, olive tokens — you will add a B2B
   colour mode, not touch the consumer one). Variable collections in that file, by exact id: the
   consumer palette is **«Farq — Brand (owner palette)» `VariableCollectionId:18147:19617`** (the
   only consumer collection to alias from); the older «Farq — Proposed Brand» and «FARQ / Business —
   isolated» collections are legacy and must not be bound to; the Nucleus collection is
   `VariableCollectionId:1760:21728` (modes Light `1760:3`, Dark `1760:4`); your new collection
   is «Farq B2B — Brand» (create it, record its id in `docs/handoff/figma-map.md`), the Foodie file `J33vly135dSelpHci4CN2F` and the
   Shoppay file `1oiuThQRCRXePR0WDXL6Jo` (import by component key into the Pro file). Farq-made
   components that already exist may be reused (`Farq / Comparison Card` 18299:143, `Farq /
   Difference Indicator` 18299:2, the `Farq / Food (from Foodie) / …` set 18319:252…368, Saudi flag
   18291:201, 3D icons 18279:2 / 18279:19617, the icon sheets «Farq icon sheet 1–5» on the
   Components page). If a screen needs something none of these provide → **STOP**, list the gap
   with the nearest kit candidate, and wait for the owner. Never draw a component "for now".
2. **Colours come from the B2B landing** (section 2), bound as variables — never typed as hex in
   a screen. Radius/spacing from Nucleus `corner-radius/*` (sm 2307:24610, md 1844:21758, lg
   1846:22510, xl 2115:26031, full 2053:23781) and `spacing/space-*` (1 2270:20333, 2 2270:20332,
   3 2270:20331, 4 2270:19578, 6 2270:20330). Type: the Nucleus ramp (bound to `typography/
   font-family/primary` = ITF Huwiya Arabic) or the `Farq/*` styles. No Nucleus purple, no Foodie
   green, no Shoppay navy/coral, and **no consumer olive** on B2B screens.
3. **RTL first; numbers always LTR** (prices, phone numbers, counters, dates, template parameter
   indices): `<bdi dir="ltr">` in code, LTR text nodes in Figma. Steppers/sliders never mirror.
4. **Honesty states are product.** Provider acceptance ≠ delivered ≠ read ≠ replied ≠ handled.
   A template that is PENDING cannot be sent. An unknown send outcome shows «غير مؤكد» and offers
   reconciliation, never a silent retry or a duplicate. Costs come from the real tariff/credits the
   server returns — the current «التكلفة التقديرية ≈» label is only acceptable while the server
   returns an estimate; if the server knows the exact cost, show it as exact. Sample data policy: in **Figma** you may use clearly marked sample content («بيانات تجريبية»
   in a visible tag on the frame) because campaign states have no production data yet; in the
   **app** no fixture rows reach any owner-visible preview or production (the dev harness
   `src/pages/shared/devHarness.tsx` stays dev-only and never deploys).
5. **Sending stays closed by default.** `TARGETING_SEND` is unset in production and the server
   answers `SEND_DISABLED` (`server.py`); you never set it. A live canary (one supplier, one
   channel, one message, exact text) needs the owner's explicit approval for that ONE send, and that
   approval is never reused for a bulk send. No billing, OAuth, password or messaging-flag changes
   as incidental testing. Never log or print `PRICING_PASSWORD`, `TARGETING_PASSWORD`, Meta or
   Mapbox tokens.
6. **No data-source names in the UI** (the supplier directory's provenance, snapshot names,
   provider adapters). Supplier business names are fine.
7. **Never deploy production without the owner's explicit «ادمج» / «انشر».** Work on a branch
   from `design/figma-sync`; preview on the Railway service `farq-pricing-preview` (81c29ac0) or a
   local `vite preview`; production is the `farq-pricing` service.
8. **Allowed repository: `/Users/m4pro/farq-pricing` only.** You never open, read or edit
   `farqconstraction`, `farq-construction-*` or any other repository (they belong to the payment
   company). Inside `farq-pricing`, the files under `src/api/` are read-only copies (their headers
   say so) — call them, do not change them. The Farq Express API (`FARQ_API_ORIGIN`, api.farq.sa)
   and the targeting service are HTTP dependencies, not codebases in this task; if a screen needs a
   field or endpoint that does not exist, write it as a GAP for the owner instead of patching
   another repository.

## 2. The B2B palette — what the landing actually renders (owner-approved 2026-10-14)

Do NOT take the `--brand-*` black/green variables in `src/styles/tokens.css` at face value: the
landing overrides them with the `--farq-*` theme, and what renders (measured with Playwright and
confirmed by the owner's Color Thief extraction of pricing.farq.sa) is a **deep-green + mint +
lime** family, a corporate cousin of the consumer olive system:

| Role | Value (rendered) | Where it shows on the landing |
|---|---|---|
| `b2b/primary` — text, headlines, icons, nav, outlines | `#254834` (Color Thief `#275C3E`) | h1, body text, «دخول», pill borders |
| `b2b/canvas` | `#f4f8f2` (Color Thief `#F3FBF3`), gradient `#f4f8f2 → #e7f1e5` | page background |
| `b2b/surface` | `#ffffff` (nav `#ffffff` at 94 %) | cards, nav bar |
| `b2b/cta` — primary button fill | `#d8ee8c` (Color Thief `#DBEB8B`) with `#254834` text, radius 14 | «حدد هدفك وابدأ» |
| `b2b/border` | `#d7e3db` | pills, cards |
| `b2b/sage` — muted/secondary text, dividers, disabled | `#93A89F` | diagram lines, secondary labels |
| `b2b/olive-gold` — tertiary accent (charts, tags) | `#A59859` | illustration accents |
| `b2b/rose` — tertiary accent (only where a second series is needed) | `#947C7C` | illustration accents |
| `b2b/selected` | `#edf4dd` | selected option surface |
| status success / warning / danger | `#22a55b` / `#ff652f` / `#c94f66` (landing `--green-500` / `--orange-500` / `--pink-500`) | badges only |
| Difference bar / lime accent | shared with the consumer system (`color/gap/fill` 18274:30 = `#a3b80f`) | comparison rows |

**Relationship to the consumer olive system (owner decision pending — see STOP point 4):** the two
families share the kit, Huwiya, radii, spacing, status colours and the lime difference bar; B2B
differs only in `primary` (`#254834` instead of olive `#3e573b`), `canvas` (`#f4f8f2` instead of
`#f6f8f2`/white) and the **lime CTA fill with dark-green text** (the consumer CTA is olive with
white text). Keep that delta small on purpose so a user moving between the app and B2B feels one
brand.

Figma: in the Pro file create a **new variable collection «Farq B2B — Brand»** with the rows above
(names `b2b/primary`, `b2b/canvas`, `b2b/surface`, `b2b/cta`, `b2b/on-cta`, `b2b/border`,
`b2b/sage`, `b2b/olive-gold`, `b2b/rose`, `b2b/selected`, `b2b/status/*`) and aliases
`color/brand/primary → b2b/primary`, `color/text/base → b2b/primary`, `color/text/muted →
b2b/sage`, `color/bg/canvas → b2b/canvas`, `color/bg/surface → b2b/surface`, `color/border/subtle
→ b2b/border`, `color/action/fill → b2b/cta`, `color/action/text → b2b/primary`. Then add a
**second mode «B2B» on the Nucleus collection** that re-points `global/brand/10…100` to a ramp
built from `#254834` (90) through `#edf4dd` (10) so Nucleus instances recolour without detaching —
the consumer «Light» mode stays untouched. Verify by screenshot that Button - Full width on a B2B
frame renders `#d8ee8c` with `#254834` text and Badge - Status success renders `#22a55b`.

Code: `src/styles/tokens.css` already has the `--farq-*` theme values; add the missing roles
there (`--farq-cta`, `--farq-sage`, `--farq-selected` …), keep `scripts/lint-tokens.mjs` green,
and never type a hex in a component.

## 3. What exists today (restyle, do not rewrite)

`src/App.tsx` routes by `view`: `login` → `LoginV2`; `create-upload` → `NewRequestV2` (BOQ upload
+ line review); `rfq-list` → `RfqListV2`; `rfq-detail` → `RequestTrackingV2`; `comparison` →
`ComparisonV2`; `award` → `pages/award` (+ `AwardConfirmSheet`); `inbox` → `pages/inbox` (read
only); `targeting` → `pages/targeting/index.tsx` (map + segment + campaign) with `TargetMap`,
`MapboxMap`, `CampaignConfirmSheet` (shows `cost`); `templates` → `Templates.tsx` (every WhatsApp
template of the business account with its Meta status via `GET /templates`); `template-new` →
`TemplateEditor.tsx` (writes a Meta-shaped template: name, language, category, header, body with
`{{n}}` variables + examples, footer, buttons; «أرسل للاعتماد» → `submitTemplate` → `POST
/templates`; status PENDING / APPROVED / REJECTED(reason)). Clients: `src/api/targetingClient.ts`
(targeting service, `TARGETING_ORIGIN`, password-gated), `constructionClient.ts` /
`constructionSuppliers.ts` (Farq Express API for RFQs, quotes, suppliers), `farqSession.ts` /
`useFarqSession.ts` (session). UI primitives: `src/ui/*` (Button, Chip, Badge, Input, Tabs,
TopBar, Sidebar, MobileNav, FlowShell, OptionCard, QuoteCard, PriceCell, TimelineStep, Toast,
Dropzone, Stat, Confidence, Icon, Logo) — these are the hand-made components from the previous
Figma; they are what you replace with kit-based ones, keeping their props so screens keep working.
Drafts persist in the browser (`drafts.ts`). The campaign template in production is
`farq_outreach_ar` (approved). `docs/PRODUCTION.md` lists the current Figma→code map and what was
left out for lack of real data (never add those back with fake numbers).

Deliverable 1, before any Figma work: `docs/handoff/screen-inventory.md` — every `view`, its
component files, data hooks/endpoints, states (loading / empty / error / read-only / disabled
send), and which `src/ui/*` primitives it uses.

## 4. The journey to deliver (buyer) — screens and kit mapping

A sticky step indicator (Nucleus Progress Indicator - Bar 16854:33155 + four labels) on
targeting; every step is a mobile screen (390) and a two-pane web layout (1440; Nucleus Web
Ecommerce & Marketing Patterns page 3529:684 for the frame, Sidebar from the same page).

1. **الشريحة المستهدفة** — `pages/targeting/index.tsx` + `TargetMap`. Filters as Nucleus Chips -
   Filled (14446:7569 / active 14446:7571) in one sliding row (trade/category, city, channel
   availability WhatsApp / e-mail / Haraj — only what the record proves, replied-before,
   wholesale evidence); Search Bar 961:20425 for name; the map stays (Mapbox) but its cards are
   Nucleus List - Has Padding rows (1834:21010 / 1834:21013) with Checkbox (page 14500:14721) at
   the inline end, Avatars (16656:38563 image / 16656:38591 initial) at the inline start, name ·
   «{city} · {channel icons}» · «آخر رد قبل N يوم» (an age, never a date); «تحديد الكل المطابق»
   (Buttons - Small 2195:25958); sticky summary bar (same construction as the consumer «Basket
   bar» 18308:485): «اخترت N مورداً · واتساب N · بريد N» + «التالي». A supplier without a verified
   channel wears Badge - Status warning (16667:32525) «بلا قناة مؤكدة» and cannot be selected.
2. **الرسالة** — `Templates.tsx` + `TemplateEditor.tsx`. Approved templates first (List rows with
   Badge - Status: success «معتمد», warning «قيد المراجعة», danger «مرفوض»); «قالب جديد» opens
   the editor: Text Field - Standard (16835:33262) name, Dropdown - Standard (16842:33325)
   language/category, Text Area (page 14507:10721) body with `{{n}}` chips, example fields per
   variable, footer, buttons; the live preview is the Foodie chat bubble as in Taseer/Chat
   18320:763 (received bubble, right). The approved body is never editable — parameters only.
3. **موافقة ميتا** — the existing submit → status screen: status card with Badge - Status,
   Meta's rejection reason verbatim, «عادةً خلال دقائق وقد تصل إلى 24 ساعة» (Meta's guidance,
   not a promise), Buttons - Full width (1:7) «عدّل القالب» on rejection; «إرسال» stays
   State=Disabled until APPROVED. If the targeting service or `TARGETING_PASSWORD` is missing the
   screen says so («خدمة الاستهداف غير متصلة») — never pretends.
4. **المراجعة والتكلفة ثم الإرسال** — `CampaignConfirmSheet.tsx` restyled as a bottom sheet
   (Shoppay Bottom Sheets set key fdb16886… / the consumer handoff-sheet construction with a 50 %
   scrim): recipients per channel, approved template name, the cost block in `<bdi dir="ltr">`
   (unit cost × recipients per channel, VAT, «يُخصم N من رصيدك (المتبقي M)» when the server
   exposes credits; otherwise the exact server figure with its label), «الرصيد لا يكفي» blocks the
   send; ONE explicit confirmation «أرسل إلى N مورداً · التكلفة X ر.س». After sending (or, while
   `SEND_DISABLED`, the honest «الإرسال مقفل حتى يفعّله المالك» state): per-recipient rows with
   «قُبل من المزوّد → وصل → قُرئ → ردّ → عولج» (Badge - Status per row), «غير مؤكد — تحقق» for
   unknown outcomes, never a re-send. Replies land in `pages/inbox` (Foodie chat pattern, Review
   row 7896cfc7… where a supplier rating exists).

Also restyle, same discipline: Login (`LoginV2` — the consumer Auth / Sign in pattern 18340:1766
recoloured), NewRequest (Shoppay Checkout & Order Review pattern 14675:11154 for the BOQ line
review; Nucleus Dropzone-equivalent = the kit's upload tile if one exists, else STOP), RfqList and
RequestTracking (Foodie Order Card 3b0c9b62… / Order detail pattern 13650:6347), Comparison
(`Farq / Comparison Card` 18299:143 with quote rows; «عرض ناقص» = Badge - Status warning, never
«الأرخص المكتمل»), Award (Shoppay Confirmation 14675:11360 / Acknowledgement & Success 14675:11624
with the 3D check 18279:2), Inbox (Foodie chat), Sidebar/MobileNav/TopBar (Nucleus Top Bar - Center
6:51, Tab Bars 37:271, the web sidebar from page 3529:684).

Supplier side: the join/invitation and the supplier's view of a received campaign (message as a
chat bubble, «قدّم عرضك» CTA, quote form with Text Fields / Steppers 17106:30088 / Dropdowns, the
«عرض ناقص» rule).

## 5. Figma plan (first; approval; then code)

1. Pro file: pages **«✦ Farq B2B: Screens»** (390 and 1440 frames) and **«✦ Farq B2B: Components»**
   only if the owner approves a new component. Variable collection + Nucleus «B2B» mode (section 2).
2. Build, in order: Login, Workspace shell (sidebar/top bar/mobile nav), RFQ list, New request,
   Request tracking, Comparison, Award, Inbox, Targeting (segment), Templates list, Template
   editor, Approval state, Campaign review & cost, Send results, Supplier quote form.
3. Prototype «Farq B2B — حملة موردين».
4. `docs/handoff/figma-map.md`: screen → node id → every instance id → data source, plus a
   **GAPS** section (anything you could not build from the kits, with the nearest kit candidate).
   **STOP and send the owner the links. Code starts only on «ابدأ».**

Figma MCP notes: load `skill://figma/figma-use/SKILL.md` + `figma-generate-design` before every
`use_figma`; one page switch per call; return node ids; `figma.importComponentByKeyAsync(key)` for
Foodie/Shoppay — known keys: Foodie Store row Basic 73c639ee…, Food row Default 5bc20b3a…, Order
Card set 3b0c9b62…, Review row 7896cfc7…, FAB set 1777d1ae…, Radio Field 03974d9d…, Bottom Sheet
Light dfba5a30…, Action Sheet Light 7116c80e…; Shoppay Tables set 1554a596…, Payment Card
1ae33411…, Address row 50df18aa…, Order row a384c582…, Bottom Sheets set fdb16886…, Action Sheets
set b05b99df…, Auth buttons set da1343f7…. Gotchas: detached instances keep Montserrat text →
delete and recreate with Huwiya; nested «Views / Images: Ratio» fills are not overridable →
replace with a rectangle; WebP uploads render blank → PNG; `Social - Button/Apple` renders broken
→ use Buttons - Full width Secondary. Instance props: top bar `Title#17776:50`, search
`Value#608:12`, chips `Is Active`, full-width button `Text Label#2194:15` + `Hierarchy`, small
button `Text Label#2195:85`, Badge-Status `Status/Variant/Contrast`.

## 6. Code plan (after «ابدأ»)

- Branch from `design/figma-sync`; `npm ci`; `npm run typecheck`, `npm run lint`
  (tokens + oxlint), `npm run build`, `npm run test:keyboard` (Playwright) must stay green;
  `python3 services/targeting-trial/test_trial_search.py` untouched and green.
- Replace `src/ui/*` internals with kit-faithful markup/CSS (same exported props), then restyle
  views/pages file by file; keep every API call, session rule, draft persistence and read-only
  gate. New CSS = `var(--brand-*)`/`var(--color-*)` only; `lint-tokens` enforces it.
- Icons: export the needed Nucleus «Icons: Line» glyphs the same way the consumer app did
  (icon sheets → SVG → generated components); do not hand-draw.
- Preview on `farq-pricing-preview` (Railway) or `vite preview`; Playwright/webkit 390×844 and
  1440×900 screenshots of every screen beside the Figma renders.
- Report five stages separately with evidence: implemented · locally tested · deployed to
  preview · verified through the journey (segment → template → Meta status → review/cost →
  SEND_DISABLED state) · production (only after «انشر»). Include test counts verbatim, what is
  unverified, and the next approval needed.

## 7. Copy (Arabic, Saudi tone, short)

«حملة موردين» · «الشريحة المستهدفة» · «اخترت N مورداً» · «بلا قناة مؤكدة» · «الرسالة» · «قالب
معتمد» · «قيد المراجعة» · «مرفوض: {سبب ميتا}» · «أرسل للاعتماد» · «المراجعة والتكلفة» · «التكلفة
X ر.س» · «يُخصم N من رصيدك (المتبقي M)» · «أرسل إلى N مورداً» · «الإرسال مقفل حتى يفعّله المالك» ·
«قُبل من المزوّد» · «وصل» · «قُرئ» · «ردّ» · «غير مؤكد — تحقق» · «عرض ناقص» · «الأرخص المكتمل».
No «تم الإرسال بنجاح» unless the provider accepted every message; say what is true per row.

## 8. STOP points (ask the owner)

1. Any component gap (section 5 GAPS).
2. The exact cost model to display if the targeting service returns only an estimate.
3. Enabling `TARGETING_SEND`, any Meta/WhatsApp credential, or the one-send canary.
4. Whether B2B stays a sibling palette of the consumer olive (recommended: one kit, three tokens
   differ — primary, canvas, lime CTA) or is folded fully into the consumer palette; and whether a
   «Night» mode is wanted (the landing has night tokens).
