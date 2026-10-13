"""Plan only: one search per provisional stable identity; approved budget is zero."""
import json,importlib.util
from pathlib import Path

def prepare(results):
 queue={}
 for result in results:
  for row in result.get('main',[])+result.get('expansion',[]):
   if not row.get('reachability',{}).get('contact_completion_needed',True):continue
   identity=row.get('commercial_identity',{}).get('id')
   if not identity:continue
   q={'entity_id':identity,'source_id':row.get('source_entity_id'),'name':row.get('commercial_identity',{}).get('display_name') or row['name'],'city':row.get('city'),'priority':row.get('score',0),'query':(row.get('commercial_identity',{}).get('display_name') or row['name'])+' السعودية','maximum_queries':1,'approved_budget':0,'execution_allowed':False,'status':'AWAITING_EXPLICIT_BUDGET','match_policy':'DISTINCTIVE_NAME_AGREEMENT_REQUIRED_NO_SNIPPET_PRODUCT_PROOF','source_refs':[row.get('source_ref') or row.get('source_url')]}
   if identity not in queue or q['priority']>queue[identity]['priority']:queue[identity]=q
 # Reuse the existing targeting planner rather than a parallel enrichment engine.
 path=Path(__file__).parents[1]/'goal-foundation/targeting/serper/plan.py'
 spec=importlib.util.spec_from_file_location('farq_existing_serper_plan',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 prepared=[{**r,'score':r['priority']} for r in queue.values()]
 return module.plan(prepared)['targets']
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('results');p.add_argument('out');a=p.parse_args();Path(a.out).write_text(json.dumps(prepare(json.loads(Path(a.results).read_text())),ensure_ascii=False,indent=2))
