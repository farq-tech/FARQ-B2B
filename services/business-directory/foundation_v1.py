"""Reproducible, read-only foundation exports. No HTTP or production writes."""
import argparse,csv,json,hashlib,collections,sys
from pathlib import Path
import duckdb
from searchability import classify,CATEGORY_MAP
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
c=duckdb.connect();c.execute("SET threads=2; SET memory_limit='512MB'");c.read_parquet(str(a.source)).create_view('r')
source_hash=hashlib.sha256(a.source.read_bytes()).hexdigest()
seed='farq-foundation-v1-20261013'
def write(name,fields,rows):
 with (a.out/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fields,extrasaction='ignore');w.writeheader()
  for row in rows:
   safe={k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in row.items()}
   # neutralize formula-like text for Excel while keeping raw JSON private for reproduction
   for k,v in safe.items():
    if isinstance(v,str) and v.startswith(('=','+','-','@')):safe[k]="'"+v
   w.writerow(safe)
def rows(sql):
 cur=c.execute(sql);fields=[d[0] for d in cur.description]
 while True:
  batch=cur.fetchmany(10000)
  if not batch:break
  for r in batch:yield dict(zip(fields,r))
# All raw geography label combinations, both languages, city context preserved.
def geography():
 for scope,where in [('RIYADH',"WHERE lower(trim(city_en))='riyadh'"),('KINGDOM','')]:
  for level in ['region','city','district']:
   for lang in ['ar','en']:
    field=level+'_'+lang
    q=f"SELECT region_ar,region_en,city_ar,city_en,{field} original_label,unnest(CASE WHEN len(sources)>0 THEN sources ELSE ['UNSPECIFIED'] END) source_name FROM r {where}"
    aggregate=f'SELECT region_ar,region_en,city_ar,city_en,original_label,source_name,count(*) frequency FROM ({q}) GROUP BY ALL ORDER BY ALL'
    for x in rows(aggregate):
     x.update(scope=scope,level=level,language=lang,candidate_id='geo-candidate:'+hashlib.sha256(json.dumps([level,lang,x['region_ar'],x['region_en'],x['city_ar'],x['city_en'],x['original_label']],ensure_ascii=False).encode()).hexdigest()[:24],canonical_id='',official_name_ar='',normalization_status='UNRESOLVED',reason='No licensed SPL reference verified; raw contextual frequency only')
     if not x['original_label']:x['reason']='Missing original label'
     yield x
geo_fields=['scope','level','language','region_ar','region_en','city_ar','city_en','original_label','source_name','frequency','candidate_id','canonical_id','official_name_ar','normalization_status','reason']
write('geo-normalization-audit.csv',geo_fields,geography())
# Map source labels only to existing detailed review taxonomy; ISIC remains blocked.
category_rows=[]
for x in rows("SELECT category original_value,count(*) frequency FROM r GROUP BY 1 ORDER BY 1"):
 primary=(x['original_value'] or '').split('|')[0].strip();g=CATEGORY_MAP.get(primary.lower())
 x.update(farq_activity_id=g['canonical_id'] if g else '',farq_label_ar=g['label_ar'] if g else '',isic_code='',isic_official_label='',isic_version='PENDING_OFFICIAL_VERSION_VERIFICATION',mapping_status='INFERRED_ACTIVITY_ONLY' if g else 'UNRESOLVED',reason='Exact reviewed directory alias; does not establish product role' if g else 'No exact reviewed mapping')
 category_rows.append(x)
write('economic-taxonomy-mapping.csv',['original_value','frequency','farq_activity_id','farq_label_ar','isic_code','isic_official_label','isic_version','mapping_status','reason'],category_rows)
# Five-way triage across Riyadh; keep population, source memberships and raw originals.
pools=collections.defaultdict(list);counts=collections.Counter();unresolved_path=a.out/'unresolved-classifications.csv'
review_fields=['review_id','source_record_id','name_ar','name_en','region_ar','region_en','city_ar','city_en','district_ar','district_en','category','secondary_category','category_l3','description_ar','description_en','latitude','longitude','website','sources','company_status','human_city_id','human_district_id','human_main_activity','human_detailed_activity','human_product_roles','human_entity_match','human_evidence_url','reviewer_id','review_status']
fields=['poi_key','name_ar','name_en','region_ar','region_en','city_ar','city_en','district_ar','district_en','category','secondary_category','category_l3','description_ar','description_en','latitude','longitude','website','sources','company_status']
with unresolved_path.open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,['source_record_id','scope','issue','original_name','original_category','original_city','original_district','sources','status']);w.writeheader()
 for r in rows('SELECT '+','.join(fields)+' FROM r ORDER BY poi_key'):
  group,reason=classify(r);riyadh=(r['city_en'] or '').strip().lower()=='riyadh'
  if group=='UNRESOLVED' or not CATEGORY_MAP.get((r['category'] or '').split('|')[0].strip().lower()):
   w.writerow(dict(source_record_id=r['poi_key'],scope='RIYADH' if riyadh else 'KINGDOM_OTHER',issue=reason if group=='UNRESOLVED' else 'ECONOMIC_MAPPING_UNRESOLVED',original_name=r['name_ar'] or r['name_en'],original_category=r['category'],original_city=r['city_ar'] or r['city_en'],original_district=r['district_ar'] or r['district_en'],sources=json.dumps(r['sources'],ensure_ascii=False),status='PENDING'))
  if riyadh:
   counts[group]+=1;r['_rank']=hashlib.sha256((seed+'|'+r['poi_key']).encode()).hexdigest();r['_group']=group;pools[group].append(r)
