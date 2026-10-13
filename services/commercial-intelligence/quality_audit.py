# coding: utf-8
"""All named candidate identities, read-only source inputs, separate quality derivative."""
import argparse,json,sqlite3,time
from pathlib import Path
from activity_quality import assessment

def build(registry,index,knowledge,output):
 inputs=[Path(p).resolve() for p in [registry,index,knowledge]];dest=Path(output).resolve()
 if dest in inputs:raise ValueError('DERIVATIVE_REQUIRED')
 before=[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs];start=time.perf_counter()
 source=sqlite3.connect(inputs[0].as_uri()+'?mode=ro',uri=True);source.execute('PRAGMA query_only=ON')
 source.execute('ATTACH DATABASE ? AS golden',(inputs[1].as_uri()+'?mode=ro',));source.execute('ATTACH DATABASE ? AS saved',(inputs[2].as_uri()+'?mode=ro',))
 temp=dest.with_suffix('.building.db');temp.unlink(missing_ok=True);out=sqlite3.connect(temp)
 out.executescript('''PRAGMA journal_mode=MEMORY;PRAGMA synchronous=OFF;
 CREATE TABLE activity_quality(entity_id TEXT PRIMARY KEY,commercial_name TEXT,primary_activity TEXT,secondary_activities TEXT,source_categories TEXT,conflicts TEXT,activity_confidence TEXT,role_candidates TEXT,source_count INTEGER,classification_status TEXT);
 CREATE TABLE source_quality(source_id TEXT PRIMARY KEY,entity_id TEXT,assessment_json TEXT);
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);''')
 sql="""SELECT s.entity_id,s.source_id,s.source_namespace,coalesce(p.name,o.name,e.name),coalesce(p.activity,o.activity,''),s.classification_state
 FROM entity_sources s JOIN entities e ON e.id=s.entity_id
 LEFT JOIN golden.profiles p ON s.source_namespace='golden' AND p.poi_key=s.source_ref
 LEFT JOIN saved.observations o ON s.source_namespace='registry' AND o.id=s.source_id
 WHERE s.entity_id IN (SELECT entity_id FROM entity_sources WHERE classification_state IN ('SEARCHABLE_BUSINESS_CANDIDATE','NAME_ONLY_BUSINESS_CANDIDATE','PUBLIC_SAVED_DOMAIN_PROFILE')) ORDER BY s.entity_id,s.source_id"""
 cursor=source.execute(sql);current=None;group=[];n=0;conflicting=0;unknown=0;rows=[];sources=[]
 def save(group):
  nonlocal n,conflicting,unknown
  eid=group[0][0];categories=[];confidence={};conflicts=[];roles=set();names=[]
  for _,sid,namespace,name,activity,state in group:
   a=assessment(name or '',activity,source=namespace);names.append(name);categories.append({'source_id':sid,'source_namespace':namespace,'original_category':activity,'original_classification':state})
   sources.append((sid,eid,json.dumps(a,ensure_ascii=False)))
   for c in a['activity_candidates']:
    key=c['activity'];old=confidence.setdefault(key,{'activity':key,'relative_confidence':0,'supporting_source_ids':[],'source_categories':set(),'name_agreement':False})
    old['relative_confidence']=max(old['relative_confidence'],c['relative_confidence']);old['supporting_source_ids'].append(sid);old['name_agreement']|=c['name_agreement'];old['source_categories'].add((namespace,activity))
   for c in a['conflicts']:conflicts.append({**c,'source_id':sid})
   roles.update(a['institutional_role_candidates'])
  for candidate in confidence.values():
   agreement=len(candidate.pop('source_categories'));candidate['distinct_category_observations']=agreement
   if candidate['relative_confidence']>=.5:candidate['relative_confidence']=round(min(.85,candidate['relative_confidence']+.03*min(3,max(0,agreement-1))),3)
  ordered=sorted(confidence.values(),key=lambda x:(-x['relative_confidence'],x['activity']))
  # Sources can be copies; agreement is exposed, never multiplied into proof.
  primary=ordered[0]['activity'] if ordered and ordered[0]['relative_confidence']>=.5 else None
  status='SOURCE_CONFLICT_REVIEW' if conflicts else 'ACTIVITY_INFERRED' if primary else 'UNRESOLVED_ACTIVITY'
  rows.append((eid,names[0],primary,json.dumps([x['activity'] for x in ordered[1:] if x['relative_confidence']>=.5]),json.dumps(categories,ensure_ascii=False),json.dumps(conflicts,ensure_ascii=False),json.dumps(ordered),json.dumps(sorted(roles)),len(group),status))
  n+=1;conflicting+=bool(conflicts);unknown+=primary is None
  if n%10000==0:
   out.executemany('INSERT INTO activity_quality VALUES(?,?,?,?,?,?,?,?,?,?)',rows);out.executemany('INSERT INTO source_quality VALUES(?,?,?)',sources);out.commit();rows.clear();sources.clear()
  if n%100000==0:print('quality identities',n,flush=True)
 for row in cursor:
  if current!=row[0] and group:save(group);group=[]
  current=row[0];group.append(row)
 if group:save(group)
 out.executemany('INSERT INTO activity_quality VALUES(?,?,?,?,?,?,?,?,?,?)',rows);out.executemany('INSERT INTO source_quality VALUES(?,?,?)',sources)
 out.execute('CREATE INDEX source_quality_entity ON source_quality(entity_id)');out.execute('INSERT INTO metadata VALUES(?,?)',('method','RELATIVE_HEURISTIC_NOT_CALIBRATED_NO_NAME_ONLY_PROOF'))
 out.commit();metrics={'audited_named_candidate_identities':n,'identities_with_source_conflicts':conflicting,'identities_without_resolved_activity':unknown,'source_members':out.execute('SELECT count(*) FROM source_quality').fetchone()[0],'states':out.execute('SELECT classification_status,count(*) FROM activity_quality GROUP BY classification_status').fetchall(),'roles_are_candidates_not_permanent':True,'confidence':'RELATIVE_NOT_CALIBRATED','provider_calls':0,'source_stats_unchanged':before==[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs],'elapsed_seconds':round(time.perf_counter()-start,3)}
 assert metrics['source_stats_unchanged'];source.close();out.close();temp.replace(dest);dest.chmod(0o600);dest.with_suffix('.receipt.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2));print(metrics)
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['registry','index','knowledge','output']:p.add_argument('--'+k,required=True)
 build(**vars(p.parse_args()))
