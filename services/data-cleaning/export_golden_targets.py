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
import os
# wholesale flag (trade_clusters.py): name/category says جملة/موزع/مستودع, or the subcategory is wholesale-only
W = f"read_parquet('{D}enrich/wholesale_flag.parquet')" if os.path.isfile(f'{D}enrich/wholesale_flag.parquet') else "(select null::varchar poi_key, null::boolean is_wholesale, null::varchar wholesale_basis)"
# badges (owner 2026-10-16: «كل مورد ياخذ بادج … يبيع يشتري او التصنيف او التخصص … ويمكن فلترته بسهولة»), no duplicates:
#   role badges from the subcategory's roles + wholesale evidence; specialties as de-duplicated concepts (specialty_concepts.csv)
import csv as _csv, json as _json
_tax = {x['sub_id']: x for x in _json.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'))['subs']}
_rel = {}
for r in _csv.DictReader(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/sub_family_relations.csv', encoding='utf-8-sig')):
    _rel.setdefault(r['sub_id'], set()).add(r['relation'])
def _roles(sid):
    x = _tax.get(sid) or {}; roles = set(filter(None, (x.get('roles') or '').split('|'))); out = []
    if sid.startswith('ind.') or sid.endswith(('_mfg', '_factory')) or 'مصنع' in (x.get('sub_ar') or ''): out.append('مصنع')
    if 'wholesale' in roles: out.append('جملة')
    if 'retail' in roles: out.append('تجزئة')
    if 'service' in roles: out.append('خدمات وتنفيذ')
    if 'sells' in _rel.get(sid, ()): out.append('يبيع')
    if 'buys' in _rel.get(sid, ()) or 'end_user' in roles: out.append('يشتري')
    return '|'.join(dict.fromkeys(out))
db.execute("create table sub_roles (sub_id varchar, role_badges varchar)")
db.executemany("insert into sub_roles values (?,?)", [(k, _roles(k)) for k in _tax])
_c = list(_csv.DictReader(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/specialty_concepts.csv', encoding='utf-8')))
db.execute("create table spec_concept (specialty_id varchar, concept_id varchar, concept_ar varchar)")
db.executemany("insert into spec_concept values (?,?,?)", [(r['specialty_id'], r['concept_id'], r['concept_ar']) for r in _c])
db.execute(f"""create table concepts as select poi_key, string_agg(distinct c.concept_id, '|' order by c.concept_id) specialty_concept_ids,
   string_agg(distinct c.concept_ar, '، ' order by c.concept_ar) specialty_concepts_ar
   from (select poi_key, unnest(specialty_ids) sid from read_parquet('{D}golden/golden_set.parquet') where in_golden) u join spec_concept c on c.specialty_id = u.sid group by 1""")
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
   lower(concat_ws(' ', g.name_ar, g.name_en, g.brand, g.sub_ar, array_to_string(g.specialties_ar, ' '), s_en.sub_en, g.main_ar, coalesce(g.district_ar, g.district), g.district_en, g.city_ar, g.city_en, g.street_ar)) search_text,
   g.sub_id, g.cls_confidence, g.sector, g.governorate_ar, g.street_ar, g.building_no, g.postal_code, g.national_address, g.license_expired, g.surveyor_verified_at, g.phone_source, g.district_method, g.city_method,
   array_to_string(g.specialties_ar, '، ') specialties_ar, array_to_string(g.specialty_ids, '|') specialty_ids,
   g.menu_link, g.order_link, g.reservation_link, g.amenities_ids, g.tradename, g.google_place_id, g.google_cid, g.floor_no,
   coalesce(w.is_wholesale, false) is_wholesale, w.wholesale_basis,
   nullif(concat_ws('|', sr.role_badges, case when coalesce(w.is_wholesale,false) and coalesce(sr.role_badges,'') not like '%جملة%' then 'جملة' end), '') role_badges,
   cc.specialty_concept_ids, cc.specialty_concepts_ar,
   -- many businesses on one coordinate = a city/district centre used when the real spot was unknown (Riyadh: 51k on one point);
   -- the place and any district taken from a boundary at that point are approximate (flag only; no value is removed)
   case when pile.n >= 50 then 'approximate' else 'point' end location_precision,
   not (pile.n >= 50 and g.district_method in ('official_boundary','osm_boundary','nearest_boundary')) district_reliable
   from g left join t using(poi_key) left join s_en using(sub_id) left join {W} w using(poi_key)
   left join sub_roles sr using(sub_id) left join concepts cc using(poi_key)
   left join (select round(latitude,4) py, round(longitude,4) px, count(*) n from g where latitude is not null group by 1,2) pile
     on pile.py = round(g.latitude,4) and pile.px = round(g.longitude,4)
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
