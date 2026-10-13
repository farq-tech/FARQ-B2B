"""Neutral commercial identity, contextual relationships and independent reachability.
No legal coalescing or cross-branch contact transfer; no calls to enrichment providers.
"""
import json,os,sqlite3,re
from pathlib import Path
from identity import normalize,domain,stable_id
SHARED=['facebook.com','instagram.com','linkedin.com','twitter.com','google.com','maps.google','salla.sa','zid.store','wixsite.com','wordpress.com','youtube.com','directory']
def identity_basis(source_id,name,website):
 host=domain(website);label=normalize(name)
 useful=host and '.' in host and not any(h in host for h in SHARED)
 if useful and label and label not in ['company','store','شركه','تموينات','بقاله']:
  return {'id':stable_id('ENTITY_GROUP',label,host),'basis':'EXACT_NAME_REPORTED_DOMAIN_CANDIDATE','legal_status':'UNVERIFIED','grouping':'REVERSIBLE_COMMERCIAL_GROUP_NOT_LEGAL_MERGE'}
 return {'id':stable_id('ENTITY',source_id),'basis':'STABLE_SOURCE_LINEAGE','legal_status':'UNVERIFIED','grouping':'SOURCE_IDENTITY_PENDING_CROSS_SOURCE_LINK'}

def batch_lookup(knowledge,cache_name,path,keys,sql,optional_table=None):
 if not path or not Path(path).is_file() or not keys:return {}
 version=(str(path),Path(path).stat().st_mtime_ns,Path(path).stat().st_size)
 state=getattr(knowledge,cache_name,None)
 if not state or state[0]!=version:state=(version,{})
 cache=state[1];missing=list(set(keys)-set(cache))
 if missing:
  db=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)
  try:
   if optional_table and not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(optional_table,)).fetchone():
    cache.update({key:None for key in missing});missing=[]
   for offset in range(0,len(missing),500):
    chunk=missing[offset:offset+500];cache.update({key:None for key in chunk})
    for row in db.execute(sql.format(','.join('?' for _ in chunk)),chunk):cache[row[0]]=row[1:]
  finally:db.close()
 found={key:cache.get(key) for key in keys}
 if len(cache)>30000:cache=found.copy()
 setattr(knowledge,cache_name,(version,cache));return found

