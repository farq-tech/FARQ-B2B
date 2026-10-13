import argparse,json,time,random,sqlite3
from pathlib import Path
from core import CpoPort,Knowledge
CASES=[
('waiting-chairs','أحتاج 20 كرسي انتظار لعيادة بالرياض','purchase','الرياض',False),
('pvc-doors','أحتاج باب PVC سماكة 6 سم','purchase','',False),
('wpc-doors','أحتاج باب WPC سماكة 6 سم','purchase','',False),
('rice-wholesale','أحتاج أرز أبو كاس 5 كيلو بالجملة','purchase','',False),
('upvc-110','أحتاج أنبوب UPVC قطر 110 مم','purchase','',False),
('sell-waiting-chairs','أبيع كراسي انتظار وأبحث عن عيادات','marketing','الرياض',False),
('sell-plumbing-proven','أبيع مواد سباكة وأريد مقاولين لديهم احتياجات مثبتة','marketing','الرياض',True),
('safety','أبحث عن موردي معدات سلامة','purchase','',False),
('restaurant-equipment','أبحث عن مصنع لتجهيزات مطاعم','purchase','',False),
('door-elbow-negative','PVC Door Elbow 110 mm','purchase','',False),
('pipe-camera-negative','كاميرا فحص الأنابيب','purchase','',False),
('industrial-door-negative','أبواب منزلية PVC','purchase','',False),
]
def evaluate(db,node,source,out):
    port=CpoPort(node,source);k=Knowledge(db,port);results=[]
    try:
        for id,text,direction,city,proof in CASES:
            before=time.perf_counter();r=k.search(text,direction,city,'local-review:qa',10,proof)
            r['case_id']=id;r['input_text']=text;r['elapsed_ms']=(time.perf_counter()-before)*1000;results.append(r)
            print(id,len(r['direct']),len(r['potential']),round(r['elapsed_ms'],1),flush=True)
        # Deterministic randomized product cases from the actual discovered catalog.
        con=sqlite3.connect(Path(db).as_uri()+'?mode=ro',uri=True)
        sample=con.execute('SELECT name FROM subjects WHERE evidence_kind=? ORDER BY id LIMIT 1000',('STRUCTURED_CATALOG_PRODUCT',)).fetchall();rng=random.Random(20261013)
        for n,(name,) in enumerate(rng.sample(sample,min(20,len(sample)))):
            r=k.search(name,'purchase','','local-review:qa',5);r['case_id']='random-'+str(n);r['input_text']=name;results.append(r)
        # Repeat warm calls with identical inputs: no regression or spurious promotion.
        warm=[]
        for id,text,direction,city,proof in CASES:
            r=k.search(text,direction,city,'local-review:qa',10,proof);warm.append(r['latency_ms'])
            previous=next(x for x in results if x['case_id']==id)
            assert [(x['id'],x['verified']) for x in r['direct']+r['potential']]==[(x['id'],x['verified']) for x in previous['direct']+previous['potential']]
        assert all(not r['execution_enabled'] and r.get('messages_sent',0)==0 for r in results)
        assert not next(r for r in results if r['case_id']=='sell-plumbing-proven')['potential']
        summary={'case_runs':len(results),'warm_repeat_cases':len(warm),'warm_p99_ms':sorted(warm)[-1],'warm_max_ms':max(warm),'cold_max_ms':max(r.get('elapsed_ms',0) for r in results),'direct_results':sum(len(r['direct']) for r in results),'review_results':sum(len(r['potential']) for r in results),'precision_at_5':None,'precision_at_10':None,'human_review':'PENDING_HUMAN_REVIEW','identity_error_rate':None,'critical_spec_error_rate':None,'method':'Actual local read-only database and existing CPO. Random seed 20261013. No network. Warm p99 uses nearest-rank on 12 observations; not a load benchmark.','cases':results}
        Path(out).write_text(json.dumps(summary,ensure_ascii=False,indent=2));return summary
    finally:port.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--node',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();evaluate(a.db,a.node,a.source,a.out)
