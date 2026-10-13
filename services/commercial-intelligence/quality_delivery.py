# coding: utf-8
"""Arabic final receipt from measured files, with scope and unknowns explicit."""
import argparse,json,sqlite3
from pathlib import Path

def deliver(root):
 root=Path(root);comparison=json.loads((root/'quality-comparison.json').read_text());audit=json.loads((root/'activity-quality.receipt.json').read_text());contact=json.loads((root/'audited-contact-presence.json').read_text());cases=json.loads((root/'after-results.json').read_text())['cases'];before=comparison['before'];after=comparison['after']
 db=sqlite3.connect(root/'activity-quality.db');db.execute('CREATE TABLE IF NOT EXISTS evaluated_relationships(id TEXT PRIMARY KEY,entity_id TEXT,subject TEXT,objective TEXT,role TEXT,commercial_function TEXT,evidence_state TEXT,source_ref TEXT,source_date TEXT,current_demand INTEGER)')
 for case in cases:
  for r in case['direct']+case['potential']:
   rel=r['commercial_relationship'];db.execute('INSERT OR REPLACE INTO evaluated_relationships VALUES(?,?,?,?,?,?,?,?,?,?)',(rel['id'],rel['entity_id'],rel['subject'],rel['objective'],rel['role'],r.get('commercial_function'),rel['evidence_state'],str(rel['source_ref']),rel['source_date'],rel['current_demand']))
 db.commit();relcounts=db.execute('SELECT role,evidence_state,count(*) FROM evaluated_relationships GROUP BY role,evidence_state').fetchall();relcount=db.execute('SELECT count(*) FROM evaluated_relationships').fetchone()[0];db.close()
 unique_error_sources=len({r['source_id'] for r in before['known_contradictions']});missing=contact['audited_identity_denominator']-contact['any_channel_presence_union'];plan=json.loads((root/'serper-unapproved-priority-plan.json').read_text());existing_first=sum(t.get('next_action')=='REVIEW_EXISTING_SOURCE_CONTACT_FIRST' for t in plan['targets'])
 text=f'''# جودة وتغطية استخبارات السوق — 13 أكتوبر 2026

نفذت التغيير داخل النواة الحالية على الفرع المعزول engineering/commercial-intelligence-recovery. جميع الجولات PRAGMATIC. لا مصدر أصلي أو إنتاج عُدّل، لا Serper أو خدمات مدفوعة أو رسائل، ولا دمج أو نشر.

## نطاق الفحص
جرى فحص {audit['audited_named_candidate_identities']:,} هوية مرشحة تجاريًا مرتبطة بـ{audit['source_members']:,} سجل مصدر. المقام يشمل هويات مصدرية مؤقتة ونطاقات مواقع محفوظة، وليس عدد شركات قانونية موحدة مثبتة. الاسم لا يثبت نشاطًا وحده. تصنيفات Golden وRegistry الأصلية محفوظة بجانب النشاط المرجح والأنشطة الثانوية والتعارضات ودرجة ترجيح نسبية، وليس احتمالًا معايرًا.
حالات الطبقة: {dict(audit['states'])}. {audit['identities_with_source_conflicts']:,} هوية فيها تعارض اكتشفته القواعد؛ هذا حد أدنى معروف لا تقدير لكل أخطاء المصادر. {audit['identities_without_resolved_activity']:,} هوية بلا نشاط رئيسي مرجح، منها متعارضة؛ لا نخترع تصنيفًا لاستكمال العدد. لا تعديل للتصنيف الأصلي أو دمج قانوني تلقائي.

## ترجيح المصادر والعلاقة
إشارة الاسم وزنها النسبي 0.20، وتصنيف المصدر 0.55، والوصف المحفوظ الداعم 0.80 إن توفر. توافق الاسم مع التصنيف يرفع الترجيح، والتناقض القوي يخفض أهلية النشاط. اتفاق ملاحظات فئات مختلفة يضيف دعمًا محدودًا، دون اعتبار النسخ المكررة مصادر مستقلة أو إثباتًا قانونيًا. غالبية فحص الدليل هنا تصنيفات وأسماء، وليست أوصافًا مستقلة؛ درجات الوثوق heuristic ولم تُعاير بمراجعة بشرية.
الدور يتحدد لكل هدف: بائع أو مصنع أو موزع أو مقدم خدمة أو مستخدم محتمل أو شريك. الجهات التنظيمية والتعليمية والمعلوماتية والوسيط مفصولة؛ ذكر المنتج لا يكفي لإثبات البيع أو التصنيع. الجهة المتعددة الأنشطة تبقى إذا توفر نشاط مناسب غير متعارض؛ الوسم المتعارض لا يرفع ترتيبها. المصنع لا يُستنتج من متجر أقمشة، وبرمجة الهاتف لا تثبت تقديم أنظمة أعمال.

## قبل ← بعد على الطلبات نفسها
استخدمت أرشيف commit 4883c42 كنسخة قبل، وأعدت 42 حالة سابقة +22 حالة إضافية بنفس النص والمدينة والاتجاه والأصول، دون نموذج أو مزود خارجي. الجولتان النهائيتان تسلسليتان على Mac، دون تشغيل تدقيق المليون سجل أو اختبار حمل أثناء القياس. زمن الافتتاح يشمل تحميل CPO؛ القياس محلي ولا يثبت زمن إنتاج.

| القياس | قبل | بعد | المقام / التفسير |
|---|---:|---:|---|
| حالات بها نتائج | {before['nonempty_cases']} | {after['nonempty_cases']} | 64؛ لا يثبت جودة الترشيح |
| حالات فيها اتساق دليل آلي ضمن أفضل خمس | {before['cases_with_top5_evidence_consistency_proxy']} | {after['cases_with_top5_evidence_consistency_proxy']} | 64؛ مؤشر اتساق اسم/نشاط أو نص عرض، وليس Precision |
| الأخطاء المعروفة في نتائج الحالات | {before['known_contradiction_appearances']} | {after['known_contradiction_appearances']} | ظهور جهة في طلب، من {unique_error_sources} معرف مصدر مختلف قبل |
| الأخطاء المعروفة ضمن أفضل خمس | {before['top5_frozen_labels'].get('KNOWN_CONTRADICTION',0)} | {after['top5_frozen_labels'].get('KNOWN_CONTRADICTION',0)} | {before['top5_result_appearances']} ظهورًا قبل / {after['top5_result_appearances']} بعد |
| هويات مرشحة مختلفة في نتائج الحالات | {before['unique_provisional_entities']} | {after['unique_provisional_entities']} | هوية مؤقتة، لا تعداد السوق |
| هويات لديها حضور هاتف أو بريد في الحالات | {before['source_contact_presence_entities']} | {after['source_contact_presence_entities']} | حضور المصدر، لا تحقق حي |
| وسيط زمن البحث ms | {before['latency_cold_ms']['median']} | {after['latency_cold_ms']['median']} | 64 أول بحث لكل طلب، يشمل بيانات السياق |
| p95 زمن البحث ms | {before['latency_cold_ms']['p95']} | {after['latency_cold_ms']['p95']} | نفس المقام |
| max زمن البحث ms | {before['latency_cold_ms']['max']} | {after['latency_cold_ms']['max']} | يتضمن افتتاح CPO |

مستويات الدليل قبل: {before['evidence_levels']}؛ بعد: {after['evidence_levels']}. مستوى A صنف مباشر، B عائلة أو عرض محفوظ، C تخصص/استخدام محتمل، D احتمال أضعف أو تاريخي. لا تعني المستويات هوية قانونية أو مخزونًا أو طلبًا حاليًا مثبتًا. انخفاض بعض B/D مقصود بعد حذف المواضيع والخدمات غير المطابقة؛ لا نملأ الأماكن الشاغرة.
فحص الاتساق لأفضل خمس بعد: {after['top5_evidence_consistency_proxy']}. حالات NO_INDEPENDENT_QA_RULE وSOURCE_ONLY_OR_UNCONFIRMED_QA_FIT تبقى غير محسومة. الفحص الآلي ليس حكمًا بشريًا أو تأكيدًا للملاءمة الفعلية. ملف frozen-evaluation-labels يوضح أحكام الاتساق المحدودة؛ فقدان مرساة قديمة من نافذة الترتيب لا يعني خطأها، ولا نخفي عدد المراسي الموجودة: قبل {before['cases_with_frozen_compatible_anchor']} حالات وبعد {after['cases_with_frozen_compatible_anchor']}.
Precision وRecall وجودة الملاءمة الفعلية: PENDING_HUMAN_REVIEW. ملف blind-human-review.csv يخلط الصفوف ببذرة ثابتة ويحجب ترتيب النظام ودرجاته وقراراته؛ لا نتائج بشرية مختلقة.

## مقارنة الاتجاهات
'''
 for direction,label in [('purchase','شراء'),('marketing','بيع/تسويق'),('availability','استفسار'),('partnership','شراكة')]:
  b=before['by_direction'][direction];a=after['by_direction'][direction]
  text+=f"- {label}: {a['cases']} حالة؛ غير الفارغة {b['nonempty']} ← {a['nonempty']}؛ هويات النتائج {b['unique_provisional_entities']} ← {a['unique_provisional_entities']}؛ حضور تواصل {b['source_contact_presence_entities']} ← {a['source_contact_presence_entities']}؛ مستويات بعد {a['levels']}.\n"
 text+=f'''
المشترون أعلى الترتيب يتغيرون حسب الاستخدام: مدارس وجامعات للكمبيوتر، مقاهٍ ومطاعم للأكواب والقهوة، عيادات للانتظار، وسباكون وصيانة مبانٍ للسباكة؛ وخدمات المحاسبة تبدأ بجهات لديها نشاط مالي محتمل بدل نسخ قائمة مكاتب واحدة. لا دليل على أن أيًا منها يريد الشراء الآن من مجرد النشاط. لم تظهر طلبات شراء حالية موثقة في هذه الحالات؛ غيابها في الاختبار لا يعني عدم وجود طلب في السوق.

## أمثلة حقيقية والأدلة
'''
 examples=['coffee-purchase','plumbing-purchase','medical-purchase','legal-purchase','computers-marketing','plumbing-marketing','accounting-marketing','uniform-maker','computer-service','dental-purchase']
 for key in examples:
  c=next(c for c in cases if c['case_id']==key);rr=c['direct']+c['potential']
  if not rr:continue
  r=rr[0];rel=r['commercial_relationship'];source=r.get('source_url') or r.get('source_ref')
  text+=f"\n### {c['input_text']}\n{r['name']} — {rel['role']} / {r.get('commercial_function')}. السبب: {r.get('usage_reason') or r.get('reason')}.\nالدليل: `{source}`؛ تاريخ المصدر {r.get('observed_at') or 'غير متوفر'}؛ نصه: {(r.get('evidence_excerpt') or '')[:400]}. الحالة {rel['evidence_state']}؛ VERIFIED={r.get('verified')}. الملف results-with-evidence.csv يحفظ بقية النتائج مع المصادر والدرجات، ولا تُختزل النتائج إلى مثال واحد.\n"
 text+=f'''
## التواصل والاستكمال
العدادات السابقة 431,396 هاتف /25,299 بريد /109,989 موقع تخص جميع الهويات المؤقتة في السجل الأكبر، وتتداخل. داخل مقام {contact['audited_identity_denominator']:,} هوية هذه المهمة: {contact['phone_presence']:,} هاتف، {contact['email_presence']:,} بريد، {contact['website_presence']:,} موقع؛ اتحاد أي وسيلة {contact['any_channel_presence_union']:,} فقط. {missing:,} بلا أي حضور وسيلة من الثلاث في المصادر المرتبطة. لا نحسبها كلها واتساب أو تواصلًا مكتملًا، ولا ننقل تواصل فرع لفرع آخر.
قائمة الأولوية من نتائج الـ64 تضم {plan['businesses']} هوية مستقرة ناقصة التواصل المباشر؛ {existing_first} منها تبدأ بمراجعة وسيلة موجودة في مصادر المجموعة، دون استعارة رقم فرع آخر. الملف serper-unapproved-priority-plan.json بدون سقف معتمد: صفر. يجري بحث مدفوع واحد فقط لكل هوية عند التفويض، وسجل محاولات SQLite مشترك يمنع التكرار حتى بالتزامن. لا خرائط تلقائية ثانية. اسم نتيجة البحث لا يثبت بيع منتج، وWhatsApp يبقى غير متحقق.

## العلاقات المحفوظة والنواة
حُفظ {relcount} رابطًا سياقيًا مختلفًا من نتائج الطلبات في evaluated_relationships داخل النسخة المشتقة، بتوزيع {relcounts}. هذه نتائج تقييم محددة وليست مجموع علاقات السوق أو الموردين المثبتين. مصدر CPO الأصلي ومحركات Construction للكتالوجات والتاريخ والأسعار بقيت دون تعديل؛ اختبارات إعادة الاستخدام السبعة تثبت مراجع الوظائف والتوجيهات الأربع وبصمات الملفات. قواعد Targeting الحالية توسعت إلى 38 عائلة تشمل الخدمات، والبحث الحر عن النشاط مستمر دون سقف إجمالي.

## الاختبارات وحدود القبول
66 تنفيذ اختبار Python ناجح، 7 اختبارات إعادة استخدام Construction، مقارنة فعلية تفشل إن عاد أي خطأ معروف في الحالات، typecheck وbuild وفحص التغييرات clean. تحذير حجم حزمة الإنتاج السابق يبقى خارج نطاق هذا التعديل. تحقق HTTP وواجهة 1440/390 محفوظ في http-validation.json وui-validation.json بعد انتهاء الجولة؛ لا اتصالات متصفح خارج loopback.

## ما بقي
- {audit['identities_without_resolved_activity']:,} هوية بلا نشاط رئيسي مرجح؛ والتعارضات {audit['identities_with_source_conflicts']:,} تحتاج مصادر مستقلة أو مراجعة، لا تحويلها إلى ثقة عالية.
- ربط ISIC والحي والفرع والهوية القانونية غير مكتمل. ما يرد في القواميس أنشطة مصادر وتخصصات تجارية، لا التصنيف الرسمي كله.
- دقة المطابقة الفعلية لم تُقَس بشريًا بعد. صفحات معلومات أو أصناف متشابهة جديدة قد تتطلب قواعد إضافية؛ لا ادعاء كشف كل الأخطاء.
- زمن البحث بعد التحقق من السياق مدوّن أعلاه؛ كلفة الجودة يجب مراقبتها، ولا ادعاء أنه أسرع.
- التغطية لجميع القطاعات هدف توسع؛ 38 عائلة والبحث بالنشاط لا يعنيان فهم جميع المنتجات والخدمات أو امتلاك كل السوق السعودي. الهدف الصريح خارج العائلات قد يبقى نشاطًا ذا صلة أو فجوة فهم.
- المخزون، الطلب الحالي، اهتمام الشراكة، صلاحية واتساب، ومتطلبات اعتماد الجهات الحكومية/الطبية غير مثبتة تلقائيًا.

## الملفات وإعادة التشغيل
activity-quality.db وreceipt: كامل فحص الهويات. source-conflicts.csv: التعارضات دون حذف أصلها. activity-coverage.csv: التوزيع المستنتج. before-after-quality.csv وquality-comparison.json: المقارنة والمقامات. results-with-evidence.csv وreal-examples.json: الترشيحات وأدلتها. blind-human-review.csv: المراجعة المستقلة المنتظرة. serper-unapproved-priority-plan.json: الاستكمال غير المعتمد. الكود والتشغيل في services/commercial-intelligence/README.md؛ جميع القيم قابلة لإعادة القياس بالسكريبتات المحفوظة. لا نشر ولا دمج ولا دفع رصيد ولا إرسال.
'''
 (root/'MARKET-INTELLIGENCE-QUALITY-REPORT.md').write_text(text)
 (root/'relationship-receipt.json').write_text(json.dumps({'unique_evaluated_contextual_relationships':relcount,'by_role_evidence_state':relcounts,'current_request_rows':sum(n for role,state,n in relcounts if state=='CURRENT_PUBLIC_REQUEST_PUBLICATION_ONLY'),'provider_calls':0},ensure_ascii=False,indent=2))
 print({'report':str(root/'MARKET-INTELLIGENCE-QUALITY-REPORT.md'),'unique_contextual_relationships':relcount})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);deliver(**vars(p.parse_args()))