selected=[];manifest=[]
for group,pop in sorted(pools.items()):
 pop.sort(key=lambda r:r['_rank']);chosen=[];seen=set();source_set=set(s for r in pop for s in (r['sources'] or []))
 # Small-source-first ensures source coverage; rest hash-random. This is quota sampling.
 freq=collections.Counter(s for r in pop for s in (r['sources'] or []))
 for source in sorted(source_set,key=lambda s:(freq[s],s)):
  if len(chosen)>=60:break
  if any(source in (r['sources'] or []) for r in chosen):continue
  r=next(r for r in pop if source in (r['sources'] or []));chosen.append(r);seen.add(r['poi_key'])
 # Include known suspicious names in blind file, without exposing flags to reviewer.
 rare=[r for r in pop if (r['name_ar'] or '') in ['EPSG:4326'] or (r['name_en'] or '') in ['Point'] or '?' in (r['district_ar'] or '')]
 for r in rare[:5]:
  if r['poi_key'] not in seen and len(chosen)<75:chosen.append(r);seen.add(r['poi_key'])
 for r in pop:
  if len(chosen)>=80:break
  if r['poi_key'] not in seen:chosen.append(r);seen.add(r['poi_key'])
 assert len(chosen)==80
 selected.extend(chosen);manifest.append({'stratum':group,'population':len(pop),'sample':80,'sources_in_population':len(source_set),'sources_represented':len(set(s for r in chosen for s in (r['sources'] or [])))})
selected.sort(key=lambda r:hashlib.sha256((seed+'|blind|'+r['poi_key']).encode()).hexdigest());blind=[]
for i,r in enumerate(selected):
 d={k:r.get(k) for k in fields if k!='poi_key'};d.update(review_id=f'R{i+1:04}',source_record_id=r['poi_key'],review_status='PENDING_HUMAN_REVIEW');blind.append(d)
write('human-review-sample.csv',review_fields,blind)
(a.out/'sample-raw.json').write_text(json.dumps([{k:v for k,v in r.items() if not k.startswith('_')} for r in selected],ensure_ascii=False))
# Private system key is separate; the review CSV contains no prediction/confidence/stratum.
(a.out/'system-review-key.json').write_text(json.dumps([{'review_id':f'R{i+1:04}','source_record_id':r['poi_key'],'system_group':r['_group']} for i,r in enumerate(selected)],ensure_ascii=False,indent=2))
evidence=[]
for pth in [a.out.parent/'expanded/direct-evidence.json',a.out.parent/'noncoffee/product-evidence.json']:
 d=json.load(open(pth))
 for e in d['annotations']:
  evidence.append({'source_record_id':(e.get('record') or {}).get('poi_key',''),'evidence_id':e.get('id') or e.get('evidence_id'),'role':e['role'],'product':e['product'],'decision':e['decision'],'temporal_state':e.get('temporal_state') or e.get('opportunity_state','UNKNOWN'),'source_url':e['source_url'],'evidence_date':e.get('evidence_date'),'observed_at':e['observed_at'],'reason':e['reason'],'independent_review':'PENDING_HUMAN_REVIEW'})
write('business-role-evidence-sample.csv',['source_record_id','evidence_id','role','product','decision','temporal_state','source_url','evidence_date','observed_at','reason','independent_review'],evidence)
assert len(blind)==400 and len({r['source_record_id'] for r in blind})==400
summary={'seed':seed,'source_sha256':source_hash,'riyadh_population':sum(counts.values()),'strata':manifest,'sample_size':400,'sampling':'source-balanced, rare-case quota, hash randomized; not equal-probability SRS; metrics require design-aware weighting','human_status':'PENDING_HUMAN_REVIEW','precision':None,'recall':None,'geography_reference':'BLOCKED_SPL_LICENSE_AND_ACCESS','economic_reference':'PENDING_OFFICIAL_VERSION_VERIFICATION'}
(a.out/'sampling-manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
assert hashlib.sha256(a.source.read_bytes()).hexdigest()==source_hash
