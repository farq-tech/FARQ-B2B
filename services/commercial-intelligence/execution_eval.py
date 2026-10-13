# coding: utf-8
"""Same real goals and assets before/after; no sends or provider requests."""
import argparse,sys,json,time
from pathlib import Path
CASES=[('computers','أجهزة كمبيوتر'),('coffee','حبوب البن'),('food','مواد غذائية'),('plumbing','مواد سباكة'),('medical','مستلزمات طبية'),('accounting','خدمات محاسبة'),('software','برامج محاسبة'),('legal','استشارات قانونية'),('marketing','تسويق رقمي'),('logistics','خدمات شحن'),('training','تدريب مهني'),('auto','قطع غيار سيارات'),('textiles','ملابس عمل وزي موحد'),('agriculture','أسمدة وبذور'),('hvac','أجهزة تكييف'),('printing','مطبوعات وخدمات طباعة')]
def run(module_root,db,index,geo,node,source,out,extra=False):
 import os
 os.environ.update(FARQ_PRAGMATIC_MATCHING='1',FARQ_GOLDEN_INDEX=index,FARQ_GEO_CANDIDATE=geo)
 sys.path.insert(0,str(Path(module_root)/'services/commercial-intelligence'))
 from core import Knowledge,CpoPort
 port=CpoPort(node,source);k=Knowledge(db,port);results=[]
 inputs=[Path(db),Path(index),Path(geo)];before=[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs]
 goals=[(key+'-'+direction,('أبيع ' if direction=='marketing' else 'أحتاج ')+text,direction,'الرياض') for key,text in CASES for direction in ['purchase','marketing']]
 goals += [('legal-partnership','أبحث عن شريك للاستشارات القانونية','partnership','الرياض'),('software-partnership','أبحث عن شريك برمجيات وأنظمة أعمال','partnership','الرياض'),('computers-availability','استفسر عن توفر أجهزة كمبيوتر','availability','الرياض'),('explicit-new-item','أبيع عبوات زجاجية وأستهدف المطاعم','marketing','الرياض'),('medical-jeddah','أحتاج مستلزمات طبية','purchase','جدة'),('software-dammam','أبيع برامج محاسبة','marketing','الدمام'),('pipe-camera','كاميرا فحص الأنابيب','purchase','الرياض'),('door-elbow','PVC Door Elbow 110 mm','purchase','الرياض'),('wpc','أحتاج باب WPC سماكة 6 سم','purchase',''),('proven-only','أبيع مواد سباكة وأريد طلب شراء موثق','marketing','الرياض')]
 if extra:
  from quality_cases import EXTRA_GOALS
  goals+=EXTRA_GOALS
 try:
  for key,text,direction,city in goals:
   t=time.perf_counter();r=k.search(text,direction,city,'local-review:execution',20,key=='proven-only');r.update(case_id=key,input_text=text,direction=direction,requested_city=city,elapsed_ms=round((time.perf_counter()-t)*1000,3));results.append(r)
   print(key,len(r['direct']),len(r['potential']),flush=True)
  assert all(not r['execution_enabled'] and r.get('messages_sent',0)==0 for r in results)
  assert before==[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs]
  payload={'case_runs':len(results),'source_stats_unchanged':True,'provider_calls':0,'messages_sent':0,'independent_human_validation':'PENDING_HUMAN_REVIEW','cases':results}
  Path(out).write_text(json.dumps(payload,ensure_ascii=False,indent=2));return payload
 finally:port.close()
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for arg in ['module-root','db','index','geo','node','source','out']:p.add_argument('--'+arg,required=True)
 p.add_argument('--extra',action='store_true')
 run(**vars(p.parse_args()))
