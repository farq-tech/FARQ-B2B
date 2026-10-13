"""Independent aggregate coverage and reachability; never copies contact values."""
import json,os,sqlite3
from pathlib import Path
from golden_directory import pure_functions

def coverage(knowledge):
 registry=os.environ.get('FARQ_COMMERCIAL_REGISTRY');receipt=Path(registry).with_suffix('.receipt.json') if registry else None
 entities=json.loads(receipt.read_text()) if receipt and receipt.is_file() else {'status':'REGISTRY_NOT_CONFIGURED'}
 db=sqlite3.connect(knowledge.path.as_uri()+'?mode=ro',uri=True);db.execute('PRAGMA query_only=ON')
 index=os.environ.get('FARQ_GOLDEN_INDEX');activity_labels=None;city_labels=None
 if index and Path(index).is_file():
  directory=sqlite3.connect(Path(index).resolve().as_uri()+'?mode=ro',uri=True)
  activity_labels,city_labels=directory.execute("SELECT count(DISTINCT nullif(trim(activity),'')),count(DISTINCT nullif(trim(city),'')) FROM profiles").fetchone();directory.close()
 counts=db.execute('SELECT evidence_kind,count(*) FROM subjects GROUP BY evidence_kind').fetchall()
 subjects=db.execute("SELECT count(*),count(DISTINCT normalized_text) FROM subjects WHERE evidence_kind!='SAVED_PAGE'").fetchone()
 links=db.execute('SELECT relationship,status,count(*) FROM relations GROUP BY relationship,status').fetchall()
 public=db.execute('SELECT count(*) FROM public_demands').fetchone()[0] if db.execute("SELECT 1 FROM sqlite_master WHERE name='public_demands'").fetchone() else 0
 db.close();profiles=pure_functions()['PROFILES']
 quality=os.environ.get('FARQ_ACTIVITY_QUALITY');quality_receipt=Path(quality).with_suffix('.receipt.json') if quality else None
 quality_metrics=json.loads(quality_receipt.read_text()) if quality_receipt and quality_receipt.is_file() else {'status':'QUALITY_DERIVATIVE_NOT_CONFIGURED'}
 return {'activity_quality':quality_metrics,'entities':entities,'activities':{'source_label_strings':activity_labels,'source_city_label_strings':city_labels,'official_isic_mapping':'NOT_CONFIRMED','whole_saudi_market_claim':False},'products_services':{'product_subject_records':subjects[0],'distinct_normalized_subject_texts':subjects[1],'subject_records_by_kind':counts,'interpreted_commercial_families':len(profiles),'known_family_keys':[p[0] for p in profiles],'open_activity_fallback':True,'cpo_only':False},'relationships':{'source_graph_rows_by_state':links,'public_request_publications':public,'permanent_entity_roles':False,'product_stock_proven':False,'current_buying_inferred_from_activity':False},'reachability':{'provider_calls':0,'max_serper_searches_per_entity':1,'approved_paid_budget':0,'source_presence_is_live_verification':False},'execution_enabled':False,'messages_sent':0,'human_validation':'PENDING_HUMAN_REVIEW'}
