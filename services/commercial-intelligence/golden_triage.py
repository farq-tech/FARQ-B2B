"""Reuse existing directory triage over minimal index; no source changes."""
import argparse,importlib.util,json,sqlite3,re
from pathlib import Path
from collections import Counter
from identity import normalize

def run(index):
 path=Path(index).resolve();db=sqlite3.connect(path.as_uri()+'?mode=rw',uri=True)
 if not db.execute("SELECT value FROM metadata WHERE key='scope'").fetchone()[0].startswith('MINIMAL_READ_ONLY'):raise ValueError('OWNED_DERIVED_INDEX_REQUIRED')
 spec=importlib.util.spec_from_file_location('directory_searchability',Path(__file__).parents[1]/'business-directory/searchability.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 db.execute('CREATE TABLE IF NOT EXISTS triage(poi_key TEXT PRIMARY KEY,class TEXT,inactive INTEGER)');counts=Counter();rows=db.execute('select poi_key,name,activity,lifecycle,company,landmark from profiles');batch=[]
 for key,name,activity,life,company,landmark in rows:
  group,_=module.classify({'name_ar':name,'category':activity})
  if str(landmark).lower() in ['true','yes','1']:group='LANDMARK_OR_NONCOMMERCIAL'
  if re.search(r'epsg|^(?:geometry|polygon|point|multipolygon)$',normalize(name)):group='GEOMETRY_NAME_QUARANTINE'
  inactive=normalize(life) in ['closed','permanently closed'] or normalize(company) in ['inactive','cancelled','ملغي']
  counts[group]+=1;counts['inactive']+=inactive;batch.append((key,group,inactive))
  if len(batch)==10000:db.executemany('INSERT OR REPLACE INTO triage VALUES(?,?,?)',batch);batch=[]
 if batch:db.executemany('INSERT OR REPLACE INTO triage VALUES(?,?,?)',batch)
 db.commit();eligible=db.execute("select count(*) from triage where inactive=0 and class not in ('GENERAL_NAME','LANDMARK_OR_NONCOMMERCIAL','GEOMETRY_NAME_QUARANTINE')").fetchone()[0];db.close();receipt={'counts':dict(counts),'retrieval_eligible_source_profiles':eligible,'scope':'SEARCHABILITY_CANDIDATES_NOT_LEGAL_ENTITIES_NOT_VERIFIED_PRODUCT_SELLERS','human_validation':'PENDING_HUMAN_REVIEW'};path.with_name('golden-triage-receipt.json').write_text(json.dumps(receipt,indent=2));print(receipt)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--index',required=True);run(p.parse_args().index)
