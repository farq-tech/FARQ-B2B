"""Necessary minimal derived retrieval index; original Parquet stays immutable."""
import argparse,sqlite3,json,hashlib,time
from pathlib import Path
import duckdb
from identity import normalize

def run(source,output):
 source=Path(source).resolve();output=Path(output).resolve()
 if source==output:raise ValueError('OUTPUT_MUST_NOT_REPLACE_SOURCE')
 before=source.stat();tmp=output.with_suffix('.building.db');tmp.unlink(missing_ok=True);db=sqlite3.connect(tmp)
 db.executescript('CREATE TABLE profiles(poi_key TEXT PRIMARY KEY,name TEXT,city TEXT,district TEXT,activity TEXT,website TEXT,observed_at TEXT,channels_json TEXT,lifecycle TEXT,company TEXT,landmark TEXT);CREATE VIRTUAL TABLE profile_search USING fts5(poi_key UNINDEXED,text);CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);')
 db.execute('PRAGMA journal_mode=MEMORY');db.execute('PRAGMA synchronous=OFF')
 con=duckdb.connect();con.execute("SET threads=2;SET memory_limit='512MB'")
 cur=con.execute("SELECT poi_key,coalesce(nullif(name_ar,''),name_en),coalesce(city_ar,city_en),coalesce(district_ar,district_en),concat_ws(' ',category,category_ar,secondary_category,category_l3,google_category),website,updated_at,phone IS NOT NULL AND trim(phone)!='',email IS NOT NULL AND trim(email)!='',lifecycle_state,company_status,is_landmark FROM read_parquet(?) WHERE poi_key IS NOT NULL",[str(source)]);n=0
 while True:
  rows=cur.fetchmany(10000)
  if not rows:break
  output_rows=[];fts=[]
  for key,name,city,district,activity,website,date,phone,email,lifecycle,company,landmark in rows:
   output_rows.append((str(key),name,city,district,activity,website,date,json.dumps((['phone'] if phone else [])+(['email'] if email else [])),lifecycle,company,landmark));fts.append((str(key),normalize((name or '')+' '+(activity or ''))))
  db.executemany('INSERT OR IGNORE INTO profiles VALUES(?,?,?,?,?,?,?,?,?,?,?)',output_rows);db.executemany('INSERT INTO profile_search VALUES(?,?)',fts);n+=len(rows)
  if n%100000==0:db.commit();print('checkpoint',n,flush=True)
 db.execute('CREATE INDEX city_index ON profiles(city)');db.executemany('INSERT INTO metadata VALUES(?,?)',[('source',str(source)),('scope','MINIMAL_READ_ONLY_RETRIEVAL_INDEX_NO_LEGAL_MERGES')]);db.commit();count=db.execute('SELECT count(*) FROM profiles').fetchone()[0];db.close();con.close();after=source.stat();assert(before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns);tmp.replace(output);output.chmod(0o600)
 receipt={'source_rows':n,'source_profile_ids':count,'legal_entities_verified':0,'source_unchanged_stat':True,'index_bytes':output.stat().st_size,'contact_values_copied':0,'scope':'NAME_ACTIVITY_LOCATION_LABELS_CHANNEL_PRESENCE_ONLY'};output.with_suffix('.receipt.json').write_text(json.dumps(receipt,indent=2));print(receipt)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True);a=p.parse_args();run(a.source,a.output)
