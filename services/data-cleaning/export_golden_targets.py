"""Export the golden set in the targeting service's directory schema (targets.parquet) plus the row classification the taxonomy search
reads (poi_taxonomy.parquet). Only `in_golden` rows (unique, not deleted/closed/vacant/non-commercial, named, located). Writes to an
export folder; never touches the service folders or the live directory. Read-only on the golden set.
Output: /Users/m4pro/farq-taxonomy-data/export/targets_golden.parquet, poi_taxonomy_golden.parquet, export_report.json"""
import duckdb, json, os
D = '/Users/m4pro/farq-taxonomy-data/'
O = D + 'export/'; os.makedirs(O, exist_ok=True)
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='14GB'")
tax = json.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'))
db.execute("create table s_en (sub_id varchar, sub_en varchar)")
db.executemany("insert into s_en values (?,?)", [(x['sub_id'], x['sub_en']) for x in tax['subs']])
db.execute(f"create view g as select * from read_parquet('{D}golden/golden_set.parquet') where in_golden")
# columns the live directory has that the golden set does not carry (descriptions, hours, socials, rating text): taken from it by poi_key
db.execute(f"""create view t as select poi_key, description_ar, description_en, working_hours, x_link, snapchat, tiktok, rating, reviews_count, region_en, region_ar,
   category_l3 from read_parquet('{P}')""")
db.execute(f"""copy (select g.poi_key, case when g.poi_key like 'hh:%' then try_cast(substr(g.poi_key, 4) as bigint) end hudhud_id,
   g.name_ar, g.name_en, g.legal_name, g.brand brand_name, s_en.sub_en category, g.sub_ar category_ar, g.main_ar secondary_category, t.category_l3,
   g.google_categories google_category, g.description_ar, g.description_en,
   case when g.google_temp_closed then 'temporarily_closed' end company_status, null::varchar lifecycle_state,
   t.region_en, t.region_ar, g.city_en, g.city_ar, g.district_en, coalesce(g.district_ar, g.district) district_ar,
   concat_ws('، ', g.street_ar, coalesce(g.district_ar, g.district), g.city_ar) full_address_ar, concat_ws(', ', g.street_en, g.district_en, g.city_en) full_address_en,
   g.latitude, g.longitude, g.phone phone_raw, g.phone phone_norm,
   case when regexp_matches(g.phone, '^\\+9665') then 'mobile' when g.phone is not null then 'landline' end phone_kind,
   (coalesce(g.has_whatsapp, false) or g.farq_supplier_whatsapp is not null) has_whatsapp, g.email, g.website, g.instagram, g.x_link, g.snapchat, g.tiktok, g.opening_hours working_hours,
   coalesce(t.rating, g.google_rating::varchar) rating, coalesce(t.reviews_count, g.reviews_count::varchar) reviews_count,
   coalesce(g.license_no, g.commercial_license) commercial_license, g.sources, len(g.sources) source_count,
   round(100.0 * g.completeness_score / 6, 1) completeness_pct,
   lower(concat_ws(' ', g.name_ar, g.name_en, g.brand, g.sub_ar, s_en.sub_en, g.main_ar, coalesce(g.district_ar, g.district), g.district_en, g.city_ar, g.city_en, g.street_ar)) search_text,
   g.sub_id, g.cls_confidence, g.sector, g.governorate_ar, g.street_ar, g.building_no, g.postal_code, g.national_address, g.license_expired, g.surveyor_verified_at, g.phone_source, g.district_method, g.city_method,
   g.menu_link, g.order_link, g.reservation_link, g.amenities_ids, g.tradename, g.google_place_id, g.google_cid, g.floor_no
   from g left join t using(poi_key) left join s_en using(sub_id)
   order by city_en, sub_id, g.poi_key) to '{O}targets_golden.parquet' (format parquet, compression zstd, compression_level 19, row_group_size 200000)""")
db.execute(f"""copy (select poi_key, sub_id, cls_source as source, cls_confidence as confidence, null::varchar as evidence from read_parquet('{D}golden/golden_set.parquet')
   where in_golden and sub_id is not null order by poi_key) to '{O}poi_taxonomy_golden.parquet' (format parquet, compression zstd, compression_level 19)""")
T = f"read_parquet('{O}targets_golden.parquet')"
r = dict(zip(['rows', 'with_phone', 'mobile', 'with_subcategory', 'new_rows', 'with_street', 'with_licence'], db.execute(f"""select count(*), count(phone_norm),
   count(*) filter (where phone_kind='mobile'), count(*) filter (where sub_id not like 'unc.%'), count(*) filter (where poi_key like 'new:%'),
   count(street_ar), count(commercial_license) from {T}""").fetchone()))
r['live_directory_rows'] = db.execute(f"select count(*) from read_parquet('{P}')").fetchone()[0]
r['size_mb'] = round(os.path.getsize(O + 'targets_golden.parquet') / 1e6, 1)
json.dump(r, open(O + 'export_report.json', 'w'), indent=1); print(r)
