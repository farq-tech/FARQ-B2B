"""Existing relationship/evidence interpretation over the original Golden Parquet, read-only."""
import ast,re,os,json,sqlite3
from functools import lru_cache
from datetime import datetime,timezone
from pathlib import Path
from identity import stable_id,normalize
from pragmatic import score

@lru_cache(maxsize=1)
def pure_functions():
 original=Path(__file__).parents[1]/'goal-foundation/targeting/trial_search.py';nodes=[]
 for node in ast.parse(original.read_text()).body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['AR','PROFILES','STOP','ACTIVITY_ALIASES'] for t in node.targets):nodes.append(node)
  if isinstance(node,ast.AugAssign) and isinstance(node.target,ast.Name) and node.target.id=='PROFILES':nodes.append(node)
  if isinstance(node,ast.FunctionDef) and node.name in ['norm','interpret','contains','evidence','buyer_intent','activity_terms']:nodes.append(node)
 env={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(original),'exec'),env);return env

def activity_conflict(name,activity,intent,text,direction):
 n=normalize(name);a=normalize(activity);q=normalize(text)
 if n in ['false','true','none','null','تموينات','بقاله','صيدليه','دهان مباني','ورشه','شركه']:return True
 # Explicit incompatible names and category conflicts stay in source; retrieval abstains.
 if intent.get('key') not in ['legal','marketing_services','logistics','training','accounting','hr','software','buyer_activity'] and re.search(r'حلاق|حلاقه|صالون|تصليح ساعات|ساعات|عطور|عطر|عقار|عقارات|نقل مدرسي|نقل الجامع|لنقل|معقب|خدمات عامه|law firm|مكتب محام',n):return True
 if intent.get('key')=='legal' and re.search(r'هندسي|engineering',n):return True
 if direction=='purchase':
  key=intent.get('key')
  if key=='legal' and re.search(r'استراح|متنزه|حدايق|hookah|park|صالون|مطعم|الفنادق',n+' '+a):return True
  if key=='software' and re.search(r'قرطاسي|مكتبه|صيدلي|مغسله|حلاق|perfume|cosmetic|صيدليات',n):return True
  if key=='accounting' and re.search(r'computer store|software company|software store|برمجيات|هندسي|engineering',a+' '+n):return True
  if key=='logistics' and re.search(r'مطعم|حلاق|صيدلي|perfume|cosmetic|ورشه|صيانه الالكترونيات',n):return True
  if key=='computers' and re.search(r'شحن|shipping|سفر|سياح|مغاسل|مغسله|حفلات|مناسبات|مقاولات|استقدام',n):return True
  if key=='computers' and not re.search(r'computer store|computer wholesal|متجر كمبيوتر|متجر حاسب|بيع.*(?:كمبيوتر|حاسب)',a+' '+n):return True
  if key=='computers' and re.search(r'هديه|هدايا|درعه|bowling|football|perfume|gifts|متجر عطور',n+' '+a):return True
  if key=='coffee' and re.search(r'lamb|grilled|sikhs|مشويات|لحم',n):return True
  if key=='furniture' and re.search(r'صيدلي|زراعي|الحدايق|garden furniture|bedroom',n+' '+a):return True
  if key=='plumbing' and re.search(r'بطاريات|بروستد|مطاعم|restaurants|الفنادق|hotels',n+' '+a):return True
  if key=='steel' and re.search(r'سيارات|auto machine|auto electrical|diesel|بلاستيك|خشبيه|wood',n+' '+a):return True
  if key=='medical' and re.search(r'مخطط|الفنادق|hotel|nurseries|telecommunication|mechanical engineering',n+' '+a):return True
  if key=='medical' and re.search(r'طاقه|energy|للتعمير|محام|law firm|construction|renewable',n+' '+a):return True
  if key=='packaging' and re.search(r'تغليف الهدايا|تغليف المركبات|gift wrapp|vehicle wrapp|automotive',n+' '+a):return True
  if key=='packaging' and re.search(r'عقار|real estate|فطاير|فطائر|بيتزا|مطعم|restaurant',n+' '+a):return True
  if key=='kitchen' and re.search(r'مطابخ سحابيه|shared.use commercial kitchen|electrician|electrical products',n+' '+a):return True
  if key=='cables' and not re.search(r'electrical suppl|electrical equipment suppl|electric material|ادوات كهرباييه|ادوات كهربائيه|electrical_hardware|كابلات|اسلاك|كيبل|كابل',a+' '+n):return True
  if key=='cables' and re.search(r'مرافق الكهرباء|خدمات كهرباء|electric utility|beauty product|airport shuttle',n+' '+a):return True
  if key=='water' and re.search(r'water tank cleaning|تنظيف خزانات',a):return True
  if key=='paint' and re.search(r'سفر|سياحه|رخام|حجر|travel agency|stone',n+' '+a):return True
  if key=='paint' and re.search(r'سيارات|car rental|automotive|خدمات السيارات|جير الي',n+' '+a):return True
  if key=='paint' and re.search(r'معلم|مقاول|painting service|hotel|الفنادق',n+' '+a):return True
 else:
  if re.search(r'سباك|حديد|دهان|كابل|كيبل',q) and re.search(r'حفلات|منسق حفلات|sheet metal|صفايح|للرعايه|الرعايه الصحيه|مطابخ|صيانه طفايات|صيان.*طفايات|event management|خدمات السيارات|مقاول صفايح|law firm',n+' '+a):return True
  if re.search(r'سباك|حديد|دهان|كابل|كيبل',q) and re.search(r'لوجست|logistic|للشحن|shipping|pharmacy|صيدليه|نقل',n+' '+a):return True
  if re.search(r'سباك|حديد|دهان|كابل|كيبل',q) and re.search(r'training center|الجمال|beauty|barber|flooring|interior decorator|مقاول ارضيات',a):return True
  if re.search(r'نظافه',q) and re.search(r'مغسله|مغسلة|تنظيف الملابس|laundry|التموينات',n+' '+a):return True
 return False

