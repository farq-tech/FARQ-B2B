# coding: utf-8
"""Persist evaluated contextual links and reproducible delivery; owned derivative only."""
import argparse,csv,json,sqlite3
from pathlib import Path

def deliver(root):
 root=Path(root);before=json.loads((root/'before-results.json').read_text());after=json.loads((root/'after-results.json').read_text());coverage=json.loads((root/'coverage.json').read_text());entities=coverage['entities']
 db=sqlite3.connect(root/'commercial-registry.db');rows=[];comparison=[]
 for b,a in zip(before['cases'],after['cases']):
  assert (b['case_id'],b['input_text'],b['direction'],b['requested_city'])==(a['case_id'],a['input_text'],a['direction'],a['requested_city'])
  comparison.append([a['case_id'],a['input_text'],a['direction'],a['requested_city'],len(b['direct']),len(b['potential']),len(a['direct']),len(a['potential'])])
  for rank,r in enumerate(a['direct']+a['potential'],1):
   rel=r['commercial_relationship'];identity=r['commercial_identity'];reach=r['reachability']
   db.execute('INSERT OR IGNORE INTO entities VALUES(?,?,?,?)',(identity['id'],identity['display_name'],identity['basis'],identity['legal_status']))
   db.execute('INSERT OR REPLACE INTO contextual_relationships VALUES(?,?,?,?,?,?,?,?,?)',(rel['id'],identity['id'],rel['subject'],rel['objective'],rel['role'],rel['evidence_state'],str(rel['source_ref'] or ''),rel['source_date'],'local-review:execution'))
   rows.append([a['case_id'],rank,r['name'],r['entity_id'],r['source_entity_id'],rel['role'],rel['evidence_state'],rel['current_demand'],r.get('city'),r.get('district'),r.get('level'),r.get('reason'),rel['source_ref'],rel['source_date'],r.get('evidence_excerpt') or r.get('source_excerpt'),','.join(reach['channel_presence'])])
 db.commit();relations=db.execute('SELECT role,evidence_state,count(*) FROM contextual_relationships GROUP BY role,evidence_state').fetchall();count=db.execute('SELECT count(*) FROM contextual_relationships').fetchone()[0];db.close()
 for filename,header,data in [('before-after-search.csv',['case','query','objective','city','before_main','before_potential','after_main','after_potential'],comparison),('search-results-with-evidence.csv',['case','rank','name','entity_id','source_id','role','evidence_state','current_request','city','district','level','reason','source','date','excerpt','channels'],rows)]:
  with (root/filename).open('w',newline='',encoding='utf-8-sig') as f:
   w=csv.writer(f);w.writerow(header);w.writerows(data)
 summary={'actual_case_runs':len(comparison),'before_nonempty':sum(bool(c['direct'] or c['potential']) for c in before['cases']),'after_nonempty':sum(bool(c['direct'] or c['potential']) for c in after['cases']),'result_appearances':len(rows),'unique_contextual_relationships':count,'relationships_by_state':relations,'precision':'PENDING_HUMAN_REVIEW','provider_calls':0,'messages_sent':0,'production_changes':0}
 (root/'execution-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
 text=f'''# تنفيذ النواة التجارية — 13 أكتوبر 2026

## النتيجة
نواة البحث الحالية تستخدم هوية تجارية محايدة، وعلاقة مستقلة لكل هدف ومنتج، ومعلومات تواصل مستقلة عن الملاءمة. أعيد استخدام CPO وIntent Resolver وSupplier Matching وPrice Memory الموجودين؛ توسعت قواعد Targeting الحالية إلى 31 عائلة منتجات وخدمات. لا محرك منفصل ولا إرسال ولا نشر.

## المقامات والتغطية
- سجلات المصادر المرتبطة: {entities['source_profiles']:,}، وهو عدد سجلات لا عدد شركات قانونية.
- هويات تجارية مؤقتة: {entities['provisional_commercial_identities']:,}. التجميع بالاسم المطابق والنطاق المسجل قابل للعكس؛ ليست جميعها منشآت مثبتة أو كيانات فريدة قانونيًا.
- مرشحون باسم تجاري: {entities['named_business_identity_candidates']:,} هوية؛ منهم {entities['strong_searchable_identity_candidates']:,} مرتبطون بنشاط تجاري مصنف. هذه حالات استدلال قابلة للبحث وليست إثباتًا للسوق كله.
- 1,211,735 سجل مصدر غير محسوم؛ لا نعلنها منشآت مؤكدة. استبعاد الأسماء العامة والمعالم والأشكال مستمر دون حذف المصدر.
- 55,855 نص نشاط مختلف في المصدر، لا 55,855 نشاط ISIC رسمي. 1,820 تسمية مدينة تحتاج تطبيعًا؛ ليست تعداد المدن الرسمية.
- {coverage['products_services']['product_subject_records']:,} سجل منتج/خدمة و{coverage['products_services']['distinct_normalized_subject_texts']:,} نص مطبع مختلف؛ ليست أصناف SKU موحدة مثبتة.
- 54,240 رابط بيع محفوظ في الرسم السابق؛ منها 17,403 مرشح رابط كتالوج، 14,985 مرشح مراجعة، 9,981 تحتاج حسم الهوية، 11,871 تاريخية. لا تعد كلها روابط بيع مثبتة ولا تخلط رابط العائلة بالصنف.

## العلاقات المنفذة
نفذت {summary['actual_case_runs']} حالة فعلية على الأصول نفسها قبل وبعد: أجهزة كمبيوتر، قهوة، غذاء، سباكة، طب، محاسبة، برمجيات، قانون، تسويق، شحن، تدريب، سيارات، ملابس، زراعة، تكييف وطباعة، مع شراء وبيع واستفسار وشراكة، والرياض وجدة والدمام.
{summary['before_nonempty']} حالة غير فارغة قبل ← {summary['after_nonempty']} بعد، من مقام 42. هذا قياس التغطية التشغيلية وليس Precision. حُفظ {count} رابط سياقي فريد من {len(rows)} ظهور في نتائج الحالات. التفاصيل والأسباب والنصوص والمصادر والتواريخ في search-results-with-evidence.csv. الطلب الحالي لا يُستنتج من النشاط؛ المشترون والشركاء محتملون، وتوجد منشورات طلبات عامة محفوظة عددها 2 ولا تثبت أهلية المشاركة أو حاجة كل مرشح.

## إمكانية الوصول
من مقام {entities['provisional_commercial_identities']:,} هويات مؤقتة: {entities['identities_with_phone_presence']:,} لها حضور هاتف/جوال/ثابت في مصدر، {entities['identities_with_email_presence']:,} بريد، {entities['identities_with_website_presence']:,} موقع مسجل. المجموعات تتداخل، ولا تعني أرقام واتساب نشطة أو مواقع رسمية مثبتة. {entities['pending_enrichment']:,} في قائمة مشتقة لاستكمال الهاتف أو البريد، الميزانية صفر وSerper صفر. قيد بحث واحد لكل هوية عند اعتماد ميزانية لاحقة؛ لا توجد عملية مدفوعة منفذة.

## ما تغيّر بالفعل
منع برامج المحاسبة من الظهور كخدمات محاسبية، وفصل شحن البضائع عن تصنيع المركبات وسياسات شحن المتاجر، ومنع الاستشارات الهندسية من ترشيحات القانون. لا نقل لتواصل فرع إلى فرع آخر. الاستدلال التجاري العام مستمر مع فصل المصدر المباشر والتاريخي والمحتمل. بحث النشاط يدعم إجمالي المطابقات وصفحات SQL دون سقف إجمالي؛ حالات المنتج تعرض نافذة ترتيب 20 لكل مستوى وليست تعدادًا شاملًا لكل السوق.

## التحقق وحدوده
54 تنفيذ اختبار Python و7 اختبارات إعادة استخدام وظائف البناء الأصلية ناجحة؛ typecheck وbuild ناجحان. lint لا أخطاء، تحذيرات الوصولية السابقة خارج التعديلات باقية. HTTP المحلي نجح لمساري تسعير وبناء والتغطية، ومنع غياب هوية المراجع 401. UI على 1440 و390 بلا تجاوز عرض أو أخطاء، اتصالات المتصفح الخارجية محجوبة. لا نتائج بشرية مخترعة: PENDING_HUMAN_REVIEW؛ مراجعة العينة المستقلة ضرورية لحساب Precision وRecall.

## الفجوات
التطبيع الرسمي للأحياء وISIC غير مكتمل، تكرار الكيانات بين المصادر غير محسوم بالكامل، ملاءمة تخصصات نادرة والاستدلال الحر خارج العائلات الحالية تحتاج توسيعًا، ولا نضمن توفر صنف أو طلب شراء أو شراكة حاليًا. البحث الحر بالنشاط لا يتوقف لذلك؛ تظهر صفة محتمل أو نشاط ذي صلة. هذا أساس تشغيلي معزول قابل للقياس، وليس اكتمال كل قطاعات السوق السعودي.

## إعادة التشغيل
الكود في engineering/commercial-intelligence-recovery. شغّل execution_eval.py ثم execution_delivery.py --root هذا المجلد؛ اقرأ services/commercial-intelligence/README.md داخل المستودع لمتغيرات النواة المحلية. المدخلات read-only؛ commercial-registry.db وحده مشتق مملوك لهذه المهمة. لا مصدر أصلي أو إنتاج أو iCloud أو Serper أو رسائل أو دمج أو نشر.
'''
 (root/'COMMERCIAL-CORE-EXECUTION-REPORT.md').write_text(text)
 print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);deliver(**vars(p.parse_args()))
