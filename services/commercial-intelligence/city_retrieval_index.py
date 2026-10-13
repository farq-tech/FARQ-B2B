"""Optional locality posting index over the SAME minimal source index, owned copy only."""
import argparse,sqlite3,json,time
from pathlib import Path
from identity import normalize,stable_id

def build(source,output):
 src=Path(source).resolve();dst=Path(output).resolve()
 if src==dst:raise ValueError('DERIVATIVE_REQUIRED')
 before=(src.stat().st_size,src.stat().st_mtime_ns);start=time.perf_counter()
 original=sqlite3.connect(src.as_uri()+'?mode=ro',uri=True)
 temp=dst.with_suffix('.building.db');temp.unlink(missing_ok=True);db=sqlite3.connect(temp)
 original.backup(db);db.executescript('PRAGMA journal_mode=MEMORY;PRAGMA synchronous=OFF;CREATE VIRTUAL TABLE city_profile_search USING fts5(poi_key UNINDEXED,text,city_key);CREATE INDEX profiles_city_lower ON profiles(lower(city));')
 rows=original.execute('SELECT f.poi_key,f.text,p.city FROM profile_search f JOIN profiles p ON p.poi_key=f.poi_key');count=0
 while True:
  batch=rows.fetchmany(10000)
  if not batch:break
  db.executemany('INSERT INTO city_profile_search VALUES(?,?,?)',[(key,text,stable_id('CITYPOSTING',normalize(city))) for key,text,city in batch]);count+=len(batch)
  if count%100000==0:db.commit();print('city postings',count,flush=True)
 db.execute("INSERT OR REPLACE INTO metadata VALUES('city_postings_method','SOURCE_CITY_NORMALIZATION_NOT_OFFICIAL_GEOGRAPHY')");db.execute("INSERT INTO city_profile_search(city_profile_search) VALUES('optimize')");db.commit();db.close();original.close();temp.replace(dst)
 assert before==(src.stat().st_size,src.stat().st_mtime_ns)
 receipt={'source':str(src),'rows':count,'source_stats_unchanged':True,'city_keys_are_official':False,'scope':'SAME_SOURCE_RECORDS_AUXILIARY_RETRIEVAL_INDEX','elapsed_seconds':round(time.perf_counter()-start,3)};dst.with_suffix('.receipt.json').write_text(json.dumps(receipt,indent=2));print(receipt)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True);build(**vars(p.parse_args()))
