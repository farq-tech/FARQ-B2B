# coding: utf-8
"""Frozen source contradictions + measurable retrieval, never human precision claims."""
import argparse,json,csv,statistics,sqlite3,random,os,re
from collections import Counter
from pathlib import Path
BAD_ANCHORS={
 'coffee-purchase': [('masdaronline.com','TOOL_BITS_NOT_COFFEE'),('historical-source:STORE-fe62d3bef56a23ef9bcdb8af45458ee5','BREAKFAST_CEREAL_NOT_COFFEE')],
 'coffee-marketing':[('الصافنات لنقل الجامع والمدرسي','SCHOOL_TRANSPORT_NOT_CAFE')],
 'food-purchase':[('الهيئة العامة للغذاء والدواء','REGULATOR_NOT_FOOD_SELLER')],
 'plumbing-purchase':[('شركة فحص تسربات المياه: كشف وإصلاح فوري بأحدث التقنيات','REPAIR_SERVICE_NOT_MATERIALS'),('حلول التهوية الصناعية من شركة عالم التوريد – اطلب الآن','VENTILATION_NOT_WATER_PLUMBING')],
 'computers-marketing':[('معقب سريع للخدمات العامة','PRIVATE_AGENT_NOT_GOVERNMENT_OFFICE')],
 'software-marketing':[('معقب سريع للخدمات العامة','PRIVATE_AGENT_NOT_GOVERNMENT_OFFICE')],
 'legal-marketing':[('معقب سريع للخدمات العامة','PRIVATE_AGENT_NOT_GOVERNMENT_OFFICE')],
 'training-marketing':[('معقب سريع للخدمات العامة','PRIVATE_AGENT_NOT_GOVERNMENT_OFFICE')],
 'printing-marketing':[('معقب سريع للخدمات العامة','PRIVATE_AGENT_NOT_GOVERNMENT_OFFICE')],
 'software-partnership':[('قرطاسية ومكتبة نوف','STATIONERY_NOT_SOFTWARE_PARTNER'),('خدمات الطالب','STUDENT_STATIONERY_NOT_SOFTWARE_PARTNER')],
 'legal-partnership':[('استراحة مواسم','RECREATION_NOT_LEGAL_PARTNER'),('شاليهات ميلا الزهراء','CHALET_NOT_LEGAL_PARTNER')],
 'logistics-purchase':[('لمسات اليد الذهبية للزينة وتلميع السيارات','CAR_POLISHING_NOT_FREIGHT')],
 'training-purchase':[('تصليح ساعات','WATCH_REPAIR_NOT_TRAINING'),('أكاديمية النجوم الرياضية فرع طويق','SPORTS_NOT_VOCATIONAL_TRAINING')],
 'textiles-purchase':[('ورشة متنقلة لإصلاح السيارات','CAR_REPAIR_NOT_UNIFORM_SELLER'),('معرض فن اسدال لأقمشة الستائر والكنب والمجالس العربية واقمشة الخيام وبيوت الشعر واقمشة المجالس التراثيه','UPHOLSTERY_NOT_WORK_UNIFORM')],
 'agriculture-marketing':[('موقف سيارات','PARKING_NOT_PLANT_NURSERY')],
 'computers-availability':[('هدية اللؤلؤ','GIFT_SHOP_NOT_COMPUTER_SELLER'),('درعه','PERFUME_NOT_COMPUTER_SELLER'),('مكبت سالم للاستقدام','RECRUITMENT_NOT_COMPUTER_SELLER')],
}
BAD_ANCHORS.update({
 'legal-purchase': [('مطبعة السلامة','PRINTER_NOT_LEGAL_PROVIDER'),('مؤسسة صدر الإتقان للصيانة تكييف وتبريد','HVAC_REPAIR_NOT_LEGAL_PROVIDER')],
 'legal-partnership':BAD_ANCHORS['legal-partnership']+[('مطبعة السلامة','PRINTER_NOT_LEGAL_PARTNER'),('مؤسسة صدر الإتقان للصيانة تكييف وتبريد','HVAC_REPAIR_NOT_LEGAL_PARTNER')],
 'software-partnership':BAD_ANCHORS['software-partnership']+[('البنك السعودي للإستثمار','BANK_SOFTWARE_USE_NOT_SOFTWARE_SUPPLY'),('جمعية التنمية الأسرية للمساعدة على الزواج','CHARITY_NOT_SOFTWARE_SUPPLIER')],
 'computer-service':[('مطعم جودة التنور المأكولات البحرية','RESTAURANT_NOT_COMPUTER_REPAIR'),('البنك السعودي البريطاني','BANK_NOT_COMPUTER_REPAIR')],
 'dental-purchase':[('صيدلية المتحدة l فرش أسنان الأطفال','CONSUMER_TOOTHBRUSH_NOT_PROFESSIONAL_DENTAL_SUPPLY'),('صيدلية المتحدة l معجون أسنان الأطفال','CONSUMER_TOOTHPASTE_NOT_PROFESSIONAL_DENTAL_SUPPLY')],
 'uniform-maker':[('uniformsa | مصادر ومحلات الزي الموحد بالسعودية','DIRECTORY_NOT_UNIFORM_FACTORY')],
})
for key in ['software-purchase','software-partnership','software-restaurant','accounting-saas']:
 BAD_ANCHORS[key]=BAD_ANCHORS.get(key,[])+[('محاصيل تركيا للفواكه والخضروات','FOOD_RETAIL_NOT_SOFTWARE_SUPPLY'),('رباط المونسية','HOUSING_NOT_SOFTWARE_SUPPLY')]