def annotate(knowledge,result,text,direction):
 items=[item for tier in ['main','expansion','catalogue_evidence'] for item in result.get(tier,[])]
 sources=[r.get('source_entity_id') or r.get('entity_id') or r['id'] for r in items]
 refs=[str(r['source_ref']) for r in items if r.get('source_ref') and (r.get('profile_type')=='ORIGINAL_POI_KEY_SOURCE_PROFILE' or result.get('search_mode')=='activity')]
 records=batch_lookup(knowledge,'contract_records',os.environ.get('FARQ_GOLDEN_INDEX'),refs,'SELECT poi_key,name,website,activity FROM profiles WHERE poi_key IN ({})')
 observations=batch_lookup(knowledge,'contract_observations',getattr(knowledge,'path',None),[s for s in sources if not s.startswith(('COMMERCIAL_PROFILE','GOLDEN_SOURCE_PROFILE'))],'SELECT id,name,host,activity FROM observations WHERE id IN ({})')
 linked_records=batch_lookup(knowledge,'contract_identity',os.environ.get('FARQ_COMMERCIAL_REGISTRY'),sources,'SELECT s.source_id,e.id,e.identity_basis,e.legal_status FROM entity_sources s JOIN entities e ON e.id=s.entity_id WHERE s.source_id IN ({})')
 quality_records=batch_lookup(knowledge,'contract_quality',os.environ.get('FARQ_ACTIVITY_QUALITY'),[r[0] for r in linked_records.values() if r],'SELECT entity_id,commercial_name,primary_activity,secondary_activities,source_categories,conflicts,activity_confidence,role_candidates,source_count,classification_status FROM activity_quality WHERE entity_id IN ({})')
 domain_profiles=batch_lookup(knowledge,'contract_domain_names',getattr(knowledge,'path',None),[s for s in sources if s.startswith('COMMERCIAL_PROFILE')],'SELECT id,display_name,name_basis FROM commercial_profiles WHERE id IN ({})',optional_table='commercial_profiles')
 branch_sources=[b.get('source_entity_id') for item in items for b in (item.get('commercial_group') or {}).get('branches',[]) if b.get('source_entity_id')]
 internal=batch_lookup(knowledge,'internal_contacts',os.environ.get('FARQ_INTERNAL_CONTACTS'),sources+branch_sources,'SELECT source_id,payload FROM contacts WHERE source_id IN ({})')
 for tier in ['main','expansion','catalogue_evidence']:
  for item in result.get(tier,[]):
   for branch in (item.get('commercial_group') or {}).get('branches',[]):
    sid=branch.get('source_entity_id')
    if internal.get(sid):
     recovered_branch=json.loads(internal[sid][0]);branch['public_source_contacts']={k:recovered_branch[k] for k in ['phone','email']};branch['contact_provenance']=recovered_branch
   source=item.get('source_entity_id') or item.get('entity_id') or item['id'];name=item['name'];website=item.get('source_url');record=None
   if item.get('source_ref') and (item.get('profile_type')=='ORIGINAL_POI_KEY_SOURCE_PROFILE' or result.get('search_mode')=='activity'):
    record=records.get(str(item['source_ref']))
    if record:name,website,_=record
   if record is None:
    record=observations.get(source)
    if record:name,website,_=record
   if domain_profiles.get(source):
    profile_name,profile_basis=domain_profiles[source]
    item['commercial_source_title']=item.get('commercial_source_title') or item['name'];name=profile_name;item['display_name_basis']=profile_basis
   # Domain-only source profiles retain a provisional source anchor, not a company-name claim.
   basis=identity_basis(source,name,website) if record else identity_basis(source,'',None)
   linked=linked_records.get(source)
   if linked:basis.update(id=linked[0],basis=linked[1],legal_status=linked[2])
   qrow=quality_records.get(basis['id'])
   if qrow:item['unified_activity']={'commercial_name':qrow[0],'primary_activity':qrow[1],'secondary_activities':json.loads(qrow[2]),'original_source_categories':json.loads(qrow[3]),'conflicts':json.loads(qrow[4]),'relative_confidence':json.loads(qrow[5]),'institutional_role_candidates':json.loads(qrow[6]),'source_count':qrow[7],'status':qrow[8],'name_alone_is_proof':False,'confidence_method':'RELATIVE_HEURISTIC_NOT_CALIBRATED'}
   item['source_entity_id']=source;item['commercial_identity']={**basis,'display_name':name,'source_id':source,'permanent_role':None}
   item['entity_id']=basis['id'];item['branch_id']=stable_id('BRANCH_SOURCE',source,item.get('city'),item.get('district'))
   role=item.get('role','organization');kind=item.get('evidence_kind','')
   current=kind=='FIRST_PARTY_PUBLIC_OPEN_REQUEST';historical=kind in ['HISTORICAL_RETAIL_PRICE','HISTORICAL_PURCHASE_REQUEST']
   state='CURRENT_PUBLIC_REQUEST_PUBLICATION_ONLY' if current else 'HISTORICAL_SOURCE_NOT_CURRENT' if historical else 'SOURCE_PRODUCT_OR_FAMILY_EVIDENCE' if item.get('level') in ['A','B'] and role=='seller' else 'POTENTIAL_ACTIVITY_INFERENCE' if role!='organization' else 'ACTIVITY_ONLY_ROLE_UNKNOWN'
   relation_id=stable_id('COMMERCIAL_RELATION',basis['id'],normalize(text),direction,source)
   item['commercial_relationship']={'id':relation_id,'entity_id':basis['id'],'subject':text,'objective':direction,'role':role,'commercial_function':item.get('commercial_function','user_potential' if role=='buyer' else role),'evidence_state':state,'level':item.get('level'),'current_demand':current,'product_stock':'UNKNOWN','source_ref':item.get('source_ref') or item.get('source_url'),'source_date':item.get('observed_at'),'reason':item.get('reason'),'verified':item.get('verified',False),'partnership_interest':'UNKNOWN','policy_requirements':'NOT_ASSESSED'}
   contacts=item.get('public_source_contacts') or {};channels=item.get('contact_channels',[])
   recovered=json.loads(internal[source][0]) if internal.get(source) else None
   if recovered:
    contacts={k:sorted(set(contacts.get(k,[])+recovered[k])) for k in ['phone','email']};item['contact_provenance']=recovered
    channels=sorted(set(channels+[k for k in ['phone','email'] if contacts[k]]))
   website=website if website and '.' in domain(website) else None
   item['reachability']={'website':website if record else item.get('source_url'),'channel_presence':channels,'source_contacts':contacts,'verification':'SOURCE_RECORDED_NOT_LIVE_VERIFIED','needs_enrichment':not bool(channels or website),'contact_completion_needed':not any(contacts.get(k) for k in ['phone','email']), 'actual_values_available':bool(any(contacts.get(k) for k in ['phone','email'])),'enrichment_allowed':False,'serper_calls':0,'max_paid_searches_per_entity':1,'source_scope':source,'borrowed_from_other_branch':False}
 result['dimensions']={'coverage':'RECOVERED_SOURCE_ASSETS_NOT_WHOLE_MARKET','relationships':'CONTEXTUAL_NOT_PERMANENT','reachability':'INDEPENDENT_OF_PRODUCT_FIT'}
 # Compatibility arrays point to the enriched objects; identity carries no permanent role.
 if 'main' in result:result['direct']=result['main']
 if 'expansion' in result:result['potential']=result['expansion']
 return result
