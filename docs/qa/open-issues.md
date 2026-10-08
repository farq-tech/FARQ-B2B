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
