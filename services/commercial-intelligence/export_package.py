"""Read-only, repeatable delivery export. VERIFIED never aliases a review candidate."""
import csv,json,sqlite3,hashlib,random,argparse
from pathlib import Path

def export(root):
 root=Path(root);db=sqlite3.connect((root/'knowledge.db').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
 def write(name,columns,rows):
  with (root/name).open('w',encoding='utf-8-sig',newline='') as f:
   w=csv.writer(f);w.writerow(columns);w.writerows(rows)
 write('identity-reconciliation.csv',['page_evidence_id','legacy_key','decision','candidate_source_observations','legal_merge'],((r['page_id'],r['legacy_key'],r['decision'],r['candidate_ids_json'],False) for r in db.execute('SELECT * FROM page_identity ORDER BY page_id')))
 write('verified-product-links.csv',['relation_id','product_id','observation_id','verification','source_url','verification_scope'],db.execute("SELECT r.id,r.subject_id,r.observation_id,r.status,e.source_url,'PRODUCT_AND_IDENTITY' FROM relations r JOIN evidence e ON e.id=r.evidence_id WHERE r.status='VERIFIED_AUTOMATED' AND r.blockers_json='[]' ORDER BY r.id"))
 write('verified-seller-evidence.csv',['relation_id','observation_id','product_id','evidence_id','verification_scope'],db.execute("SELECT id,observation_id,subject_id,evidence_id,'PRODUCT_AND_IDENTITY' FROM relations WHERE relationship='SELLS' AND status='VERIFIED_AUTOMATED' AND blockers_json='[]' ORDER BY id"))
 demand=[]
 for r in db.execute('SELECT * FROM public_demands ORDER BY id'):
  demand.append([r['id'],r['authority_name'],r['title'],'PUBLIC_REQUEST_AS_OBSERVED',r['source_url'],r['observed_at'],r['deadline'],r['verification_dimension'],r['eligibility'],'PUBLIC'])
 for r in json.loads((root/'historical-demand.json').read_text()):
  demand.append([r['id'],'AUTHORITY_MASKED_UNRESOLVED',r['product_description'],'HISTORICAL_DOCUMENT_ONLY',r['source_document'],r['date'],'','AUTOMATED_EXTRACTION_ONLY','UNKNOWN',r['owner_scope']])
 write('buyer-demand-evidence.csv',['id','authority','description','status','source','observed_at','deadline','verification_dimension','eligibility','owner_scope'],demand)
 unresolved=list(db.execute('SELECT * FROM unresolved ORDER BY id'))
 for r in db.execute("SELECT observation_id,status FROM geo_candidates WHERE status!='SPATIAL_REGION_CANDIDATE' ORDER BY observation_id"):
  unresolved.append(['GEO:'+r[0],'GEOGRAPHY',r[0],r[1]])
 write('unresolved-cases.csv',['id','kind','source_ref','reason'],unresolved)
 counts={t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['observations','subjects','evidence','relations','contact_flags','public_demands','geo_candidates']}
 rows=[['source_observations',548571,counts['observations'],'ORIGINAL_SOURCE_RECORDS_NOT_UNIQUE_LEGAL_ENTITIES',548571],['derived_subjects',0,counts['subjects'],'SOURCE_PRODUCT_OR_PAGE_OBSERVATIONS_NOT_GLOBAL_SKUS',counts['subjects']],['derived_relations',0,counts['relations'],'REVIEW_OR_HISTORICAL_RELATIONS',counts['relations']],['verified_seller_links',0,0,'ALL_REQUIRED_GATES',counts['relations']],['identity_pages_reconciled',0,3594,'SOURCE_LINEAGE_REVIEW_NOT_LEGAL_VERIFICATION',3594],['public_current_requests',0,counts['public_demands'],'PUBLICATION_ONLY_NOT_PRODUCT_FIT',counts['public_demands']],['historical_demand_rows',0,69,'HISTORICAL_NOT_CURRENT',69]]
 write('coverage-before-after.csv',['metric','before','after','grain_or_scope','denominator'],rows)
 v=json.loads((root/'validation-results.json').read_text());blinded=[];key=[]
 for case in v['cases']:
  for rank,item in enumerate(case['direct']+case['potential']+case.get('catalogue_evidence',[]),1):
   rid=hashlib.sha256((case['case_id']+item['id']).encode()).hexdigest()[:24]
   blinded.append([rid,case['input_text'],item.get('name'),item.get('subject'),item.get('source_url'),item.get('observed_at'),item.get('city'),'','','',''])
   key.append([rid,case['case_id'],rank,item['id'],item.get('status'),item.get('verified')])
 random.Random(20261013).shuffle(blinded)
 write('human-review-sample.csv',['review_id','user_goal','original_name','original_product','source_url','source_date','source_city','review_product_fit','review_identity_fit','review_critical_spec_fit','review_notes'],blinded)
 write('human-review-key-private.csv',['review_id','case_id','rank','relation_id','system_status','system_verified'],key)
 # Independent reproducible directory review; system classes kept in a separate key.
 candidates={}
 for r in db.execute('SELECT o.*,s.class,s.inactive FROM observations o JOIN observation_state s ON s.observation_id=o.id ORDER BY o.id'):
  candidates.setdefault((r['class'],r['source_id']),[]).append(dict(r))
 rng=random.Random(20261013);selected=[];keys=list(candidates);rng.shuffle(keys)
 for key in keys:rng.shuffle(candidates[key])
 while len(selected)<400 and any(candidates.values()):
  for key in keys:
   if candidates[key] and len(selected)<400:selected.append(candidates[key].pop())
 rng.shuffle(selected)
 write('directory-human-review-400.csv',['review_id','original_name','original_city','original_district','original_activity','original_source_id','record_uid','human_entity_kind','human_city','human_district','human_activity','human_notes'],((r['id'],r['name'],r['city'],r['district'],r['activity'],r['source_id'],r['record_uid'],'','','','','') for r in selected))
 write('directory-review-key-private.csv',['id','system_class','inactive'],((r['id'],r['class'],r['inactive']) for r in selected))
 receipt={'counts':counts,'legal_entities_verified':0,'human_review':'PENDING_HUMAN_REVIEW','verified_export_empty_is_intentional':True,'read_only_export':True}
 (root/'package-receipt.json').write_text(json.dumps(receipt,indent=2));db.close();print(receipt)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();export(a.output)
