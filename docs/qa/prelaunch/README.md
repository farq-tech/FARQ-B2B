# إعادة تدقيق الإصدار

Baseline: `0fa3649`، فرع الإصلاح `qa/prelaunch-audit`. تاريخ: 2026-10-12، الرياض.

1. `npm ci --ignore-scripts`، ثم `npm run build` و`npm run typecheck` و`npm run lint`.
2. شغّل محليًا (لا تقرأ .env الإنتاج):
   `PORT=5198 PRICING_PASSWORD=qa-only-not-production FARQ_API_ORIGIN=http://127.0.0.1:1 TARGETING_ORIGIN=http://127.0.0.1:1 python3 server.py`
   لا تضبط TARGETING_SEND=1، ولا تضبط origins إلى خدمات حقيقية.
3. الأدوات الاختيارية: Playwright موجود في lock. axe وLighthouse استُخدما بأدوات npm مؤقتة غير محفوظة في package.json/lock؛ ثبتهما في بيئة تدقيق منفصلة أو `npm install --no-save --package-lock=false @axe-core/playwright lighthouse @types/geojson`. أعد `npm ci` بعدها قبل checks النهائية لكي لا تختبر اعتماديات مختلفة عن lock.
4. `node docs/qa/prelaunch/audit.mjs` (صور المقاسات التسعة، جرد، axe، تفاعلات). `AUDIT_OUT=docs/qa/prelaunch/after node docs/qa/prelaunch/audit.mjs` يحفظ بعد الإصلاح في مجلد مستقل.
5. `npx lighthouse http://127.0.0.1:5198/ --chrome-flags='--headless' --only-categories=performance,accessibility,seo,best-practices --output=json --output-path=docs/qa/prelaunch/lighthouse-mobile.json`؛ قياس متسلسل على جهاز هادئ. JSON محفوظ كما خرج من الأداة؛ ليس INP ميدانيًا.
6. `node docs/qa/prelaunch/edge.mjs`، `node docs/qa/prelaunch/retest.mjs`، `python3 docs/qa/prelaunch/server-check.py`.
7. `npx playwright test -c docs/qa/prelaunch/playwright.config.ts`؛ Vite الاختبارات 5199، backend غير متاح عمدًا. يختبر fixtures فقط. تأكد أنه لا توجد عملية أخرى على المنفذ من مستودع مختلف؛ config حاليًا يستخدم reuseExistingServer ولا يحمي من خادم خاطئ.
8. `node docs/qa/prelaunch/published.mjs` قراءة GET للموقع المنشور فقط؛ لا POST ولا إرسال واتساب. `stability.mjs` ست إعادة تحميل وتبويبان؛ لا إثبات لغياب التسريب طويلًا.

أخطاء السكربتات الأولية وسجلات المحاولات بقيت للأمانة. النتائج النهائية: `existing-tests-final.txt` (23 PASS)، `after/results.json` (axe صفر في 9 مقاسات)، `retest.json`، `server-check.txt`، `typecheck-final.txt`، `build-final.txt`، `lint-final.txt`.

لا تشغيل رسوم أو إرسال حقيقي أو دخول بحساب عميل. الموافقة على النشر في التقرير الرئيسي `LANDING-PRELAUNCH-AUDIT.md`.
