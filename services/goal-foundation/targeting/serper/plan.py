"""Offline planner over stable identities. No provider calls, secrets or approval inference."""
import json,argparse
from pathlib import Path

def plan(rows):
    by_identity={}
    for row in rows:
        identity=row.get('entity_id') or row.get('poi_key')
        if not identity or row.get('has_whatsapp') or row.get('reachability',{}).get('contact_completion_needed') is False:continue
        previous=by_identity.get(identity)
        if previous is None or (row.get('score') or 0)>(previous.get('score') or 0):by_identity[identity]=row
    targets=sorted(by_identity.values(),key=lambda r:(-(r.get('score') or 0),str(r.get('entity_id') or r.get('poi_key'))))
    return {'targets':targets,'businesses':len(targets),'maximum_search_credits':len(targets),'max_searches_per_identity':1,'approved_credit_cap':0,'approved':False,'note':'Offline priority list; requires explicit approved cap. Exactly one attempt per stable identity, no automatic maps retry, no sends or source writes.'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args()
    rows=json.loads(Path(a.input).read_text());rows=rows.get('rows',[]) if isinstance(rows,dict) else rows
    Path(a.output).write_text(json.dumps(plan(rows),ensure_ascii=False,indent=2))
