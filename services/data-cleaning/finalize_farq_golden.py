"""Finalize Golden v2 on the existing Farq server after source audits and rubricator classification.
Writes versioned artifacts only; never replaces the currently served targets.parquet or poi_taxonomy.parquet.
"""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib
import duckdb
ROOT=Path('/app/data/buildings_ingest'); GOLD=ROOT/'golden'; RB=GOLD/'rubricator'; OUT=GOLD/'v2'; OUT.mkdir(exist_ok=True)
V1=GOLD/'farq_golden_v1.parquet'; CL=RB/'candidate_rubricator_classification.parquet'
base='/app/data/targets.parquet'; taxbase='/app/data/poi_taxonomy.parquet'
db=duckdb.connect(); db.execute("SET threads=4"); db.execute("SET memory_limit='8GB'")
p=lambda x:"'"+str(x).replace("'","''")+"'"
for f in (OUT/'farq_golden_v2.parquet',OUT/'poi_taxonomy_golden_v2.parquet'):
 if f.exists(): f.unlink()
db.execute(f"CREATE VIEW v1 AS SELECT * FROM read_parquet({p(V1)})")
db.execute(f"CREATE VIEW cls AS SELECT * FROM read_parquet({p(CL)})")
db.execute(f"""COPY (
 SELECT v1.* EXCLUDE (sub_id,cls_confidence),
        CASE WHEN cls.cls_confidence IN ('high','medium') THEN cls.sub_id ELSE v1.sub_id END AS sub_id,
        coalesce(cls.cls_confidence,v1.cls_confidence) AS cls_confidence,
        cls.classification_method, cls.source_class_id AS classification_extension_id,
        cls.source_rubricator_codes, cls.source_rubricator_labels_en, cls.source_rubricator_labels_ar,
        cls.source_rubricator_labels_ru, cls.source_rubricator_project_codes, cls.source_rubricator_match_terms,
        cls.source_category_labels, cls.proposed_farq_sub_ids
 FROM v1 LEFT JOIN cls USING (poi_key)
) TO {p(OUT/'farq_golden_v2.parquet')} (FORMAT PARQUET,COMPRESSION ZSTD)""")
# Serving taxonomy rows are unique, known Farq subcategories only. Source-native categories remain in the extension catalog.
db.execute(f"""COPY (
 SELECT * FROM read_parquet({p(taxbase)})
 UNION ALL
 SELECT c.poi_key,c.sub_id,
        CASE WHEN c.classification_method LIKE '%rubricator%' THEN 'rubricator' ELSE 'farq_lexicon' END AS source,
        c.cls_confidence AS confidence,
        coalesce(c.classification_method,'') || CASE WHEN c.proposed_farq_sub_ids IS NOT NULL THEN '; proposed='||c.proposed_farq_sub_ids ELSE '' END AS evidence
 FROM cls c
 WHERE c.sub_id IS NOT NULL AND c.cls_confidence IN ('high','medium')
   AND NOT EXISTS (SELECT 1 FROM read_parquet({p(taxbase)}) old WHERE old.poi_key=c.poi_key)
) TO {p(OUT/'poi_taxonomy_golden_v2.parquet')} (FORMAT PARQUET,COMPRESSION ZSTD)""")
report={'version':'farq_golden_v2','built_at_utc':datetime.now(timezone.utc).isoformat(),
 'rights_confirmation':{'status':'user_confirmed','scope':'Farq holds rights to use the source data; owner confirmation supplied 2026-10-25.'},
 'production_inputs':{'targets_sha256':hashlib.sha256(Path(base).read_bytes()).hexdigest(),'targets_path':base,'poi_taxonomy_path':taxbase},
 'outputs':{'golden':str(OUT/'farq_golden_v2.parquet'),'poi_taxonomy':str(OUT/'poi_taxonomy_golden_v2.parquet'),'rubricator_catalog':str(RB/'rubricator_catalog.json'),'source_category_registry':str(RB/'rubricator_taxonomy_extension.json')},
 'counts':{},'verification':{},'release_note':'Versioned staging artifacts only. Production files are untouched until the release passes app build and API checks.'}
