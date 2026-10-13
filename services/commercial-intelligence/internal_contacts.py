"""Recover recorded business contacts into an owned overlay, by exact source lineage.
No source writes, provider calls, name matching or cross-branch transfer.
"""
import argparse,json,re,sqlite3
from pathlib import Path
from identity import stable_id,observation_id,domain
DIGITS=str.maketrans('٠١٢٣٤٥٦٧٨٩','0123456789')
def values(raw,channel):
 raw=str(raw or '').translate(DIGITS)
 if channel=='email':return sorted(set(e.lower() for e in re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',raw)))
 out=set()
 for part in re.split(r'[,;|/\n]',raw):
  n=re.sub(r'\D','',part)
  if n.startswith('00966'):n=n[2:]
  if len(n)==10 and n.startswith('0'):n='966'+n[1:]
  if len(n)==9 and n.startswith('5'):n='966'+n
  if re.fullmatch(r'966[15]\d{8}',n) and len(set(n[3:]))>2:out.add('+'+n)
 return sorted(out)
def build(golden,registry,out):
 if Path(out).exists():raise ValueError('NEW_OUTPUT_REQUIRED')
 import duckdb
 db=sqlite3.connect(out);db.execute('CREATE TABLE contacts(source_id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
 before={str(p):(p.stat().st_size,p.stat().st_mtime_ns) for p in map(Path,[golden,registry])}
 counts={'golden_records_with_values':0,'registry_records_with_values':0,'phone_values':0,'email_values':0}
 def save(sid,phone,email,ref,date):
  p=values(phone,'phone');e=values(email,'email')
  if not(p or e):return False
  old=db.execute('SELECT payload FROM contacts WHERE source_id=?',(sid,)).fetchone()
  previous=json.loads(old[0]) if old else {}
  p=sorted(set(p+previous.get('phone',[])));e=sorted(set(e+previous.get('email',[])))
  payload={'phone':p,'email':e,'source_ref':ref,'observed_at':date,'scope':'SAVED_DOMAIN_NOT_LEGAL_ENTITY_OR_BRANCH' if sid.startswith('COMMERCIAL_PROFILE') else 'EXACT_SOURCE_RECORD','date_kind':'SOURCE_UPDATE' if ref.startswith('golden:') else 'SAVED_FETCH' if sid.startswith('COMMERCIAL_PROFILE') else 'INGESTION_OR_EXTRACTION_NOT_OBSERVATION','validation':'FORMAT_VALID_SOURCE_RECORDED_NOT_LIVE','whatsapp_verified':False}
  db.execute('INSERT OR REPLACE INTO contacts VALUES(?,?)',(sid,json.dumps(payload,ensure_ascii=False)));counts['phone_values']+=len(p);counts['email_values']+=len(e);return True
 d=duckdb.connect();d.execute("SET threads=2;SET memory_limit='512MB'")
 c=d.execute('SELECT poi_key,phone,email,updated_at FROM read_parquet(?) WHERE poi_key IS NOT NULL AND (phone IS NOT NULL OR email IS NOT NULL)',[golden])
 while True:
  rows=c.fetchmany(10000)
  if not rows:break
  for key,p,e,date in rows:counts['golden_records_with_values']+=save(stable_id('GOLDEN_SOURCE_PROFILE',key),p,e,'golden:'+str(key),str(date) if date else None)
  db.commit()
 d.close();r=sqlite3.connect(Path(registry).resolve().as_uri()+'?mode=ro',uri=True);r.execute('PRAGMA query_only=ON')
 for sid,uid,p,e,date in r.execute('SELECT source_id,record_uid,phone_raw,email_raw,ingested_at FROM source_records WHERE phone_raw IS NOT NULL OR email_raw IS NOT NULL'):
  counts['registry_records_with_values']+=save(observation_id(sid,uid),p,e,uid,date)
 for sid,uid,ch,value,date in r.execute("SELECT s.source_id,s.record_uid,c.channel,c.value_normalized,c.extracted_at FROM record_contacts c JOIN source_records s ON s.record_uid=c.record_uid WHERE c.valid=1 AND c.channel IN ('phone','mobile','landline','whatsapp','sales_email','email')"):
  save(observation_id(sid,uid),value if ch not in ['email','sales_email'] else None,value if ch in ['email','sales_email'] else None,uid,date)
 for host,ch,value,url,status,date in r.execute('SELECT domain,channel,value,source_url,http_status,fetched_at FROM web_contacts WHERE http_status=200'):
  if domain(url)!=domain(host):continue
  save(stable_id('COMMERCIAL_PROFILE',domain(host)),value if ch in ['phone','mobile','landline','whatsapp'] else None,value if ch in ['email','sales_email'] else None,url or host,date)
 r.close();db.commit();counts['exact_source_records']=db.execute('select count(*) from contacts').fetchone()[0];counts['phone_values']=0;counts['email_values']=0;counts['same_domain_profiles']=0
 for sid,payload in db.execute('select source_id,payload from contacts'):
  p=json.loads(payload);counts['phone_values']+=len(p['phone']);counts['email_values']+=len(p['email']);counts['same_domain_profiles']+=sid.startswith('COMMERCIAL_PROFILE')
 db.close()
 assert all((Path(p).stat().st_size,Path(p).stat().st_mtime_ns)==v for p,v in before.items())
 counts.update(source_stat_unchanged=True,serper_calls=0,cross_branch_transfers=0)
 Path(out).with_suffix('.receipt.json').write_text(json.dumps(counts,indent=2));print(counts)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--golden',required=True);a.add_argument('--registry',required=True);a.add_argument('--out',required=True);v=a.parse_args();build(v.golden,v.registry,v.out)
