"""Evidence freshness is distinct from web observation freshness."""
from datetime import datetime

def state(e,as_of):
 if e.get('identity_status')=='CONFLICTED':return 'CONFLICTED'
 if e.get('decision')=='POTENTIAL':return 'POTENTIAL'
 if e.get('role')=='SELLER':return 'OFFER_OBSERVED_DATE_UNKNOWN' if not e.get('evidence_date') else 'DATED_OFFER'
 if e.get('role')!='BUYER':return 'UNKNOWN'
 if e.get('source_status') in ['closed','cancelled']:return 'HISTORICAL'
 if e.get('source_status')=='active' and e.get('deadline'):
  deadline=datetime.fromisoformat(e['deadline']);now=datetime.fromisoformat(as_of)
  return 'CURRENT_OPEN' if deadline>now else 'HISTORICAL'
 return 'HISTORICAL' if e.get('evidence_date') else 'UNKNOWN'
