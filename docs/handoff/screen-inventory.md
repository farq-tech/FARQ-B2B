# Screen inventory — FARQ B2B post-login (Deliverable 1)

Branch `design/b2b-kit-restyle` (from `design/figma-sync` @ 99781cf), 2026-10-14. Read from the code
as it is; nothing has been changed yet. Brief: `docs/handoff/figma-kit-restyle-brief.md`.

Routing: `src/procurementContext.tsx` (view ⇄ URL), `src/App.tsx` (gates + shell).
Gates before any screen: (1) server site password (`server.py`), (2) Farq login (`farqSession`),
(3) `VITE_ALLOWED_EMAILS` allow-list → «هذه الصفحة خاصة» denied state, «جارٍ التحقق من الحساب…» pending state.

Primitives column = `src/ui/*` used directly by the screen file (Icon counted only where rendered).

## 1. Views

| view · URL | Files | Data (endpoints) | States in code | `src/ui` primitives |
|---|---|---|---|---|
| `login` · `/login` (and any URL while signed out) | `views/LoginV2.tsx` | `farqSession.signIn` → `POST /api/auth/login` | idle · submitting «جارٍ الدخول…» · error (FarqAuthError / «تعذر الوصول إلى الخادم») · disabled submit until both fields. After: allow-list pending / denied | **none** — hand-written inputs/button, `#fff` card, `--color-bg-cta` |
| Shell (all signed-in views except `create-upload`) | `App.tsx`, `ui/Sidebar.tsx` (NavItem), `ui/MobileNav.tsx` (MobileBottomNav, MobileAppBar), `ui/useIsMobile.ts`, `live-bg/` | `useFarqSession` (email for the account row) | desktop sidebar (3 items: الطلبات · الوارد · الاستهداف + «طلب جديد» + sign-out) · mobile bottom nav (4 tabs) · Suspense «جارٍ التحميل…» | Sidebar, NavItem, MobileBottomNav, Button |
| `rfq-list` · `/requests` | `views/RfqListV2.tsx` | `listBuyerRfqs` → `GET /api/construction/rfqs` | loading · error · empty «لا توجد طلبات بعد.» · list (status pill per row: SENT / PARTIALLY_SENT / DRAFT_NOT_SENT / CLOSED / AWARDED / CANCELLED) | **none** — hand-written rows and pills, `#fff` |
| `create-upload` · `/new` (full-page wizard, no shell) | `views/NewRequestV2.tsx`, `lib/parseBoq`, `lib/readBooklet`, `lib/autoPick`, `lib/rfqPackages`, `lib/sendGuards`, `lib/imageShrink` | `parseConstructionBoqPdf` (`POST …/boq/parse-pdf`), `scanPurchaseRequest` (`POST /api/construction/purchase-requests/scan`), `matchConstructionBoqCatalog` (`POST …/boq/match`), `fetchConstructionWhatsAppPricing` (`GET …/whatsapp/pricing`), `createConstructionRfq` (`POST …/rfqs`), `startConstructionDispatch` / `getConstructionDispatch`, `resolveRfqSupplierIds` | 4 steps (0 input method: كراسة / اكتب / صوّر → 1 line review with tabs → 2 delivery: city, required date, quote deadline → 3 send). Reading progress · read error · match error · per-line «عمل فقط» / «ما فيه مورد مختار» · paid-WhatsApp confirm (price from server) · blockers list · sending progress · summary «تم الإرسال لـ N من M · تعذّر K» · read-only build refusal (network choke point) | FlowHeader, OptionCard, Dropzone (via flow), Tabs, Chip, Input, Button, Badge, EvidenceBadge, Icon |
| `rfq-detail` · `/requests/:id` | `views/RequestTrackingV2.tsx`, `lib/requestFile` | `getConstructionRfq`, `getConstructionComparison`, `getConstructionSupplierOutcomes` | loading · error · supplier filter tabs (all / quoted / replied / waiting / declined) · empty filter · per-supplier badge (تمت الترسية · أرسل سعر · اعتذر · فتح الطلب · بانتظار الرد · تعذر الإرسال · بانتظار إرسال واتساب يدويًا · لم يُرسل) · 4-step timeline · new-quote Toast (once) | TopBar, Stat×4, Tabs, TimelineStep×4, QuoteCard, ChannelBadge, Badge, Button, Toast, Icon |
| `comparison` · `/requests/:id/compare` | `views/ComparisonV2.tsx`, `lib/requestFile`, `lib/awardFlow` | `getConstructionRfq`, `getConstructionComparison` | loading · error (suggests opening envelopes) · <2 complete offers «لا يوجد بعد» · per-cell PriceCell states (Best / Normal / Higher / Pending / Not comparable) · line filter chips · empty filter · opens AwardConfirmSheet in place · notice | TopBar, PriceCell, Chip, Badge, Button, Icon |
| `award` · `/requests/:id/award` (deep link) | `pages/award/index.tsx`, `pages/award/AwardConfirmSheet.tsx` | `getConstructionRfq`, `getConstructionComparison`, `getConstructionProjects`, `createConstructionProject`, `createConstructionAward`, `openConstructionRfqEnvelopes` | loading · error + retry · no offer ready · sheet: projects loading / error · 403 «تحتاج صلاحية مدير أو معتمد» · busy «جارٍ تسجيل الترسية…» | Button, Chip, Input, Icon |
| `inbox` · `/inbox` (**read-only**) | `pages/inbox/index.tsx` | `getConstructionInboxStatus`, `listConstructionInboxThreads` (filter all / needs_reply), `getConstructionInboxThread`; polls every 15 s | list loading / error + retry · detail loading / error · filters (الكل / يحتاج رد / أرسل سعر) · sent-snapshot toggle · «قراءة آخر رد» panel (server reply_kind only) · composer **disabled** «الرد من هنا غير مفعّل» | MobileAppBar, Chip, Badge, ChannelBadge, Button, Icon |
| `targeting` · `/targeting` | `pages/targeting/index.tsx`, `TargetMap.tsx` (drawn map), `MapboxMap.tsx` (when `VITE_MAPBOX_TOKEN`), `CampaignConfirmSheet.tsx`, `lib/readBooklet` | `listCities` (`GET /_targeting/cities`), `searchTargets` (`POST /_targeting/search`), `templateStatus` (`GET /_targeting/template-status`), `scanPurchaseRequest` (booklet → lines), `sendCampaign` (`POST /_targeting/send-farq` ×2 per 200) | no search yet · city required · searching · search error · no results · results (counters وُجد / واتساب / إيميل / لا يمكن; AI fit badge مناسب / محتمل / غير مناسب) · «حدد المناسبين» · paging 150 · truncated note · booklet reading / error / line chips · compose: template badge (معتمد / status / unknown) · send blocked with reason (no search / none chosen / no text / template unknown / not APPROVED / no holder RFQ) · confirm sheet: busy · error · **SEND_DISABLED** «الإرسال مقفل في هذه البيئة» · unknown outcome «ما تأكدنا إن شي طلع — راجع صندوق الوارد قبل ما تعيد» · done notice «أُرسلت N · ما وصلت K» | Badge, Button, ChannelBadge, Stat×4, Icon |
| `templates` · `/targeting/templates` | `pages/targeting/Templates.tsx`, `drafts.ts` | `listTemplates` (`GET /_targeting/templates`), fallback `templateStatus`; drafts from `localStorage` | loading · failed (alert) · fallback (campaign template only) · filter chips (الكل / معتمد / قيد المراجعة / مرفوض / مسودة) with counts · empty filter · per-row Badge (APPROVED / PENDING+IN_APPEAL / REJECTED / DRAFT / other) · Meta rejection reason verbatim · «آخر استخدام» / «نسبة الرد» shown as «—» | TopBar, Chip, Badge, Button, Icon |
| `template-new` · `/targeting/templates/new` | `pages/targeting/TemplateEditor.tsx`, `drafts.ts` | `submitTemplate` (`POST /_targeting/templates`) | edit / preview tabs (mobile) · live phone preview with filled examples · pre-submit checks (opt-out, examples, sequential vars, category, risky words) · submit blocked (`submitBlock`) · yes/no sheet · submitting · result ok («وصل القالب لـMeta — الحالة: …») / error · draft saved / not saved | TopBar, Badge, Button, Icon (+ local Segmented, Label) |

