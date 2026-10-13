"""Commercial recommendations, distinct from verification and legal identity."""
import json,re,sqlite3,time
from datetime import datetime,timezone
from identity import normalize,stable_id,domain
WEIGHTS={'product':40,'specialty':20,'identity':15,'geography':10,'recency':10,'contact':5}
STOP={'احتاج','ابي','ابحث','عن','اشتري','ابيع','أحتاج','لعياده','بالرياض','لعيادة','كميه','عدد','قطر','مم','كيلو','بالجمله','مختلفه','مقاسات','سماكات','مواد','واريد','لديهم','احتياجات','مثبته','موردي','مصنع','موزع','اريد','خدمات','خدمه','mm','cm','سم','لمنشاه','لمنشاتي','معدات','مصنع','موزع'}
def signals(text):
 q=normalize(text)
 if re.search(r'\bupvc\b',q) and re.search(r'انابيب|انبوب|pipe|ماسوره|مواسير',q):return ['upvc'],['انابيب','انبوب','pipe','ماسوره','مواسير']
 if re.search(r'تجهيزات.*مطاعم|restaurant.*equipment',q):return ['تجهيزات مطاعم','معدات مطاعم','restaurant equipment','commercial kitchen'],['معدات مطاعم','تجهيزات مطاعم','restaurant equipment','commercial kitchen']
 if re.search(r'معدات.*سلامه|safety.*equipment',q):return ['معدات سلامه','معدات السلامه','safety equipment','safety supplies','معدات اطفاء'],['معدات سلامه','معدات السلامه','safety equipment','fire protection']
 # Semantic exclusions preserve product head, not a second ontology.
 if re.search(r'كرسي|كراسي|chairs?',q) and re.search(r'انتظار|waiting',q):return ['كرسي انتظار','كراسي انتظار','waiting chair','waiting bench','waiting seat'],['كرسي','كراسي','chair','seating']
 if re.search(r'ابواب|باب|doors?',q) and not re.search(r'elbow|hinge|مفصل|اكواع',q):
  material=next((m for m in ['wpc','upvc','pvc'] if re.search(r'\b'+m+r'\b',q)),None)
  return ([material] if material else ['ابواب','door']),['ابواب','باب','door']
 terms=[t for t in re.findall(r'\w+',q) if len(t)>2 and not t.isdigit() and t not in STOP]
 return terms,terms

def reject(text,title,body):
 q=normalize(text);t=normalize(title);b=normalize(body)
 door=bool(re.search(r'ابواب|باب|doors?',q)) and not re.search(r'elbow|hinge|مفصل|اكواع',q)
 if 'elbow' in q and 'elbow' not in t:return 'ELBOW_NOT_IN_PRODUCT_TITLE'
 if door:
  if re.search(r'elbow|hinge|handle|doorbell|مفصل|مقبض|اكواع',t):return 'ACCESSORY_NOT_COMPLETE_DOOR'
  if not re.search(r'باب|ابواب|\bdoors?\b',t):return 'COMPLETE_DOOR_NOT_IN_TITLE'
  if not re.search(r'industrial|صناعي',q) and re.search(r'industrial|high.speed|صناعي|ابواب سريعه',t) and not re.search(r'منزلي|داخلي|interior|residential',t):return 'INDUSTRIAL_NOT_RESIDENTIAL'
 if re.search(r'كرسي|كراسي|chair',q) and re.search(r'سيفون|فرنجي|مرحاض|toilet',t):return 'TOILET_NOT_SEATING'
 if re.search(r'انتظار|waiting',q) and re.search(r'عياد|clinic|hospital',t) and not re.search(r'كرسي|كراسي|chair|اثاث|furniture',t):return 'CLINIC_NOT_SELLER'
 if re.search(r'كاميرا|camera',q) and re.search(r'انابيب|انبوب|pipe',q) and not re.search(r'(?:camera|كاميرا).{0,60}(?:pipe|drain|sewer|انابيب|انبوب)|(?:pipe|drain|sewer).{0,60}camera',b):return 'NOT_PIPE_CAMERA'
 for material in ['wpc','upvc','pvc']:
  if re.search(r'\b'+material+r'\b',q) and material not in b:return 'CRITICAL_MATERIAL_NOT_SUPPORTED'
  if door and re.search(r'\b'+material+r'\b',q) and material not in t and any(other in t for other in ['wpc','pvc','upvc'] if other!=material):return 'PRODUCT_TITLE_MATERIAL_CONFLICT'
 diameter=re.search(r'(?:قطر|diameter)\s*(\d+)',q)
 if diameter and not re.search(r'\b'+diameter[1]+r'\b',b):return 'CRITICAL_DIAMETER_NOT_SUPPORTED'
 if 'ابو كاس' in q and not re.search(r'ابو كاس|abu kass',b):return 'BRAND_DIFFERENT'
 if re.search(r'5\s*(?:كيلو|kg)',q) and not re.search(r'\b5\s*(?:كيلو|kg)\b',b):return 'PACK_SIZE_NOT_SUPPORTED'
 return None

