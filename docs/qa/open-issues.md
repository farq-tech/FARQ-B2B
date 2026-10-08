# Open issues (logic rules to review — not changed by the UI work)

## 1. «أوفر مورد واحد» needs two complete offers
- Where: `src/lib/requestFile.ts` → `matrixTotals()` (copied from فرق بناء, ios-app@5147808).
- Rule: `lowest` is named only when **≥ 2** suppliers priced **every** line, on one tax basis and one currency.
  With exactly one complete offer, `lowest` is `null`, so the comparison has no «أوفر مورد واحد» figure.
- UI handling (M2): the summary shows «عرض كامل واحد — نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد (اسم المورد)»
  instead of a blank «—». The rule itself is unchanged.
- Question for review: should a single complete offer be shown as the single-supplier figure (labelled «الوحيد الكامل»)?

## 2. Copies taken from uncommitted فرق بناء source
- `src/api/constructionClient.ts` and `src/lib/requestFile.ts` — see `docs/qa/m2/source-diffs/`. Owner decision pending.
- Each file now starts with its source fingerprint (sha256 + git blob of the working-tree file, and the committed 5147808 blob).
- Rule until the decision: keep as copies; no new logic is built on the uncommitted parts
  (`quoteCoverage(summary, requestedLineCount?)`, `invitesForMessage`, inbox `request_number`).
  Screen 04 already calls the 2-argument `quoteCoverage` (header column, award dialog coverage) — that call stays, nothing new is added.

## 3. API fields the Figma screens need (not available — API not changed)

| Field (what it would carry) | Where it is used in Figma | Current state in the app |
|---|---|---|
| Evidence level per invited supplier: `STRONG` «سبق سعّر نفس البند» · `MEDIUM` «يبيع نفس الفئة» · `WEAK` «مطابقة تقديرية» | 03 supplier rows (under the name); 02 supplier picker before send | `EvidenceBadge` built, not rendered |
| Reply reason when a supplier replied without a price (e.g. «يسأل عن الكمية») | 03 supplier row status «رد · يسأل عن الكمية» | Only `opened_at` and `LINE_DECLINED` events exist → shown as «فتح الطلب · بانتظار السعر» |
| Decline reason breakdown (not stocked / quantity too large) | 03 stat «اعتذروا» basis «2 ما عندهم البند · 1 الكمية كبيرة» | Basis shows a generic sentence |
| Sidebar counters: open requests, unread inbox threads | Sidebar «طلبات التسعير 3», «صندوق الوارد 5» | No counters shown |
| Structured offer facts: delivery cost/included, warranty, delivery days | 03 Quote Card facts «توصيل مجاني · التوريد 3 أيام · ضمان سنة»; 04 note «التوصيل والضريبة في بطاقة كل عرض» | Lead time from `leadTimeLabel`; notes text shown as-is |
| Reading confidence per extracted line (High/Medium/Low) | 02 review table column «ثقة القراءة» and phone cards | Column not shown (parse-pdf/scan return no confidence) |
| Qualified-supplier count for the request | 03 stat «تم التواصل معهم» basis «موردين مؤهلين لبنود الطلب» | Basis uses the invited count |

## 4. Award dialog keyboard — FIXED (track D, Confirm Sheet)
- Was: the copied AwardDialog did not move focus into itself, had no Escape-to-close and no focus trap.
- Now: screen 04 opens `src/pages/award/AwardConfirmSheet.tsx` (Figma 49:2168 / M05 58:356) instead. On open focus moves to the
  sheet heading; Tab / Shift+Tab stay inside; Escape closes (not while saving); focus returns to the button that opened it.
  role=dialog, aria-modal, aria-labelledby/-describedby. Proven by Playwright: `docs/qa/screens-b/screens-b.spec.ts`
  («05 · ترسية opens the sheet…», «05 · phone…») and `tests/keyboard.spec.ts` («04 · enabled ترسية…», updated).
