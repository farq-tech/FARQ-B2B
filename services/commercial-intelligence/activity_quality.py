# coding: utf-8
"""Explainable eligibility checks within the existing pragmatic core, never source edits.
Confidence is relative rule strength, not calibrated probability or legal verification.
"""
import re
from functools import lru_cache
from identity import normalize
SECTORS={
 'school_transport':r'school transport|نقل مدرسي|لنقل الجامع|لنقل المدرسي',
 'food_service':r'restaurant|cafe|coffee shop|cafeteria|مطعم|مطاعم|مقه[ىي]|كافتيريا',
 'software':r'software|برمج|تطوير برامج',
 'computer_trade':r'computer (?:store|wholesal|supplier)|متجر (?:كمبيوتر|حاسب)|اجهزه كمبيوتر|بيع.{0,15}كمبيوتر',
 'computer_repair':r'computer repair|صيانه.{0,12}(?:كمبيوتر|حاسب)|اصلاح.{0,12}كمبيوتر',
 'accounting':r'accountant|accounting firm|bookkeeping|محاسب|مسك دفاتر',
 'legal':r'law firm|legal services|محاما|استشارات (?:ال)?قانون',
 'medical_care':r'clinic|hospital|مستشف[ىي]|عياد|مستوصف',
 'dental':r'dental|dentist|اسنان',
 'medical_trade':r'medical (?:supply|equipment)|مستلزمات طبي|معدات طبي',
 'pharmacy':r'pharmac|drug store|صيدلي',
 'plumbing_trade':r'plumbing suppl|sanitary|ادوات صحي|ادوات سباك|مواد سباك',
 'plumbing_service':r'plumber|plumbing contractor|سباك|صيان.{0,12}(?:سباك|مبان)|تشطيبات',
 'construction':r'construction|contractor|contracting|مقاول|انشاءات',
 'engineering':r'engineering consultant|استشارات هندسي|للاستشارات الهندسي',
 'auto_service':r'auto repair|car repair|car service|automotive services|tire repair|ورشه.{0,35}سيارات|اصلاح.{0,15}سيارات|صيانه سيارات|ميكانيكا سيارات|خدمات السيارات|تلميع السيارات|زينة السيارات',
 'auto_trade':r'auto parts|car parts|قطع غيار سيارات',
 'logistics':r'logistics|freight|shipping company|لوجست|للشحن|خدمات شحن',
 'clothing_retail':r'clothing store|clothes shop|متجر ملابس|ملابس نسائي|ملابس رجالي',
 'uniforms':r'uniform|زي موحد|ملابس عمل',
 'textile':r'textile|fabric store|اقمشه|نسيج',
 'education':r'school|university|college|مدرسه|جامع[ه]|كليه|research institute|مركز ابحاث',
 'training':r'training|تدريب',
 'coffee_trade':r'coffee (?:supplier|wholesaler|roaster)|roaster|محمص|حبوب (?:القهوه|البن)',
 'agriculture':r'farm|agricultur|fertilizer|nursery|زراع|مزرعه|اسمده|مشاتل',
 'hotel':r'hotel|فندق|فنادق|استراحه|شاليهات',
 'office':r'corporate|الشركات|مكتب الشركات|business (?:center|office)|مكتب شركات|شركه',
 'retail_food':r'grocery|supermarket|foodstuff|بقال|تموين|اغذي',
 'marketing':r'marketing agency|advertising|تسويق|دعايه|اعلان',
 'hvac':r'hvac|air conditioning|refrigeration|تكييف|مكيف|تبريد',
 'printing':r'print shop|printing|مطبعه|مطابع|طباعه|خدمات الطالب',
 'cleaning':r'cleaning|janitorial|detergent|نظاف|منظفات',
 'packaging':r'packaging|paper products|تغليف|عبوات|اكواب',
 'furniture':r'furniture|اثاث|مفروشات',
 'water':r'bottled water|مياه شرب|مصنع مياه',
 'electrical':r'electrical|كهربا|كيبل|كابل',
 'steel':r'steel|metal supplier|حديد|معادن',
 'paint':r'paint|دهانات|بويه',
 'stationery':r'stationery|قرطاسي',
 'hr':r'recruitment|staffing|employment agency|موارد بشري|توظيف|استقدام',
 'beauty':r'beauty|spa|barber|صالون|حلاق|عطور|الجمال والعنايه',
 'real_estate':r'real estate|عقار',
 'nonprofit':r'non profit|charity|جمعيه|خيريه',
 'government':r'government office|جهات حكوميه|وزاره',
 'watch_repair':r'watch repair|تصليح ساعات|اصلاح ساعات',
 'parking':r'parking|موقف سيارات',
 'financial':r'bank|financial|بنك|بنوك|تمويل|خدمات ماليه',
 'insurance':r'insurance|تامين',
 'tourism':r'travel agency|tour operator|سياح|وكاله سفر',
 'telecom':r'telecommunicat|internet service|خدمات اتصالات',
 'security':r'security|حراسه|امن منشات',
 'waste':r'waste|recycl|نفايات|تدوير',
 'general_retail':r'shopping|retail|التسوق|متجر عام',
 'home_goods':r'home goods|home builder|matress|mattress|مستلزمات منزليه|مراتب|ستائر|اقمشه الكنب',
 'industrial':r'industrial manufacturer|industrial equipment|معدات صناعيه|تصنيع صناعي',
 'doors_windows':r'door shop|window supplier|ابواب|نوافذ',
 'tailoring':r'tailor|خياط',
 'metal_work':r'blacksmith|metal workshop|حداد|ورشه معادن',
 'sports':r'sport|gym|fitness|رياضي|لياقه',
 'leisure':r'camping|amusement|ترفيه|تخييم|كشته',
 'laundry':r'laundry|مغسله ملابس|غسيل ملابس',
 'transport':r'transport|نقل بضايع|نقل ركاب',
 'electronics':r'electronic|الكترونيات|appliance|اجهزه منزليه',
 'pet':r'pet shop|veterinar|بيطر|حيوانات اليفه',
 'childcare':r'child care|kindergarten|حضانه|روضه اطفال',
 'energy':r'energy|solar|طاقه|شمسيه',
 'mining':r'mining|quarry|تعدين|محاجر',
 'media':r'media|film|production studio|انتاج اعلامي|تصوير',
}
COMPILED={k:re.compile(v) for k,v in SECTORS.items()}
# Explicit contradictions, not blanket exclusion of multi-activity businesses.
CONFLICTS={'food_service':{'school_transport','auto_service','computer_repair','engineering','pharmacy','logistics'},'education':{'food_service','beauty','auto_service','engineering'},'software':{'food_service','beauty','pharmacy','auto_service','stationery','printing','financial','nonprofit'},'computer_repair':{'food_service','financial','medical_care','beauty'},'computer_trade':{'food_service','beauty','pharmacy','hotel'},'accounting':{'engineering','food_service','auto_service','leisure'},'logistics':{'auto_service','beauty','food_service','medical_care'},'legal':{'engineering','food_service','beauty','hotel','leisure','stationery','printing','hvac'},'medical_trade':{'food_service','engineering','beauty','real_estate'},'uniforms':{'beauty','pharmacy','auto_service','home_goods'},'training':{'beauty','auto_service','leisure','watch_repair'},'agriculture':{'parking'},'security':{'medical_care','computer_trade','software','food_service'},'telecom':{'sports','medical_care','food_service'},'tourism':{'furniture','home_goods'},'insurance':{'food_service','auto_service'}}
ROLE_PATTERNS={
 'regulator':r'regulatory|regulator|هي(?:ئ|ي)ه.{0,25}(?:غذاء|دواء|تنظيم|رقابه|مواصفات)|وزارة|وزاره|sfda|saso',
 'educational_research':r'university|school|college|research institute|جامعه|مدرسه|كليه|مركز ابحاث',
 'publisher_information':r'مجله|موسوعه|صحيفه|اخبار|news|magazine|encyclopedia|information portal|blog',
 'marketplace_intermediary':r'marketplace|سوق الكتروني|منصه تجاره|دليل الموردين|supplier directory',
 'manufacturer':r'manufacturer|manufacturing|مصنع|للتصنيع',
 'distributor':r'distributor|wholesaler|توزيع|موزع|بالجمله',
 'service_provider':r'service|repair|consult|contractor|خدمات|صيانه|استشارات|مقاول|محاما|محاسب',
 'seller':r'store|shop|supplier|trading|متجر|تجاره|توريد|بيع',
}
ROLE_COMPILED={k:re.compile(v) for k,v in ROLE_PATTERNS.items()}