BAD_ANCHORS['plumbing-purchase'] += [('كدن لتأجير السيارات','CAR_RENTAL_NOT_PLUMBING_SUPPLY'),('سهام لهدايا المواليد والمناسبات','BABY_GIFTS_NOT_PLUMBING_SUPPLY')]
BAD_ANCHORS['textiles-purchase'] += [('شركه البحر الاحمر للتأمين','INSURANCE_NOT_UNIFORM_SUPPLY')]
GOOD_ANCHORS={
 'coffee-purchase':['محمص الشنواني','bnfsjy.com'],
 'computers-purchase':['البداية الرقمية للحاسب الالي','واي تيك'],
 'plumbing-purchase':['شركة السقاف التجارية افضل شركة ادوات صحية','مؤسسة علي أحمد الهاشم التجارية , مواد سباكة و صحية وكهربائية'],
 'legal-purchase':['مكتب وليد الحمزة للمحاماة والاستشارات القانونية','مكتب الراشد للمحاماة والاستشارات القانونية'],
 'accounting-purchase':['شركة عبدالعزيز عبدالرحمن الجميعه محاسبون ومراجعون قانونيون'],
 'medical-purchase':['شركة عطاء الدولية لتجارة المستلزمات الطبية','مؤسسة المركز السعودي للوازم الطبية'],
 'medical-marketing':['مستوصف الجافل لطب الاسنان','المهيدب لطب الاسنان'],
 'plumbing-marketing':['ناصر المطيري للمقاولات','رواد الأعمال للمقاولات العامة'],
 'tourism-purchase':['الهدف للسفر والسياحة | حجز تذاكر طيران وعروض سياحية'],
 'software-purchase':['ميثود','تطبيق أتلانتس'],
}

