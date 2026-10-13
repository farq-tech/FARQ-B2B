"""Stable source-observation identity overlay; never claims legal merges."""
import hashlib,json,re,unicodedata
from urllib.parse import urlsplit

def stable_id(kind,*parts):
    return kind+'-'+hashlib.sha256(json.dumps(parts,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:32]

def normalize(value):
    text=unicodedata.normalize('NFKC',str(value or '')).lower()
    text=re.sub(r'[\u064b-\u065fـ]','',text).translate(str.maketrans({'أ':'ا','إ':'ا','آ':'ا','ى':'ي','ة':'ه'}))
    return re.sub(r'\s+',' ',text).strip()

def domain(value):
    try:
        value=str(value or '').strip()
        return (urlsplit(value if '://' in value else 'https://'+value).hostname or '').lower().removeprefix('www.')
    except ValueError:return ''

def observation_id(source_id,record_uid):
    if not source_id or not record_uid:raise ValueError('SOURCE_LINEAGE_REQUIRED')
    return stable_id('OBS',source_id,record_uid)

def reconcile(saved,current_records):
    """Page assignment is a review proposal, not an entity or ownership merge."""
    name=normalize(saved.get('supplier_name'));host=domain(saved.get('canonical_url') or saved.get('url'))
    candidates=[]
    for r in current_records:
        names={normalize(r.get(k)) for k in ('name_ar','name_en','tradename','legal_name') if r.get(k)}
        if name and name in names and host and domain(r.get('website_raw') or r.get('website'))==host:
            candidates.append(observation_id(r['source_id'],r['record_uid']))
    candidates=sorted(set(candidates))
    return {'decision':'SOURCE_LINEAGE_REVIEW_CANDIDATE' if len(candidates)==1 else 'AMBIGUOUS_IDENTITY' if candidates else 'IDENTITY_UNRESOLVED',
            'candidate_observation_ids':candidates,'automatic_legal_merge':False,
            'basis':['EXACT_NORMALIZED_SOURCE_NAME','SAME_SOURCE_WEBSITE_HOST'],
            'required':['brand_legal_relationship','branch_product_relationship'],
            'legacy_key_used_as_identity':False}
