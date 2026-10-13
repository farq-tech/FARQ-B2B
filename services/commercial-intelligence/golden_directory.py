"""Existing relationship/evidence interpretation over the original Golden Parquet, read-only."""
import ast,re,os,json,sqlite3
from functools import lru_cache
from pathlib import Path
from identity import stable_id,normalize
from pragmatic import score

@lru_cache(maxsize=1)
def pure_functions():
 original=Path(__file__).parents[1]/'goal-foundation/targeting/trial_search.py';nodes=[]
 for node in ast.parse(original.read_text()).body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['AR','PROFILES','STOP'] for t in node.targets):nodes.append(node)
  if isinstance(node,ast.FunctionDef) and node.name in ['norm','interpret','contains','evidence','buyer_intent']:nodes.append(node)
 env={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(original),'exec'),env);return env

def candidates(knowledge,text,direction,city,limit):
 path=os.environ.get('FARQ_GOLDEN_DIRECTORY')
 index=os.environ.get('FARQ_GOLDEN_INDEX')
 if not (index and Path(index).is_file()) and (not path or not Path(path).is_file()):return []
 functions=pure_functions();intent=functions['buyer_intent'](text) if direction=='marketing' else functions['interpret'](text)
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
  result=[]
  for key,name,sourcecity,district,activity,website,date,phone,email,lifecycle,company,landmark in data:
   combined=normalize(str(name or '')+' '+str(activity or ''))
   if re.search(r'كاميرا|camera',normalize(text)) and re.search(r'انابيب|انبوب|pipe',normalize(text)) and not re.search(r'camera|كاميرا|فحص الانابيب|pipe inspection',combined):continue
   if re.search(r'ابواب|باب|doors?',normalize(text)) and not re.search(r'hinge|elbow|مفصل|اكواع',normalize(text)) and re.search(r'hinge|elbow|مفصل|مقابض فقط',combined):continue
   if not name or str(landmark).lower() in ['true','1','yes'] or normalize(lifecycle) in ['closed','permanently closed'] or normalize(company) in ['inactive','cancelled','ملغي'] or re.search(r'geometry|epsg|polygon|كورنيش|مسجد|حديقه',normalize(name)):continue
   if direction=='marketing':
    if any(functions['contains'](t,combined) for t in intent['exclude']):continue
    if not any(functions['contains'](t,normalize(activity)) for t in terms):continue
    reason=intent['label']+'؛ لا دليل طلب شراء حالي'
   else:
    matched=functions['evidence']({'name':name,'evidence_category':activity},intent)
    if not matched:continue
    reason='تخصص تجاري مرتبط وفق محرك الدليل الموجود؛ لا دليل صنف أو مخزون'
    if direction=='partnership' and not re.search(r'مصنع|تصنيع|توزيع|موزع|manufactur|distribut|وكيل',normalize(activity)):continue
   channels=(["phone"] if phone else [])+(["email"] if email else [])
   parts={'product':.4,'specialty':.8,'identity':.5,'geography':.7 if city else 0,'recency':.3 if date else 0,'contact':1 if channels else 0}
   pid=stable_id('GOLDEN_SOURCE_PROFILE',key)
   result.append({'id':pid,'entity_id':pid,'name':name,'city':sourcecity,'district':district,'role':'buyer' if direction=='marketing' else 'partner' if direction=='partnership' else 'seller','level':'C','match_status':'SPECIALTY_MATCH','score':score(parts),'score_components':parts,'verified':False,'status':'SOURCE_SPECIALTY_RECOMMENDATION','evidence_kind':'GOLDEN_SOURCE_ACTIVITY','source_ref':str(key),'evidence_excerpt':str(activity),'observed_at':date,'reason':reason,'contact_channels':channels,'contact_verification':'SOURCE_RECORDED_NOT_LIVE_VERIFIED','availability':'UNKNOWN','delivery_coverage':'UNKNOWN','purchase_intent':'UNKNOWN','partnership_interest':'UNKNOWN','blockers':['PRODUCT_SPECIFIC_RELATION_NOT_PROVEN','LEGAL_ENTITY_UNLINKED'],'profile_type':'ORIGINAL_POI_KEY_SOURCE_PROFILE'})
  result.sort(key=lambda r:(-r['score'],r['id']));return result[:limit]
 finally:
  if con:con.close()