# QA-only agreement checks, separate from implementation and not ground-truth labels.
SELLER_CHECKS={
 'computers':(r'computer store|computer wholesal',r'حاسب|كمبيوتر|computer'),
 'coffee':(r'roast|coffee supplier',r'محمص|قهوة|roast|coffee'),
 'plumbing':(r'plumbing|sanitary|أدوات صحية',r'سباك|أدوات صحية|plumbing'),
 'medical':(r'medical suppl|medical equipment|لوازم الطبية',r'طبية|medical'),
 'accounting':(r'accounting firm|accountant',r'محاسب|accountant|audit'),
 'software':(r'software company|software store',r'برمج|تقنية المعلومات|تقنيه المعلومات|software|information technology'),
 'legal':(r'law firm|legal services',r'محاما|قانون|law firm'),
 'logistics':(r'logistics|shipping|freight',r'شحن|نقل|لوجست|logistic|shipping'),
 'training':(r'training',r'تدريب|training'),
 'auto':(r'auto parts',r'قطع غيار|parts'),
 'textiles':(r'uniform',r'زي موحد|ملابس عمل|uniform'),
 'agriculture':(r'agricultur|fertilizer',r'زراع|أسمدة|مشتل|agricultur'),
 'hvac':(r'air conditioning|hvac|refrigeration',r'تكييف|تبريد|مكيف|hvac'),
 'printing':(r'print shop|printing',r'طبع|طباعة|طباعه|مطابع|print'),
 'dental':(r'dental',r'أسنان|اسنان|dental'),
 'insurance':(r'insurance',r'تأمين|تامين|insurance'),
 'tourism':(r'travel agency|tour operator',r'سفر|سياحة|سياحه|travel'),
 'telecom':(r'telecommunication|internet service',r'اتصالات|انترنت|telecom'),
 'security':(r'security guard|حراسه',r'حراس|حراسة|guard'),
 'waste':(r'recycling|waste management',r'نفايات|تدوير|recycl|waste'),
 'computer-service':(r'computer repair',r'صيانة|صيانه|حاسب|كمبيوتر|repair'),
}
BUYER_CHECKS={
 'computers':(r'school|university|college|corporate office',r'مدرسة|مدرسه|جامعة|جامعه|شركة|شركه|school|university'),
 'coffee':(r'cafe|coffee shop|restaurant',r'مقهى|مقهي|كوفي|قهوة|قهوه|مطعم|coffee|cafe'),
 'paper-cups':(r'cafe|coffee shop|restaurant',r'مقهى|مقهي|كوفي|قهوة|قهوه|مطعم|coffee|cafe'),
 'waiting':(r'clinic|hospital|service center',r'عياد|مستشف|مستوصف|clinic|hospital'),
 'dental':(r'dental clinic|dentist',r'أسنان|اسنان|dental'),
 'plumbing':(r'plumber|plumbing contractor|construction|contractor|maintenance',r'سباك|مقاول|تشطيبات|صيانة|صيانه|plumbing|contract'),
 'accounting':(r'restaurant|retail store|corporate office|factory|non profit',r'مطعم|متجر|شركة|شركه|مصنع|جمعية|جمعيه|company|restaurant'),
 'auto':(r'auto repair|car repair',r'ورشة|ورشه|سيارات|repair'),
}
def evidence_agreement(case,row):
 key=case['case_id'].rsplit('-',1)[0]
 if case['case_id']=='computer-service':key='computer-service'
 if key in ['computers-availability','computer','computer-goods']:key='computers'
 table=BUYER_CHECKS if case['direction']=='marketing' else SELLER_CHECKS
 checks=table.get(key)
 if not checks:return 'NO_INDEPENDENT_QA_RULE'
 body=row.get('evidence_excerpt','');name=row['name']
 if row.get('evidence_kind') in ['SAVED_COMMERCIAL_PAGE','STRUCTURED_SOURCE_CATALOG']:
  if re.search(checks[1],row.get('commercial_source_title','')+' '+body[:250],re.I):return 'SAVED_OFFER_TEXT_COMPATIBLE_NOT_VERIFIED'
 if re.search(checks[0],body,re.I) and re.search(checks[1],name,re.I):return 'NAME_AND_SOURCE_ACTIVITY_COHERENT_NOT_PROVEN'
 return 'SOURCE_ONLY_OR_UNCONFIRMED_QA_FIT'

