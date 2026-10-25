"""Build a deduplicated, stable Farq Atlas identity layer from staged Golden v3.

Automatic merge evidence is deliberately strict:
- duplicate Google Place IDs only when city, near-identical coordinates, names, phones,
  licenses, legal name, floor, status, and known Farq subcategory agree;
- rare exact normalized business names at the same exact precise point only when
  those same non-empty identity fields do not conflict.
Ambiguous/common names and approximate points stay separate. Every input key is
retained in source_to_farq_atlas_id.parquet for backwards-compatible resolution.
"""
import csv,hashlib,json,sys
from collections import defaultdict,Counter
from pathlib import Path
sys.path.insert(0,'/tmp/farq-audit-libs')
import duckdb
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden'; IN=GOLD/'v3/farq_golden_v3.parquet'; TAX=GOLD/'v2/poi_taxonomy_golden_v2.parquet'
OUT=GOLD/'v4'; OUT.mkdir(parents=True,exist_ok=True)
MERGED=OUT/'farq_golden_v4.parquet'; TAXOUT=OUT/'poi_taxonomy_golden_v4.parquet'; CROSS=OUT/'source_to_farq_atlas_id.parquet'; REPORT=OUT/'farq_atlas_identity_report.json'
p=lambda x:"'"+str(x).replace("'","''")+"'"
db=duckdb.connect();db.execute('SET threads=1');db.execute('SET preserve_insertion_order=false');db.execute("SET memory_limit='5GB'");(OUT/'duckdb_tmp').mkdir(parents=True,exist_ok=True);db.execute(f"SET temp_directory={p(OUT/'duckdb_tmp')}")
db.execute(f"create temp view g as select * from read_parquet({p(IN)})")
cols=db.execute(f'describe select * from read_parquet({p(IN)})').fetchall(); types={r[0]:r[1] for r in cols}
required={'poi_key','latitude','longitude','city_en','name_ar','name_en'}
if not required.issubset(types): raise ValueError(f'missing required columns: {sorted(required-set(types))}')

def norm(field):
 return f"regexp_replace(translate(lower(trim(coalesce(cast({field} as varchar),''))),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
# Name signatures include either language; source strings are not fuzzy-matched.
name_rows=[]
for field in ('name_ar','name_en'):
 name_rows.append(f"select distinct poi_key,city_en,latitude,longitude,name_key,sub_id,phone_norm,legal_name,urbi_floor,building_no,commercial_license,source_trade_license,company_status,lifecycle_state from (select *,{norm(field)} name_key from g) where length(name_key)>=4 and coalesce(location_precision,'point')='point' and latitude is not null and longitude is not null")
db.execute('create temp table name_rows as '+' union all '.join(name_rows))
db.execute('create temp table name_freq as select name_key,count(distinct poi_key) frequency from name_rows group by 1')
# Strict full-group checks prevent chaining a missing field between conflicting members.
sub_ok="count(distinct nullif(sub_id,'') ) filter(where sub_id not like 'unc.%' and sub_id not like 'noncom.%')<=1"
phone_ok="count(distinct nullif(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'),''))<=1"
legal_ok=f"count(distinct nullif({norm('legal_name')},''))<=1"
floor_ok=f"count(distinct nullif({norm('urbi_floor')},''))<=1"
building_ok=f"count(distinct nullif({norm('building_no')},''))<=1"
license_ok="count(distinct nullif(trim(cast(commercial_license as varchar)),''))<=1 and count(distinct nullif(trim(cast(source_trade_license as varchar)),''))<=1"
status_ok="count(distinct nullif(company_status,''))<=1 and count(distinct nullif(lifecycle_state,''))<=1"
db.execute(f"""create temp table name_groups as
 select n.city_en,n.latitude,n.longitude,n.name_key,list_distinct(list(n.poi_key)) member_keys,count(distinct n.poi_key) member_count
 from name_rows n join name_freq f using(name_key)
 group by n.city_en,n.latitude,n.longitude,n.name_key
 having count(distinct n.poi_key)>1 and max(f.frequency)<=50
 and {sub_ok} and {phone_ok} and {legal_ok} and {floor_ok} and {building_ok} and {license_ok} and {status_ok}""")
