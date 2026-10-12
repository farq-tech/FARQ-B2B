"""Deterministic baseline evaluation, no network or writes to application data."""
import json
from pathlib import Path
from baseline import interpret
from core import DIRECTIONS, Entity, Evidence, discover
from datetime import datetime,timedelta,timezone
ROOT=Path(__file__).resolve().parent
NOW=datetime(2026,10,12,tzinfo=timezone.utc)
results=[]
for case in json.loads((ROOT/'fixtures/direction-cases.json').read_text()):
 result=interpret(case['text'],sector=case['sector'],owner_id='fixture-owner',city_id=case['city_id'],fixture_subject=case['expected_subject'])
 g=result.get('goal')
 understood=bool(g and g.objective.value==case['expected_objective'] and g.subject_id==case['expected_subject'] and g.owner_role.value==case['expected_owner_role'] and g.target_role.value==case['expected_target_role'])
 # Expected targets originate from separately declared fixture facts, not the interpretation.
 profiles=[('seller','offers_product'),('buyer','uses_product'),('partner','distribution_interest'),('name_only',None)]
 entities=[]
 for identity,predicate in profiles:
  evidence=() if not predicate else (Evidence(identity,identity,case['expected_subject'],predicate,'first_party_statement',f'fixture://{identity}',f'Synthetic explicitly declared {predicate}',NOW-timedelta(days=1),NOW+timedelta(days=30)),)
  entities.append(Entity(identity,'Synthetic '+identity,'Riyadh','name/activity must not count',evidence))
 actual=discover(g,entities,NOW) if g else {'rows':[]}
 ids=[x['entity_id'] for x in actual['rows']]
 expected={'marketing':['buyer'],'purchase':['seller'],'availability':['seller'],'partnership':['partner']}[case['expected_objective']]
 results.append({'case':case['id'],'understood':understood,'correct_target':ids==expected,'actual_targets':ids,'expected_targets':expected})
report={'dataset':'synthetic_direction_contract_only', 'product_understanding':'NOT_TESTED_BY_THIS_BENCHMARK','cases':len(results),'direction_contract_passed':sum(r['understood'] for r in results),'correct_target':sum(r['correct_target'] for r in results),'critical_direction_inversions':sum(r['actual_targets']!=r['expected_targets'] for r in results),'independently_reviewed':0,'real_entity_precision':'NOT_MEASURED','phase1_gate':'BLOCKED_INDEPENDENT_RELEVANCE_VALIDATION','details':results}
print(json.dumps(report,ensure_ascii=False,indent=2))
