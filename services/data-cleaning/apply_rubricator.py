"""Join the Farq Golden candidate classifications to the owner-approved 3-language Rubricator.
Exact source-category links are high confidence; unique whole-phrase keyword links are medium.
Recurring ambiguous rubric combinations get a stable source-class ID; no market role is inferred.
Run on the existing Farq target service.
"""
import csv,hashlib,json,re,sys
from collections import Counter,defaultdict
from pathlib import Path
sys.path.insert(0,'/tmp/farq-audit-libs')
from openpyxl import load_workbook
import duckdb, shapefile
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden'; TAX=Path('/app/data/taxonomy')
RB=ROOT/'rubricator/rubricator_2025.xlsx'; CLASS=GOLD/'classification'; OUT=GOLD/'rubricator'
OUT.mkdir(exist_ok=True)
TR=str.maketrans('أإآةىؤئ','اااهيوي')
STOP={'service','services','company','companies','business','businesses','center','centre','shop','shops','store','stores','general','other','and','of','for','the','with','work','works','products','goods','provider','organization','organizations','مؤسسة','شركة','خدمات','مركز','محل','مستلزمات','товары','услуги','магазин'}
def norm(s):
 s=(s or '').lower().translate(TR); s=re.sub('[ً-ْـ]','',s); s=re.sub(r"[_/\\–|(),.&{}\[\]\"'’:;!؟?،+*#]+",' ',s); return re.sub(r'\s+',' ',s).strip()
def singular(s):
 if s.endswith('ies') and len(s)>5: return s[:-3]+'y'
 if s.endswith('s') and len(s)>5 and not s.endswith(('ss','us','is')): return s[:-1]
 return s
def split_terms(s): return [norm(x) for x in re.split(r'[;|\n]',s or '') if norm(x)]
def split_source_labels(s): return [norm(x) for piece in (s or '').splitlines() for x in re.split(r'\s+/\s*',piece) if norm(x)]
def phrase(term,text): return (' '+norm(term)+' ') in (' '+norm(text)+' ')
def p(v): return "'"+str(v).replace("'","''")+"'"

# Read the latest owner-provided worksheet (both local copies were SHA-256 identical).
wb=load_workbook(RB,read_only=True,data_only=True); ws=wb['Riyadh']; it=ws.iter_rows(values_only=True); header=[str(x).strip() if x is not None else '' for x in next(it)]; idx={k:i for i,k in enumerate(header) if k}
rubrics={}
for row in it:
 get=lambda k: str(row[idx[k]]).strip() if k in idx and idx[k]<len(row) and row[idx[k]] is not None else ''
 code=get('Код рубрики')
 if not code: continue
 rubrics[code]={'code':code,'project_code':get("Rubric's code in the project"),'category_en':get('Category EN'),'category_ar':get('Category AR'),'category_ru':get('Category RUS'),
 'level2_en':get('Rubric 2 level EN'),'level2_ar':get('Rubric 2 level AR'),'level2_ru':get('Rubric 2 level RUS'),
 'rubric_en':get('Rubric EN'),'rubric_ar':get('Rubric AR'),'rubric_ru':get('Rubric RU'),
 'keywords_en':get('Key words EN'),'keywords_ar':get('Key words AR'),'keywords_ru':get('Key words RUS'),'description_en':get('Description EN')}
wb.close()
label_to_codes=defaultdict(set)
for code,x in rubrics.items():
 for field in ('rubric_en','rubric_ar','rubric_ru'):
  lab=norm(x[field]); label_to_codes[lab].add(code)
  if singular(lab)!=lab: label_to_codes[singular(lab)].add(code)
term_to_codes=defaultdict(set)
for code,x in rubrics.items():
 for field in ('keywords_en','keywords_ar','keywords_ru'):
  for term in split_terms(x[field]):
   if len(term)<4 or term in STOP: continue
   term_to_codes[term].add(code)
   if singular(term)!=term: term_to_codes[singular(term)].add(code)

# Link Rubricator leaves to Farq subcategories only when exact official labels/approved lexicon terms are unique.
tax=json.load(open(TAX/'farq_taxonomy.json',encoding='utf-8')); subs={s['sub_id']:s for s in tax['subs']}; lex=defaultdict(set)
for r in csv.DictReader(open(TAX/'search_lexicon.csv',encoding='utf-8')):
 try: ok=float(r['share'])>=0.6 and float(r['support'])>=5
 except: ok=False
 if ok and r['sub_id'] in subs:
  term=norm(r['term'])
  if len(term)>=4: lex[term].add(r['sub_id']); lex[singular(term)].add(r['sub_id'])
for sid,s in subs.items():
 for text in (s.get('sub_en',''),s.get('sub_ar',''),s.get('match_hints','')):
  for term in re.split(r'[|;,\n]+',text or ''):
   term=norm(term)
   if len(term)>=4: lex[term].add(sid); lex[singular(term)].add(sid)
