"""Explicit activity discovery; never infers a seller/buyer relationship."""
import json,os,re,sqlite3,time
from pathlib import Path
from identity import normalize,stable_id

def search(knowledge,text,city,limit,offset=0):
 start=time.perf_counter();index=os.environ.get('FARQ_GOLDEN_INDEX')
 if not index or not Path(index).is_file():raise ValueError('ACTIVITY_INDEX_REQUIRED')
 from golden_directory import pure_functions
 f=pure_functions();expanded=f['activity_terms'](text)
 alternatives=expanded if len(expanded)>1 else None
 terms=[w for w in re.findall(r'\w+',normalize(text)) if w not in ['ابحث','عن','نشاط','نشاطات','منشات','الرياض']][:12]
 if not terms:raise ValueError('ACTIVITY_REQUIRED')
 # Literal activity retrieval, independent of supported product families.
 con=sqlite3.connect(Path(index).resolve().as_uri()+'?mode=ro',uri=True);con.execute('PRAGMA query_only=ON')
 aliases=[city]+[a for a in knowledge.city_aliases if knowledge.city_matches(city,a)] if city else []
 city_sql=' AND lower(p.city) IN ('+','.join('?' for _ in aliases)+')' if aliases else ''
 has_triage=bool(con.execute("SELECT 1 FROM sqlite_master WHERE name='triage'").fetchone())
 join=" JOIN triage t ON t.poi_key=p.poi_key AND t.inactive=0 AND t.class NOT IN ('GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE')" if has_triage else ''
 con.create_function('activity_ok',1,lambda value:int(any(w in normalize(value) for w in alternatives) if alternatives else all(w in normalize(value) for w in terms)),deterministic=True)
 con.create_function('record_ok',4,lambda name,life,company,landmark:int(bool(name) and str(landmark).lower() not in ['true','1','yes'] and normalize(life) not in ['closed','permanently closed'] and normalize(company) not in ['inactive','cancelled','ملغي']),deterministic=True)
 base=' FROM profile_search f JOIN profiles p ON p.poi_key=f.poi_key'+join+' WHERE profile_search MATCH ?'+city_sql+' AND activity_ok(p.activity)=1 AND record_ok(p.name,p.lifecycle,p.company,p.landmark)=1'
 params=[' OR '.join('"'+w+'"' for w in alternatives) if alternatives else ' AND '.join('"'+w+'"' for w in terms)]+[a.lower() for a in aliases]
 total=con.execute('SELECT count(*)'+base,params).fetchone()[0]
 rows=con.execute('SELECT p.*'+base+' ORDER BY bm25(profile_search),p.poi_key LIMIT ? OFFSET ?',params+[limit,offset]).fetchall();con.close()
 result=[]
 for key,name,sourcecity,district,activity,website,date,channels,lifecycle,company,landmark in rows:
  if not name or str(landmark).lower() in ['true','1','yes'] or normalize(lifecycle) in ['closed','permanently closed'] or normalize(company) in ['inactive','cancelled','ملغي']:continue
  if not (any(w in normalize(activity) for w in alternatives) if alternatives else all(w in normalize(activity) for w in terms)):continue
  pid=stable_id('GOLDEN_SOURCE_PROFILE',key)
  result.append({'id':pid,'entity_id':pid,'name':name,'role':'organization','city':sourcecity,'district':district,'level':'C','score':None,'match_status':'ACTIVITY_MATCH','verified':False,'status':'MATCHED_SOURCE_ACTIVITY','evidence_kind':'GOLDEN_SOURCE_ACTIVITY','source_ref':str(key),'observed_at':date,'evidence_excerpt':'Recorded name: '+name+' | Recorded activity: '+activity,'reason':'مطابق للنشاط المطلوب في تصنيف المصدر؛ دور البيع أو الشراء والطلب الحالي غير مثبتين','purchase_intent':'UNKNOWN','availability':'UNKNOWN','contact_channels':json.loads(channels),'blockers':['SOURCE_ACTIVITY_NOT_INDEPENDENTLY_VERIFIED'],'relationship':'NOT_INFERRED'})
  if len(result)>=limit:break
 return {'goal':{'target_activity':text,'relationship':'NOT_INFERRED'},'policy':'PRAGMATIC','search_mode':'activity','total':total,'offset':offset,'next_offset':offset+len(result) if offset+len(result)<total else None,'total_capped':False,'main':result,'expansion':[],'direct':result,'potential':[],'levels':{'C':len(result)},'coverage':'RECORDED_ACTIVITY_MATCH' if result else 'ACTIVITY_COVERAGE_GAP','execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW','latency_ms':round((time.perf_counter()-start)*1000,3)}
