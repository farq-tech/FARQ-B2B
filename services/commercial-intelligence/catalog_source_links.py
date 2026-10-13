"""Source-owned catalog associations; no supplier/legal/branch coalescing."""
import argparse,json,sqlite3
from pathlib import Path
from identity import stable_id,domain
from commercial_profiles import BLOCKED_HOSTS
def run(dbpath):
 p=Path(dbpath).resolve();db=sqlite3.connect(p.as_uri()+'?mode=rw',uri=True)
 if db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]!='1':raise ValueError('DERIVED_DATABASE_REQUIRED')
 rows=db.execute("SELECT id,name,source_url,source_file,observed_at,date_kind,specs_json FROM subjects WHERE evidence_kind='STRUCTURED_CATALOG_PRODUCT'").fetchall();n=0
 for sid,name,url,file,date,datekind,specs in rows:
  host=domain(url)
  if not host or any(h in host for h in BLOCKED_HOSTS):continue
  eid=stable_id('EV','STRUCTURED_SOURCE',sid);rid=stable_id('REL','SOURCE_CATALOG',sid,eid)
  db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?)',(eid,file,None,url,None,date,datekind,'STRUCTURED_SOURCE_CATALOG',name,None,'AUTOMATED_SOURCE_EXTRACTION_NOT_LEGAL_OR_STOCK_VERIFICATION'))
  db.execute('INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,None,sid,None,None,'SELLS',eid,'SOURCE_CATALOG_MATCH_CANDIDATE','PRODUCT_REFERENCE',json.dumps(['LEGAL_ENTITY_UNLINKED','BRANCH_AND_STOCK_UNKNOWN']),None));n+=1
 db.commit();db.close();p.with_name('catalog-source-links-receipt.json').write_text(json.dumps({'source_catalog_rows_linked':n,'legal_merges':0,'verification_promotions':0,'scope':'SAME_SOURCE_CATALOG_URL_ONLY'},indent=2));print(n)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);run(p.parse_args().db)
