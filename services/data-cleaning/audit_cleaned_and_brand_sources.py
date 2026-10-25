"""Audit BluePages, cleaned-data and Urbi-brand files on the existing Farq server.
Returns counts only and creates no production mutation.
"""
import csv,json,re,sys
from pathlib import Path
sys.path.insert(0,'/tmp/farq-audit-libs')
from openpyxl import load_workbook
import duckdb
ROOT=Path('/app/data/buildings_ingest'); SRC=ROOT/'cleaned_sources'; BRAND=ROOT/'brand_urbi'; GOLD=ROOT/'golden'; OUT=GOLD/'source_audits'; OUT.mkdir(exist_ok=True)
brand_csv=OUT/'urbi_brand_data.csv'
w=load_workbook(BRAND/'urbi_brand_2025.xlsx',read_only=True,data_only=True); ws=w['data']
with brand_csv.open('w',encoding='utf-8',newline='') as f:
 wr=csv.writer(f)
 for row in ws.iter_rows(values_only=True): wr.writerow(list(row))
w.close()
db=duckdb.connect(); db.execute("SET threads=4"); db.execute("SET memory_limit='4GB'")
p=lambda x:"'"+str(x).replace("'","''")+"'"
base='/app/data/targets.parquet'
files={'bluepages':SRC/'bluepages_cleaned_data.csv','cleaned':SRC/'cleaned_data.csv','filled':SRC/'cleaned_data_filled.csv','brand_urbi':brand_csv}
results={}
for label,path in files.items():
 table='s_'+label
 db.execute(f"create view {table} as select row_number() over () as source_row_id,* from read_csv({p(path)},all_varchar=true,header=true,ignore_errors=true,quote='\"',escape='\"')")
 cols=[r[0] for r in db.execute(f'describe select * from {table}').fetchall()]
 count=db.execute(f'select count(*) from {table}').fetchone()[0]
 qcols={x.lower():x for x in cols}
 row={'rows':count,'columns':cols,'nonempty':{},'unique':{},'direct_id_matches':{},'exact_coordinate_name_matches':None}
 for key in ('id','google_id','google_place_id','building_id','makani','brand_name','name','name_en','name_ar','branches_count','number_of_employees','phone','email','website'):
  col=qcols.get(key)
  if col:
   qi='"'+col.replace('"','""')+'"'
   row['nonempty'][col]=db.execute(f"select count(*) from {table} where nullif(trim(cast({qi} as varchar)),'') is not null").fetchone()[0]
   if key in ('id','google_id','google_place_id','building_id','makani'):
    row['unique'][col]=db.execute(f"select count(distinct trim(cast({qi} as varchar))) from {table} where nullif(trim(cast({qi} as varchar)),'') is not null").fetchone()[0]
 if 'id' in qcols:
  col=qcols['id']; qi='"'+col.replace('"','""')+'"'
  row['direct_id_matches']['poi_key']=db.execute(f"select count(distinct s.{qi}) from {table} s join read_parquet({p(base)}) t on cast(s.{qi} as varchar)=t.poi_key where nullif(trim(cast(s.{qi} as varchar)),'') is not null").fetchone()[0]
  if 'google_place_id' in qcols:
   row['direct_id_matches']['google_place_id']=db.execute(f"select count(distinct s.{qi}) from {table} s join read_parquet({p(base)}) t on cast(s.{qi} as varchar)=t.google_place_id where nullif(trim(cast(s.{qi} as varchar)),'') is not null").fetchone()[0]
 if all(k in qcols for k in ('longitude','latitude')) and ('name' in qcols or 'name_ar' in qcols or 'name_en' in qcols):
  name_cols=[qcols[k] for k in ('name','name_en','name_ar') if k in qcols]
  eq=' OR '.join(f"lower(trim(cast(s.\"{c}\" as varchar)))=lower(trim(t.\"{target}\"))" for c in name_cols for target in (('name_ar','name_en') if c.lower().endswith('_ar') else ('name_ar','name_en')))
  # strict numeric coordinate equality and exact case-insensitive trimmed name, then enforce one source row <-> one POI.
  db.execute(f"create temp table pairs_{label} as select distinct s.source_row_id,t.poi_key from {table} s join read_parquet({p(base)}) t on try_cast(s.\"{qcols['latitude']}\" as double)=t.latitude and try_cast(s.\"{qcols['longitude']}\" as double)=t.longitude and ({eq})")
  pairtab=f'pairs_{label}'
  row['exact_coordinate_name_matches']={'pairs':db.execute(f'select count(*) from {pairtab}').fetchone()[0],
    'source_rows':db.execute(f'select count(distinct source_row_id) from {pairtab}').fetchone()[0],
    'poi_keys':db.execute(f'select count(distinct poi_key) from {pairtab}').fetchone()[0],
    'one_to_one_pairs':db.execute(f"select count(*) from (select source_row_id,poi_key from {pairtab} qualify count(*) over(partition by source_row_id)=1 and count(*) over(partition by poi_key)=1)").fetchone()[0]}
 results[label]=row
# direct building foreign-key presence (when the building layer is ready)
building_path='/app/data/buildings_ingest/normalized/buildings.parquet'
if Path(building_path).exists():
 for label in ('cleaned','filled','brand_urbi'):
  table='s_'+label; cols=[r[0] for r in db.execute(f'describe select * from {table}').fetchall()]; c=next((x for x in cols if x.casefold()=='building id'),None)
  if c:
   qcol='"'+c.replace('"','""')+'"'
   results[label]['building_id_matches']=db.execute(f"select count(distinct trim(s.{qcol})) from {table} s join read_parquet({p(building_path)}) b on trim(s.{qcol})=trim(cast(b.houseid as varchar)) where nullif(trim(s.{qcol}),'') is not null").fetchone()[0]
report={'files':{k:{'rows':v['rows'],'columns':v['columns'],'nonempty':v['nonempty'],'unique':v['unique'],'direct_id_matches':v['direct_id_matches'],'exact_coordinate_name_matches':v['exact_coordinate_name_matches'],'building_id_matches':v.get('building_id_matches')} for k,v in results.items()},'policy':'No fuzzy name-only linkage; exact ID joins or exact coordinates plus exact normalized name, one-to-one only.'}
json.dump(report,open(OUT/'cleaned_brand_source_audit.json','w'),ensure_ascii=False,indent=2)
for k,v in results.items(): print(k,json.dumps({x:v.get(x) for x in ('rows','nonempty','unique','direct_id_matches','exact_coordinate_name_matches','building_id_matches')},ensure_ascii=False))