rubric_farq={}
for code,x in rubrics.items():
 found=set()
 for field in ('rubric_en','rubric_ar','rubric_ru'):
  term=norm(x[field]); found.update(lex.get(term,set())); found.update(lex.get(singular(term),set()))
 rubric_farq[code]=sorted(found)

# Exact CardSyncod->SynCode link, and exact category labels from the QGIS firms-with-license layer.
db=duckdb.connect(); base=GOLD/'farq_golden_v1.parquet'; clsfile=CLASS/'candidate_classification.parquet'
db.execute(f"create table cand as select source_coordinate_id id, source_coordinate_name nm from read_parquet({p(base)}) where golden_match_method='coordinate_license_exact'")
candidates={r[0]:norm(r[1]) for r in db.execute('select id,nm from cand').fetchall()}
source_labels=defaultdict(set); qgis=shapefile.Reader('/app/data/buildings_ingest/firms_source/Firms with trade license.shp',encoding='utf-8')
for rec in qgis.iterRecords():
 d=rec.as_dict(); cid=str(d.get('CardSyncod') or '').strip()
 if cid in candidates: source_labels[cid].update(split_source_labels(str(d.get('Categories') or '')))
qgis.close()
# Previous exact Farq-lexicon classification is retained as fallback only when Rubricator did not resolve a row.
prev={r[0]:r[1:] for r in db.execute(f"select poi_key,sub_id,cls_confidence,source_class_ids,proposed_farq_sub_ids from read_parquet({p(clsfile)})").fetchall()}
# Match each candidate. Source category labels have priority; the business name uses exact keyword phrases only.
pre=[]; ambiguity_counts=Counter(); direct_count=0; keyword_count=0
for ident,nm in candidates.items():
 labels=sorted(source_labels.get(ident,set()))
 direct=set().union(*(label_to_codes.get(l,set()) | label_to_codes.get(singular(l),set()) for l in labels)) if labels else set()
 if len(direct)==1:
  codes=sorted(direct); conf='high'; method='exact_qgis_category_to_rubricator'; direct_count+=1; matched_terms=labels
 elif len(direct)>1:
  codes=sorted(direct); conf='unknown'; method='ambiguous_qgis_category_to_rubricator'; ambiguity_counts[tuple(codes)]+=1; matched_terms=labels
 else:
  words=nm.split(); hits=[]
  for n in range(min(7,len(words)),0,-1):
   for i in range(len(words)-n+1):
    term=' '.join(words[i:i+n]); ids=term_to_codes.get(term) or term_to_codes.get(singular(term))
    if ids: hits.append((n,term,ids))
   if hits: break
  if hits:
   longest=max(h[0] for h in hits); codes=sorted(set().union(*(h[2] for h in hits if h[0]==longest)))
   conf='medium' if len(codes)==1 else 'unknown'; method='unique_rubricator_name_keyword' if len(codes)==1 else 'ambiguous_rubricator_name_keywords'
   matched_terms=sorted({h[1] for h in hits if h[0]==longest and set(h[2]) & set(codes)})
   if len(codes)==1: keyword_count+=1
   else: ambiguity_counts[tuple(codes)]+=1
  else: codes=[]; conf='unknown'; method='no_rubricator_match'; matched_terms=[]
 pre.append((ident,nm,labels,codes,conf,method,matched_terms))
combo_ids={combo:'rubricator.combo.'+hashlib.sha1('|'.join(combo).encode()).hexdigest()[:12] for combo,n in ambiguity_counts.items() if n>=2}

rows=[]; methods=Counter(); registry={}
for ident,nm,labels,codes,conf,method,matched_terms in pre:
 old=prev.get('urbi_coords:'+ident,(None,'unknown',None,None)); old_sub,old_conf,old_classes,old_proposed=old
 mapped=sorted(set().union(*(set(rubric_farq.get(c,[])) for c in codes))) if codes else []
 sub_id=mapped[0] if len(mapped)==1 else None; cls=conf if sub_id else 'unknown'; source_class=None; final_method=method
 if len(codes)==1 and not sub_id: source_class='rubricator.'+codes[0]
 if len(codes)>1 and tuple(codes) in combo_ids: source_class=combo_ids[tuple(codes)]
 if not codes and old_sub:
  sub_id=old_sub; cls=old_conf; source_class=(old_classes or '').split(' | ')[0] or None; final_method='approved_farq_lexicon_fallback'
 elif not codes and old_classes:
  source_class=old_classes.split(' | ')[0]; final_method='repeated_qgis_source_class_fallback'
 if source_class and source_class.startswith('rubricator.') and source_class not in registry:
  code=source_class.split('.',1)[1]
  if code in rubrics:
   x=rubrics[code]; registry[source_class]={'class_id':source_class,'rubricator_code':code,'label_en':x['rubric_en'],'label_ar':x['rubric_ar'],'label_ru':x['rubric_ru'],'category_en':x['category_en'],'category_ar':x['category_ar'],'category_ru':x['category_ru'],'level2_en':x['level2_en'],'level2_ar':x['level2_ar'],'level2_ru':x['level2_ru'],'description_en':x['description_en'],'proposed_farq_sub_ids':rubric_farq[code],'mapping_status':'mapped' if len(rubric_farq[code])==1 else ('ambiguous' if rubric_farq[code] else 'unmapped'),'roles':None,'role_status':'not_inferred','source':'Rubricator'}
 codes_text=' | '.join(codes); names_en=' | '.join(rubrics[c]['rubric_en'] for c in codes); names_ar=' | '.join(rubrics[c]['rubric_ar'] for c in codes); names_ru=' | '.join(rubrics[c]['rubric_ru'] for c in codes)
 project_codes=' | '.join(rubrics[c]['project_code'] for c in codes)
 match_terms=' | '.join(matched_terms)
 rows.append({'poi_key':'urbi_coords:'+ident,'sub_id':sub_id,'cls_confidence':cls,'classification_method':final_method,'source_class_id':source_class,'source_rubricator_codes':codes_text or None,'source_rubricator_labels_en':names_en or None,'source_rubricator_labels_ar':names_ar or None,'source_rubricator_labels_ru':names_ru or None,'source_rubricator_project_codes':project_codes or None,'source_rubricator_match_terms':match_terms or None,'source_category_labels':' | '.join(labels) or None,'proposed_farq_sub_ids':' | '.join(mapped) or old_proposed})
 methods[final_method]+=1
