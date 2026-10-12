"""City-context exact reference candidates only; no official/SPL IDs fabricated."""
import csv,json,hashlib,sys,collections
from pathlib import Path
p=Path(sys.argv[1]); ref=Path(sys.argv[2]); d=json.loads(ref.read_text()); lookup=collections.defaultdict(list)
for x in d['locations']:
 if x['type']=='district':
  for name in [x.get('name_ar'),x.get('name_en')]:
   if name:lookup[(x['parent_id'],name.strip().lower())].append(x)
city_names={'riyadh':'riyadh','الرياض':'riyadh','jeddah':'jeddah','جدة':'jeddah','dammam':'dammam','الدمام':'dammam','makkah':'makkah','مكة المكرمة':'makkah','madinah':'madinah','المدينة المنورة':'madinah','khobar':'khobar','الخبر':'khobar'}
src=p/'geo-normalization-audit.csv'; tmp=p/'geo-normalization-audit.tmp'; counts=collections.Counter()
with src.open(encoding='utf-8-sig') as f,tmp.open('w',encoding='utf-8-sig',newline='') as o:
 reader=csv.DictReader(f); fields=list(dict.fromkeys(reader.fieldnames+['reference_candidate_id','reference_name_ar','reference_source_codes','reference_status'])); writer=csv.DictWriter(o,fields);writer.writeheader()
 for r in reader:
  en=city_names.get(r['city_en'].strip().lower()); ar=city_names.get(r['city_ar'].strip().lower()); city=en or ar
  if en and ar and en!=ar:r['reason']='CITY_LANGUAGE_CONFLICT';city=None
  matches=lookup.get(('city:'+city,r['original_label'].strip().lower()),[]) if city and r['level']=='district' else []
  unique={x['district_id']:x for x in matches}
  if len(unique)==1:
   x=next(iter(unique.values())); r.update(reference_candidate_id=x['district_id'],reference_name_ar=x['name_ar'],reference_source_codes=json.dumps(x.get('source_codes',[])),reference_status='EXACT_CONTEXT_REFERENCE_PENDING_LICENSE',normalization_status='REFERENCE_CANDIDATE',reason='Exact district alias inside identified city; source assertion and license not independently verified')
  else:r['reference_status']='UNRESOLVED'
  counts[r['scope']+':'+r['normalization_status']]+=1;writer.writerow(r)
tmp.replace(src);(p/'geography-reference-summary.json').write_text(json.dumps({'reference_sha256':hashlib.sha256(ref.read_bytes()).hexdigest(),'counts_of_aggregate_rows_not_businesses':counts,'official_ids_assigned':0},indent=2))
print(json.dumps(counts))
