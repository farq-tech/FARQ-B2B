"""Full HudHud change-request history («crs_export.csv», 110,831 CRs, 2025-05 → 2025-08), read in place from the Lenovo drive.
For every entity, the LATEST APPROVED CR gives the surveyor-verified state: subcategories (mapped through hudhud_sub_map.csv),
names, phone, website, e-mail, licence, national address, district/city, and whether it was deleted. Read-only.
Output: /Users/m4pro/farq-taxonomy-data/enrich/crs_latest.parquet"""
import csv, sys
import duckdb
F = sys.argv[1] if len(sys.argv) > 1 else '/Volumes/Lenovo PS8S/Cr/crs_export.csv'
D = '/Users/m4pro/farq-taxonomy-data/'
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='6GB'")
db.execute("create table hmap (hid varchar, sub_id varchar, confidence varchar, hsub varchar)")
db.executemany("insert into hmap values (?,?,?,?)", [(r['hudhud_sub_id'].split('.')[0], r['sub_id'], r['confidence'], r['hudhud_sub_en'])
                                                     for r in csv.DictReader(open(T + 'hudhud_sub_map.csv', encoding='utf-8'))])
db.execute(f"""create table c as select split_part(cr_entity_id,'.',1) eid, cr_status, cr_operation, cr_created_at, cr_created_by,
   last_log_sub_categories_ids subs, split_part(last_log_category_id,'.',1) cat_id, nullif(last_log_name_ar,'') name_ar, nullif(last_log_name_en,'') name_en,
   nullif(last_log_phone_number,'') phone, nullif(last_log_website,'') website, nullif(last_log_email,'') email, nullif(last_log_licenseno,'') license_no,
   nullif(last_log_national_address,'') national_address, nullif(last_log_district_ar,'') district_ar, nullif(last_log_district_en,'') district_en,
   nullif(last_log_city_ar,'') city_ar, nullif(last_log_city_en,'') city_en
   from read_csv('{F}', all_varchar=true, header=true, ignore_errors=true, parallel=true) where cr_status='approved'""")
db.execute("create table latest as select * from c qualify row_number() over (partition by eid order by cr_created_at desc)=1")
db.execute("""create table subpick as select eid, arg_min(h.sub_id, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) sub_id,
   arg_min(h.hsub, case h.confidence when 'high' then 0 when 'medium' then 1 else 2 end) hsub, min(h.confidence) conf
   from (select eid, unnest(regexp_extract_all(subs, '[0-9]+')) hid from latest) x join hmap h using(hid) group by eid""")
db.execute(f"""copy (select 'hh:' || l.eid poi_key, l.cr_operation last_operation, l.cr_operation='delete' deleted, l.cr_created_at verified_at, l.cr_created_by surveyor,
   s.sub_id, s.hsub hudhud_sub, s.conf sub_confidence, l.name_ar, l.name_en, l.phone, l.website, l.email, l.license_no, l.national_address,
   l.district_ar, l.district_en, l.city_ar, l.city_en
   from latest l left join subpick s using(eid) where 'hh:' || l.eid in (select poi_key from read_parquet('{P}'))) to '{D}enrich/crs_latest.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(*) filter (where deleted), count(sub_id), count(name_ar), count(phone), count(license_no), count(national_address), count(district_ar)
   from read_parquet('{D}enrich/crs_latest.parquet')""").fetchone())
