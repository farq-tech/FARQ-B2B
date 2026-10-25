"""Add only one-to-one exact-coordinate + exact-name cleaned/Urbi brand matches to staged Farq Golden."""
import json
from pathlib import Path
import duckdb
ROOT=Path('/app/data/buildings_ingest'); SRC=ROOT/'cleaned_sources'; BRAND=ROOT/'brand_urbi'; GOLD=ROOT/'golden/v2'
OUT=ROOT/'golden/v3'; OUT.mkdir(parents=True,exist_ok=True)
DB=duckdb.connect(); DB.execute("SET threads=4"); DB.execute("SET memory_limit='6GB'")
q=lambda x:"'"+str(x).replace("'","''")+"'"
base='/app/data/targets.parquet'
target=GOLD/'farq_golden_v2.parquet'
inputs={'cleaned':SRC/'cleaned_data.csv','filled':SRC/'cleaned_data_filled.csv','brand_urbi':ROOT/'golden/source_audits/urbi_brand_data.csv'}
for label,path in inputs.items():
    DB.execute(f"create view s_{label} as select row_number() over() source_row_id,* from read_csv({q(path)},all_varchar=true,header=true,ignore_errors=true,quote='\"',escape='\"')")
    DB.execute(f"""create temp table m_{label} as
      select source_row_id,poi_key from (
        select distinct s.source_row_id,t.poi_key from s_{label} s join read_parquet({q(target)}) t
        on try_cast(s."Longitude" as double)=t.longitude and try_cast(s."Latitude" as double)=t.latitude
        and (lower(trim(coalesce(s."Name Arabic",''))) in (lower(trim(coalesce(t.name_ar,''))),lower(trim(coalesce(t.name_en,''))))
          or lower(trim(coalesce(s."Name",''))) in (lower(trim(coalesce(t.name_ar,''))),lower(trim(coalesce(t.name_en,'')))))
      ) p
      qualify count(*) over(partition by source_row_id)=1 and count(*) over(partition by poi_key)=1""")
    print(label,'one_to_one',DB.execute(f'select count(*) from m_{label}').fetchone()[0],flush=True)
# Only fill blank target fields. Original source values remain alongside each other for provenance.
base_select='t.*'
# Avoid trusting demographic/legal/contact information with fuzzy or non-unique links; link policy above is exact and 1:1.
fieldmap={
 'urbi_brand_name':'"Brand Name"','urbi_legal_name':'"Legal Name"','urbi_legal_name_ar':'"Legal Name Arabic"',
 'urbi_phone_raw':'"Phone"','urbi_email':'"Email"','urbi_website':'"Website"','urbi_instagram':'"Instagram"',
 'urbi_linkedin':'"LinkedIn"','urbi_twitter':'"Twitter"','urbi_makani':'"Makani"','urbi_category_ar':'"Category Arabic"',
 'urbi_category_en':'"Category English"','urbi_district_ar':'"District Name Arabic"','urbi_district':'"District Name"',
 'urbi_street_ar':'"Street Arabic"','urbi_street':'"Street"','urbi_building_id':'"Building ID"',
 'urbi_building_number':'"Building Number"','urbi_floor':'"Floor"','urbi_branches_count':'"Branches Count"',
 'urbi_employee_count':'"Number of Employees"','urbi_payment_methods':'"Payment Methods"','urbi_service_languages':'"Service Languages"',
 'urbi_sun_hours':'"Sun Working Hours"','urbi_mon_hours':'"Mon Working Hours"','urbi_tue_hours':'"Tue Working Hours"',
 'urbi_wed_hours':'"Wed Working Hours"','urbi_thu_hours':'"Thu Working Hours"','urbi_fri_hours':'"Fri Working Hours"','urbi_sat_hours':'"Sat Working Hours"'}
# Consolidate source records per target only after each source's unique match was established.
parts=[]
for label in ('brand_urbi','filled','cleaned'):
    pairs=f'm_{label}'; source=f's_{label}'
    sel=', '.join(f'nullif(trim(cast(s.{col} as varchar)),\'\') as {alias}' for alias,col in fieldmap.items())
    parts.append(f"select m.poi_key,{sel},'{label}' as matched_source from {pairs} m join {source} s using(source_row_id)")
