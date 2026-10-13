"""Neutral commercial identity, contextual relationships and independent reachability.
No legal coalescing or cross-branch contact transfer; no calls to enrichment providers.
"""
import json,os,sqlite3
from pathlib import Path
from identity import normalize,domain,stable_id
SHARED=['facebook.com','instagram.com','linkedin.com','twitter.com','google.com','maps.google','salla.sa','zid.store','wixsite.com','wordpress.com','youtube.com','directory']
def identity_basis(source_id,name,website):
 host=domain(website);label=normalize(name)
 useful=host and '.' in host and not any(h in host for h in SHARED)
 if useful and label and label not in ['company','store','شركه','تموينات','بقاله']:
  return {'id':stable_id('ENTITY_GROUP',label,host),'basis':'EXACT_NAME_REPORTED_DOMAIN_CANDIDATE','legal_status':'UNVERIFIED','grouping':'REVERSIBLE_COMMERCIAL_GROUP_NOT_LEGAL_MERGE'}
 return {'id':stable_id('ENTITY',source_id),'basis':'STABLE_SOURCE_LINEAGE','legal_status':'UNVERIFIED','grouping':'SOURCE_IDENTITY_PENDING_CROSS_SOURCE_LINK'}

def annotate(knowledge,result,text,direction):
 for tier in ['main','expansion','catalogue_evidence']:
  for item in result.get(tier,[]):
   source=item.get('source_entity_id') or item.get('entity_id') or item['id'];name=item['name'];website=item.get('source_url');record=None
   if item.get('source_ref') and item.get('profile_type')=='ORIGINAL_POI_KEY_SOURCE_PROFILE' or result.get('search_mode')=='activity':
    index=os.environ.get('FARQ_GOLDEN_INDEX')
    if index and Path(index).is_file():
     cache=getattr(knowledge,'entity_record_cache',{});ref=str(item.get('source_ref'))
     if ref not in cache:
      db=sqlite3.connect(Path(index).resolve().as_uri()+'?mode=ro',uri=True)
      cache[ref]=db.execute('SELECT name,website,activity FROM profiles WHERE poi_key=?',(ref,)).fetchone();db.close()
      if len(cache)>5000:cache={ref:cache[ref]}
      knowledge.entity_record_cache=cache
     record=cache.get(ref)
     if record:name,website,_=record
   if record is None and hasattr(knowledge,'path') and not source.startswith('COMMERCIAL_PROFILE'):
    db=sqlite3.connect(knowledge.path.as_uri()+'?mode=ro',uri=True)
    found=db.execute('SELECT name,host,activity FROM observations WHERE id=?',(source,)).fetchone();db.close()
    if found:record=found;name,website,_=record
   # Domain-only source profiles retain a provisional source anchor, not a company-name claim.
   basis=identity_basis(source,name,website) if record else identity_basis(source,'',None)
   registry=os.environ.get('FARQ_COMMERCIAL_REGISTRY')
   if registry and Path(registry).is_file():
    db=sqlite3.connect(Path(registry).resolve().as_uri()+'?mode=ro',uri=True)
    linked=db.execute('SELECT e.id,e.identity_basis,e.legal_status FROM entity_sources s JOIN entities e ON e.id=s.entity_id WHERE s.source_id=?',(source,)).fetchone();db.close()
    if linked:basis.update(id=linked[0],basis=linked[1],legal_status=linked[2])
   quality_path=os.environ.get('FARQ_ACTIVITY_QUALITY')
   if quality_path and Path(quality_path).is_file():
    qdb=sqlite3.connect(Path(quality_path).resolve().as_uri()+'?mode=ro',uri=True)
    qrow=qdb.execute('SELECT commercial_name,primary_activity,secondary_activities,source_categories,conflicts,activity_confidence,role_candidates,source_count,classification_status FROM activity_quality WHERE entity_id=?',(basis['id'],)).fetchone();qdb.close()
    if qrow:item['unified_activity']={'commercial_name':qrow[0],'primary_activity':qrow[1],'secondary_activities':json.loads(qrow[2]),'original_source_categories':json.loads(qrow[3]),'conflicts':json.loads(qrow[4]),'relative_confidence':json.loads(qrow[5]),'institutional_role_candidates':json.loads(qrow[6]),'source_count':qrow[7],'status':qrow[8],'name_alone_is_proof':False,'confidence_method':'RELATIVE_HEURISTIC_NOT_CALIBRATED'}
   item['source_entity_id']=source;item['commercial_identity']={**basis,'display_name':name,'source_id':source,'permanent_role':None}
   item['entity_id']=basis['id'];item['branch_id']=stable_id('BRANCH_SOURCE',source,item.get('city'),item.get('district'))
   role=item.get('role','organization');kind=item.get('evidence_kind','')
   current=kind=='FIRST_PARTY_PUBLIC_OPEN_REQUEST';historical=kind in ['HISTORICAL_RETAIL_PRICE','HISTORICAL_PURCHASE_REQUEST']
   state='CURRENT_PUBLIC_REQUEST_PUBLICATION_ONLY' if current else 'HISTORICAL_SOURCE_NOT_CURRENT' if historical else 'SOURCE_PRODUCT_OR_FAMILY_EVIDENCE' if item.get('level') in ['A','B'] and role=='seller' else 'POTENTIAL_ACTIVITY_INFERENCE' if role!='organization' else 'ACTIVITY_ONLY_ROLE_UNKNOWN'
   relation_id=stable_id('COMMERCIAL_RELATION',basis['id'],normalize(text),direction,source)
   item['commercial_relationship']={'id':relation_id,'entity_id':basis['id'],'subject':text,'objective':direction,'role':role,'commercial_function':item.get('commercial_function','user_potential' if role=='buyer' else role),'evidence_state':state,'level':item.get('level'),'current_demand':current,'product_stock':'UNKNOWN','source_ref':item.get('source_ref') or item.get('source_url'),'source_date':item.get('observed_at'),'reason':item.get('reason'),'verified':item.get('verified',False),'partnership_interest':'UNKNOWN','policy_requirements':'NOT_ASSESSED'}
   contacts=item.get('public_source_contacts') or {};channels=item.get('contact_channels',[])
   website=website if website and '.' in domain(website) else None
   item['reachability']={'website':website if record else item.get('source_url'),'channel_presence':channels,'source_contacts':contacts,'verification':'SOURCE_RECORDED_NOT_LIVE_VERIFIED','needs_enrichment':not bool(channels or website),'contact_completion_needed':not any(c in channels for c in ['phone','mobile','landline','email']),'enrichment_allowed':False,'serper_calls':0,'max_paid_searches_per_entity':1,'source_scope':source,'borrowed_from_other_branch':False}
 result['dimensions']={'coverage':'RECOVERED_SOURCE_ASSETS_NOT_WHOLE_MARKET','relationships':'CONTEXTUAL_NOT_PERMANENT','reachability':'INDEPENDENT_OF_PRODUCT_FIT'}
 # Compatibility arrays point to the enriched objects; identity carries no permanent role.
 if 'main' in result:result['direct']=result['main']
 if 'expansion' in result:result['potential']=result['expansion']
 return result
