"""Classify staged exact-ID Farq candidates using source category labels and Farq's approved lexicon.
Runs only on the existing Farq target server. Recurring unmapped/ambiguous labels receive stable source-class IDs,
with links to any candidate Farq subcategories kept separately; no sales/buying roles are invented.
"""
import csv, hashlib, json, re, sys
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, '/tmp/farq-audit-libs')
import shapefile
import duckdb
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden'; TAX=Path('/app/data/taxonomy')
BASE=GOLD/'farq_golden_v1.parquet'; OUT=GOLD/'classification'
OUT.mkdir(exist_ok=True)
TR=str.maketrans('أإآةىؤئ','اااهيوي')
GENERIC={'مواد','معدات','خدمات','اجهزه','مستلزمات','ادوات','منتجات','قطع','اعمال','محل','محلات','شركه','مؤسسه','مكتب','مركز','تجاره','بيع','عامه','عام','جمله','services','service','equipment','supplies','products','materials','parts','store','shop','company','general','trading','wholesale','retail','center','office','other','and','the','business'}
def norm(s):
 s=(s or '').lower().translate(TR); s=re.sub('[ً-ْـ]','',s); s=re.sub(r"[_/\\–|(),.&{}\[\]\"'’:;!؟?،+*#]+",' ',s); return re.sub(r'\s+',' ',s).strip()
def phrase_match(name,term): return (' '+term+' ') in (' '+name+' ')
def split_labels(x): return [norm(v) for piece in (x or '').splitlines() for v in re.split(r'\s+/\s+',piece) if norm(v)]

tax=json.load(open(TAX/'farq_taxonomy.json',encoding='utf-8')); subs={s['sub_id']:s for s in tax['subs']}
# Only approved, non-generic, supported lexicon entries; non-name labels may classify a source label exactly.
lex_by_term=defaultdict(set); name_terms=[]
for r in csv.DictReader(open(TAX/'search_lexicon.csv',encoding='utf-8')):
 term=norm(r['term']); sid=r['sub_id']; sources=set(r['sources'].split('|'))
 try: share=float(r['share']); support=float(r['support'])
 except: continue
 if sid not in subs or sid.startswith(('unc.','noncom.')) or len(term)<3 or term in GENERIC or share<0.6 or support<5: continue
 lex_by_term[term].add(sid)
 if 'name_mining' in sources or len(term.split())>=1: name_terms.append((term,sid,share,support))

# Pull new candidates and exact QGIS category labels by CardSyncod (= exact SynCode).
db=duckdb.connect(); p=lambda x:"'"+str(x).replace("'","''")+"'"
db.execute(f"create table cand as select source_coordinate_id as id, source_coordinate_name as nm from read_parquet({p(BASE)}) where golden_match_method='coordinate_license_exact'")
candidates={r[0]:norm(r[1]) for r in db.execute('select id,nm from cand').fetchall()}
labels_by_id=defaultdict(set); global_label_counts=Counter()
sf=shapefile.Reader('/app/data/buildings_ingest/firms_source/Firms with trade license.shp',encoding='utf-8')
for record in sf.iterRecords():
 d=record.as_dict(); cid=str(d.get('CardSyncod') or '').strip()
 cats=split_labels(str(d.get('Categories') or ''))
 for label in set(cats): global_label_counts[label]+=1
 if cid in candidates: labels_by_id[cid].update(cats)
sf.close()
# Source label -> possible Farq classes through exact lexicon label mapping.
label_map={label:set(lex_by_term.get(label,set())) for label in global_label_counts}
# Source categories not present in lexicon still receive an ID only if repeated in this exact source.
source_classes={}
for label,n in global_label_counts.items():
 possible=label_map.get(label,set())
 if n>=2 and len(possible)!=1:
  cid='src2gis.'+hashlib.sha1(label.encode('utf-8')).hexdigest()[:12]
  source_classes[label]={'source_class_id':cid,'source_class_label':label,'source_rows':n,'proposed_farq_sub_ids':sorted(possible),'mapping_status':'unmapped' if not possible else 'ambiguous'}

# Name rule index: longest phrase wins; a tie across distinct Farq categories is unresolved.
name_index=defaultdict(set)
for term,sid,share,support in name_terms:
 if len(term.split())>1 or len(term)>=5:
  name_index[term].add(sid)