DB.execute('create temp view e_rows as '+' union all '.join(parts))
expr=[]
for alias in fieldmap:
    expr.append(f"coalesce(max({alias}) filter(where matched_source='brand_urbi'),max({alias}) filter(where matched_source='filled'),max({alias}) filter(where matched_source='cleaned')) as {alias}")
expr.append("list_distinct(list(matched_source)) as urbi_cleaned_match_sources")
DB.execute('create temp table e as select poi_key,'+', '.join(expr)+' from e_rows group by poi_key')
# Keep legacy target fields untouched unless they are empty; extensions always keep the raw source values.
updates={
 'email':'urbi_email','website':'urbi_website','instagram':'urbi_instagram','linkedin':'urbi_linkedin','twitter':'urbi_twitter',
 'legal_name':'urbi_legal_name','makani':'urbi_makani','street_ar':'urbi_street_ar','district_ar':'urbi_district_ar',
 'branches_count':'urbi_branches_count','brand':'urbi_brand_name'
}
cols=DB.execute(f'describe select * from read_parquet({q(target)})').fetchall(); existing={r[0] for r in cols}
select=['t.'+r[0] for r in cols]
for old,new in updates.items():
    if old in existing: select[ list(existing).index(old) ] = f"coalesce(nullif(trim(cast(t.{old} as varchar)),''), e.{new}) as {old}"
# Avoid relying on ordering of a set: rebuild explicitly.
select=[]
for row in cols:
    c=row[0]
    select.append(f"coalesce(nullif(trim(cast(t.{c} as varchar)),''),e.{updates[c]}) as {c}" if c in updates else f't."{c}"')
select.extend('e."'+c+'"' for c in fieldmap)
select.append('e.urbi_cleaned_match_sources')
# Join independently verified population and building layers by exact POI key only.
join_sql=f"""left join read_parquet('{ROOT/'golden/v2/poi_population_districts.parquet'}') pop using(poi_key)
left join read_parquet('{ROOT/'golden/v2/business_building_links.parquet'}') bld using(poi_key)"""
select.extend(['pop.district_id as population_district_id','pop.population_estimate','pop.population_coverage_pct','pop.population_year','pop.spatial_match_status as population_spatial_match_status',
 'bld.houseid as linked_building_house_id','bld.building_use','bld.building_use_ar','bld.type as linked_building_type','bld.purpose as linked_building_purpose',
 'bld.entrances as linked_building_entrances','bld.apartments as linked_building_apartments','bld.district as linked_building_district','bld.street as linked_building_street'])
outpar=OUT/'farq_golden_v3.parquet'; report_path=OUT/'cleaned_brand_enrichment_report.json'
if outpar.exists(): outpar.unlink()
DB.execute(f"copy (select {', '.join(select)} from read_parquet({q(target)}) t left join e using(poi_key) {join_sql}) to {q(outpar)} (format parquet,compression zstd)")
# Report unique match and filled-field counts. Existing target null fill avoids destructive replacement.
counts=DB.execute(f"select count(*) as total,count(*) filter(where urbi_cleaned_match_sources is not null) as matched from read_parquet({q(outpar)})").fetchone()
filled={}
for c in fieldmap:
    filled[c]=DB.execute(f"select count(*) from read_parquet({q(outpar)}) where nullif(trim(cast(\"{c}\" as varchar)),'') is not null").fetchone()[0]
report={'total_rows':counts[0],'poi_rows_matched':counts[1],'one_to_one_matches_by_source':{k:DB.execute(f'select count(*) from m_{k}').fetchone()[0] for k in inputs},'nonempty_after_enrichment':filled,'policy':'Exact numeric latitude/longitude and exact case-insensitive trimmed Arabic or English name; unique source row to unique POI per file. Original target fields are filled only when blank. Source-native fields retained under urbi_*.' ,'output':str(outpar)}
report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