db.execute(f"""create temp table name_group_audit as
 select n.city_en,n.latitude,n.longitude,n.name_key,count(distinct n.poi_key) member_count,
 count(distinct nullif(n.sub_id,'')) filter(where n.sub_id not like 'unc.%' and n.sub_id not like 'noncom.%') subcategories,
 count(distinct nullif(regexp_replace(coalesce(n.phone_norm,''),'[^0-9]','','g'),'')) phones,
 count(distinct nullif({norm('n.legal_name')},'')) legal_names,
 count(distinct nullif({norm('n.urbi_floor')},'')) floors,
 count(distinct nullif({norm('n.building_no')},'')) building_numbers,
 count(distinct nullif(trim(cast(n.commercial_license as varchar)),'')) licenses,
 count(distinct nullif(trim(cast(n.source_trade_license as varchar)),'')) trade_licenses,
 count(distinct nullif(n.company_status,'')) statuses,
 max(f.frequency) name_frequency
 from name_rows n join name_freq f using(name_key)
 group by n.city_en,n.latitude,n.longitude,n.name_key having count(distinct n.poi_key)>1""")
# Google ID alone was not sufficient: require consistent identity data and coordinates within ~35 m.
if 'google_place_id' in types:
 ar_name="count(distinct nullif("+norm('name_ar')+",''))<=1"; en_name="count(distinct nullif("+norm('name_en')+",''))<=1"
 gpid_city="count(distinct nullif(city_en,''))=1"
 gpid_status="count(distinct nullif(company_status,''))<=1 and count(distinct nullif(lifecycle_state,''))<=1"
 db.execute(f"""create temp table google_groups as
 select google_place_id,list_distinct(list(poi_key)) member_keys,count(distinct poi_key) member_count
 from g where nullif(trim(cast(google_place_id as varchar)),'') is not null
 group by google_place_id
 having count(distinct poi_key)>1 and {gpid_city}
 and max(latitude)-min(latitude)<=0.00035 and max(longitude)-min(longitude)<=0.00035
 and {ar_name} and {en_name} and {sub_ok} and {phone_ok} and {legal_ok} and {floor_ok} and {building_ok} and {license_ok} and {gpid_status} and count(*) filter(where coalesce(location_precision,'point')<>'point')=0""")
else: db.execute('create temp table google_groups as select null::varchar google_place_id,[]::varchar[] member_keys,0 member_count where false')
# Expand safe group membership into pair edges for connected components.
edges_csv=OUT/'duplicate_edges.csv'
with edges_csv.open('w',encoding='utf-8',newline='') as stream:
 w=csv.writer(stream);w.writerow(['a','b','reason'])
 for table,reason in [('name_groups','rare_exact_name_precise_point'),('google_groups','consistent_google_place_id')]:
  cur=db.execute(f'select member_keys from {table}')
  for (members,) in cur.fetchall():
   keys=sorted(set(members))
   if len(keys)<2: continue
   root=keys[0]
   for key in keys[1:]: w.writerow([root,key,reason])
db.execute(f"create temp table edges as select * from read_csv({p(edges_csv)},all_varchar=true,header=true)")
edge_rows=db.execute('select a,b,reason from edges').fetchall()
parent={}; reasons=defaultdict(set)
def find(x):
 root=x
 while parent.get(root,root)!=root: root=parent[root]
 while parent.get(x,x)!=root: parent[x],x=root,parent[x]
 return root
for a,b,reason in edge_rows:
 ra,rb=find(a),find(b)
 if ra!=rb: parent[max(ra,rb)]=min(ra,rb)
 reasons[find(a)].add(reason)