@lru_cache(maxsize=20000)
def sectors(value):
 text=normalize(value)
 return [k for k,p in COMPILED.items() if p.search(text)]

def assessment(name,activity,description='',source='GOLDEN_SOURCE_ACTIVITY'):
 ns=sectors(name);acts=sectors(activity);desc=sectors(description)
 scores=[];conflicts=[]
 for sector in set(acts+ns+desc):
  origins=[];strength=0
  if sector in acts:strength=.55;origins.append({'type':'SOURCE_CATEGORY','value':activity,'weight':.55,'source':source})
  if sector in ns:strength=max(strength,.2)+(.15 if sector in acts else 0);origins.append({'type':'NAME_SIGNAL_NOT_PROOF','value':name,'weight':.2})
  if sector in desc:strength=max(strength,.8);origins.append({'type':'SAVED_DESCRIPTION','value':description[:300],'weight':.8})
  opposing=CONFLICTS.get(sector,set()) & set(ns+acts)
  if opposing and sector not in desc:
   conflicts.append({'activity':sector,'opposing_signals':sorted(opposing),'opposing_name_signals':sorted(set(ns)&opposing),'reason':'SOURCE_CATEGORY_CONTRADICTS_EXPLICIT_NAME_SIGNAL_REQUIRES_INDEPENDENT_SUPPORT'})
   strength=max(.1,strength-.4)
  scores.append({'activity':sector,'relative_confidence':round(min(.95,strength),3),'basis':origins,'name_agreement':sector in ns,'description_agreement':sector in desc})
 scores.sort(key=lambda s:(-s['relative_confidence'],s['activity']))
 roles=[role for role,p in ROLE_COMPILED.items() if p.search(normalize(name+' '+activity))]
 return {'commercial_name':name,'primary_activity':scores[0]['activity'] if scores and scores[0]['relative_confidence']>=.5 else None,'secondary_activities':[s['activity'] for s in scores[1:] if s['relative_confidence']>=.5],'original_source_categories':[{'source':source,'value':activity}],'activity_candidates':scores,'conflicts':conflicts,'institutional_role_candidates':roles,'confidence_method':'RELATIVE_HEURISTIC_NOT_CALIBRATED','name_alone_is_proof':False}

