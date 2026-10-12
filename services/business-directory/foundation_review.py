"""Validate blind review integrity; no substitute for independent human assessment."""
import csv,json,sys
from pathlib import Path
p=Path(sys.argv[1]); rows=list(csv.DictReader((p/'human-review-sample.csv').open(encoding='utf-8-sig')))
assert len(rows)==400 and len({r['source_record_id'] for r in rows})==400
assert not any(k.startswith('system_') or k in ['confidence','stratum','decision'] for k in rows[0])
completed=[r for r in rows if r['review_status']=='REVIEWED' and r['reviewer_id'].strip()]
metrics={k:None for k in ['precision','recall','city_accuracy','district_accuracy','main_activity_accuracy','detailed_activity_accuracy','high_confidence_error_rate','false_entity_merge_rate']}
result={'status':'PENDING_HUMAN_REVIEW' if len(completed)<400 else 'PENDING_AXIS_SPECIFIC_ADJUDICATION','records':400,'completed':len(completed),'metrics':metrics,'population_estimates':'NOT_ESTIMABLE_FROM_QUOTA_SAMPLE_WITHOUT_INCLUSION_PROBABILITIES'}
(p/'human-review-status.json').write_text(json.dumps(result,indent=2)); print(json.dumps(result))
