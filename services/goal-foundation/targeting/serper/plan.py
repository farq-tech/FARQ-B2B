"""Offline planner. Calls no provider and reads no secrets."""
import json
import argparse
from pathlib import Path

def plan(rows):
    targets=[r for r in rows if not r.get('has_whatsapp')][:3]
    return {'targets':targets,'businesses':len(targets),'maximum_search_credits':len(targets)*2,'approved':False,'note':'No calls without explicit owner approval; preserve original rank.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args()
    rows=json.loads(Path(a.input).read_text());rows=rows.get('rows',[]) if isinstance(rows,dict) else rows
    Path(a.output).write_text(json.dumps(plan(rows),ensure_ascii=False,indent=2))