SERVICE_KEYS={'computer_repair','insurance','tourism','telecom','security_services','waste','accounting','legal','software','marketing_services','logistics','training','hr','printing'}
KEY_SECTOR={'security_services':'security','telecom':'telecom','insurance':'insurance','tourism':'tourism','computer_repair':'computer_repair','training':'training','agriculture':'agriculture','computers':'computer_trade','coffee':'coffee_trade','accounting':'accounting','software':'software','legal':'legal','logistics':'logistics','medical':'medical_trade','dental':'dental','textiles':'uniforms'}

def eligibility(text,key,direction,name,activity='',description='',independent_offer=False):
 q=normalize(text);n=normalize(name);a=normalize(activity);data=assessment(name,activity,description)
 roles=data['institutional_role_candidates'];bad=[]
 if direction=='marketing':
  buyer_sectors={'coffee':{'food_service','hotel'},'packaging':{'food_service','retail_food'},'computers':{'office','education','government'},'chairs':{'medical_care','government'},'plumbing':{'plumbing_service','construction'},'accounting':{'office','food_service','industrial','nonprofit','general_retail'}}
  relevant=set(sectors(activity)) & buyer_sectors.get(key,set(sectors(activity)))
  conflicted={c['activity'] for c in data['conflicts']}
  if relevant and not (relevant-conflicted):bad.append('NO_COMPATIBLE_USE_AFTER_SOURCE_CONFLICT_CHECK')
 if direction in ['purchase','availability','partnership']:
  target=KEY_SECTOR.get(key)
  bad.extend(c['reason'] for c in data['conflicts'] if c['activity']==target and not independent_offer)
  if 'regulator' in roles and not independent_offer:bad.append('REGULATOR_NOT_COMMERCIAL_SELLER')
  if 'publisher_information' in roles and not independent_offer:bad.append('PUBLISHER_NOT_COMMERCIAL_SELLER')
  if 'educational_research' in roles and key not in ['training'] and not independent_offer:bad.append('EDUCATION_RESEARCH_NOT_PRODUCT_SELLER')
  if key=='computers' and re.search(r'computer repair|صيانه.{0,15}(?:كمبيوتر|حاسب)',n+' '+a) and not re.search(r'computer (?:store|wholesal)|بيع|متجر',a):bad.append('COMPUTER_REPAIR_NOT_GOODS_SALE')
  if key=='accounting' and re.search(r'software|برمج|نظام محاسب|سوفت',n+' '+a) and not re.search(r'accounting firm|مكتب.{0,15}محاسب|محاسبون',n+' '+a):bad.append('ACCOUNTING_SOFTWARE_NOT_ACCOUNTING_SERVICE')
  if key=='training' and re.search(r'مهني|vocational|اداري|وظيفي',q) and re.search(r'رياضي|sport|fitness|gym',n+' '+a):bad.append('SPORTS_TRAINING_NOT_VOCATIONAL_SERVICE')
  if key=='dental' and not re.search(r'dental|اسنان',n+' '+a+' '+normalize(description)):bad.append('GENERAL_MEDICINE_NOT_DENTAL_SPECIALTY')
  if key=='textiles' and re.search(r'زي موحد|ملابس عمل|uniform|workwear',q) and re.search(r'ستائر|كنب|curtain|upholstery',n+' '+a) and not re.search(r'uniform|زي موحد|ملابس عمل',a):bad.append('UPHOLSTERY_FABRIC_NOT_WORK_UNIFORM')
  if key=='textiles' and re.search(r'مصنع|تصنيع|manufactur',q) and not re.search(r'uniform manufactur|clothing manufactur|مصنع.{0,35}(?:زي|ملابس)|تصنيع.{0,20}(?:زي|ملابس)',n+' '+a+' '+normalize(description)):bad.append('SPECIFIC_UNIFORM_MANUFACTURE_NOT_SUPPORTED')
  if key=='logistics' and re.search(r'auto repair|car repair|صيانه سيارات|ورشه سيارات',n+' '+a) and not independent_offer:bad.append('AUTO_MAINTENANCE_NOT_FREIGHT_SERVICE')
 if direction=='marketing' and 'government office' in a and re.search(r'معقب|تعقيب|خدمات عامه',n):bad.append('PRIVATE_AGENT_NOT_GOVERNMENT_PRODUCT_USER')
 role='user_potential' if direction=='marketing' else 'partner_potential' if direction=='partnership' else 'service_provider' if key in SERVICE_KEYS else 'seller'
 if direction not in ['marketing','partnership']:
  if 'service_provider' in roles and 'seller' not in roles:role='service_provider'
  for r in ['regulator','publisher_information','marketplace_intermediary','manufacturer','distributor','educational_research']:
   if r in roles:role=r;break
 return {'eligible':not bad,'reasons':list(dict.fromkeys(bad)),'activity_assessment':data,'commercial_function':role,'independent_offer_support':independent_offer}