def score(parts):return round(sum(WEIGHTS[k]*max(0,min(1,parts.get(k,0))) for k in WEIGHTS),2)

def offer_support(key,title,body):
 t=normalize(title);b=normalize(body)
 if re.search(r'^التصنيفات|^categories|^دليل |^directory',t):return False
 if key=='accounting' and re.search(r'نظام|برنامج|سوفت|software|erp|solution',t) and not re.search(r'مكتب.{0,20}محاسب|محاسبون|accounting firm|bookkeeping services',t):return False
 if key=='legal' and re.search(r'هندسي|engineering',t):return False
 if key=='logistics' and not re.search(r'خدمات.{0,15}(?:شحن|لوجست)|للشحن|شركه.{0,20}شحن|freight forwarding|logistics|shipping company',t):return False
 patterns={
  'computer_repair':r'computer repair|صيانه.{0,15}(?:كمبيوتر|حاسب)|اصلاح.{0,15}كمبيوتر',
  'insurance':r'insurance (?:company|agency|broker|services)|شركه.{0,20}تامين|خدمات (?:ال)?تامين|وكاله.{0,15}تامين',
  'tourism':r'travel agency|tour operator|للسفر والسياحه|خدمات سفر|وكاله سفر',
  'telecom':r'telecommunications|internet service provider|خدمات اتصالات|مزود.{0,10}انترنت',
  'security_services':r'security guard|خدمات حراسه|حراسه منشات',
  'waste':r'waste management|recycling|جمع نفايات|تدوير نفايات',
  'accounting':r'خدمات.{0,24}محاسب|مسك.{0,8}دفاتر|مكتب.{0,20}محاسب|محاسب.{0,15}(?:قانوني|معتمد)|accounting (?:services|firm)|bookkeeping|audit firm',
  'legal':r'محاما|استشارات (?:ال)?قانون|law firm|legal services',
  'logistics':r'خدمات الشحن|خدمات لوجست|freight forwarding|logistics service|shipping company',
  'training':r'مركز تدريب|معهد تدريب|training (?:center|institute)|دورات تدريبيه',
 }
 if key in ['insurance','tourism','telecom','security_services','waste'] and not re.search(patterns[key],t):return False
 if key in patterns:
  if key=='logistics' and re.search(r'شحن|لوجست|freight|logistics|shipping',t):return True
  if key=='legal' and re.search(r'هندسي|engineering',t) and not re.search(patterns[key],t):return False
  return bool(re.search(patterns[key],b))
 if key=='auto_parts' and not re.search(r'سيارات|سياره|auto parts|car parts|automotive',t):return False
 return True

