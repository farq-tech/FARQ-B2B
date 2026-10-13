import argparse,importlib.util,json,re,sqlite3
from collections import Counter
from pathlib import Path
from identity import observation_id,normalize
def run(registry,dbpath):
    file=Path(__file__).parents[1]/'business-directory/searchability.py';spec=importlib.util.spec_from_file_location('existing_searchability',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    src=sqlite3.connect(Path(registry).as_uri()+'?mode=ro',uri=True);src.row_factory=sqlite3.Row;src.execute('PRAGMA query_only=ON')
    db=sqlite3.connect(dbpath);db.execute('CREATE TABLE IF NOT EXISTS observation_state(observation_id TEXT PRIMARY KEY,class TEXT NOT NULL,reason TEXT NOT NULL,inactive INTEGER NOT NULL)')
    counts=Counter()
    for r in src.execute('SELECT record_uid,source_id,name_ar,name_en,category_raw,status_raw FROM source_records'):
        name=r['name_ar'] or r['name_en'] or '';group,reason=module.classify({'name_ar':r['name_ar'],'name_en':r['name_en'],'category':r['category_raw']})
        if re.search(r'epsg|^(?:point|polygon|multipolygon|geometry)$',name,re.I):group='GEOMETRY_NAME_QUARANTINE';reason='Geometry/CRS label is not a business name'
        closed=bool(re.search(r'permanently closed|مغلق دائم',normalize(r['status_raw'])))
        db.execute('INSERT OR REPLACE INTO observation_state VALUES(?,?,?,?)',(observation_id(r['source_id'],r['record_uid']),group,reason,closed));counts[group]+=1;counts['inactive']+=closed
    db.commit();db.close();src.close();Path(dbpath).with_name('source-triage-receipt.json').write_text(json.dumps({'counts':dict(counts),'method':'Existing Business Directory classify function reused; explicit geometry and closed-state guard. Not independently validated.'},indent=2));print(dict(counts),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--registry',required=True);p.add_argument('--db',required=True);a=p.parse_args();run(a.registry,a.db)