def offer_conflict(text,key,title,body,source_url=''):
 q=normalize(text);t=normalize(title);b=normalize(body)
 if re.search(r'مصادر ومحلات|دليل (?:مورد|مصانع)|supplier directory',t):return 'DIRECTORY_NOT_COMMERCIAL_SELLER'
 if key=='dental' and re.search(r'معجون|فرش.{0,12}اسنان|toothpaste|toothbrush',t) and not re.search(r'معجون|فرش.{0,12}اسنان|toothpaste|toothbrush',q):return 'CONSUMER_ORAL_CARE_NOT_PROFESSIONAL_DENTAL_SUPPLY'
 if key=='textiles' and re.search(r'مصنع|manufactur',q) and not re.search(r'مصنع.{0,45}(?:زي|ملابس)|uniform manufacturer|نحن.{0,30}(?:نصنع|مصنع)|مصنعنا',t+' '+b):return 'UNIFORM_STORE_OR_DIRECTORY_NOT_MANUFACTURER'
 if key=='coffee':
  if re.search(r'cereal|breakfast|screw|drill|driver bit|حبوب (?:ال)?افطار|مفك|لقمه مثقاب',t):return 'COFFEE_NOT_CEREAL_OR_TOOL_BITS'
  if not re.search(r'coffee|قهوه|حبوب البن|\bبن\b',t) and not re.search(r'(?:حبوب.{0,15}(?:قهوه|البن)|coffee beans).{0,70}(?:جمله|تجزيه|بيع|wholesale|sale)',b):return 'COFFEE_PRODUCT_NOT_IN_TITLE'
 if key=='computers' and re.search(r'repair|maintenance|صيانه|اصلاح',t) and not re.search(r'computer (?:desktop|laptop)|كمبيوتر.{0,15}(?:مكتبي|محمول)',t):return 'COMPUTER_REPAIR_NOT_GOODS_SALE'
 if key=='dental' and not re.search(r'dental|dentist|اسنان',t):return 'GENERAL_MEDICINE_NOT_DENTAL_PRODUCT'
 if key=='textiles' and re.search(r'uniform|زي موحد|ملابس عمل',q) and not re.search(r'uniform|workwear|زي موحد|ملابس عمل',t):return 'CLOTHING_NOT_UNIFORM_PRODUCT'
 if key=='plumbing' and re.search(r'تهويه|ventilation|air duct|hvac',t) and not re.search(r'سباك|مياه|water pipe|plumbing',t):return 'VENTILATION_NOT_PLUMBING_MATERIAL'
 if key=='plumbing' and re.search(r'فحص تسرب|كشف تسرب|اصلاح|leak detection|repair',t) and not re.search(r'متجر|بيع|توريد|shop|sale|supply',t):return 'PLUMBING_REPAIR_NOT_MATERIALS_OFFER'
 if key=='hvac' and re.search(r'امن|امني|security|smart home',t) and not re.search(r'مكيف|تكييف|hvac|air conditioning',t):return 'SECURITY_SYSTEM_NOT_AIR_CONDITIONER'
 if key=='logistics' and re.search(r'auto|vehicle|maintenance|manufactur|سيارات|مركبات|صيانه',t):return 'VEHICLE_MAINTENANCE_NOT_FREIGHT_SERVICE'
 # A factual article/product mention is not a commercial offer. Keep history as history.
 if re.search(r'what is|how to|benefits of|news|article|فوائد|ما هي|ما هو|مقال|اخبار',t):return 'INFORMATIONAL_MENTION_NOT_COMMERCIAL_OFFER'
 if re.search(r'\.gov\.sa(?:/|$)',source_url) and not re.search(r'بيع|متجر|sale|shop',t):return 'REGULATOR_INFORMATION_NOT_OFFER'
 return None

