"""Resume local source product interpretations using authoritative CPO only.
Never upgrades SELLER or product verification. No source writes.
"""
import argparse,json,sqlite3,time,hashlib
from pathlib import Path
from core import CpoPort
from identity import normalize

def overlay(dbpath,node,source,batch=100):
 path=Path(dbpath).resolve()
 if not path.is_file():raise ValueError('EXISTING_DERIVED_DATABASE_REQUIRED')
 db=sqlite3.connect(path.as_uri()+'?mode=rw',uri=True);db.row_factory=sqlite3.Row
 if not db.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()[0]=='1':raise ValueError('DERIVED_GRAPH_SCHEMA_REQUIRED')
 fingerprints={name:hashlib.sha256((Path(source)/name).read_bytes()).hexdigest() for name in ['data/construction/procurement-ontology.data.json','data/construction/procurement-ontology.resolver.cjs','lib/construction/line-intent-authority.js']}

 db.execute('CREATE TABLE IF NOT EXISTS cpo_interpretations(subject_id TEXT PRIMARY KEY REFERENCES subjects(id),family TEXT,intent TEXT,status TEXT NOT NULL,ontology_version TEXT NOT NULL,source_hashes_json TEXT NOT NULL,interpretation_json TEXT NOT NULL)')
 rows=db.execute("SELECT id,name FROM subjects WHERE evidence_kind IN ('CATALOG_PRODUCT_RECORD','STRUCTURED_CATALOG_PRODUCT','HISTORICAL_RETAIL_PRODUCT') AND id NOT IN (SELECT subject_id FROM cpo_interpretations) ORDER BY id LIMIT ?",(batch,)).fetchall()
 port=CpoPort(node,source);started=time.perf_counter();counts={}
 try:
  for n,r in enumerate(rows):
   goal=port.analyze('purchase',r['name']);binding=goal['product'];resolution=binding['resolution'];status=goal['state'];counts[status]=counts.get(status,0)+1
   db.execute('INSERT OR IGNORE INTO cpo_interpretations VALUES(?,?,?,?,?,?,?)',(r['id'],resolution.get('family') or resolution.get('family_id'),resolution.get('intent'),status,str(goal.get('ontologyVersion')),json.dumps(fingerprints),json.dumps(binding,ensure_ascii=False)))
   if n%20==19:db.commit();print('checkpoint',n+1,flush=True)
  db.commit();print({'processed':len(rows),'counts':counts,'elapsed_s':time.perf_counter()-started},flush=True)
 finally:port.close();db.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--node',required=True);p.add_argument('--source',required=True);p.add_argument('--batch',type=int,default=100);a=p.parse_args();overlay(a.db,a.node,a.source,a.batch)
