# المسار D (design/screens-b) — 05 تأكيد الترسية و06 صندوق الوارد

النطاق بعد تحديث الـLead: 05 و06 فقط. جوال 03/04 خلص على design/figma-sync (955a96d)، وما في هذا الفرع أي تعديل على 03،
وتعديل 04 محصور في: استبدال AwardDialog بالـConfirm Sheet + نص سبب تعطيل «ترسية» لما يكون فيه عرض كامل واحد.

## 05 · Confirm Sheet — `src/pages/award/AwardConfirmSheet.tsx` (+ صفحة `src/pages/award/index.tsx`)
- Figma 49:2168 (ديسكتوب: نافذة في الوسط) وM05 58:356 (جوال: ورقة من تحت). مقارنة: `compare/05-1440.png`، `compare/05-390.png`.
- المنطق والاستدعاءات منسوخة سطرًا بسطر من AwardDialog. الإثبات: `award-calls.md` — سيناريوهين (مشروع موجود، مشروع جديد + «أخرى»)،
  الطلبات معترضة بـpage.route، النتيجة متطابقة (5 و6 طلبات، نفس الطرق والمسارات والأجسام).
- الوصولية: role=dialog وaria-modal وaria-labelledby/-describedby؛ التركيز ينتقل للعنوان عند الفتح؛ Tab محصور؛ Escape يقفل
  (إلا أثناء الحفظ)؛ التركيز يرجع للزر اللي فتحها. مثبت في Playwright.
- ما أخذنا نص Figma «نبلّغ الباقين… تقدر تلغي خلال 30 دقيقة» لأنه غير صحيح على الـAPI (open-issues §5).
- «وصل عرض واحد»: زر «ترسية» يبقى معطّل (القاعدة كما هي) وسببه صار «نحتاج عرضين كاملين على الأقل للمقارنة — وصل عرض واحد»
  بدل «لا يوجد مورد سعّر كل البنود بعد» (كانت غير صحيحة لما فيه عرض كامل). لقطات: `after/04-one-complete-offer-*.png`.

## 06 · صندوق الوارد — `src/pages/inbox/index.tsx`
- Figma 50:988 وM06 58:431. مقارنة: `compare/06-1440.png`، `compare/06-390.png`.
- على الـendpoints الموجودة فقط: `GET inbox/status`، `GET inbox/threads?filter=all|needs_reply`، `GET inbox/threads/:inviteId`.
- قراءة فقط: ما فيه رد ولا broadcast ولا تعليم مقروء (كلها POST). خانة الرد معطّلة وسببها مكتوب.
- القائمة تتحدث كل 15 ثانية ويظهر «آخر تحديث»؛ المحادثة المفتوحة تنعاد قراءتها لما يتغير `last_received_at`.
- الدعوات المرسلة بدون رد (kind_hint=DISPATCH) مخفية افتراضيًا مع زر «إظهار N دعوة مرسلة بدون رد» (نفس سلوك فرق بناء).
- لوحة «عرض مستخرج» في Figma: الـAPI ما يرجّع أسعار مستخرجة → نعرض تصنيف الخادم لآخر رد فقط ونقول إن الأرقام غير متاحة (open-issues §6).
- الحالات: تحميل، خطأ مع «أعد المحاولة»، فاضي، بحث بدون نتائج، تصنيف فاضي، محادثة بدون رسائل.

### اختبار «اختبار صندوق الوارد» الحقيقي — ما انعمل
يحتاج جلسة دخول على الـAPI الحقيقي، وما عندي (ما فيه token في الـworktree، والدخول بحساب المالك). يحتاج الـLead/المالك:
افتح `/inbox` وأنت مسجّل، أرسل من جوالك «اختبار صندوق الوارد» إلى ‎+966 51 019 7017، وسجّل: هل ظهرت، بعد كم ثانية
(الشاشة تتحدث كل 15 ثانية)، وكيف انعرضت في القائمة والمحادثة. لا ترد.

## التشغيل والاختبار
- harness (dev فقط، ما يدخل الـbuild): `http://localhost:5193/docs/qa/screens-b/harness.html?screen=award-sheet|award-legacy|comparison-award|inbox[&state=empty|error|loading]`.
  أي طلب غير GET مرفوض داخل الصفحة إلا تحت Playwright.
- اختبارات المسار: `npx playwright test -c docs/qa/screens-b/playwright.config.ts` (سيرفر dev على 5193 شغال).
- اختبارات الريبو على نفس السيرفر: `npx playwright test -c docs/qa/screens-b/playwright.repo.config.ts`
  (تكتب لقطات في docs/qa/m2 وm4 — رجّعها بـ`git checkout -- docs/qa/m2 docs/qa/m4`).
- لقطات: `shoot.mjs`. صور Figma: `figma/`.