# Re-canonicalize reason sets after union operations.
components=defaultdict(set)
all_participants={key for a,b,_ in edge_rows for key in (a,b)}
for key in all_participants: components[find(key)].add(key)
component_reasons=defaultdict(set)
for a,b,reason in edge_rows: component_reasons[find(a)].add(reason)
if all_participants:
 db.execute('create temp table scores(poi_key varchar,quality double)')
 # Build a quality score only for records participating in a merge.
 db.execute(f"""insert into scores select poi_key,
   (case when not starts_with(poi_key,'new:') then 10 else 0 end)
  + (case when nullif(name_ar,'') is not null then 4 else 0 end)
  + (case when nullif(name_en,'') is not null then 3 else 0 end)
  + (case when sub_id is not null and sub_id not like 'unc.%' then 3 else 0 end)
  + (case when nullif(phone_norm,'') is not null then 5 else 0 end)
  + (case when nullif(email,'') is not null then 2 else 0 end)
  + (case when nullif(website,'') is not null then 2 else 0 end)
  + (case when commercial_license is not null then 2 else 0 end)
  + coalesce(source_count,0)
  + (case when urbi_legal_name is not null then 2 else 0 end)
  + (case when urbi_branches_count is not null then 1 else 0 end)
  + (case when linked_building_house_id is not null then 1 else 0 end)
  from g join (select distinct unnest(list_value(a,b)) poi_key from edges) e using(poi_key)""")
 score={k:v for k,v in db.execute('select poi_key,quality from scores').fetchall()}
 component_map=[];reason_counts=Counter();size_counts=Counter()
 for root,keys in components.items():
  members=sorted(keys)
  master=sorted(members,key=lambda k:(-score.get(k,0),k.startswith('new:'),k))[0]
  sha=hashlib.sha256(master.encode()).hexdigest()[:20].upper(); atlas='FA-'+sha
  reason_text=';'.join(sorted(component_reasons[root]))
  for key in members: component_map.append((key,master,atlas,len(members),reason_text))
  size_counts[len(members)]+=1
  for _,_,_,_,why in [component_map[-1]]: reason_counts.update(filter(None,why.split(',')))
 components_csv=OUT/'merged_components.csv'
 with components_csv.open('w',encoding='utf-8',newline='') as f:
  w=csv.writer(f);w.writerow(['source_poi_key','canonical_poi_key','farq_atlas_id','merged_record_count','merge_evidence']);w.writerows(component_map)
 db.execute(f"create temp table component_map as select * from read_csv({p(components_csv)},all_varchar=true,header=true)")
else:
 size_counts=Counter();reason_counts=Counter()
 db.execute('create temp table component_map(source_poi_key varchar,canonical_poi_key varchar,farq_atlas_id varchar,merged_record_count varchar,merge_evidence varchar)')
# Complete one-to-one crosswalk, then merge every source field into the selected master row.
if CROSS.exists(): CROSS.unlink()
db.execute(f"""copy (select g.poi_key source_poi_key,coalesce(m.canonical_poi_key,g.poi_key) canonical_poi_key,
 'FA-'||upper(substr(sha256(coalesce(m.canonical_poi_key,g.poi_key)),1,20)) farq_atlas_id,
 coalesce(try_cast(m.merged_record_count as integer),1) merged_record_count,
 coalesce(m.merge_evidence,'') merge_evidence,
 g.poi_key<>coalesce(m.canonical_poi_key,g.poi_key) merged_alias
 from g left join component_map m on g.poi_key=m.source_poi_key) to {p(CROSS)} (format parquet,compression zstd)""")