report['counts']['v1_rows']=db.execute('select count(*) from v1').fetchone()[0]
report['counts']['v1_unique_keys']=db.execute('select count(distinct poi_key) from v1').fetchone()[0]
report['counts']['new_candidates']=db.execute("select count(*) from v1 where golden_match_method='coordinate_license_exact'").fetchone()[0]
report['counts']['new_candidates_with_farq_subcategory']=db.execute("select count(*) from cls where sub_id is not null and cls_confidence in ('high','medium')").fetchone()[0]
report['counts']['new_candidates_with_source_rubricator']=db.execute("select count(*) from cls where source_rubricator_codes is not null").fetchone()[0]
report['counts']['new_candidates_with_extension_category']=db.execute("select count(*) from cls where source_class_id is not null").fetchone()[0]
report['counts']['new_candidates_unknown_or_ambiguous']=db.execute("select count(*) from cls where sub_id is null and source_class_id is null").fetchone()[0]
report['counts']['taxonomy_rows_v1']=db.execute(f'select count(*) from read_parquet({p(taxbase)})').fetchone()[0]
report['counts']['taxonomy_rows_v2']=db.execute(f'select count(*) from read_parquet({p(OUT/"poi_taxonomy_golden_v2.parquet")})').fetchone()[0]
report['counts']['taxonomy_new_unique']=report['counts']['taxonomy_rows_v2']-report['counts']['taxonomy_rows_v1']
report['counts']['source_class_registry']=json.load(open(RB/'rubricator_taxonomy_extension.json'))['rubricator_class_count']
report['counts']['rubricator_catalog_categories']=json.load(open(RB/'rubricator_catalog.json'))['rows']
report['verification']['v2_rows']=db.execute(f'select count(*) from read_parquet({p(OUT/"farq_golden_v2.parquet")})').fetchone()[0]
report['verification']['v2_unique_keys']=db.execute(f'select count(distinct poi_key) from read_parquet({p(OUT/"farq_golden_v2.parquet")})').fetchone()[0]
report['verification']['new_rows_missing_coordinates']=db.execute(f"select count(*) from read_parquet({p(OUT/'farq_golden_v2.parquet')}) where golden_match_method='coordinate_license_exact' and (latitude is null or longitude is null or latitude not between -90 and 90 or longitude not between -180 and 180)").fetchone()[0]
report['verification']['new_rows_with_classified_sub_id_confidence_missing']=db.execute(f"select count(*) from read_parquet({p(OUT/'farq_golden_v2.parquet')}) where golden_match_method='coordinate_license_exact' and sub_id is not null and (cls_confidence is null or cls_confidence not in ('high','medium'))").fetchone()[0]
report['verification']['changes_to_existing_core_fields']=db.execute(f"""select count(*) from read_parquet({p(OUT/'farq_golden_v2.parquet')}) o join read_parquet({p(base)}) i using(poi_key)
 where o.golden_match_method like 'existing_atlas%' and
 (o.name_ar is distinct from i.name_ar or o.name_en is distinct from i.name_en or o.latitude is distinct from i.latitude or o.longitude is distinct from i.longitude or o.company_status is distinct from i.company_status)""").fetchone()[0]
report['verification']['v2_key_count_matches_v1_plus_new']=report['verification']['v2_rows']==report['counts']['v1_rows']
report['verification']['all_new_coordinates_valid']=report['verification']['new_rows_missing_coordinates']==0
report['verification']['old_core_unchanged']=report['verification']['changes_to_existing_core_fields']==0
assert report['verification']['v2_rows']==report['counts']['v1_rows']==report['counts']['v1_unique_keys']
assert report['verification']['v2_unique_keys']==report['verification']['v2_rows']
assert report['verification']['all_new_coordinates_valid']
assert report['verification']['old_core_unchanged']
json.dump(report,open(OUT/'farq_golden_v2_report.json','w'),ensure_ascii=False,indent=2); print(json.dumps(report,ensure_ascii=False,indent=2))