- API calls unchanged (same reads, guards, order and payloads as AwardDialog): `docs/qa/screens-b/award-calls.md`.

## 5. Landing page (track B) — content not available, shown as placeholders
- Trust strip (Figma 35:218 `{suppliers_count}` `{regions_count}` `{avg_first_reply}` `{quotes_count}`): shown as «[رقم يُحدَّد]». Needs real figures from the system at publish time.
- Pricing (37:203): `{trial_price}` `{business_price}` → «[سعر يُحدَّد]»; plan limits «حتى 3 طلبات» and «حتى 5 مستخدمين» → «[عدد يُحدَّد]» (not confirmed as product limits).
- FAQ (37:284): Figma has an answer only for «كم ياخذ وقت أول رد؟». The other five show «الإجابة قيد الإعداد» + WhatsApp link.
- Footer (37:327): `{CR_number}` `{VAT_number}` → «[يُحدَّد]». «من نحن · الخصوصية · الشروط» and «للموردين» have no pages yet — rendered as text, not links.
- Sign-up: no public subscriber sign-up endpoint. `farqSession.signUp` (POST /signup) is for invited colleagues of a فرق بناء account, so all start/sign-up CTAs open WhatsApp with «هلا، أبي أجرب فرق تسعير». Decide whether a public sign-up should exist.
- Enterprise plan «تواصل معنا» uses `mailto:info@farq.sa` (subject «فرق تسعير — خطة المؤسسات»).
- Illustrative figures (hero cards, split blocks, comparison table, inbox example) are Figma's example data and are labelled «توضيحية».
- Brand marks: WhatsApp / Haraj / Farq call-centre logos appear only inside the living background (handoff assets/channels, used by the Lead's component). Brand-usage terms for WhatsApp and Haraj need confirmation before launch.
- Deferred by decision: targeting tool (link only — no public URL given; the internal one in App.tsx was not exposed), dark mode, Ahmad's missing drawings.
- No `og:image` share image in Figma.

## 6. Figma Confirm Sheet copy not used (track D)
- Figma 05 says «برسل لكل مورد البنود اللي رسّت عليه، ونبلّغ الباقين بلطف إن العرض ما رسى. تقدر تلغي خلال 30 دقيقة».
  The award API does not notify the other suppliers and there is no undo window, so the sheet keeps AwardDialog's accurate text.
- Figma 05 awards the split basket («رسِّ على 3 موردين»). The API awards one supplier quote version per call; split awards are not built.

## 7. Inbox (screen 06) — API gaps and limits (track D)

| Needed by Figma 06 | State in the API / app |
|---|---|
| «عرض مستخرج»: lines, unit prices, total, delivery, tax, confidence («ثقة عالية»), source quote from the chat | Not in `GET /inbox/threads/:id`. Panel shows `reply_kind` + `reply_summary_ar` + `reply_contacts` only and says prices are not extracted. No «اعتمد في المقارنة» / «عدّل» buttons. |
| Channel of a thread row (واتساب / إيميل badge in the list) | Thread rows have no channel; shown per message (`channel`) in the conversation only. |
| Evidence badge in the conversation header («سبق سعّر نفس البند») | Not in the API (same as item 3). |
| Reply composer, quick replies («أبشر», «متى التوريد؟», «أرسل عرض رسمي») | Endpoints exist (claim owner, reply, broadcast) but «فرق تسعير» is read-only for supplier messaging; composer shown disabled with the reason. Needs an owner decision before any send path is wired. |
| Read / unread | `POST /inbox/threads/read-state` exists; not called (no writes from this screen). Unread counts are shown as the API reports them. |
| Sidebar counter «صندوق الوارد 5» | Same as item 3 (no counter endpoint used). |
| Live test «اختبار صندوق الوارد» to +966 51 019 7017 | Not run by track D: the real API needs a signed-in session. Needs the Lead/owner (steps in `docs/qa/screens-b/README.md`). |
