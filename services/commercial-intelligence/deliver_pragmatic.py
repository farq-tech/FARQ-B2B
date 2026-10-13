# -*- coding: utf-8 -*-
"""Export an auditable local review packet; never contacts a provider."""
import csv,json,random,hashlib,sqlite3
from pathlib import Path
import argparse

def deliver(root):
 root=Path(root);data=json.loads((root/'pragmatic-final-validation-results.json').read_text());rows=[]
 for case in data['cases']:
  for tier in ['main','expansion']:
   for rank,item in enumerate(case.get(tier,[]),1):
    rows.append({'case':case['case_id'],'goal':case['input_text'],'tier':tier,'rank':rank,**{k:item.get(k) for k in ['id','entity_id','name','role','level','score','subject','evidence_kind','source_url','source_ref','evidence_excerpt','observed_at','city','district','reason','verified','purchase_intent','availability','blockers']}})
 fields=list(rows[0])
 def write(name,records,keys):
  with (root/name).open('w',newline='') as f:
   w=csv.DictWriter(f,fieldnames=keys);w.writeheader()
   for r in records:w.writerow({k:json.dumps(r.get(k),ensure_ascii=False) if isinstance(r.get(k),(list,dict)) else r.get(k) for k in keys})
  (root/name).chmod(0o600)
 write('supplier-buyer-results-with-evidence.csv',rows,fields)
 blind=[];key=[];sample=rows.copy();random.Random(20261013).shuffle(sample)
 for n,r in enumerate(sample):
  bid=hashlib.sha256((r['id']+r['case']+str(n)).encode()).hexdigest()[:16]
  blind.append({'review_id':bid,**{k:r.get(k) for k in ['goal','name','role','subject','evidence_kind','source_url','source_ref','evidence_excerpt','observed_at','city','district']},'human_product_fit':'','human_role_fit':'','human_identity_fit':'','reviewer_notes':''})
  key.append({'review_id':bid,'case':r['case'],'system_level':r['level'],'system_rank':r['rank'],'id':r['id']})
 write('pragmatic-human-review-blind.csv',blind,list(blind[0]));write('pragmatic-human-review-key.csv',key,list(key[0]))
 unique=len({r['entity_id'] for r in rows});levels={x:sum(r['level']==x for r in rows) for x in 'ABCD'}
 lines=['# نتائج الموردين والمشترين — نسخة محلية للمراجعة','', 'لم يتغير الإنتاج أو المصدر الأصلي. لا إرسال، لا نشر، لا Serper.','',f"اختُبرت {data['case_runs']} حالة و{data['warm_repeat_cases']} إعادة بحث. النتائج المعروضة: {len(rows)} ظهورًا لـ{unique} ملف مصدر مختلف؛ ليست عدد المنشآت القانونية المثبتة.",f'مستويات النتائج المعروضة: {levels}. A دليل صنف، B دليل عائلة، C تخصص، D احتمال/دليل تاريخي. VERIFIED مستقل ولم يثبت تلقائيًا.','',f"أقصى زمن أول بحث: {data['cold_max_ms']:.1f}ms. p99/max للإعادة: {data['warm_max_ms']:.1f}ms. القياس محلي تسلسلي على Mac، وليس اختبار حمل؛ الإعادة تشمل ذاكرة مؤقتة محدودة 30 ثانية بحسب المستخدم وإصدار الملفات.",'', '## نتائج الحالات الأساسية','', '| البحث | رئيسية A/B | توسعة C/D | مثال | دليل |','|---|---:|---:|---|---|']
 for c in data['cases'][:20]:
  results=c.get('main',[])+c.get('expansion',[]);r=results[0] if results else {}
  proof=r.get('source_url') or r.get('source_ref') or 'لا دليل كافٍ'
  lines.append(f"| {c['input_text']} | {len(c.get('main',[]))} | {len(c.get('expansion',[]))} | {r.get('name','امتناع')} | {proof} |")
 lines+=['','## ما نملكه وما لا نثبته','', 'الفهرس يحتوي 1,804,423 معرف مصدر POI؛ ليس 1.8 مليون شركة مثبتة. 466,386 سجلًا مصنفًا آليًا كمرشح منشأة قابل للبحث؛ بقية الفئات وتعارضاتها موثقة في golden-triage-receipt.json. الأسماء والتصنيفات المحلية ليست قاموسًا رسميًا معتمدًا.','', 'استعيدت 17,403 علاقة كتالوج منظمة في القاعدة المشتقة. ملفات المصادر التجارية 1,405 نطاقًا؛ أرقام محفوظة في 304 وبريد في 860 وفق إيصال الاستخراج، لا تحقق حي من التواصل ولا دمج قانوني. أرقام الحضور في Golden لا تُجمع معها بوصفها شركات فريدة.','', 'المشترون في أمثلة الكمبيوتر والأكواب والسباكة مرشحون من النشاط فقط، لا طلبات شراء حالية. تاريخ Golden الظاهر يتضمن 2023/2024؛ لا نصفه بحديث. المواد الطبية لا تثبت ترخيص المنتج أو استخدام الدواء المحدد. مواصفات السمك والمخزون والتوصيل غير المؤكدة تبقى معلنة.','', '## قبل ← بعد','', 'قبل: بوابة هوية قديمة تخفي المصدر التجاري وتؤخر البحث بمسح النشاط. بعد: ملفات مصادر مستقلة، A/B منفصلة عن C/D، استبعاد تعارضات المنتج، فهرس أوسع، مقتطف دليل، وإعادة بحث مؤقتة معزولة حسب المستخدم. لا نقل أرقام أو مواقع عبر SG.','', '## الاختبارات وحدود الاعتماد','', 'اختبارات Python ناجحة (44 تنفيذًا، تشمل تكرار اختبارات الأساس الموروثة). TypeScript وbuild وفحص oxlint للملفات المعدلة ناجحة. البناء يحتفظ بتحذير حجم Mapbox السابق. اختبارات UI محلية 1440/390 محفوظة، واختبارات محول فرق بناء محفوظة دون إرسال.','', 'PENDING_HUMAN_REVIEW: لم يُجرَ تقييم بشري مستقل. Precision@5 وRecall ودقة الهوية لم تُقَس بشريًا؛ نجاح الاختبارات لا يثبت 90%. ملفات المراجعة العمياء ومفتاح النظام منفصلان. الفجوات في كاميرا الأنابيب وطلب مقاول موثق لا تُملأ بأسماء مختلقة.','', 'المتبقي للاعتماد العام: مراجعة بشرية للترشيح، أدلة شراء حالية أوسع، ربط قانوني وفروع حيث يلزم، وتعميق التغطية للتخصصات غير المفسرة. هذا تسليم محلي للمراجعة وليس موافقة على نشر شامل.','', '## أين وكيف','', 'الكود: /Users/m4pro/farq-commercial-intelligence، engineering/commercial-intelligence-recovery. راجع services/commercial-intelligence/README.md. فعّل FARQ_PRAGMATIC_MATCHING=1 مع FARQ_GOLDEN_INDEX؛ الإنتاج معطل. النتائج التفصيلية: supplier-buyer-results-with-evidence.csv، والتقييم: pragmatic-final-validation-results.json.']
 (root/'FARQ-PRAGMATIC-COMMERCIAL-MATCHING.md').write_text('\n'.join(lines)+'\n')
 print({'rows':len(rows),'source_profiles':unique,'levels':levels,'warm_max_ms':data['warm_max_ms'],'cold_max_ms':data['cold_max_ms']})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();deliver(a.root)
