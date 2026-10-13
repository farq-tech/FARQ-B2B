"""Stable source-observation identity overlay; never claims legal merges."""
import hashlib,json,re,unicodedata
from functools import lru_cache
from urllib.parse import urlsplit

def stable_id(kind,*parts):
    return kind+'-'+hashlib.sha256(json.dumps(parts,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:32]

_AR_TRANSLATION=str.maketrans({'أ':'ا','إ':'ا','آ':'ا','ى':'ي','ة':'ه'})
_MARKS=re.compile(r'[\u064b-\u065fـ]');_SPACE=re.compile(r'\s+')
@lru_cache(maxsize=30000)
def _short_normalize(text):
    return _normalize(text)
def _normalize(text):
    text=unicodedata.normalize('NFKC',text).lower()
    text=_MARKS.sub('',text).translate(_AR_TRANSLATION)
    return _SPACE.sub(' ',text).strip()
def normalize(value):
    text=str(value or '')
    return _short_normalize(text) if len(text)<=2000 else _normalize(text)

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
