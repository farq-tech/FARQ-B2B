"""Derived neutral identities and source links. Originals remain read-only."""
import argparse,json,sqlite3
from pathlib import Path
from identity import stable_id
from commercial_contract import identity_basis

def build(knowledge,index,output):
 inputs=[Path(knowledge),Path(index)];output=Path(output)
 if output.resolve() in {p.resolve() for p in inputs}:raise ValueError('DERIVATIVE_REQUIRED')
 before=[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs]
 tmp=output.with_suffix('.building.db');tmp.unlink(missing_ok=True);out=sqlite3.connect(tmp)
 out.executescript('''PRAGMA journal_mode=MEMORY;PRAGMA synchronous=OFF;
 CREATE TABLE entities(id TEXT PRIMARY KEY,name TEXT,identity_basis TEXT,legal_status TEXT NOT NULL);
 CREATE TABLE entity_sources(source_id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,source_namespace TEXT,source_ref TEXT,branch_id TEXT,classification_state TEXT,phone_present INTEGER,email_present INTEGER,website_present INTEGER,city_present INTEGER);
 CREATE TABLE contextual_relationships(id TEXT PRIMARY KEY,entity_id TEXT,subject TEXT,objective TEXT,role TEXT,evidence_state TEXT,source_ref TEXT,source_date TEXT,actor_scope TEXT);
 CREATE TABLE enrichment_queue(entity_id TEXT PRIMARY KEY,status TEXT NOT NULL,paid_calls INTEGER NOT NULL DEFAULT 0 CHECK(paid_calls BETWEEN 0 AND 1),approved_cap INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);''')
 def add(rows,namespace):
  entities=[];members=[]
  for ref,name,website,city,district,state,channels in rows:
   sid=stable_id('GOLDEN_SOURCE_PROFILE',ref) if namespace=='golden' else ref
   # Directory records may share a reversible commercial group; domain profiles have no company-name proof.
   ident=identity_basis(sid,name,website) if namespace!='web' else identity_basis(sid,'',None)
   entities.append((ident['id'],name,ident['basis'],ident['legal_status']))
   members.append((sid,ident['id'],namespace,str(ref),stable_id('BRANCH_SOURCE',sid,city,district),state,int(any(key in channels for key in ['phone','mobile','landline'])),int('email' in channels),int(bool(website)),int(bool(city))))
  out.executemany('INSERT OR IGNORE INTO entities VALUES(?,?,?,?)',entities);out.executemany('INSERT OR IGNORE INTO entity_sources VALUES(?,?,?,?,?,?,?,?,?,?)',members)
  out.commit()
 g=sqlite3.connect(Path(index).resolve().as_uri()+'?mode=ro',uri=True);g.execute('PRAGMA query_only=ON')
 cursor=g.execute("SELECT p.poi_key,p.name,p.website,p.city,p.district,t.class,p.channels_json FROM profiles p JOIN triage t ON t.poi_key=p.poi_key WHERE t.inactive=0 AND t.class NOT IN ('GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE') AND trim(coalesce(p.name,''))!='' AND lower(p.name) NOT IN ('false','true','none','null')")
 n=0
 while True:
  batch=cursor.fetchmany(15000)
  if not batch:break
  add([(a,b,c,d,e,f,json.loads(h)) for a,b,c,d,e,f,h in batch],'golden');n+=len(batch)
  if n%150000==0:print('golden linked',n,flush=True)
 g.close()
 k=sqlite3.connect(Path(knowledge).resolve().as_uri()+'?mode=ro',uri=True);k.execute('PRAGMA query_only=ON')
 cursor=k.execute("SELECT o.id,o.name,o.host,o.city,o.district,t.class,coalesce(c.channels_json,'[]') FROM observations o JOIN observation_state t ON t.observation_id=o.id LEFT JOIN contact_flags c ON c.observation_id=o.id WHERE t.inactive=0 AND t.class NOT IN ('GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE') AND trim(coalesce(o.name,''))!=''")
 while True:
  batch=cursor.fetchmany(15000)
  if not batch:break
  add([(a,b,c,d,e,f,json.loads(h)) for a,b,c,d,e,f,h in batch],'registry')
 batch=k.execute('SELECT id,host,source_url,contact_json FROM commercial_profiles').fetchall()
 add([(a,b,c,None,None,'PUBLIC_SAVED_DOMAIN_PROFILE',[key for key,value in json.loads(d).items() if value]) for a,b,c,d in batch],'web');k.close()
 out.executescript('CREATE INDEX entity_sources_entity ON entity_sources(entity_id);CREATE INDEX entity_sources_namespace ON entity_sources(source_namespace);')
 # Planning is idempotent and approved budget remains zero. No provider implementation is invoked.
 out.execute("INSERT INTO enrichment_queue(entity_id,status) SELECT entity_id,'PENDING_NO_PAID_BUDGET' FROM entity_sources GROUP BY entity_id HAVING max(phone_present)=0 AND max(email_present)=0")
 out.execute('INSERT INTO metadata VALUES(?,?)',('scope','PROVISIONAL_COMMERCIAL_IDENTITIES_NOT_VERIFIED_LEGAL_ENTITIES'))
 out.commit();assert before==[(p.stat().st_size,p.stat().st_mtime_ns) for p in inputs]
 metrics={'source_profiles':out.execute('SELECT count(*) FROM entity_sources').fetchone()[0],'provisional_commercial_identities':out.execute('SELECT count(*) FROM entities').fetchone()[0],'commercial_group_candidates':out.execute("SELECT count(*) FROM entities WHERE identity_basis='EXACT_NAME_REPORTED_DOMAIN_CANDIDATE'").fetchone()[0],'members_by_namespace':out.execute('SELECT source_namespace,count(*) FROM entity_sources GROUP BY source_namespace').fetchall(),'classification_members':out.execute('SELECT classification_state,count(*) FROM entity_sources GROUP BY classification_state').fetchall(),'identities_with_phone_presence':out.execute('SELECT count(DISTINCT entity_id) FROM entity_sources WHERE phone_present=1').fetchone()[0],'identities_with_email_presence':out.execute('SELECT count(DISTINCT entity_id) FROM entity_sources WHERE email_present=1').fetchone()[0],'identities_with_website_presence':out.execute('SELECT count(DISTINCT entity_id) FROM entity_sources WHERE website_present=1').fetchone()[0],'pending_enrichment':out.execute('SELECT count(*) FROM enrichment_queue').fetchone()[0],'strong_searchable_identity_candidates':out.execute("SELECT count(DISTINCT entity_id) FROM entity_sources WHERE classification_state='SEARCHABLE_BUSINESS_CANDIDATE'").fetchone()[0],'named_business_identity_candidates':out.execute("SELECT count(DISTINCT entity_id) FROM entity_sources WHERE classification_state IN ('SEARCHABLE_BUSINESS_CANDIDATE','NAME_ONLY_BUSINESS_CANDIDATE')").fetchone()[0],'paid_calls':0,'verified_legal_entities':0,'source_stats_unchanged':True}
 out.close();tmp.replace(output);output.chmod(0o600);output.with_suffix('.receipt.json').write_text(json.dumps(metrics,indent=2));print(metrics)
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for x in ['knowledge','index','output']:p.add_argument('--'+x,required=True)
 build(**vars(p.parse_args()))