def search(knowledge,text,direction,city,actor,limit,proven_only=False):
 from golden_directory import pure_functions
 from activity_quality import offer_conflict,eligibility,ROLE_COMPILED
 product_profile=pure_functions()['interpret'](text)
 start=time.perf_counter();goal=knowledge.cpo.analyze(direction,text);primary,family=signals(text);primary=list(map(normalize,primary));family=list(map(normalize,family))
 db=sqlite3.connect(knowledge.path.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
 terms=list(dict.fromkeys(primary+family+[normalize(t) for t in goal['product']['resolution'].get('search_terms',[]) if len(t)>3]))[:50]
 terms=[t for t in terms if t!=normalize(city)]
 if not terms:db.close();return {'goal':goal,'direct':[],'potential':[],'main':[],'expansion':[],'levels':{},'policy':'PRAGMATIC','execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW','latency_ms':0}
 sql='SELECT s.*,e.id evidence_id,e.excerpt,e.owner_scope,e.kind,e.observed_at evidence_date FROM subject_search JOIN subjects s ON s.id=subject_search.subject_id JOIN relations r ON r.subject_id=s.id JOIN evidence e ON e.id=r.evidence_id WHERE subject_search MATCH ? AND (r.scope_owner IS NULL OR r.scope_owner=?) AND (e.owner_scope IS NULL OR e.owner_scope=?) ORDER BY bm25(subject_search) LIMIT 1200'
 rows=db.execute(sql,(' OR '.join('"'+t.replace('"','')+'"' for t in terms),actor,actor)).fetchall();accepted=[];rejected=[];seen=set()
 for r in rows:
  historical=r['kind']=='HISTORICAL_RETAIL_PRICE'
  host=domain(r['source_url']) or ('historical-source:'+stable_id('STORE',r['excerpt'].split(' — ')[-1]) if historical else '')
  if not host or any(t in host for t in ['facebook.com','instagram.com','linkedin.com','twitter.com','yellowpages','directory']):continue
  pid=stable_id('COMMERCIAL_PROFILE',host)
  if pid in seen:continue
  title=r['name'];body=r['normalized_text']
  specs=json.loads(r['specs_json']);body+=(' '+str(specs.get('value',''))+' '+str(specs.get('unit','')).lower())
  if not offer_support(product_profile['key'],title,body):
   rejected.append({'subject_id':r['id'],'reason':'COMMERCIAL_OFFER_NOT_SUPPORTED_OR_DIFFERENT_SERVICE'});continue
  reason=offer_conflict(text,product_profile['key'],title,body,r['source_url'] or '') or reject(text,title,body)
  if reason:rejected.append({'subject_id':r['id'],'reason':reason});continue
  institution_roles=[role for role in ['regulator','publisher_information','educational_research'] if ROLE_COMPILED[role].search(normalize(title))]
  if any(role in institution_roles for role in ['regulator','publisher_information']) or ('educational_research' in institution_roles and product_profile['key']!='training'):
   rejected.append({'subject_id':r['id'],'reason':'NONCOMMERCIAL_INSTITUTION_PRODUCT_MENTION'});continue
  if direction=='partnership' and product_profile['key'] not in ['legal','accounting','software','marketing_services','logistics','training','hr','printing','insurance','tourism','telecom','security_services','waste'] and not re.search(r'مصنع|تصنيع|موزع|توزيع|وكيل|manufactur|distribut|dealer',body):continue
  exact=all(term in normalize(title) for term in primary) if len(primary)==1 else any(term in normalize(title) for term in primary) if any(' ' in t for t in primary) else len(primary)>0 and all(t in normalize(title) for t in primary)
  family_hit=(any(t in body for t in primary) if any(' ' in t for t in primary) else bool(primary) and all(t in body for t in primary)) and any(t in body for t in family)
  # Terms must occur in a local commercial context, not scattered across a site.
  local_support=any((any(t in chunk for t in primary) if any(' ' in t for t in primary) else bool(primary) and all(t in chunk for t in primary)) and re.search(r'بيع|متجر|منتجات|توريد|توزيع|تسوق|shop|product|supply|distribut|sale',chunk) for chunk in [body[i:i+240] for i in range(0,len(body),120)])
  family_hit=family_hit and (local_support or exact)
  specialty_hit=any(t in normalize(title) for t in family)
  if not family_hit and not specialty_hit:continue
  level='A' if exact and (r['kind']=='STRUCTURED_SOURCE_CATALOG' or (r['kind']=='SAVED_COMMERCIAL_PAGE' and re.search(r'/products?/',r['source_url'] or '') and '/product-category/' not in (r['source_url'] or ''))) else 'B' if family_hit else 'C'
  if historical:level='D'
  if direction=='partnership':level='C'
  # Source-domain profile is not a legal entity or branch. No SG contact/location transfer.
  pid=stable_id('COMMERCIAL_PROFILE',host)
  if pid in seen:continue
  seen.add(pid)
  parts={'product':1 if level=='A' else .75 if level=='B' else .4,'specialty':.8 if family_hit else .3,'identity':.7,'geography':0,'recency':0,'contact':0}
  if direction=='partnership' and family_hit:parts['product']=.75
  contacts={'phone':[],'email':[]}
  if db.execute("SELECT 1 FROM sqlite_master WHERE name='commercial_profiles'").fetchone():
   profile=db.execute('SELECT contact_json FROM commercial_profiles WHERE id=?',(pid,)).fetchone()
   if profile:contacts=json.loads(profile[0]);parts['contact']=1 if any(contacts.values()) else 0
  date=r['evidence_date'] or r['observed_at']
  try:age=(datetime.now(timezone.utc)-datetime.fromisoformat((date or '').replace('Z','+00:00'))).days;parts['recency']=0 if age<0 else 1 if age<90 else .5 if age<365 else .1
  except (ValueError,TypeError):pass
  accepted.append({'id':stable_id('RECOMMENDATION',pid,r['id']),'entity_id':pid,'name':title if r['kind']=='SAVED_COMMERCIAL_PAGE' else host,'commercial_source_title':title,'profile_type':'SOURCE_DOMAIN_PROFILE_LEGAL_ENTITY_UNLINKED','role':'partner' if direction=='partnership' else 'seller','subject':title,'evidence_excerpt':r['excerpt'][:1200],'source_url':r['source_url'],'observed_at':date,'level':level,'match_status':{'A':'DIRECT_MATCH','B':'FAMILY_MATCH','C':'SPECIALTY_MATCH','D':'MARKET_CANDIDATE'}[level],'score':score(parts),'score_components':parts,'verified':False,'status':'COMMERCIAL_RECOMMENDATION_NOT_VERIFIED','evidence_kind':r['kind'],'reason':'مصدر تجاري مستقل؛ درجة الترشيح منفصلة عن التحقق القانوني والمخزون','blockers':['LEGAL_ENTITY_AND_BRANCH_UNLINKED','CURRENT_STOCK_UNKNOWN']+(['CRITICAL_THICKNESS_UNCONFIRMED'] if re.search(r'سماكه|سماكة|سمك|thickness',text) else []),'city':None,'district':None,'availability':'UNKNOWN','delivery_coverage':'UNKNOWN','contact_channels':[key for key,values in contacts.items() if values],'public_source_contacts':contacts,'contact_verification':'SAVED_PUBLIC_SOURCE_NOT_LIVE_VERIFIED','partnership_interest':'UNKNOWN' if direction=='partnership' else None,'commercial_function':eligibility(text,product_profile['key'],direction,title,'',independent_offer=True)['commercial_function']})
 from golden_directory import candidates
 accepted.extend(candidates(knowledge,text,direction,city,limit))
 db.close();accepted.sort(key=lambda r:(-r['score'],r['id']));main=[r for r in accepted if r['level'] in ['A','B']][:limit];expansion=[r for r in accepted if r['level'] in ['C','D']][:limit]
 return {'goal':goal,'main':main,'expansion':expansion,'direct':main,'potential':expansion,'levels':{level:sum(r['level']==level for r in accepted) for level in ['A','B','C','D']},'excluded':rejected[:50]+getattr(knowledge,'last_directory_exclusions',[])[:100], 'excluded_count':len(rejected)+len(getattr(knowledge,'last_directory_exclusions',[])),'retrieved_subject_rows':len(rows),'policy':'PRAGMATIC','coverage':'COMMERCIAL_SOURCE_PROFILES' if accepted else 'EVIDENCE_GAP','execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW','latency_ms':round((time.perf_counter()-start)*1000,3)}
