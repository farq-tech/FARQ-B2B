# coding: utf-8
"""Measured follow-up delivery from real replay files and read-only activity snapshots."""
import argparse,csv,json,sqlite3,statistics
from pathlib import Path

def deliver(root,previous_quality):
 root=Path(root);comparison=json.loads((root/'quality-comparison.json').read_text());before=json.loads((root/'before-results.json').read_text());after=json.loads((root/'after-results.json').read_text());audit=json.loads((root/'activity-quality.receipt.json').read_text());previous=json.loads(Path(previous_quality).with_suffix('.receipt.json').read_text())
 db=sqlite3.connect((root/'activity-quality.db').as_uri()+'?mode=ro',uri=True);db.execute('ATTACH DATABASE ? AS previous',(Path(previous_quality).resolve().as_uri()+'?mode=ro',))
 transitions={key:db.execute(sql).fetchone()[0] for key,sql in {
  'previously_unknown_now_inferred':"SELECT count(*) FROM activity_quality a JOIN previous.activity_quality b USING(entity_id) WHERE b.primary_activity IS NULL AND a.primary_activity IS NOT NULL",
  'previously_inferred_now_abstained':"SELECT count(*) FROM activity_quality a JOIN previous.activity_quality b USING(entity_id) WHERE b.primary_activity IS NOT NULL AND a.primary_activity IS NULL",
  'new_conflict_identities':"SELECT count(*) FROM activity_quality a JOIN previous.activity_quality b USING(entity_id) WHERE a.conflicts!='[]' AND b.conflicts='[]'",
  'remaining_unknown_with_only_blank_source_categories':"SELECT count(*) FROM activity_quality a WHERE primary_activity IS NULL AND NOT EXISTS(SELECT 1 FROM json_each(a.source_categories) j WHERE trim(coalesce(json_extract(j.value,'$.original_category'),''))!='')"}.items()}
 for filename,sql,header in [
 ('activity-changes.csv',"SELECT a.entity_id,a.commercial_name,b.primary_activity,a.primary_activity,b.classification_status,a.classification_status,a.source_categories,a.conflicts FROM activity_quality a JOIN previous.activity_quality b USING(entity_id) WHERE a.primary_activity IS NOT b.primary_activity OR a.classification_status!=b.classification_status",['entity','name','before_primary','after_primary','before_status','after_status','original_source_categories','conflicts']),
 ('source-conflicts.csv',"SELECT entity_id,commercial_name,primary_activity,source_categories,conflicts,activity_confidence FROM activity_quality WHERE conflicts!='[]'",['entity','name','inferred_primary','original_source_categories','conflicts','relative_confidence']),
 ('unresolved-classifications.csv',"SELECT entity_id,commercial_name,classification_status,source_categories,activity_confidence FROM activity_quality WHERE primary_activity IS NULL",['entity','name','status','original_source_categories','candidate_activity_confidence'])]:
  with (root/filename).open('w',encoding='utf-8-sig',newline='') as f:w=csv.writer(f);w.writerow(header);w.writerows(db.execute(sql))
 db.close()
 bybefore={c['case_id']:c for c in before['cases']};examples=[];branches=[];diversity=[]
 for c in after['cases']:
  prev=bybefore[c['case_id']];rr=c['direct']+c['potential'];old=prev['direct']+prev['potential']
  def dunkin(rows):return sum('دانكن' in r['name'] or 'dunkin' in r['name'].lower() for r in rows)
  if c['direction']=='marketing':diversity.append({'case':c['case_id'],'dunkin_before':dunkin(old),'dunkin_after':dunkin(rr),'groups':sum(bool(r.get('commercial_group')) for r in rr),'top5_names_after':[r['name'] for r in rr[:5]]})
  for r in rr:
   g=r.get('commercial_group')
   if g:
    for b in g['branches']:branches.append([c['case_id'],g['id'],r['name'],g['basis'],g['source_locality_count'],b['source_entity_id'],b['source_ref'],b['name'],b['city'],b['district'],b['evidence_excerpt'],b['observed_at'],','.join(b['contact_channels'])])
  if c['case_id'] in ['coffee-marketing','paper-cups-marketing','plumbing-purchase','software-purchase','textiles-purchase','computers-marketing','plumbing-marketing','dental-purchase','coffee-purchase']:
   examples.append({'case':c['case_id'],'goal':c['input_text'],'direction':c['direction'],'before':[{'name':r['name'],'level':r['level'],'source':r.get('source_ref') or r.get('source_url'),'excerpt':r.get('evidence_excerpt'),'date':r.get('observed_at')} for r in old[:7]],'after':[{'name':r['name'],'level':r['level'],'source':r.get('source_ref') or r.get('source_url'),'excerpt':r.get('evidence_excerpt'),'date':r.get('observed_at'),'reason':r.get('usage_reason') or r.get('reason'),'commercial_group':r.get('commercial_group'),'current_demand':r['commercial_relationship']['current_demand']} for r in rr[:5]],'excluded':c.get('excluded',[])})
 assert all(d['dunkin_after']<=1 for d in diversity)
 with (root/'display-group-branches.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['case','presentation_group','representative','group_basis','distinct_source_localities_not_branch_count','source_id','source_ref','branch_name','city','district','original_evidence','source_date','branch_channels']);w.writerows(branches)
 (root/'before-after-real-examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2));(root/'diversification-receipt.json').write_text(json.dumps(diversity,ensure_ascii=False,indent=2));(root/'activity-transition-receipt.json').write_text(json.dumps(transitions,ensure_ascii=False,indent=2))
 b=comparison['before'];a=comparison['after'];speed=round((1-a['latency_cold_ms']['median']/b['latency_cold_ms']['median'])*100,1)
 text=f'''# متابعة جودة استخبارات السوق والتنويع — 13 أكتوبر 2026

نفذت داخل النواة الحالية على engineering/commercial-intelligence-recovery، في PRAGMATIC. لا تعديل للمصادر أو الإنتاج، لا Serper أو خدمات مدفوعة أو إرسال، ولا دمج أو نشر.

## ما تغير
- تصحيح أهلية الأنشطة الثانوية المتناقضة: الغذاء والسكن لا يثبتان تقديم البرمجيات، وتأجير السيارات والهدايا لا يثبتان بيع السباكة، والتأمين لا يثبت بيع الزي. احتُفظ بالتصنيف الخام والمصدر والسبب. الإشارة المستقلة المناسبة تسمح بتعدد النشاط؛ الاسم وحده لا يثبت نشاطًا أو ملكية.
- إضافة تسميات مصادر كانت غير مفهومة: التخزين والوقود والزهور والهدايا وتأجير المعدات ومواد البناء والأحذية وغيرها. لا تحويلها إلى إثبات بيع منتج. المصادر الخالية والرموز غير المفسرة تبقى مجهولة.
- تنويع بحث العملاء المحتملين قبل قطع نافذة النتائج: مجموعة عرض واحدة للعلامة أو الاسم المميز المتوافق مع النشاط، مع فصل النطاقات المتعارضة. نفس الاسم لا يدمج الهوية القانونية. الشركة الأم لا تجمع إلا بعلاقة موثقة صريحة؛ لا علاقات أم/تابع مثبتة إضافية في هذه المهمة.
- الفروع والمصدر والتواصل باقية في commercial_group.branches، وخيار استعراضها في صفحة المراجعة المحلية. عدد الفروع الفعلي غير محسوم: known_branch_count=null. العدد المعروض بجانب السجلات يخص تسميات أحياء مصدرية متميزة، لا عدد الفروع؛ قد يقع أكثر من فرع في الحي نفسه. سجلات الموقع الناقص محفوظة ولا تُخترع مواقع لها. في بحث البائع المحلي يبقى كل معرف مصدر مستقلًا حتى لو تطابق الاسم والحي؛ لا تجميع إلا بهوية فرع مؤكدة صراحة أو معرف مصدر متكرر، ولا نقل للأرقام بين الفروع.
- تحسين السرعة بقراءات هوية وتصنيف مجمعة مع ذاكرة محدودة وإبطال عند تغير الأصول، وإعادة استخدام التطبيع القصير، وفهرس إضافي للمدينة فوق نسخة من فهرس المصدر نفسه. لم أُخفّض سقف المرشحين 3000 أو نافذة المراجعة لإظهار تحسن مصطنع. المفتاح الجغرافي لا يثبت مدينة رسمية، ووزن عمود المدينة في ترتيب النص صفر؛ قد يتغير ترتيب bm25 قليلًا بسبب طول مستند الفهرس، لذا أُعيدت الحالات كاملة.

## الهويات والتعارضات
المقام نفسه {audit['audited_named_candidate_identities']:,} هوية مصدرية مرشحة، من {audit['source_members']:,} سجل؛ ليست شركات قانونية محققة.
- بلا نشاط رئيسي مرجح: {previous['identities_without_resolved_activity']:,} ← {audit['identities_without_resolved_activity']:,}.
- مجهولة سابقًا أصبح نشاطها مستنتجًا من تسميات المصدر: {transitions['previously_unknown_now_inferred']:,}. مستنتجة سابقًا عاد الامتناع عنها: {transitions['previously_inferred_now_abstained']:,}.
- هويات ذات تعارض مكتشف: {previous['identities_with_source_conflicts']:,} ← {audit['identities_with_source_conflicts']:,}؛ {transitions['new_conflict_identities']:,} هويات تعارض إضافية. الزيادة كشف للمشكلة، وليست تدهورًا أو إقرارًا بأن جميع التعارضات حُسمت.
- من الباقي المجهول {transitions['remaining_unknown_with_only_blank_source_categories']:,} بلا أي تصنيف مصدر غير فارغ. لا يكفي الاسم وحده لحسمها، ولا اختلاق أنشطة لإغلاق الفجوة.
activity-changes.csv وsource-conflicts.csv وunresolved-classifications.csv تحتوي التغييرات والمجهول كاملًا مع المصدر.

## مقارنة 64 حالة فعلية قبل وبعد
نسخة قبل commit 2f6bf2c، ونصوص وأهداف ومدن وأصول مصدرية متطابقة. 42 حالة أصلية +22 قطاعًا/خدمة إضافية. القياس النهائي تسلسلي على Mac، دون تدقيق مليون سجل أو بناء أو متصفح متزامن من هذه المهمة؛ حالة حمل بقية الجهاز غير مضبوطة. ليس اختبار حمل إنتاجي أو ضمان SLA. الفهرس بعد مشتق من جميع سجلات الفهرس قبل، وليس بيانات جديدة.

| القياس | قبل | بعد | التفسير |
|---|---:|---:|---|
| نتائج غير فارغة | {b['nonempty_cases']} | {a['nonempty_cases']} | المقام 64؛ ليس مقياس دقة |
| اتساق دليل آلي في أفضل خمس | {b['cases_with_top5_evidence_consistency_proxy']} | {a['cases_with_top5_evidence_consistency_proxy']} | المقام 64؛ ليس Precision أو مراجعة بشرية |
| ظهور الأخطاء المعروفة | {b['known_contradiction_appearances']} | {a['known_contradiction_appearances']} | جميع النتائج؛ يشمل الأمثلة الخمسة، لا كل أخطاء السوق |
| أخطاء معروفة في أفضل خمس | {b['top5_frozen_labels'].get('KNOWN_CONTRADICTION',0)} | {a['top5_frozen_labels'].get('KNOWN_CONTRADICTION',0)} | ظهور جهة داخل طلب |
| هويات مختلفة بالنتائج | {b['unique_provisional_entities']} | {a['unique_provisional_entities']} | هويات مؤقتة، لا عدد العلامات القانونية |
| حضور هاتف/بريد للهوية في النتائج | {b['source_contact_presence_entities']} | {a['source_contact_presence_entities']} | ليس واتساب متحققًا؛ الاتصالات لا تُجمع كجهات مكتملة |
| وسيط ms | {b['latency_cold_ms']['median']} | {a['latency_cold_ms']['median']} | انخفاض {speed}%؛ جميع الحالات، يتضمن CPO |
| p95 ms | {b['latency_cold_ms']['p95']} | {a['latency_cold_ms']['p95']} | المقام 64 |
| max ms | {b['latency_cold_ms']['max']} | {a['latency_cold_ms']['max']} | يتأثر بأول تشغيل CPO |

الدليل بعد: {a['evidence_levels']}. لا ترقية إلى C بسبب نشاط متعارض. النتيجة المحتملة تبقى محتملة. الطلب الحالي والمخزون واهتمام الشراكة لم تثبت من النشاط؛ المشترون يستخدمون المنتج على الأرجح، وليسوا طلبات مؤكدة. عدد المراسي المتوافقة الثابتة قبل {b['cases_with_frozen_compatible_anchor']} وبعد {a['cases_with_frozen_compatible_anchor']}؛ تغير نافذة الترتيب لا يثبت خطأ المرساة المزاحة.

## أمثلة حقيقية مع الدليل
'''
 for e in examples:
  text+=f"\n### {e['goal']}\nقبل: "+' · '.join(r['name'] for r in e['before'][:5])+'.\nبعد:\n'
  for r in e['after'][:3]:
   group=r.get('commercial_group');g=f"؛ {group['source_locality_count']} تسميات أحياء مصدرية / {group['source_record_count']} سجلات داخل الاسترجاع" if group else ''
   text+=f"- {r['name']} ({r['level']}){g}: {r['reason']}. المصدر `{r['source']}`؛ التاريخ {r['date'] or 'غير متوفر'}. النص المحفوظ: {(r['excerpt'] or '')[:450]}. طلب حالي مثبت: {r['current_demand']}.\n"
 mandatory=[]
 for case_id,names in [('software-purchase',['محاصيل تركيا للفواكه والخضروات','رباط المونسية']),('plumbing-purchase',['كدن لتأجير السيارات','سهام لهدايا المواليد والمناسبات']),('textiles-purchase',['شركه البحر الاحمر للتأمين'])]:
  old=bybefore[case_id];current=next(c for c in after['cases'] if c['case_id']==case_id)
  for name in names:
   r=next(r for r in old['direct']+old['potential'] if r['name']==name)
   excluded=next(r for r in current.get('excluded',[]) if r.get('name')==name)
   mandatory.append([case_id,name,r['level'],'EXCLUDED_FOR_THIS_OBJECTIVE_ONLY',r.get('source_ref'),r.get('evidence_excerpt'),r.get('observed_at'),json.dumps(excluded.get('reason'),ensure_ascii=False)])
 text+='\n## الأمثلة الإلزامية — قرار فعلي محفوظ\n'
 for case,name,level,decision,source,excerpt,date,reason in mandatory:
  text+=f"- {name}: قبل {level} في {case}؛ بعد مستبعد لهذا الهدف فقط. المصدر `{source}` ({date or 'تاريخ غير متاح'}): {excerpt}. سبب القرار: {reason}. لم تُحذف المنشأة أو تصنيفاتها الأصلية.\n"
 with (root/'mandatory-conflicts-before-after.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['case','name','before_level','after_decision','source_ref','original_evidence','source_date','decision_reason']);w.writerows(mandatory)
 text+='''
## القبول والحدود
اختبارات التراجع تفشل إذا عادت الأمثلة الخمسة أو الأخطاء السابقة، وتختبر التنويع، إبقاء المواقع والتواصل، والفهرس المشتق دون تغيير الأصل. ملفات checks.json وui-validation.json وhttp-validation.json تثبت النتائج التقنية الفعلية.
جودة الملاءمة البشرية: PENDING_HUMAN_REVIEW. ليس التخلص من قائمة أخطاء محدودة دليل اكتمال الجودة؛ blind-human-review.csv جاهز دون قرارات النظام. القواميس مبنية على تسميات المصادر وليست ISIC رسميًا كاملًا. العلاقات القانونية، المصدر المستقل للأنشطة المتعارضة، المدن والأحياء الرسمية، المخزون والطلب الحالي والتواصل الحي ما زالت فجوات. البحث الحر عن النشاط يبقى متاحًا، وفهم 38 عائلة ليس كل السوق السعودي. المنتج يعرض نافذة مراجعة محدودة؛ لا يدعي حصر جميع الجهات.

## أين الملفات
before-results.json وafter-results.json: النتائج الفعلية كاملة. before-after-quality.csv: قياس كل طلب. results-with-evidence.csv: الموردون والمشترون وسببهم ودليلهم. before-after-real-examples.json: أمثلة قبل وبعد والأدلة والاستبعاد. display-group-branches.csv: السجلات المخفية خلف تجميع العرض دون فقدها. activity-quality.db: الطبقة المشتقة الجديدة؛ golden-search-index.db: نسخة الاسترجاع المحلية بفهرس المدينة؛ مصادرهما الأصلية لم تتغير. لا تشغيل Serper، والخطة غير المعتمدة سقفها صفر.
'''
 (root/'PRAGMATIC-FOLLOWUP-REPORT.md').write_text(text)
 print({'report':str(root/'PRAGMATIC-FOLLOWUP-REPORT.md'),'transitions':transitions,'median_speed_improvement_percent':speed,'branch_source_rows':len(branches)})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--previous-quality',required=True);deliver(**vars(p.parse_args()))
