"""Conservative, reviewable triage, not a legal business registry classifier."""
import re,json,argparse,collections
from pathlib import Path
import duckdb
LAND=re.compile(r'^(mosques?|public parks?|nature|cultural sites|tourist attraction|historical landmark|cemetery|parking lot|apartment building|residential building|bus stop|road|bridge)$',re.I)
BUS=re.compile(r'restaurant|coffee|cafe|grocery|pharmac|beauty|automotive|hotel|home goods|shopping|corporate|bank|contract|plumb|building.material|electrical|equipment.rental|steel.metal|aluminium.glass|decor.carpentry|store|shop|supplier|manufacturer|factory|تجارة|مطعم|مقهى|مقاول|صيدلي',re.I)
NAME_BUS=re.compile(r'\b(company|corporation|establishment|restaurant|pharmacy|factory|contracting|grocery|store|trading|shop|tailor)\b|شركة|مؤسسة|مطعم|صيدلية|مصنع|تموينات|مقاولات|تجارة|محل',re.I)
ALIASES=json.loads(Path(__file__).with_name('category-aliases.json').read_text())
CATEGORY_MAP={alias.lower():group for group in ALIASES for alias in group['aliases']}
GENERIC={'شركة','مؤسسة','محل','مطعم','مقهى','سوبرماركت','بقالة','مسجد','company','restaurant','shop','store','unknown','unnamed','test','n/a'}
def classify(r):
 name=(r.get('name_ar') or r.get('name_en') or '').strip();cat=(r.get('category') or '').split('|')[0].strip()
 if not name:return 'UNRESOLVED','اسم مفقود'
 if name.lower() in GENERIC or len(name)<3 or name.isnumeric():return 'GENERAL_NAME','اسم عام أو غير مميز'
 if LAND.fullmatch(cat):return 'LANDMARK_OR_NONCOMMERCIAL','تصنيف مصدر لمعْلم أو موقع غير تجاري؛ لم يتحقق مستقلًا'
 if re.search(r"\b(house|home of|mosque|park|cemetery)\b|^مسجد\s|^جامع\s",name,re.I) and not BUS.search(cat):return 'LANDMARK_OR_NONCOMMERCIAL','إشارة اسم إلى معلم أو منزل، دون نشاط تجاري مسنود'
 mapped=CATEGORY_MAP.get(cat.lower())
 if mapped and mapped['canonical_id']=='activity-review:landmark':return 'LANDMARK_OR_NONCOMMERCIAL','تصنيف مصدر موحّد لمعْلم أو موقع؛ يحتاج تحققًا'
 if mapped and mapped['commercial_candidate']:return 'SEARCHABLE_BUSINESS_CANDIDATE','اسم مميز ونشاط مصدر بعد توحيد التصنيف؛ لا يثبت البيع أو الشراء'
 if BUS.search(cat):return 'SEARCHABLE_BUSINESS_CANDIDATE','اسم مميز وتصنيف مصدر تجاري؛ الهوية والنشاط يحتاجان تحققًا'
 if NAME_BUS.search(name):return 'NAME_ONLY_BUSINESS_CANDIDATE','الاسم يوحي بمنشأة؛ لا تصنيف تجاري كافٍ'
 return 'UNRESOLVED','لا دليل كافٍ للفصل بين منشأة أو اسم عام أو معلم'
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();c=duckdb.connect();c.execute('set threads=2');c.read_parquet(a.source).create_view('r')
 cur=c.execute("select poi_key,name_ar,name_en,category,phone_norm,company_status from r where lower(trim(city_en))='riyadh' order by poi_key");names=[x[0] for x in cur.description];counts=collections.Counter();missing=collections.Counter();examples=collections.defaultdict(list);closed=collections.Counter()
 while True:
  batch=cur.fetchmany(10000)
  if not batch:break
  for raw in batch:
   r=dict(zip(names,raw));group,reason=classify(r);counts[group]+=1
   if not (r['phone_norm'] or '').strip():missing[group]+=1
   if 'closed' in (r['company_status'] or '').lower():closed[group]+=1
   if len(examples[group])<12:examples[group].append({k:r[k] for k in ['poi_key','name_ar','name_en','category']}|{'reason':reason})
 n=sum(counts.values());result={'records':n,'grain':'source records, not deduplicated companies','method':'conservative offline lexical triage; not independently validated; no complete market taxonomy','counts':{k:{'records':v,'pct':round(v/n*100,2),'missing_phone':missing[k],'closed_status':closed[k]} for k,v in counts.items()},'examples':examples,'precision':None,'recall':None}
 a.out.mkdir(parents=True,exist_ok=True);(a.out/'searchability.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='examples'},ensure_ascii=False))