def usage_priority(key,activity,name=''):
 a=normalize(activity);n=normalize(name)
 rules={
  'packaging':[(r'cafe|coffee shop|cafeteria|مقه|كافتيريا',1,'استخدام متكرر محتمل لتقديم المشروبات'),(r'restaurant|مطعم|bakery|مخبز',.85,'استخدام محتمل للتقديم والتعبئة')],
  'chairs':[(r'medical clinic|hospital|عياد|مستشف',1,'مناطق انتظار العملاء والمرضى'),(r'service center|مركز خدم',.8,'انتظار المراجعين')],
  'plumbing':[(r'plumbing contractor|plumber|سباك|تشطيبات|building maintenance|صيانه مباني',1,'استخدام مرتبط بأعمال السباكة والصيانة'),(r'construction|contractor|مقاول',.75,'استخدام محتمل في المشاريع؛ لا مشاريع حالية مثبتة')],
  'computers':[(r'school|university|college|مدرسه|جامعه|كليه',1,'استخدام تعليمي وإداري'),(r'corporate office|business office|مكتب شركات',.8,'استخدام مكتبي محتمل'),(r'government office',.6,'استخدام إداري محتمل؛ الاعتماد غير مفحوص')],
  'accounting':[(r'small business|restaurant|retail store|non profit|مطعم|متجر|جمعيه',1,'قد تستعين بمحاسبة خارجية؛ الحجم غير مؤكد'),(r'factory|مصنع',.8,'عمليات مالية محتملة'),(r'corporate office|company|شركه',.55,'احتمال عام؛ لا دليل استعانة خارجية')],
  'software':[(r'corporate office|school|hospital|restaurant|شركه|مدرسه|مطعم',.8,'استخدام أنظمة أعمال محتمل')],
 }
 choices=[(priority,reason) for pattern,priority,reason in rules.get(key,[]) if re.search(pattern,a)]
 if not choices:return .45,'استخدام تجاري ممكن من النشاط؛ الكثافة غير معلومة'
 return max(choices,key=lambda x:x[0])