db.execute(f"create temp view mapped as select g.*,coalesce(m.canonical_poi_key,g.poi_key) canonical_poi_key from g left join component_map m on g.poi_key=m.source_poi_key")
# Prepare all fields; field-wise first non-empty by source completeness keeps the primary row and fills its gaps.
quality="(case when not starts_with(poi_key,'new:') then 10 else 0 end)+(case when nullif(name_ar,'') is not null then 4 else 0 end)+(case when nullif(name_en,'') is not null then 3 else 0 end)+(case when sub_id is not null and sub_id not like 'unc.%' then 3 else 0 end)+(case when nullif(phone_norm,'') is not null then 5 else 0 end)+(case when nullif(email,'') is not null then 2 else 0 end)+(case when nullif(website,'') is not null then 2 else 0 end)+coalesce(source_count,0)+(case when urbi_legal_name is not null then 2 else 0 end)+(case when urbi_branches_count is not null then 1 else 0 end)+(case when linked_building_house_id is not null then 1 else 0 end)"
# Use aliases for string-valued source fields and preserve native types for all non-string values.
expressions=[]
for name,typ in types.items():
 if name=='poi_key': continue
 qn='"'+name.replace('"','""')+'"'
 if name=='sources' and '[]' in typ:
  expressions.append(f"list_distinct(flatten(list({qn}) filter(where {qn} is not null))) as {qn}")
 elif '[]' in typ or 'STRUCT' in typ.upper() or 'MAP' in typ.upper():
  expressions.append(f"first({qn} order by quality desc,poi_key) filter(where {qn} is not null and len({qn})>0) as {qn}")
 elif typ.upper().startswith('VARCHAR'):
  expressions.append(f"first({qn} order by quality desc,poi_key) filter(where nullif(trim({qn}),'') is not null) as {qn}")
 else:
  expressions.append(f"first({qn} order by quality desc,poi_key) filter(where {qn} is not null) as {qn}")
expr_sql=',\n'.join(expressions)
if MERGED.exists(): MERGED.unlink()
PARTS=OUT/'identity_parts'; PARTS.mkdir(parents=True,exist_ok=True)
# Keep complete partition files so a later QA-only rerun can reuse them.
# Hash partitioning bounds aggregation memory while keeping the final output globally unique.
for bucket in range(16):
 part=PARTS/f'part-{bucket:02d}.parquet'
 if part.exists() and part.stat().st_size>0: continue
 db.execute(f"""copy (select canonical_poi_key poi_key,
 'FA-'||upper(substr(sha256(canonical_poi_key),1,20)) farq_atlas_id,
 list(poi_key order by poi_key) merged_source_poi_keys,
 count(*) merged_record_count,
 case when count(*)>1 then 'FA-DUP-'||upper(substr(sha256(canonical_poi_key),1,16)) end farq_duplicate_group_id,
 {expr_sql}
 from (select *,{quality} quality from mapped)
 where hash(canonical_poi_key)%16={bucket}
 group by canonical_poi_key
 ) to {p(part)} (format parquet,compression zstd)""")
db.execute(f"copy (select * from read_parquet({p(PARTS/'part-*.parquet')})) to {p(MERGED)} (format parquet,compression zstd)")
# Collapse classifications through the same canonical identity. High confidence wins; incompatible classes are blocked above.
if TAX.exists():
 taxcols={r[0] for r in db.execute(f'describe select * from read_parquet({p(TAX)})').fetchall()}
 if {'poi_key','sub_id'}.issubset(taxcols):
  cexpr="case confidence when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end" if 'confidence' in taxcols else '0'
  tsource='first(source order by '+cexpr+' desc,source) filter(where source is not null)' if 'source' in taxcols else "null::varchar"
  tconfidence='first(confidence order by '+cexpr+' desc,confidence) filter(where confidence is not null)' if 'confidence' in taxcols else "null::varchar"
  tevidence='first(evidence order by '+cexpr+' desc,evidence) filter(where evidence is not null)' if 'evidence' in taxcols else "null::varchar"
  taxsql=f"""copy (select x.canonical_poi_key poi_key,x.farq_atlas_id,first(t.sub_id order by {cexpr} desc,t.sub_id) sub_id,
     {tsource} "source",{tconfidence} confidence,{tevidence} evidence
     from read_parquet({p(TAX)}) t join read_parquet({p(CROSS)}) x on t.poi_key=x.source_poi_key group by x.canonical_poi_key,x.farq_atlas_id)
     to {p(TAXOUT)} (format parquet,compression zstd)"""
  if TAXOUT.exists(): TAXOUT.unlink()
  db.execute(taxsql)
