# coding: utf-8
"""Goal-specific reversible presentation groups; never legal merges or contact transfer."""
import re
from identity import normalize,domain,stable_id

# Alias evidence is saved source naming plus reported brand domain, not parent ownership.
BRAND_ALIASES={'dunkin':{'دانكن','دانكن دونتس','دانكن دونات','dunkin','dunkin donuts',"dunkin'"}}
GENERIC={'company','store','shop','مقهى','مقهي','مطعم','شركه','مؤسسه','تموينات','بقاله','مدرسه','صيدليه','قهوه','كوفي','cafe','coffee shop'}

def label(row):
 name=normalize(row.get('name',''))
 # Remove explicit presentation suffixes, never strip arbitrary distinctive words.
 name=re.sub(r'[,،]\s*(?:مقه[ىي]|مطعم|coffee shop|restaurant)$','',name).strip()
 for brand,aliases in BRAND_ALIASES.items():
  if name in aliases:return brand,'SAVED_SOURCE_BRAND_ALIAS_CANDIDATE'
 # Only explicitly marked branch suffixes can be removed.
 name=re.sub(r'\s+(?:فرع|branch)\s+.+$','',name).strip()
 if name in GENERIC or len(name)<4:return None,None
 return name,'EXACT_DISTINCTIVE_NAME_COMPATIBLE_ACTIVITY_PRESENTATION_ONLY'

def location(row,city_key):
 city=city_key(row.get('city') or '')
 district=normalize(row.get('district'))
 if not district or district.isdigit():return None
 return city,district

def diversify(rows,direction,city_key=normalize):
 if not rows:return []
 # Name alone cannot reconcile ownership; different explicit hosts split a display group.
 names={};groups={};result=[]
 for row in rows:
  key,basis=label(row)
  if key:
   host=domain(row.get('source_website') or row.get('reachability',{}).get('website') or row.get('source_url'))
   if host and ('.' not in host or host in {'salla.sa','instagram.com','facebook.com'}):host=''
   names.setdefault(key,set()).add(host)
 for row in rows:
  name,basis=label(row);host=domain(row.get('source_website') or row.get('reachability',{}).get('website') or row.get('source_url'))
  if '.' not in host:host=''
  activity=row.get('activity_assessment',{}).get('primary_activity') or row.get('unified_activity',{}).get('primary_activity') or row.get('commercial_function')
  entity=row.get('commercial_identity',{}).get('id')
  parent=row.get('confirmed_parent_identity')
  if parent and parent.get('verified') and parent.get('evidence_ref'):key=('parent',parent['id']);basis='EXPLICIT_VERIFIED_PARENT_RELATION'
  elif entity and row.get('commercial_identity',{}).get('basis')=='EXACT_NAME_REPORTED_DOMAIN_CANDIDATE':key=('entity',entity);basis='EXISTING_REVERSIBLE_COMMERCIAL_IDENTITY'
  elif name:
   hosts={h for h in names[name] if h}
   key=('display',name,activity,host if len(hosts)>1 else '')
  else:key=('source',row.get('source_entity_id') or row['id']);basis='SOURCE_IDENTITY_NO_NAME_COLLAPSE'
  # Local seller discovery keeps distinct locations and unknown branches separate.
  if direction in ['purchase','availability','activity']:
   loc=location(row,city_key)
   key+=('local_source_branch',(row.get('confirmed_branch_relation',{}).get('id') if row.get('confirmed_branch_relation',{}).get('verified') and row.get('confirmed_branch_relation',{}).get('evidence_ref') else None) or row.get('source_entity_id') or row.get('source_ref') or row['id'])
  if key not in groups:
   representative=dict(row);representative['_group_basis']=basis;groups[key]=[representative];result.append((key,representative))
  else:groups[key].append(row)
 output=[]
 for key,row in result:
  members=groups[key];basis=row.pop('_group_basis');locations={location(r,city_key) for r in members}-{None}
  if len(members)>1:
   row['commercial_group']={'id':stable_id('PRESENTATION_GROUP',*key),'basis':basis,'legal_merge':False,'parent_relationship_proven':basis=='EXPLICIT_VERIFIED_PARENT_RELATION','source_record_count':len(members),'known_branch_count':None,'source_locality_count':len(locations),'branch_count_scope':'UNCONFIRMED_DISTINCT_SOURCE_RECORDS_NOT_PROVEN_BRANCHES','unlocated_source_records':sum(location(r,city_key) is None for r in members),'branches':[{'id':r.get('branch_id') or stable_id('BRANCH_SOURCE',r.get('source_entity_id') or r['id'],r.get('city'),r.get('district')),'source_entity_id':r.get('source_entity_id') or r.get('entity_id'),'source_ref':r.get('source_ref'),'source_url':r.get('source_url'),'source_website':r.get('source_website'),'name':r['name'],'city':r.get('city'),'district':r.get('district'),'observed_at':r.get('observed_at'),'contact_channels':r.get('contact_channels',[]),'public_source_contacts':r.get('public_source_contacts',{}),'evidence_excerpt':r.get('evidence_excerpt'),'level':r.get('level'),'score':r.get('score'),'borrowed_from_other_branch':False} for r in members],'goal':direction}
  output.append(row)
 return output