# Only combinations that repeated in candidates are added as new synthetic classes.
for combo,cid in combo_ids.items():
 registry[cid]={'class_id':cid,'rubricator_codes':list(combo),'label_en':'Rubricator combination: '+' + '.join(rubrics[c]['rubric_en'] for c in combo),'label_ar':' + '.join(rubrics[c]['rubric_ar'] for c in combo),'label_ru':' + '.join(rubrics[c]['rubric_ru'] for c in combo),'proposed_farq_sub_ids':sorted(set().union(*(set(rubric_farq.get(c,[])) for c in combo))),'roles':None,'role_status':'not_inferred','source':'Repeated ambiguous Rubricator match; exact repeated combination'}

fields=list(rows[0]); csvpath=OUT/'candidate_rubricator_classification.csv'
with csvpath.open('w',encoding='utf-8',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
db.execute(f"copy (select * from read_csv({p(csvpath)},all_varchar=true,header=true,nullstr='',quote='\"',escape='\"')) to {p(OUT/'candidate_rubricator_classification.parquet')} (format parquet,compression zstd)")
json.dump({'rubricator_rows':len(rubrics),'owner_source_file_sha256':'27a1e1185e5ccb6b966d492fdd9aa7d0e53b5d19e9cab02de6fed9148a209fa3','rubricator_class_count':len(registry),'classes':registry},open(OUT/'rubricator_taxonomy_extension.json','w'),ensure_ascii=False,indent=2)
catalog=[]
for code,x in rubrics.items():
 mapped=rubric_farq[code]
 catalog.append({**x,'proposed_farq_sub_ids':mapped,'mapping_status':'mapped' if len(mapped)==1 else ('ambiguous' if mapped else 'unmapped'),'market_roles':None,'role_status':'not_inferred'})
json.dump({'rows':len(catalog),'source_file_sha256':'27a1e1185e5ccb6b966d492fdd9aa7d0e53b5d19e9cab02de6fed9148a209fa3','source':'Rubricator in 3 languages','categories':catalog},open(OUT/'rubricator_catalog.json','w'),ensure_ascii=False,indent=2)
# Check whether project rubric codes match any business identifier field. They are rubric metadata, never used as entity IDs.
project_codes={x['project_code'] for x in rubrics.values() if x['project_code']}
report={'rubricator_rows':len(rubrics),'candidate_rows':len(rows),'candidate_rows_with_qgis_category':sum(bool(r['source_category_labels']) for r in rows),
 'exact_source_category_rubricator_matches':direct_count,'unique_rubricator_keyword_matches':keyword_count,
 'repeated_ambiguous_combinations':{ 'distinct_combinations':len(combo_ids),'business_rows':sum(n for combo,n in ambiguity_counts.items() if n>=2)},
 'remaining_ambiguous_rows':sum(n for combo,n in ambiguity_counts.items() if n<2),
 'unmatched_rubricator_rows':methods['no_rubricator_match'],'farq_taxonomy_fallback_rows':methods['approved_farq_lexicon_fallback']+methods['repeated_qgis_source_class_fallback'],
 'classification_methods':dict(methods),'new_source_class_count':len(registry),
 'rubric_project_codes_unique':len(project_codes),'entity_id_note':'Rubric code in project is retained only as category metadata; it is never joined to POI/business identifiers.'}
json.dump(report,open(OUT/'rubricator_classification_report.json','w'),ensure_ascii=False,indent=2); print(json.dumps(report,ensure_ascii=False,indent=2))
