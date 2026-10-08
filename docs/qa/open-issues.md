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

## 4. Award dialog keyboard (copied legacy, rebuilt in M6 as Confirm Sheet)
- Found by the Playwright test: the dialog does not move focus into itself, has no Escape-to-close and no focus trap.
  It is usable by keyboard (Tab reaches «رجوع للمقارنة», Enter closes) but focus starts behind it. Fix in M6 (Confirm Sheet 25:210).