def evaluate(before,after,root):
 root=Path(root);before=json.loads(Path(before).read_text());after=json.loads(Path(after).read_text());cases_before={c['case_id']:c for c in before['cases']};labels={};items=[];reviews=[];comparisons=[];plans={};examples=[]
 for case in before['cases']+after['cases']:
  for r in case['direct']+case['potential']:
   bad=next((reason for name,reason in BAD_ANCHORS.get(case['case_id'],[]) if r['name']==name),None)
   if bad:labels[(case['case_id'],r['source_entity_id'])]=('KNOWN_CONTRADICTION',bad)
   elif r['name'] in GOOD_ANCHORS.get(case['case_id'],[]):labels[(case['case_id'],r['source_entity_id'])]=('SOURCE_COMPATIBLE_CANDIDATE','Plausible source activity/offer; not legal, stock or current demand verification')
 def metrics(dataset):
  all_rows=[];top=[];valid_cases=0
  for c in dataset['cases']:
   rr=c['direct']+c['potential'];all_rows.extend((c,r) for r in rr);top.extend((c,r) for r in rr[:5])
   if any(labels.get((c['case_id'],r['source_entity_id']),('',))[0]=='SOURCE_COMPATIBLE_CANDIDATE' for r in rr):valid_cases+=1
  evidence=Counter(r.get('level','UNSPECIFIED') for c,r in all_rows);functions=Counter(r.get('commercial_function','NOT_RECORDED') for c,r in all_rows)
  violations=[{'case':c['case_id'],'name':r['name'],'source_id':r['source_entity_id'],'reason':labels[(c['case_id'],r['source_entity_id'])][1]} for c,r in all_rows if labels.get((c['case_id'],r['source_entity_id']),('',))[0]=='KNOWN_CONTRADICTION']
  top_labels=Counter(labels.get((c['case_id'],r['source_entity_id']),('NOT_INDEPENDENTLY_RATED',))[0] for c,r in top)
  elapsed=sorted(c['elapsed_ms'] for c in dataset['cases'])
  agreement=Counter(evidence_agreement(c,r) for c,r in top)
  useful_proxy=sum(any(evidence_agreement(c,r) in ['SAVED_OFFER_TEXT_COMPATIBLE_NOT_VERIFIED','NAME_AND_SOURCE_ACTIVITY_COHERENT_NOT_PROVEN'] and labels.get((c['case_id'],r['source_entity_id']),('',))[0]!='KNOWN_CONTRADICTION' for r in (c['direct']+c['potential'])[:5]) for c in dataset['cases'])
  directions={}
  for direction in ['purchase','marketing','availability','partnership']:
   selected=[c for c in dataset['cases'] if c['direction']==direction];rr=[r for c in selected for r in c['direct']+c['potential']]
   directions[direction]={'cases':len(selected),'nonempty':sum(bool(c['direct'] or c['potential']) for c in selected),'result_appearances':len(rr),'unique_provisional_entities':len({r['entity_id'] for r in rr}),'source_contact_presence_entities':len({r['entity_id'] for r in rr if r.get('contact_channels')}),'levels':dict(Counter(r.get('level','UNSPECIFIED') for r in rr))}
  return {'cases':len(dataset['cases']),'nonempty_cases':sum(bool(c['direct'] or c['potential']) for c in dataset['cases']),'cases_with_frozen_compatible_anchor':valid_cases,'cases_with_top5_evidence_consistency_proxy':useful_proxy,'top5_evidence_consistency_proxy':dict(agreement),'result_appearances':len(all_rows),'unique_provisional_entities':len({r['entity_id'] for c,r in all_rows}),'source_contact_presence_entities':len({r['entity_id'] for c,r in all_rows if r.get('contact_channels')}),'top5_result_appearances':len(top),'top5_frozen_labels':dict(top_labels),'known_contradiction_appearances':len(violations),'known_contradictions':violations,'evidence_levels':dict(evidence),'commercial_functions':dict(functions),'latency_cold_ms':{'median':round(statistics.median(elapsed),2),'p95':round(elapsed[min(len(elapsed)-1,int(.95*(len(elapsed)-1)))],2),'max':max(elapsed),'method':'Sequential real local cases including CPO; not load benchmark'},'by_direction':directions}
 bm=metrics(before);am=metrics(after)
 for c in after['cases']:
  b=cases_before[c['case_id']];assert (b['input_text'],b['direction'],b['requested_city'])==(c['input_text'],c['direction'],c['requested_city'])
  comparisons.append([c['case_id'],c['input_text'],c['direction'],len(b['direct']),len(b['potential']),len(c['direct']),len(c['potential']),b['elapsed_ms'],c['elapsed_ms']])
  for rank,r in enumerate(c['direct']+c['potential'],1):
   state=r['commercial_relationship']['evidence_state'];label=labels.get((c['case_id'],r['source_entity_id']),('NOT_INDEPENDENTLY_RATED',''))
   items.append([c['case_id'],rank,r['name'],r['entity_id'],r['source_entity_id'],r['role'],r.get('commercial_function'),r.get('level'),state,r.get('reason'),r.get('usage_reason'),r.get('evidence_excerpt'),r.get('source_ref') or r.get('source_url'),r.get('observed_at'),','.join(r.get('contact_channels',[])),label[0]])
   if rank<=5:reviews.append([c['case_id'],c['input_text'],c['direction'],r['name'],r.get('evidence_excerpt'),r.get('source_ref') or r.get('source_url'),r.get('observed_at'),'','',''])
   if r['reachability']['contact_completion_needed']:
    key=r['entity_id'];prior=plans.get(key)
    if not prior or (r.get('score') or 0)>(prior.get('score') or 0):plans[key]={'entity_id':key,'name_ar':r['commercial_identity']['display_name'],'city':r.get('city'),'requested_city':c['requested_city'],'city_basis':'SOURCE_RECORDED_NOT_LIVE_VERIFIED' if r.get('city') else 'USER_REQUEST_CONTEXT_ONLY','score':r.get('score') or 0,'reason':r.get('reason'),'goal':c['input_text'],'source_ref':r.get('source_ref') or r.get('source_url'),'reachability':{'contact_completion_needed':True},'source_phone_present':False,'source_email_present':False}
   if rank==1:examples.append({'case':c['case_id'],'goal':c['input_text'],'name':r['name'],'role':r['role'],'function':r.get('commercial_function'),'evidence_state':state,'reason':r.get('reason'),'source':r.get('source_ref') or r.get('source_url'),'excerpt':r.get('evidence_excerpt'),'date':r.get('observed_at')})
 random.Random(20261013).shuffle(reviews)
 for filename,header,rows in [('before-after-quality.csv',['case','query','direction','before_main','before_potential','after_main','after_potential','before_ms','after_ms'],comparisons),('results-with-evidence.csv',['case','rank','name','entity','source_id','role','function','level','evidence_state','reason','usage_reason','excerpt','source','date','channels','frozen_evaluation'],items),('blind-human-review.csv',['case','goal','objective','name','original_evidence','source','date','human_relevance','human_role','human_notes'],reviews)]:
  with (root/filename).open('w',encoding='utf-8-sig',newline='') as f:
   writer=csv.writer(f);writer.writerow(header);writer.writerows(rows)
 registry=os.environ.get('FARQ_COMMERCIAL_REGISTRY')
 if registry and Path(registry).is_file():
  db=sqlite3.connect(Path(registry).resolve().as_uri()+'?mode=ro',uri=True)
  for identity,row in plans.items():
   phone,email,website=db.execute('SELECT max(phone_present),max(email_present),max(website_present) FROM entity_sources WHERE entity_id=?',(identity,)).fetchone()
   row['existing_group_contact_presence']={'phone':bool(phone),'email':bool(email),'website':bool(website),'same_branch_confirmed':False}
   row['next_action']='REVIEW_EXISTING_SOURCE_CONTACT_FIRST' if phone or email or website else 'SERPER_SINGLE_SEARCH_PENDING_BUDGET'
   row['provider_allowed']=False
  db.close()
 import importlib.util
 p=Path(__file__).parents[1]/'goal-foundation/targeting/serper/plan.py';spec=importlib.util.spec_from_file_location('offline_plan',p);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 plan=module.plan(list(plans.values()));plan['identity_attempt_ledger']=str(root.parent/'commercial-enrichment-identity-attempts.db');(root/'serper-unapproved-priority-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
 (root/'frozen-evaluation-labels.json').write_text(json.dumps([{'case':case,'source_id':sid,'label':value[0],'reason':value[1],'method':'Explicit query/source contradiction or compatible source anchor; not independent human adjudication'} for (case,sid),value in labels.items()],ensure_ascii=False,indent=2))
 (root/'real-examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2))
 result={'before':bm,'after':am,'known_error_appearances_removed':bm['known_contradiction_appearances']-am['known_contradiction_appearances'],'human_validation':'PENDING_HUMAN_REVIEW','precision_recall':'NOT_ESTIMATED_WITHOUT_INDEPENDENT_LABELS','provider_calls':0,'messages_sent':0,'enrichment_plan_unique_identities':plan['businesses'],'enrichment_budget_approved':0}
 (root/'quality-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ['before','after']},ensure_ascii=False))
 if am['known_contradiction_appearances']:raise AssertionError('KNOWN_REAL_SOURCE_CONTRADICTION_REGRESSION: '+json.dumps(am['known_contradictions'],ensure_ascii=False))
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for arg in ['before','after','root']:p.add_argument('--'+arg,required=True)
 evaluate(**vars(p.parse_args()))
