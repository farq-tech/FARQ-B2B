# أساس الأهداف — المرحلة 0 فقط

أداة محلية معزولة، دون قاعدة أهداف إنتاج أو واجهات أو إرسال. لا توجد Supplier Matching أو Ontology جديدة: `construction-port.cjs` يستورد المحركات الموجودة من checkout فرق بناء صريح. العقود في `core.py` والبيانات في fixtures لاختبار الاتجاه وصلاحية الأدلة الوهمية فقط. `baseline.py` ليس NLU إنتاجيًا ولا يتعرف على المنتج؛ يقبل منتج fixture مُسمّى مسبقًا في benchmark فقط. استخراج span المنتج من هدف طبيعي وتنفيذ الخطة مؤجلان حتى اعتماد المرحلة 0.

من هذا worktree:

```sh
python3 -m unittest discover -s services/goal-foundation/tests -v
python3 services/goal-foundation/evaluate.py
FARQ_CONSTRUCTION_SOURCE=/Users/m4pro/farq-pricing-api-proof/api node --require ./services/goal-foundation/tests/offline-guard.cjs --test services/goal-foundation/tests/construction-reuse.test.cjs
FARQ_CONSTRUCTION_SOURCE=/Users/m4pro/farq-pricing-api-proof/api node --require ./services/goal-foundation/tests/offline-guard.cjs services/goal-foundation/inspect-construction.cjs
python3 services/goal-foundation/directory-audit.py /Users/m4pro/farq-targeting/data/targets.parquet
```

Python 3.9+، Node 24 كما اختُبر؛ تدقيق الدليل فقط يتطلب duckdb (المثبت محليًا 1.4.5). اختبارات الخادم الأصلية تتطلب node_modules الخاصة به، ومنها PGlite. الدليل يقرأ Parquet ويصدر إحصاءات دون أسماء أو معلومات اتصال.

من جذر backend المصدر:

```sh
node --require /Users/m4pro/farq-pricing-goals-phase0/services/goal-foundation/tests/offline-guard.cjs --test api/tests/construction-line-intent-authority.test.js api/tests/construction-procurement-ontology-vendored.test.js api/tests/construction-boq-catalog-matching.test.js api/tests/construction-supplier-quote-history.test.js api/tests/construction-supplier-price-memory.test.js api/tests/construction-evidence-grade-tenant-scope.test.js
```

الحاجز طبقة حماية للاختبارات المحددة، وليس sandbox عام لكل عملية فرعية أو UDP. لم تشغل هذه الاختبارات إرسالًا خارجيًا أو اتصالًا سحابيًا. لا تشغّل server/runtime إنتاجيًا أو migrations لأجل هذه المرحلة.

متابعة الأدلة العامة وتجربة توسيع بيانات CPO داخل resolver الأصلي، دون كتابة على مصدر فرق بناء:

```sh
FARQ_CONSTRUCTION_SOURCE=/Users/m4pro/farq-pricing-api-proof/api node --require ./services/goal-foundation/tests/offline-guard.cjs --test services/goal-foundation/tests/public-evidence.test.cjs
FARQ_CONSTRUCTION_SOURCE=/Users/m4pro/farq-pricing-api-proof/api node --require ./services/goal-foundation/tests/offline-guard.cjs services/goal-foundation/evaluate-public.cjs
FARQ_CONSTRUCTION_SOURCE=/Users/m4pro/farq-pricing-api-proof/api node --require ./services/goal-foundation/tests/offline-guard.cjs services/goal-foundation/cpo-extension-experiment.mjs
```

هذه التجربة تعدّل بيانات CPO في الذاكرة فقط، وتختبر بقاء نتائج المصطلحات القديمة. لا تنشئ مخزنًا بديلًا ولا تضيف supplier map أو صلاحيات أو إرسالًا؛ معرفاتها تجريبية غير معتمدة. نتائج الترشيح في العينة العامة أحكام موثقة من الباحث، وليست اكتشافًا إنتاجيًا أو تقييمًا مستقلًا.
