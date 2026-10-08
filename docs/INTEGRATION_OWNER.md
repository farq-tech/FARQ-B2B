# integration/today — owner

الدمج في integration/today لجلسة واحدة فقط: جلسة Claude Code «farqconstraction-7e» (الـLead، فرق تسعير — Figma sync)، بتكليف من المالك 2026-10-08.

- تصحيح: commit 7d8b42a نسب الدمج لجلسة «farqconstraction-60» بالغلط (وصلتها رسالة الـLead بالخطأ). هذه الجلسة ما تدمج هنا.
- الجلسات الأخرى ووكلاؤها: يشتغلون على فروعهم (design/*) فقط، ولا يكتبون في هذا الفرع ولا في مجلده (~/farq-pricing-wt/integration). أي تعديل يحتاجونه هنا: طلب في docs/qa/requests.md.
- قبل كل دمج: `git log` للتحقق إن ما فيه commits من غير الـLead.
- لا push. الـpush والـPR بقرار المالك.

## من كتب وش في هذا الفرع (`git log --format='%h %an %ad %s'`)
المؤلف في git واحد لكل الجلسات (farq-tech)، فالنسبة هنا من سجل الجلسات:
- **الـLead (farqconstraction-7e):** 17c8fbb، 1275001، cfc6e54، 8776e2c (دمج B)، a7007ae (دمج D)، 258e4e3، 0766cca، 738db24 (دمج live-bg 49c8300)، b6d6aba (الأغلفة الشفافة)، 90236a0 (server.py)، 966965e، 8fd2eba، a3b3cef (دمج live-bg 8706dcf)، 8a02f76، وكل ما بعدها.
- **وكيل الخلفية:** لا شيء مباشرة على هذا الفرع. شغله على design/live-bg (dbf1024 … 49c8300، 8706dcf) ودخل بالدمج.
- **وكيل B / وكيل D:** على design/landing وdesign/screens-b فقط، ودخل بالدمج.
- **وكيل ١ (farqconstraction-60):** 7d8b42a بالغلط، وصُحّح في 8a02f76.