# Release QA and exact stable ID collisions.
metrics={}
metrics['input_rows']=db.execute(f'select count(*) from read_parquet({p(IN)})').fetchone()[0]
metrics['output_rows']=db.execute(f'select count(*) from {p(MERGED)}').fetchone()[0]
metrics['unique_poi_keys']=db.execute(f'select count(distinct poi_key) from read_parquet({p(MERGED)})').fetchone()[0]
metrics['unique_farq_atlas_ids']=db.execute(f'select count(distinct farq_atlas_id) from read_parquet({p(MERGED)})').fetchone()[0]
metrics['crosswalk_rows']=db.execute(f'select count(*) from read_parquet({p(CROSS)})').fetchone()[0]
metrics['crosswalk_unique_source_keys']=db.execute(f'select count(distinct source_poi_key) from read_parquet({p(CROSS)})').fetchone()[0]
metrics['merged_groups']=len(components);metrics['merged_records']=sum(len(v) for v in components.values());metrics['rows_removed_as_duplicates']=metrics['input_rows']-metrics['output_rows']
metrics['group_size_distribution']={str(k):v for k,v in sorted(size_counts.items())};metrics['merge_evidence_counts']=dict(reason_counts)
metrics['duplicate_audit']={
 'strict_exact_name_precise_point_groups':db.execute('select count(*) from name_groups').fetchone()[0],
 'all_exact_name_precise_point_groups':db.execute('select count(*) from name_group_audit').fetchone()[0],
 'blocked_common_name_groups':db.execute('select count(*) from name_group_audit where name_frequency>50').fetchone()[0],
 'blocked_subcategory_conflicts':db.execute('select count(*) from name_group_audit where subcategories>1').fetchone()[0],
 'blocked_phone_conflicts':db.execute('select count(*) from name_group_audit where phones>1').fetchone()[0],
 'blocked_legal_name_conflicts':db.execute('select count(*) from name_group_audit where legal_names>1').fetchone()[0],
 'blocked_floor_conflicts':db.execute('select count(*) from name_group_audit where floors>1').fetchone()[0],
 'blocked_building_number_conflicts':db.execute('select count(*) from name_group_audit where building_numbers>1').fetchone()[0],
 'blocked_license_conflicts':db.execute('select count(*) from name_group_audit where licenses>1 or trade_licenses>1').fetchone()[0],
 'blocked_lifecycle_conflicts':db.execute('select count(*) from name_group_audit where statuses>1').fetchone()[0],
 'consistent_duplicate_google_place_id_groups':db.execute('select count(*) from google_groups').fetchone()[0]}
metrics['id_collisions']=db.execute(f'select count(*) from (select farq_atlas_id from read_parquet({p(MERGED)}) group by 1 having count(*)>1)').fetchone()[0]
metrics['invalid_coordinates']=db.execute(f'select count(*) from read_parquet({p(MERGED)}) where latitude not between -90 and 90 or longitude not between -180 and 180').fetchone()[0]
metrics['taxonomy_rows']=db.execute(f'select count(*) from read_parquet({p(TAXOUT)})').fetchone()[0] if TAXOUT.exists() else 0
metrics['taxonomy_orphans']=db.execute(f'select count(*) from read_parquet({p(TAXOUT)}) t anti join read_parquet({p(MERGED)}) g using(poi_key)').fetchone()[0] if TAXOUT.exists() else 0
metrics['group_policy']='Approximate locations, common names (>50 rows), and groups with conflicting city, names, location, known subcategory, phone, legal name, floor, building number, license, or lifecycle status are never automatically merged.'
metrics['id_policy']='FA- plus deterministic SHA-256 prefix of the chosen canonical source poi_key; old source keys map to canonical key and Farq Atlas ID in source_to_farq_atlas_id.parquet.'
metrics['outputs']={'golden':str(MERGED),'taxonomy':str(TAXOUT),'source_to_id_crosswalk':str(CROSS)}
REPORT.write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print(json.dumps(metrics,ensure_ascii=False,indent=2),flush=True)