Dev-only (never built): `/ui` gallery (`src/dev/uiGallery.tsx`), `?harness=` fixtures (`src/dev/harness.tsx`,
`src/dev/fixtures.ts`), `/live-bg`. The brief's `src/pages/shared/devHarness.tsx` also exists.

## 2. `src/ui/*` primitives → which screens use them

| Primitive | Used by |
|---|---|
| Button / IconButton / Spinner | every screen except LoginV2, RfqListV2 |
| Badge, EvidenceBadge, ChannelBadge | Comparison, NewRequest, RequestTracking, Inbox, Targeting, Templates, TemplateEditor |
| Chip | Comparison, NewRequest, Award sheet, Inbox, Templates |
| Input | NewRequest, Award sheet |
| Tabs / Tab | NewRequest, RequestTracking |
| TopBar / SearchField | Comparison, RequestTracking, Templates, TemplateEditor |
| Sidebar / NavItem | App shell |
| MobileAppBar / MobileBottomNav | App shell, Inbox |
| FlowHeader / FlowFooter | NewRequest |
| OptionCard | NewRequest |
| Dropzone | NewRequest |
| QuoteCard | RequestTracking |
| PriceCell | Comparison |
| TimelineStep | RequestTracking |
| Stat | RequestTracking, Targeting |
| Toast | RequestTracking |
| Confidence | not imported by any screen (gallery only) |
| Logo | not imported by any screen (LoginV2 uses `assets/pricing-v2/mark.svg`) |
| Icon | everywhere |

