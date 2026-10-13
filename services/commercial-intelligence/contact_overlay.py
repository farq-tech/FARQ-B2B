import argparse,json,sqlite3
from pathlib import Path
from identity import observation_id
def run(registry,dbpath):
    source=sqlite3.connect(Path(registry).as_uri()+'?mode=ro',uri=True);source.execute('PRAGMA query_only=ON')
    db=sqlite3.connect(dbpath);db.execute('PRAGMA foreign_keys=ON');db.execute('CREATE TABLE IF NOT EXISTS contact_flags(observation_id TEXT PRIMARY KEY REFERENCES observations(id),channels_json TEXT NOT NULL,validation_scope TEXT NOT NULL)')
    rows=source.execute("SELECT r.source_id,r.record_uid,group_concat(DISTINCT c.channel) FROM record_contacts c JOIN source_records r USING(record_uid) WHERE c.valid=1 GROUP BY r.record_uid")
    count=0
    for src,uid,channels in rows:
        oid=observation_id(src,uid)
        if db.execute('SELECT 1 FROM observations WHERE id=?',(oid,)).fetchone():
            db.execute('INSERT OR REPLACE INTO contact_flags VALUES(?,?,?)',(oid,json.dumps(sorted(channels.split(','))),'SOURCE_SYNTAX_ONLY_NOT_LIVE_OR_OWNERSHIP_VERIFIED'));count+=1
    db.commit();db.close();source.close();print({'contact_observations_with_recorded_valid_syntax_channels':count,'contact_values_exported':0})
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--registry',required=True);p.add_argument('--db',required=True);a=p.parse_args();run(a.registry,a.db)
