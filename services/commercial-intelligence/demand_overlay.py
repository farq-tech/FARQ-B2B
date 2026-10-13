"""Bounded official-request recovery; publication verification, not award/eligibility."""
import argparse,json,sqlite3,hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import urlsplit
from identity import stable_id,normalize
def run(dbpath,receipt):
    data=json.loads(Path(receipt).read_text());asof=datetime.fromisoformat(data['read_date']+'T12:00:00+03:00')
    db=sqlite3.connect(dbpath);db.execute('CREATE TABLE IF NOT EXISTS public_demands(id TEXT PRIMARY KEY,authority_id TEXT NOT NULL,authority_name TEXT NOT NULL,title TEXT NOT NULL,normalized_text TEXT NOT NULL,source_url TEXT NOT NULL,deadline TEXT NOT NULL,observed_at TEXT NOT NULL,status TEXT NOT NULL,verification_dimension TEXT NOT NULL,eligibility TEXT NOT NULL)')
    rows=[]
    for r in data['requests']:
        assert urlsplit(r['url']).hostname=='taqeem.gov.sa' and r['status_observed']=='نشط' and datetime.fromisoformat(r['deadline'])>asof
        id=stable_id('DEMAND',r['competition_id']);authority=stable_id('AUTHORITY','taqeem.gov.sa')
        db.execute('INSERT OR REPLACE INTO public_demands VALUES(?,?,?,?,?,?,?,?,?,?,?)',(id,authority,r['authority'],r['title'],normalize(r['title']),r['url'],r['deadline'],data['read_date'],'VERIFIED_AUTOMATED_PUBLIC_REQUEST_PUBLICATION',r['verification_dimension'],r['eligibility']))
        rows.append({'id':id,'authority_id':authority,'authority':r['authority'],'product_or_service':r['title'],'source_url':r['url'],'observed_at':data['read_date'],'source_crawl_age_days':r['source_crawl_age_days'],'deadline':r['deadline'],'temporal_state':'OPEN_REQUEST_AS_OBSERVED','verification':'AUTOMATED_SOURCE_PUBLICATION_CHECK','independent_human_review':'PENDING','eligibility':'NOT_ASSESSED','specific_materials_confirmed':False})
    db.commit();db.close()
    Path(dbpath).with_name('current-public-demand.json').write_text(json.dumps({'rows':rows,'source_receipt_sha256':hashlib.sha256(Path(receipt).read_bytes()).hexdigest(),'limitations':data['source_caveat']},ensure_ascii=False,indent=2));print({'public_current_requests':len(rows),'distinct_publishing_authorities':len({r['authority_id'] for r in rows})})
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--receipt',required=True);a=p.parse_args();run(a.db,a.receipt)