# candidate names are small enough for token ngram lookup, avoiding fuzzy match.
assign=[]; evidence_counts=Counter(); category_usage=Counter(); ambiguous_count=0
for ident,name in candidates.items():
 labels=sorted(labels_by_id.get(ident,set()))
 mapped=set().union(*(label_map.get(label,set()) for label in labels)) if labels else set()
 src_ids=sorted(source_classes[label]['source_class_id'] for label in labels if label in source_classes)
 if len(mapped)==1:
  sid=next(iter(mapped)); confidence='high'; method='exact_2gis_category_label'; proposed=[sid]
 elif len(mapped)>1:
  sid=None; confidence='unknown'; method='ambiguous_2gis_source_categories'; proposed=sorted(mapped); ambiguous_count+=1
 else:
  words=name.split(); hits=[]
  padded=' '+name+' '
  # exact whole-token category phrases only. No spelling-distance/fuzzy matches.
  for n in range(min(5,len(words)),0,-1):
   for i in range(len(words)-n+1):
    term=' '.join(words[i:i+n])
    ids=name_index.get(term)
    if ids and phrase_match(name,term): hits.append((n,term,ids))
   if hits: break
  if hits:
   top=max(x[0] for x in hits); best=set().union(*(x[2] for x in hits if x[0]==top))
   if len(best)==1:
    sid=next(iter(best)); confidence='medium'; method='unique_farq_lexicon_name'; proposed=[sid]
   else:
    sid=None; confidence='unknown'; method='ambiguous_farq_lexicon_name'; proposed=sorted(best); ambiguous_count+=1
  else: sid=None; confidence='unknown'; method='no_taxonomy_evidence'; proposed=[]
 # Repeated source category is a real sourced class even when it cannot safely map to one Farq subcategory.
 if not src_ids and labels: src_ids=sorted(source_classes[x]['source_class_id'] for x in labels if x in source_classes)
 row={'poi_key':'urbi_coords:'+ident,'sub_id':sid,'cls_confidence':confidence,'classification_method':method,
      'source_category_labels':' | '.join(labels) or None,'source_class_ids':' | '.join(src_ids) or None,
      'proposed_farq_sub_ids':' | '.join(proposed) or None,'taxonomy_extension_required':bool(src_ids)}
 assign.append(row); evidence_counts[method]+=1
 if sid: category_usage[sid]+=1
# Write compact CSV then Parquet; a companion registry is the new, source-only taxonomy extension.
fields=list(assign[0])
csvpath=OUT/'candidate_classification.csv'
with csvpath.open('w',encoding='utf-8',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(assign)
registry=[]
for label,x in source_classes.items():
 used=sum(1 for ident in labels_by_id if label in labels_by_id[ident])
 if used>=2:
  registry.append({**x,'candidate_count':used,'roles':None,'role_status':'not_inferred','source':'QGIS Firms Categories; exact CardSyncod to SynCode'})
json.dump({'source_class_count':len(registry),'classes':registry},open(OUT/'source_category_registry.json','w'),ensure_ascii=False,indent=2)
db.execute(f"copy (select * from read_csv({p(csvpath)},all_varchar=true,header=true,nullstr='')) to {p(OUT/'candidate_classification.parquet')} (format parquet,compression zstd)")
report={'candidate_rows':len(assign),'source_label_linked_candidates':sum(bool(labels_by_id.get(k)) for k in candidates),
 'classified_farq_high':evidence_counts['exact_2gis_category_label'],'classified_farq_medium':evidence_counts['unique_farq_lexicon_name'],
 'unclassified_ambiguous':evidence_counts['ambiguous_2gis_source_categories']+evidence_counts['ambiguous_farq_lexicon_name'],
 'unclassified_no_evidence':evidence_counts['no_taxonomy_evidence'],'classification_methods':dict(evidence_counts),
 'source_class_registry_rows':len(registry),'recurring_source_class_candidates':sum(x['candidate_count'] for x in registry),
 'unresolved_source_category_links':sum(1 for x in registry if x['mapping_status']!='mapped'),
 'categories_by_farq_sub_id':dict(category_usage.most_common(50)),
 'policy':'exact source category links are high; unique whole-phrase Farq lexicon name hits are medium; ties stay unclassified. Recurring source categories get stable source IDs without inferred market roles.'}
json.dump(report,open(OUT/'classification_report.json','w'),ensure_ascii=False,indent=2); print(json.dumps(report,ensure_ascii=False,indent=2))