Hand-written UI with no primitive (restyle targets that also need kit instances): LoginV2 (whole form),
RfqListV2 (rows, pills), Targeting results rows / city `<select>` / search form / compose card,
TemplateEditor Segmented + fields, CampaignConfirmSheet and AwardConfirmSheet shells, Inbox chat bubbles.

## 3. Facts that change the brief (to confirm with the owner)

1. **`src/api/targetingClient.ts` is not a copied file** (no «Copied from فرق بناء» header, unlike the
   other seven files in `src/api/`). It belongs to this repo and can be edited; the targeting service
   behind it cannot.
2. **Cost.** Targeting uses a client constant `COST_PER_MESSAGE = 0.17` (`targeting/index.tsx:38`)
   shown as «التكلفة التقديرية ≈». The Farq Express API already exposes a server price,
   `GET /api/construction/whatsapp/pricing` → `{ enabled, category, price_sar, currency }`, which
   NewRequest uses. No endpoint returns VAT, credits or balance. → STOP 2.
3. **Template choice.** `sendCampaign` always sends `farq_outreach_ar` (`OUTREACH_TEMPLATE`) with
   `{{1}}` = place name, `{{2}}` = campaign text, and the send gate checks only that template's status.
   Sending with any other approved template is not supported by the client or (as far as the client
   shows) the service. GAP for «choose an approved template».
4. **Delivery evidence.** `POST /send-farq` returns only `sent[]` / `failed[]` (provider acceptance).
   No endpoint returns delivered / read / replied / handled per recipient for a campaign. GAP.
5. **Segment filters.** `TargetRow` has: name, category, city/district/region, phone + `has_whatsapp`,
   email, sources, match kind, AI fit. It has **no** Haraj channel, **no** «replied before»,
   **no** last-reply age, **no** wholesale evidence. The brief's «آخر رد قبل N يوم» and those chips
   have no data. GAP.
6. **Email.** Email-only places are visible but not selectable: the campaign is WhatsApp-only.
7. **Supplier side.** No supplier screen exists in this repo. `constructionClient.ts` has
   `getPublicSupplierInvite` / `submitPublicSupplierQuote` (public portal by token), but no page uses them.
   The supplier join / received-campaign / quote form would be new screens (Figma first, as the brief says).
8. **Approval polling.** After «أرسل للاعتماد» the editor shows the status returned once; there is no
   status screen that re-checks Meta. The «موافقة ميتا» step would read `GET /templates` again.
9. **«خدمة الاستهداف غير متصلة».** Today the client maps any non-OK reply to «خدمة الاستهداف ما ردّت»
   and 401 to «انتهت جلسة الصفحة»; a missing `TARGETING_PASSWORD` is indistinguishable from an outage.
