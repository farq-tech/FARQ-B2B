"""Read-only shared retrieval. Evidence tiers and identity gates are explicit."""
import json,os,re,sqlite3,subprocess,threading,time,select
import ast,sys,copy
from datetime import datetime,timezone
from pathlib import Path
from identity import normalize,stable_id,domain

class CpoPort:
    def __init__(self,node,api_root):
        self.node=node;self.api_root=api_root;self.lock=threading.Lock();self.cache={};self.catalog_cache={};self.commands=0;self._start()
    def _start(self):
        env={**os.environ,'FARQ_CONSTRUCTION_SOURCE':str(self.api_root)}
        flags=['--regexp-interpret-all'] if os.environ.get('FARQ_CPO_INTERPRET_REGEXP')=='1' else []
        self.proc=subprocess.Popen([self.node,*flags,str(Path(__file__).with_name('cpo_bridge.cjs'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env=env);self.commands=0
    def _rotate(self):
        if self.commands>=100:self.close();self._start()
        self.commands+=1
    def analyze(self,objective,text):
        key=(objective,text)
        with self.lock:
            if key not in self.cache:
                self._rotate()
                self.proc.stdin.write(json.dumps({'id':stable_id('Q',*key),'objective':objective,'text':text},ensure_ascii=False)+'\n');self.proc.stdin.flush()
                data=self._response()
                if 'error' in data:raise ValueError(data['error'])
                if len(self.cache)>=100:self.cache.clear()
                self.cache[key]=data['result']
            return self.cache[key]
    def _response(self):
        ready,_,_=select.select([self.proc.stdout],[],[],30)
        if not ready:
            self.close();self._start();raise TimeoutError('CPO_RESPONSE_TIMEOUT')
        line=self.proc.stdout.readline()
        if not line:
            self.close();self._start();raise RuntimeError('CPO_PROCESS_CLOSED')
        return json.loads(line)
    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()
    def match_catalog(self,objective,text,items):
        with self.lock:
            key=json.dumps([objective,text,items],ensure_ascii=False,sort_keys=True)
            if key in self.catalog_cache:return self.catalog_cache[key]
            self._rotate()
            self.proc.stdin.write(json.dumps({'operation':'catalog','objective':objective,'text':text,'items':items},ensure_ascii=False)+'\n');self.proc.stdin.flush()
            r=self._response()
            if 'error' in r:raise ValueError(r['error'])
            if len(self.catalog_cache)>=50:self.catalog_cache.clear()
            self.catalog_cache[key]=r['result']
            return r['result']

class Knowledge:
    def __init__(self,db,cpo):
        self.path=Path(db);self.cpo=cpo;self.response_cache={};self.city_aliases={};self.pragmatic=os.environ.get('FARQ_PRAGMATIC_MATCHING')=='1' and os.environ.get('NODE_ENV')!='production'
        # Alias equivalence only when the recovered source supplies both names;
        # duplicate names remain unresolved, never geocoded by string alone.
        geo=os.environ.get('FARQ_GEO_CANDIDATE')
        if geo:
            aliases={}
            for f in json.loads(Path(geo).read_text()).get('features',[]):
                p=f['properties']
                if p.get('type') not in ['locality','city']:continue
                for value in [p.get('name_ar'),p.get('name_en')]+p.get('aliases',[]):
                    if value:aliases.setdefault(normalize(value),set()).add(p['id'])
            self.city_aliases={k:next(iter(v)) for k,v in aliases.items() if len(v)==1}
    def city_matches(self,a,b):
        if not a or not b:return True
        x,y=normalize(a),normalize(b)
        return x==y or bool(self.city_aliases.get(x) and self.city_aliases.get(x)==self.city_aliases.get(y))
    def search(self,text,direction='purchase',city='',actor=None,limit=10,proven_only=False,offset=0):
        if direction not in ['purchase','marketing','availability','partnership','activity']:raise ValueError('INVALID_DIRECTION')
        if not isinstance(text,str) or not 2<=len(text.strip())<=1000:raise ValueError('INVALID_GOAL')
        if not actor:raise PermissionError('ACTOR_REQUIRED')
        if type(limit)!=int or not 1<=limit<=20:raise ValueError('INVALID_LIMIT')
        if type(offset)!=int or offset<0:raise ValueError('INVALID_OFFSET')
        if direction!='activity' and offset:raise ValueError('OFFSET_ACTIVITY_ONLY')
        start=time.perf_counter()
        # Actor-scoped, short-lived cache invalidated by changes in derived inputs.
        index=os.environ.get('FARQ_GOLDEN_INDEX')
        registry=os.environ.get('FARQ_COMMERCIAL_REGISTRY')
        files=[self.path]+([Path(registry)] if registry else [])+([Path(index)] if index else [])
        version=tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in files if p.exists())
        key=(str(actor),str(text),str(direction),str(city),str(limit),str(proven_only),self.pragmatic,version,offset)
        hit=self.response_cache.get(key)
        if hit and time.monotonic()-hit[0]<30:
            result=copy.deepcopy(hit[1]);result['latency_ms']=round((time.perf_counter()-start)*1000,3);result['cache_hit']=True;return result
        result=self._search_uncached(text,direction,city,actor,limit,proven_only,offset)
        if self.pragmatic:
            from commercial_contract import annotate
            result=annotate(self,result,text,direction)
            from golden_directory import pure_functions
            if 'goal' in result:result['goal']['commercial_product']=pure_functions()['interpret'](text)
            result['goal_understanding']='EXISTING_CPO_PLUS_GENERAL_TARGETING_INTERPRETER'
        if len(self.response_cache)>=100:self.response_cache.clear()
        self.response_cache[key]=(time.monotonic(),copy.deepcopy(result))
        result['cache_hit']=False;return result
    def _search_uncached(self,text,direction='purchase',city='',actor=None,limit=10,proven_only=False,offset=0):
        if direction not in ['purchase','marketing','availability','partnership','activity']:raise ValueError('INVALID_DIRECTION')
        if not isinstance(text,str) or not 2<=len(text.strip())<=1000:raise ValueError('INVALID_GOAL')
        if not actor:raise PermissionError('ACTOR_REQUIRED')
        if type(limit)!=int or not 1<=limit<=20:raise ValueError('INVALID_LIMIT')
        if direction=='activity':
            if not self.pragmatic:raise ValueError('ACTIVITY_MODE_DISABLED')
            from activity_search import search
            return search(self,text,city,limit,offset)
        if self.pragmatic and direction!='marketing':
            from pragmatic import search
            return search(self,text,direction,city,actor,limit,proven_only)
        start=time.perf_counter();goal=self.cpo.analyze(direction,text);resolution=goal['product']['resolution']
        db=sqlite3.connect(self.path.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        has_geo=bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='geo_candidates'").fetchone())
        has_triage=bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='observation_state'").fetchone())
        def suppressed(oid):
            if not has_triage or not oid:return False
            state=db.execute('SELECT class,inactive FROM observation_state WHERE observation_id=?',(oid,)).fetchone()
            return bool(state and (state['inactive'] or state['class'] in ['GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE']))
        if direction=='marketing':
            # Reuse only the pure relationship interpretation from existing Targeting.
            # Importing a server/network/LLM module is deliberately unnecessary.
            from golden_directory import pure_functions
            scope=pure_functions()
            intent=scope['buyer_intent'](text);terms=intent['seller'];exclude=intent['exclude']
            require_proof=proven_only or bool(re.search(r'احتياجات مثبته|طلب شراء موثق|طلب حالي',normalize(text)))
            rows=[];current=[]
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='public_demands'").fetchone():
                meaningful=[t for t in re.findall(r'\w+',normalize(text)) if len(t)>3 and t not in ['ابيع','اريد','ابحث','خدمات','خدمه','شركات','منشات','جهات','توفير','للشركات']]
                for d in db.execute('SELECT * FROM public_demands'):
                    if datetime.fromisoformat(d['deadline'])<=datetime.now(timezone.utc):continue
                    # Publication is verified separately from fit to the user's offer.
                    # Require three substantive terms and complete term agreement.
                    if len(meaningful)>=3 and all(t in d['normalized_text'] for t in meaningful):
                        current.append({'id':d['id'],'entity_id':d['authority_id'],'name':d['authority_name'],'subject':d['title'],'role':'buyer','source_url':d['source_url'],'observed_at':d['observed_at'],'deadline':d['deadline'],'verified':False,'publication_verified':True,'status':d['status'],'evidence_kind':'FIRST_PARTY_PUBLIC_OPEN_REQUEST','verification_dimension':d['verification_dimension'],'match_level':'REQUEST_TITLE_TERMS_REQUIRES_SCOPE_REVIEW','eligibility':'NOT_ASSESSED','availability':'NOT_APPLICABLE','reason':'طلب عام منشور مطابق لعبارة الخدمة؛ متطلبات المشاركة والمواصفات التفصيلية تحتاج مراجعة','blockers':['PUBLIC_PROCUREMENT_ELIGIBILITY_NOT_ASSESSED']})
            if terms and not require_proof and not (self.pragmatic and os.environ.get("FARQ_GOLDEN_INDEX")):
                # FTS indexes original activity observations; activity never proves buying.
                clauses=' OR '.join('lower(activity) LIKE ?' for _ in terms)
                raw=db.execute('SELECT * FROM observations WHERE '+clauses+' ORDER BY id',['%'+t+'%' for t in terms])
                for r in raw:
                    if suppressed(r['id']):continue
                    activity=normalize(r['activity']);name=normalize(r['name']);combined=name+' '+activity
                    if any(t in combined for t in exclude) or not name or re.search(r'epsg|geometry|point|polygon|كورنيش|حديقه|مسجد|mountain',name):continue
                    if not self.city_matches(city,r['city']):continue
                    rows.append({'id':r['id'],'entity_id':r['id'],'name':r['name'],'city':r['city'],'district':r['district'],'role':'buyer','verified':False,'status':'POTENTIAL_ACTIVITY_ONLY','evidence_kind':'SOURCE_ACTIVITY','source_ref':r['record_uid'],'reason':intent['label'],'availability':'UNKNOWN','purchase_intent':'UNKNOWN','blockers':['NO_PRODUCT_SPECIFIC_CURRENT_DEMAND','IDENTITY_REVIEW_REQUIRED']})
            if self.pragmatic and not require_proof:
                from golden_directory import candidates
                rows.extend(candidates(self,text,direction,city,limit))
            if self.pragmatic:
                from pragmatic import score
                for item in current:
                    item.update(level='A',match_status='DIRECT_MATCH',score=score({'product':1,'specialty':1,'identity':1,'geography':0,'recency':1,'contact':0}))
                for item in rows:
                    flag=db.execute('SELECT channels_json FROM contact_flags WHERE observation_id=?',(item['entity_id'],)).fetchone()
                    item['contact_channels']=json.loads(flag[0]) if flag else item.get('contact_channels',[])
                    item.update(level='C',match_status='SPECIALTY_MATCH',score=item.get('score') or score({'product':.4,'specialty':.8,'identity':.5,'geography':.5 if city else 0,'recency':0,'contact':1 if item['contact_channels'] else 0}))
                rows.sort(key=lambda r:(-r['score'],r['id']))
            else:rows.sort(key=lambda r:r['id'])
            db.close()
            return {'goal':goal,'policy':'PRAGMATIC' if self.pragmatic else 'STRICT','main':current[:limit],'expansion':rows[:limit],'levels':{'A':len(current),'B':0,'C':len(rows),'D':0},'direct':current[:limit],'potential':rows[:limit],'coverage':'PUBLIC_REQUEST_AS_OBSERVED' if current else 'POTENTIAL_ACTIVITY_ONLY' if rows else 'NO_PROVEN_CURRENT_DEMAND','execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW','latency_ms':round((time.perf_counter()-start)*1000,3)}
        # Existing CPO search terms, then literal catalog tokens when CPO abstains.
        tokens=[t for t in re.findall(r'[\w]+',normalize(text)) if not t.isdigit() and len(t)>1]
        stop={'احتاج','ابي','ابحث','عن','اشتري','ابيع','لعياده','بالرياض','للعياده','كميه','عدد','قطر','مم','كيلو','بالجمله','مختلفه','مقاسات','سماكات','مواد','واريد','لديهم','احتياجات','مثبته'}
        tokens=[t for t in tokens if t not in stop and normalize(t)!=normalize(city)]
        phrases=[]
        for term in resolution.get('search_terms') or []:
            if len(normalize(term))>3:phrases.append('"'+normalize(term).replace('"','')+'"')
        phrases+=['"'+t.replace('"','')+'"' for t in tokens]
        phrases=list(dict.fromkeys(phrases))[:50]
        if not phrases:
            db.close()
            return {'goal':goal,'direct':[],'potential':[],'coverage':'PRODUCT_UNRESOLVED','execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW','latency_ms':(time.perf_counter()-start)*1000}
        rows=db.execute('SELECT s.*,bm25(subject_search) rank FROM subject_search JOIN subjects s ON s.id=subject_search.subject_id WHERE subject_search MATCH ? AND EXISTS (SELECT 1 FROM relations r LEFT JOIN evidence e ON e.id=r.evidence_id WHERE r.subject_id=s.id AND (r.scope_owner IS NULL OR r.scope_owner=?) AND (e.owner_scope IS NULL OR e.owner_scope=?)) ORDER BY rank LIMIT 400',(' OR '.join(phrases),actor,actor)).fetchall()
        shared_match=self.cpo.match_catalog(direction,text,[{'id':r['id'],'name_ar':r['name'],'name_en':r['name'],'category':r['catalog_family'] or r['cpo_family'] or '', 'farq_spec_id':r['cpo_family'] or r['catalog_family'] or r['id']} for r in rows]) if hasattr(self.cpo,'match_catalog') else None
        direct=[];potential=[];catalogue=[];seen=set();exclusions=[]
        for row in rows:
            r=dict(row);name=normalize(r['name']);body=normalize(r['normalized_text']);reason=None
            # Independent context exclusions: not alternate product ontology.
            accessory_request=bool(re.search(r'\b(elbow|tee|hinge|handles?)\b|مفصله|وصله|اكواع|مقابض',normalize(text)))
            door=(resolution.get('intent') in ['pvc_door','wpc_door'] or bool(re.search(r'باب|ابواب|doors?',normalize(text)))) and not accessory_request
            if door and not re.search(r'ابواب|باب|\bdoors?\b',name):reason='COMPLETE_DOOR_NOT_IN_PRODUCT_TITLE'
            if door and re.search(r'\b(elbow|tee|hinge|handles?|strip|sealant|foam|drain|doorbell)\b|مفصله|صفايه|اكواع|مقابض|حشوه',name):reason='ACCESSORY_OR_FITTING_NOT_COMPLETE_DOOR'
            if door and 'صناعي' not in normalize(text) and re.search(r'ابواب سريعه|ابواب صناعي|industrial doors|high.speed doors',body) and not re.search(r'ابواب داخليه|ابواب منزليه|interior doors|residential doors',body):reason='INDUSTRIAL_DOOR_SPEC_SCOPE_DIFFERENT'
            camera_request=bool(re.search(r'كاميرا|camera',normalize(text)))
            if not camera_request and re.search(r'انبوب|انابيب|مواسير|pipe',normalize(text)) and re.search(r'كاميرا|camera|طوب|brick|insulation|عزل',name):reason='PIPE_ACCESSORY_OR_DIFFERENT_MATERIAL'
            if camera_request and (not re.search(r'كاميرا|camera',body) or (re.search(r'انبوب|انابيب|مواسير|pipe',normalize(text)) and not re.search(r'كاميرا.{0,60}(?:انبوب|انابيب|مواسير)|(?:pipe|drain|sewer).{0,40}(?:camera|inspection)|camera.{0,40}(?:pipe|drain|sewer)',body))):reason='PIPE_INSPECTION_CAMERA_NOT_IN_EVIDENCE'
            requested_material='wpc' if re.search(r'\bwpc\b',normalize(text)) else 'upvc' if re.search(r'\bupvc\b',normalize(text)) else 'pvc' if re.search(r'\bpvc\b',normalize(text)) else None
            if requested_material and requested_material not in body:reason='REQUIRED_MATERIAL_NOT_IN_EVIDENCE'
            if re.search(r'انتظار|waiting',normalize(text)) and not re.search(r'كرسي\s+انتظار|كراسي\s+انتظار|waiting\s+(?:chair|bench|seat)',body):reason='WAITING_SEATING_NOT_IN_EVIDENCE'
            if re.search(r'110',text) and not re.search(r'\b110\b',body):reason='REQUIRED_DIAMETER_UNCONFIRMED'
            if re.search(r'ابو كاس|أبو كاس|abu kass',text,re.I) and not re.search(r'ابو كاس|abu kass',body,re.I):reason='BRAND_UNCONFIRMED'
            if re.search(r'5\s*(?:كيلو|kg)',text,re.I):
                specs=json.loads(r['specs_json'])
                if not (str(specs.get('value')) in ['5','5.0'] and str(specs.get('unit','')).lower()=='kg') and not re.search(r'\b5\s*(?:كيلو|kg)\b',body):reason='CRITICAL_PACK_SIZE_UNCONFIRMED'
            if reason:exclusions.append({'subject_id':r['id'],'reason':reason});continue
            relations=db.execute('SELECT r.*,e.source_url evidence_url,e.observed_at,e.kind evidence_kind,e.excerpt,o.name entity_name,o.city,o.district,o.record_uid FROM relations r LEFT JOIN evidence e ON e.id=r.evidence_id LEFT JOIN observations o ON o.id=r.observation_id WHERE r.subject_id=? AND (r.scope_owner IS NULL OR r.scope_owner=?) AND (e.owner_scope IS NULL OR e.owner_scope=?)',(r['id'],actor,actor)).fetchall()
            for raw in relations:
                rel=dict(raw)
                if suppressed(rel['observation_id']):continue
                if not self.city_matches(city,rel.get('city')):continue
                # Legal identity, product compatibility and own evidence are required for direct tier.
                wanted='SELLS' if direction in ['purchase','availability'] else 'BUYER_CURRENT_DEMAND' if direction=='marketing' else 'PARTNERSHIP_INTEREST'
                if rel['relationship']!=wanted:continue
                # A shared page is one evidence source, not ten independent firms.
                # Observation IDs remain unmerged and individually auditable.
                key=(domain(rel.get('evidence_url') or r['source_url']),r['id'] if rel['observation_id'] is None else 'PAGE_SOURCE')
                if key in seen:continue
                seen.add(key)
                item={'id':rel['id'],'entity_id':rel['observation_id'],'name':rel.get('entity_name') or r['name'],'role':'seller' if direction in ['purchase','availability'] else 'buyer' if direction=='marketing' else 'partner','subject':r['name'],'source_url':rel.get('evidence_url') or r['source_url'],'observed_at':rel.get('observed_at'),'evidence_kind':rel.get('evidence_kind'),'status':rel['status'],'match_level':rel['match_level'],'blockers':json.loads(rel['blockers_json']),'city':rel.get('city'),'district':rel.get('district'),'availability':'UNKNOWN','contact':'SOURCE_RECORDED_NOT_LIVE_VERIFIED','verified':False,'reason':'دليل محفوظ يحتاج حسم هوية الجهة وتوافق المنتج والفرع'}
                flag=db.execute('SELECT channels_json FROM contact_flags WHERE observation_id=?',(rel['observation_id'],)).fetchone()
                item['contact_channels']=json.loads(flag[0]) if flag else item.get('contact_channels',[])
                item['contact']='SOURCE_SYNTAX_VALID_ONLY_NOT_LIVE_VERIFIED' if flag else 'NOT_ESTABLISHED'
                geography=db.execute('SELECT city_id,region_id,district_id,status,official_parent_verified FROM geo_candidates WHERE observation_id=?',(rel['observation_id'],)).fetchone() if has_geo else None
                item['geography']=dict(geography) if geography else {'status':'NOT_ESTABLISHED','official_parent_verified':False}
                item['delivery_coverage']='UNKNOWN'
                if geography and geography['status']=='CITY_POINT_CONFLICT':
                    exclusions.append({'subject_id':r['id'],'reason':'SOURCE_CITY_COORDINATE_CONFLICT'});continue
                if city and not rel.get('city'):item['blockers'].append('REQUESTED_CITY_UNCONFIRMED')
                if re.search(r'سماكه|سمك|thickness|مقاسات|ابعاد',normalize(text)):
                    item['blockers'].append('CRITICAL_SPEC_UNCONFIRMED')
                if rel['scope_owner'] and rel['scope_owner']!=actor:continue
                if not rel['observation_id']:
                    catalogue.append(item);continue
                # Nothing built by the importer silently earns VERIFIED.
                if rel['status']=='VERIFIED_AUTOMATED' and not item['blockers'] and rel['observation_id']:
                    item['verified']=True;direct.append(item)
                elif not proven_only:potential.append(item)
        db.close()
        return {'goal':goal,'construction_catalog_match':shared_match,'direct':direct[:limit],'potential':potential[:limit],'catalogue_evidence':catalogue[:limit],'excluded':exclusions[:20],
                'coverage':'VERIFIED_SUPPORTED' if direct else 'REVIEW_REQUIRED' if potential else 'EVIDENCE_GAP',
                'execution_enabled':False,'messages_sent':0,'identity_claim':'SOURCE_OBSERVATIONS_NOT_LEGAL_MERGES',
                'latency_ms':round((time.perf_counter()-start)*1000,3),'human_validation':'PENDING_HUMAN_REVIEW'}