def candidates(knowledge,text,direction,city,limit):
 path=os.environ.get('FARQ_GOLDEN_DIRECTORY')
 index=os.environ.get('FARQ_GOLDEN_INDEX')
 if not (index and Path(index).is_file()) and (not path or not Path(path).is_file()):return []
 functions=pure_functions();intent=functions['buyer_intent'](text) if direction=='marketing' else functions['interpret'](text)
 role_unresolved=False
 if direction=='marketing' and not intent['seller']:
  intent=functions['interpret'](text);role_unresolved=True
 terms=intent['seller'] or intent['product']
 if not terms:return []
 query=' OR '.join("regexp_replace(translate(lower(concat_ws(' ',category,category_ar,secondary_category,category_l3,google_category,name_ar,name_en)), 'أإآةىؤئ', 'اااهيوي'), '[ً-ْـ]', '', 'g') LIKE ?" for _ in terms)
 con=None
 aliases=[city]+[a for a in knowledge.city_aliases if knowledge.city_matches(city,a)] if city else []
 city_sql=' AND (lower(city_ar) IN ('+','.join('?' for _ in aliases)+') OR lower(city_en) IN ('+','.join('?' for _ in aliases)+'))' if aliases else ''
 params=[path]+['%'+term+'%' for term in terms]+([a.lower() for a in aliases]*2)
 sql="""SELECT poi_key,coalesce(nullif(name_ar,''),name_en) AS display_name,coalesce(city_ar,city_en) city,coalesce(district_ar,district_en) district,concat_ws(' ',category,category_ar,secondary_category,category_l3,google_category) activity,website,updated_at,phone,email,lifecycle_state,company_status,is_landmark FROM read_parquet(?) WHERE ("""+query+") AND poi_key IS NOT NULL"+city_sql+" ORDER BY poi_key LIMIT 3000"
 try:
  if index and Path(index).is_file():
   local=sqlite3.connect(Path(index).resolve().as_uri()+'?mode=ro',uri=True);local.execute('PRAGMA query_only=ON')
   city_filter=' AND lower(p.city) IN ('+','.join('?' for _ in aliases)+')' if aliases else ''
   clause=' OR '.join('"'+term.replace('"','')+'"' for term in terms)
   has_triage=bool(local.execute("SELECT 1 FROM sqlite_master WHERE name='triage'").fetchone())
   triage_join=" JOIN triage t ON t.poi_key=p.poi_key AND t.inactive=0 AND t.class NOT IN ('GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE')" if has_triage else ''
   raw=local.execute('SELECT p.* FROM profile_search f JOIN profiles p ON p.poi_key=f.poi_key'+triage_join+' WHERE profile_search MATCH ?'+city_filter+' ORDER BY bm25(profile_search) LIMIT 3000',[clause]+[a.lower() for a in aliases]).fetchall()
   data=[(key,name,sourcecity,district,activity,website,date,'phone' in json.loads(channels),'email' in json.loads(channels),lifecycle,company,landmark) for key,name,sourcecity,district,activity,website,date,channels,lifecycle,company,landmark in raw];local.close()
  else:
   import duckdb
   con=duckdb.connect();con.execute("SET threads=2;SET memory_limit='512MB'")
   data=con.execute(sql,params).fetchall()
  result=[];knowledge.last_directory_exclusions=[]
  for key,name,sourcecity,district,activity,website,date,phone,email,lifecycle,company,landmark in data:
   combined=normalize(str(name or '')+' '+str(activity or ''))
   if re.search(r'كاميرا|camera',normalize(text)) and re.search(r'انابيب|انبوب|pipe',normalize(text)) and not re.search(r'camera|كاميرا|فحص الانابيب|pipe inspection',combined):continue
   if re.search(r'ابواب|باب|doors?',normalize(text)) and not re.search(r'hinge|elbow|مفصل|اكواع',normalize(text)) and re.search(r'hinge|elbow|مفصل|مقابض فقط',combined):continue
   if not name or str(landmark).lower() in ['true','1','yes'] or normalize(lifecycle) in ['closed','permanently closed'] or normalize(company) in ['inactive','cancelled','ملغي'] or re.search(r'geometry|epsg|polygon|كورنيش|مسجد|حديقه',normalize(name)):continue
   if activity_conflict(name,activity,intent,text,direction):
    knowledge.last_directory_exclusions.append({'source_ref':str(key),'name':name,'activity':activity,'reason':'NAME_ACTIVITY_CONFLICT_OR_INCOMPATIBLE_SPECIALTY_OR_GENERIC_IDENTITY'})
    continue
   if direction=='marketing' and not role_unresolved:
    if any(functions['contains'](t,combined) for t in intent['exclude']):continue
    if not any(functions['contains'](t,normalize(activity)) for t in terms):continue
    reason=intent['label']+'؛ لا دليل طلب شراء حالي'
   else:
    matched=functions['evidence']({'name':name,'evidence_category':activity},intent)
    if not matched:continue
    reason='تخصص تجاري مرتبط وفق محرك الدليل الموجود؛ لا دليل صنف أو مخزون'
    if direction=='partnership' and intent['key'] not in ['legal','accounting','software','marketing_services','logistics','training','hr','printing'] and not re.search(r'مصنع|تصنيع|توزيع|موزع|manufactur|distribut|وكيل',normalize(activity)):continue
   if role_unresolved:reason='نشاط مرتبط بالعبارة؛ لم يتحدد استخدام تجاري كافٍ لاستنتاج أنه مشترٍ'
   if direction=='partnership':reason='تخصص قد يكمل الشراكة المطلوبة؛ اهتمام الجهة بالشراكة غير مثبت'
   channels=(["phone"] if phone else [])+(["email"] if email else [])
   hits=[term for term in terms if functions['contains'](term,normalize(activity))]
   reason+='؛ مطابقات النشاط المسجل: '+('، '.join(hits) if hits else 'الاسم فقط، التصنيف غير متاح')
   specific=max((len(t.split()) for t in hits),default=0)
   recency=0
   for fmt in [None,'%d.%m.%Y','%Y-%m-%d %H:%M:%S.%f']:
    try:
     stamp=datetime.fromisoformat(str(date).replace('Z','+00:00')) if fmt is None else datetime.strptime(str(date),fmt)
     if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=timezone.utc)
     age=(datetime.now(timezone.utc)-stamp).days
     recency=1 if 0<=age<90 else .5 if 90<=age<365 else .1 if age>=365 else 0
     break
    except (ValueError,TypeError):pass
   parts={'product':.4,'specialty':min(.95,.6+.1*specific),'identity':.5,'geography':.7 if city else 0,'recency':recency,'contact':1 if channels else 0}
   pid=stable_id('GOLDEN_SOURCE_PROFILE',key)
   result.append({'id':pid,'entity_id':pid,'name':name,'city':sourcecity,'district':district,'role':'organization' if role_unresolved else 'buyer' if direction=='marketing' else 'partner' if direction=='partnership' else 'seller','level':'C' if hits else 'D','match_status':'SPECIALTY_MATCH' if hits else 'MARKET_CANDIDATE','score':score(parts),'score_components':parts,'verified':False,'status':'SOURCE_SPECIALTY_RECOMMENDATION','evidence_kind':'GOLDEN_SOURCE_ACTIVITY' if hits else 'GOLDEN_SOURCE_NAME','source_ref':str(key),'evidence_excerpt':'الاسم المسجل: '+str(name)+' | النشاط المسجل: '+str(activity),'observed_at':date,'reason':reason,'matched_activity_terms':hits,'contact_channels':channels,'contact_verification':'SOURCE_RECORDED_NOT_LIVE_VERIFIED','availability':'UNKNOWN','delivery_coverage':'UNKNOWN','purchase_intent':'UNKNOWN','partnership_interest':'UNKNOWN','interpretation_basis':'EXPLICIT_TARGET_ACTIVITY' if intent['key']=='explicit_buyer_activity' else 'EXISTING_TARGETING_PRODUCT_USE_RULE','blockers':['PRODUCT_SPECIFIC_RELATION_NOT_PROVEN','LEGAL_ENTITY_UNLINKED'],'profile_type':'ORIGINAL_POI_KEY_SOURCE_PROFILE'})
  result.sort(key=lambda r:(-r['score'],r['id']));return result[:limit]
 finally:
  if con:con.close()
