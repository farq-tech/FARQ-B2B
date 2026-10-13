# -*- coding: utf-8 -*-
"""Read-only Riyadh coverage exercise using the shared product and relationship core."""
import argparse,csv,json,os,sys,time,hashlib,random
from pathlib import Path
from core import CpoPort,Knowledge
SPECIALTIES=[('computers','أجهزة كمبيوتر'),('food','مواد غذائية'),('plumbing','مواد سباكة'),('medical','مستلزمات طبية'),('furniture','أثاث مكتبي'),('coffee','حبوب البن'),('water','مياه شرب'),('kitchen','معدات مطبخ'),('cables','كابلات كهربائية'),('cleaning','مواد نظافة'),('packaging','مواد تغليف'),('stationery','قرطاسية'),('paint','دهانات'),('steel','حديد')]

def run(db,node,source,index,geo,output):
 out=Path(output);out.mkdir(parents=True,exist_ok=True)
 os.environ.update(FARQ_PRAGMATIC_MATCHING='1',FARQ_GOLDEN_INDEX=index,FARQ_GEO_CANDIDATE=geo)
 inputs=[Path(db),Path(index),Path(geo)]
 before={str(p):(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs}
 port=CpoPort(node,source);k=Knowledge(db,port);cases=[];rows=[];unlocated=[];excluded=[]
 try:
  for key,label in SPECIALTIES:
   for direction in ['purchase','marketing']:
    text=('أبحث عن '+label) if direction=='purchase' else ('أبيع '+label)
    response=k.search(text,direction,'الرياض','local-review:riyadh-coverage',20)
    excluded.extend({'specialty':label,'direction':direction,**x} for x in getattr(k,'last_directory_exclusions',[]))
    allrows=response.get('main',[])+response.get('expansion',[])
    located=[x for x in allrows if x.get('city') and k.city_matches('الرياض',x['city'])]
    selected=located[:10]
    missing=[x for x in allrows if not x.get('city')]
    for x in missing:unlocated.append({'specialty':label,'direction':direction,**x})
    # No source without confirmed Riyadh label is silently relabelled Riyadh.
    assert all(x.get('city') and k.city_matches('الرياض',x['city']) for x in selected)
    assert all(x.get('level')!='X' and not x.get('verified') for x in selected)
    case={'specialty_id':key,'specialty':label,'direction':direction,'count':len(selected),'current_demand_count':sum(x.get('evidence_kind')=='FIRST_PARTY_PUBLIC_OPEN_REQUEST' for x in selected),'historical_demand_count':sum(x.get('evidence_kind')=='HISTORICAL_PURCHASE_REQUEST' for x in selected),'potential_count':sum(x.get('role')=='buyer' and x.get('purchase_intent')=='UNKNOWN' for x in selected),'unlocated_sources':len(missing),'latency_ms':response['latency_ms'],'results':selected}
    cases.append(case)
    for n,x in enumerate(selected,1):
     rows.append({'specialty':label,'direction':direction,'rank':n,'entity_id':x['entity_id'],'name':x['name'],'role':x['role'],'level':x['level'],'score':x['score'],'city':x.get('city'),'district':x.get('district'),'evidence_kind':x['evidence_kind'],'evidence_excerpt':x.get('evidence_excerpt'),'source_url':x.get('source_url'),'source_ref':x.get('source_ref'),'observed_at':x.get('observed_at'),'reason':x['reason'],'matched_activity_terms':x.get('matched_activity_terms'),'demand_state':'CURRENT_PUBLIC_REQUEST' if x.get('evidence_kind')=='FIRST_PARTY_PUBLIC_OPEN_REQUEST' else 'HISTORICAL_REQUEST' if x.get('evidence_kind')=='HISTORICAL_PURCHASE_REQUEST' else 'POTENTIAL_ONLY' if x['role']=='buyer' else 'SELLER_SPECIALTY_NOT_STOCK','contact_channels':x.get('contact_channels'),'verified':False})
    print(key,direction,len(selected),round(response['latency_ms'],1),flush=True)
 finally:port.close()
 after={str(p):(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs};assert before==after
 def export(name,items):
  with (out/name).open('w',newline='',encoding='utf8') as f:
   w=csv.DictWriter(f,fieldnames=list(items[0]));w.writeheader()
   for x in items:w.writerow({key:json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else value for key,value in x.items()})
  (out/name).chmod(0o600)
 export('riyadh-top10-suppliers-buyers.csv',rows)
 if excluded:export('riyadh-excluded-source-conflicts.csv',excluded)
 blind=[];review_key=[];review=rows.copy();random.Random(20261013).shuffle(review)
 for i,x in enumerate(review):
  rid=hashlib.sha256((x['entity_id']+x['specialty']+str(i)).encode()).hexdigest()[:16]
  blind.append({'review_id':rid,**{key:x[key] for key in ['specialty','direction','name','role','city','district','evidence_kind','evidence_excerpt','source_url','source_ref','observed_at']},'human_fit':'','human_evidence_strength':'','notes':''})
  review_key.append({'review_id':rid,'entity_id':x['entity_id'],'specialty':x['specialty'],'direction':x['direction'],'system_rank':x['rank'],'system_score':x['score'],'system_level':x['level']})
 export('riyadh-human-review-blind.csv',blind)
 export('riyadh-human-review-key.csv',review_key)
 summary={'specialties':len(SPECIALTIES),'queries':len(cases),'excluded_candidate_appearances':len(excluded),'result_appearances':len(rows),'unique_source_ids':len({x['entity_id'] for x in rows}),'seller_appearances':sum(x['role']=='seller' for x in rows),'buyer_appearances':sum(x['role']=='buyer' for x in rows),'current_demand_results':sum(c['current_demand_count'] for c in cases),'historical_demand_results':sum(c['historical_demand_count'] for c in cases),'serper_calls':0,'messages_sent':0,'original_modified':False,'source_inputs':list(before),'source_role_warning':'SOURCE_ACTIVITY_NOT_PRODUCT_OR_DEMAND_PROOF','input_stats_unchanged':before==after,'independent_human_review':'PENDING_HUMAN_REVIEW','selection':'Main A/B first then C/D score; original source city must match Riyadh; up to ten, no padding','cases':cases,'unlocated_source_candidates':unlocated}
 (out/'riyadh-coverage.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
 lines=['# تغطية تخصصات الرياض — الموردون والمشترون','',f"{len(SPECIALTIES)} تخصصًا، {len(cases)} بحثًا، {len(rows)} ظهور نتيجة، {summary['unique_source_ids']} معرف مصدر مختلف. ليست كيانات قانونية موحّدة.",'','كل قائمة حتى عشر نتائج من المصدر المسجل بالرياض فقط. ما لا يثبت موقعه منفصل في JSON؛ لا نملأ العدد بأسماء غير مناسبة. المصادر محفوظة وتاريخها ظاهر، ولا تحقق حي أو Serper.','',f"الطلب الحالي المثبت في هذه النتائج: {summary['current_demand_results']}. الطلب التاريخي: {summary['historical_demand_results']}. المشترون الآخرون محتملون من النشاط فقط، دون إثبات مشاريع دائمة أو احتياج حالي.",'','| التخصص | موردون | مشترون محتملون | طلب حالي |','|---|---:|---:|---:|']
 for _,label in SPECIALTIES:
  seller=next(c for c in cases if c['specialty']==label and c['direction']=='purchase');buyer=next(c for c in cases if c['specialty']==label and c['direction']=='marketing')
  lines.append(f"| {label} | {seller['count']} | {buyer['potential_count']} | {buyer['current_demand_count']} |")
 for case in cases:
  lines+=['', '## '+case['specialty']+' — '+('الموردون' if case['direction']=='purchase' else 'المشترون المحتملون'),'']
  for n,x in enumerate(case['results'],1):
   lines +=[f"### {n}. {x['name']}",f"{x.get('city','')} — {x.get('district') or 'الحي غير مثبت'}؛ المستوى {x['level']}، درجة ترجيح {x['score']} وليست احتمال شراء.",x['reason'],f"الدليل: {x.get('source_url') or x.get('source_ref')}؛ تاريخ المصدر: {x.get('observed_at') or 'غير معلوم'}.",f"مقتطف المصدر: {x.get('evidence_excerpt') or 'غير متاح'}",'']
 lines+=['## حدود النتائج','', 'كل النتائج المحلية المعروضة هنا تخصصية C ما لم يذكر غير ذلك. عُزلت تعارضات أسماء ظاهرة كالعقارات مقابل التغليف، والحلاق مقابل المقاول، والسيارات مقابل الدهانات. العزل بقواعد محافظة قد يخفض التغطية، ولا يحل كل أخطاء تصنيف المصدر. النشاط يثبت تصنيف المصدر فقط، ولا يثبت بيع صنف بعينه أو مخزونًا أو طلب شراء. الأسماء والمدينة والحي غير متحقق منها رسميًا، والتاريخ قديم في مصادر 2023/2024. لا دمج قانوني أو نقل تواصل بين جهات.','', 'الترتيب تجريبي بحسب قوة عبارة التخصص وحداثة المصدر وحضور وسيلة تواصل؛ لا يثبت أكثر الجهات استخدامًا أو احتياجًا. بعض النشاط متعدد ويحتاج مراجعة بشرية. الملفات العمياء مرفقة؛ Precision@10 وRecall غير مقاسين بشريًا.','', 'شُغّل محرك CPO الموجود لفهم البحث ثم محرك Targeting الموجود لدليل النشاط وعكس الاتجاه. توسيع قواعد استخدام المنتج داخل المحرك نفسه، دون قاموس موازٍ أو اتصال نموذج خارجي. لا نشر ولا تعديل المصدر أو الإنتاج ولا رسائل.']
 (out/'RIYADH-SUPPLIERS-BUYERS-EVIDENCE.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
 (out/'checksums.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.is_file() and p.name!='checksums.json'},indent=2))
 print({k:v for k,v in summary.items() if k not in ['cases','unlocated_source_candidates']})
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for key in ['db','node','source','index','geo','output']:p.add_argument('--'+key,required=True)
 a=p.parse_args();run(**vars(a))
