"""Golden set: one row per business, directory (1.93 M) + new businesses (1.24 M), with every enrichment layer joined and a
completeness check per row. Read-only on every input. Nothing is dropped: rows that should not be targeted keep a reason in
`exclude_reason`, and `in_golden` marks the de-duplicated, targetable set.
Output: /Users/m4pro/farq-taxonomy-data/golden/golden_set.parquet + completeness_report.json"""
import duckdb, json
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
D = '/Users/m4pro/farq-taxonomy-data/'
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='14GB'")
tax = json.load(open(T))
db.execute("create table subs (sub_id varchar, sub_ar varchar, sub_en varchar, main_id varchar, main_ar varchar, roles varchar, isic4 varchar)")
db.executemany("insert into subs values (?,?,?,?,?,?,?)", [(s['sub_id'], s['sub_ar'], s['sub_en'], s['main_id'], s['main_ar'], s['roles'], s.get('isic4_primary')) for s in tax['subs']])
# display names follow the surveyors' conventions: no bidi marks, Latin digits, single spaces (legal-form words are kept here)
clean = lambda c: f"""nullif(trim(regexp_replace(translate(regexp_replace(coalesce({c},''), '[‎‏‪-‮⁦-⁩]', '', 'g'),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\\s+', ' ', 'g')),'')"""
db.execute(f"""create table base as
  select poi_key, 'directory' origin, name_ar, name_en, latitude, longitude, nullif(trim(phone_norm),'') phone, has_whatsapp, nullif(trim(email),'') email,
     nullif(trim(website),'') website, nullif(trim(instagram),'') instagram, nullif(trim(commercial_license),'') commercial_license, sources,
     coalesce(nullif(district_ar,''), nullif(district_en,'')) district from read_parquet('{P}')
  union all
  select poi_key, 'new', name_ar, name_en, latitude, longitude, phone_norm, null, email, website, null, null, origins, district_ar from read_parquet('{D}golden/new_entities.parquet')""")
db.execute(f"""create table cls as select * from (select poi_key, sub_id, source cls_source, confidence cls_confidence from read_parquet('{D}poi_taxonomy.parquet')
  union all select poi_key, sub_id, source, confidence from read_parquet('{D}golden/new_taxonomy.parquet')) qualify row_number() over (partition by poi_key)=1""")
db.execute(f"""create table city as select * from (select poi_key, city_en, city_ar from read_parquet('{D}poi_city.parquet')
  union all select poi_key, city_en, city_en from read_parquet('{D}golden/new_entities.parquet')) qualify row_number() over (partition by poi_key)=1""")
db.execute(f"""create table g as select b.poi_key, b.origin,
   {clean('b.name_ar')} name_ar, {clean('b.name_en')} name_en, c.sub_id, s.sub_ar, s.main_id, s.main_ar, s.roles, s.isic4, c.cls_source, c.cls_confidence,
   sec.sector, b.latitude, b.longitude, coalesce(ci.city_en, pf.city_en) city_en, coalesce(ci.city_ar, case when ci.city_en is null then pf.city_en end) city_ar,
   case when ci.city_en is not null then 'source' when pf.city_en is not null then 'neighbours' end city_method,
   coalesce(nullif(trim(b.district),''), pf.district) district, case when nullif(trim(b.district),'') is not null then 'source' when pf.district is not null then 'neighbours' end district_method,
   coalesce(b.phone, o.phone) phone, case when b.phone is not null then 'source' when o.phone is not null then o.phone_source end phone_source,
   coalesce(b.has_whatsapp, o.has_whatsapp, false) has_whatsapp, coalesce(b.email, cd.email) email, coalesce(b.website, cd.website, bb.website) website,
   coalesce(b.instagram, cd.instagram, bb.instagram) instagram, cd.linkedin, cd.twitter,
   cd.employees_band, cd.branches_count, coalesce(cd.legal_name_ar, cd.legal_name_en) legal_name, cd.makani, b.commercial_license,
   bb.brand brand, gm.google_categories, gm.rating google_rating, gm.reviews google_reviews, coalesce(gm.perm_closed, false) google_perm_closed,
   coalesce(gm.temp_closed, false) google_temp_closed, (coalesce(h.last_operation='delete' and h.last_review_status='approved', false) or coalesce(ts.is_deleted, false)) hudhud_deleted, ts.state hudhud_state,
   cs.poi_key is not null curated_contracting_supplier, coalesce(cs.qualified, false) qualified_distributor,
   gr.group_id dup_group, coalesce(gr.is_primary, true) dup_primary, b.sources
   from base b left join cls c using(poi_key)
   left join (select * from read_parquet('{D}golden/place_fill.parquet') qualify row_number() over (partition by poi_key)=1) pf using(poi_key) left join subs s using(sub_id) left join city ci using(poi_key)
   left join (select * from read_parquet('{D}poi_sector.parquet') qualify row_number() over (partition by poi_key)=1) sec using(poi_key)
   left join (select * from read_parquet('{D}contacts/contacts_overlay.parquet') qualify row_number() over (partition by poi_key)=1) o using(poi_key)
   left join (select * from read_parquet('{D}enrich/cleaned_data_attrs.parquet') qualify row_number() over (partition by poi_key order by (employees_band is null), matched_by)=1) cd using(poi_key)
   left join (select poi_key, any_value(brand) brand, any_value(website) website, any_value(instagram) instagram from read_parquet('{D}enrich/brand_branches.parquet') group by 1) bb using(poi_key)
   left join (select * from read_parquet('{D}enrich/gmb_match.parquet') qualify row_number() over (partition by poi_key)=1) gm using(poi_key)
   left join (select * from read_parquet('{D}enrich/hudhud_logs_status.parquet') qualify row_number() over (partition by poi_key order by last_log_at desc)=1) h using(poi_key)
   left join (select * from read_parquet('{D}enrich/hudhud_trx_state.parquet') qualify row_number() over (partition by poi_key)=1) ts using(poi_key)
   left join (select * from read_parquet('{D}enrich/contracting_suppliers.parquet') qualify row_number() over (partition by poi_key order by qualified desc)=1) cs using(poi_key)
   left join (select * from read_parquet('{D}poi_groups.parquet') qualify row_number() over (partition by poi_key)=1) gr using(poi_key)""")
dup = db.execute("select count(*) - count(distinct poi_key) from g where poi_key is not null").fetchone()[0]
assert dup == 0, f'{dup} duplicate keys after joins'
# completeness: the fields a buyer or seller needs to act on a result
db.execute("""create table g2 as select *,
   [x for x in [
     case when coalesce(name_ar, name_en) is null then 'name' end,
     case when sub_id is null or sub_id like 'unc.%' then 'subcategory' end,
     case when latitude is null then 'location' end,
     case when city_en is null then 'city' end,
     case when district is null then 'district' end,
     case when phone is null and email is null and website is null then 'contact' end] if x is not null] missing_fields,
   case when hudhud_deleted then 'hudhud_deleted' when google_perm_closed then 'google_permanently_closed'
        when cls_source = 'vacant' then 'vacant_unit' when not dup_primary then 'duplicate_copy'
        when sub_id like 'noncom.%' then 'non_commercial' when coalesce(name_ar, name_en) is null then 'no_name'
        when latitude is null then 'no_location' end exclude_reason from g""")
db.execute("""create table golden as select *, len(missing_fields) = 0 complete, 6 - len(missing_fields) completeness_score,
   exclude_reason is null in_golden from g2""")
db.execute(f"copy golden to '{D}golden/golden_set.parquet' (format parquet, compression zstd)")
r = {}
r['rows_total'] = db.execute("select count(*) from golden").fetchone()[0]
r['by_origin'] = dict(db.execute("select origin, count(*) from golden group by 1").fetchall())
r['exclude_reasons'] = dict(db.execute("select coalesce(exclude_reason,'—in golden—'), count(*) from golden group by 1 order by 2 desc").fetchall())
gs = "from golden where in_golden"
r['golden_rows'] = db.execute(f"select count(*) {gs}").fetchone()[0]
r['golden_complete_all_6'] = db.execute(f"select count(*) {gs} and complete").fetchone()[0]
r['golden_field_fill'] = dict(zip(['name', 'subcategory', 'subcategory_high_or_medium', 'location', 'city', 'district', 'any_contact', 'phone', 'mobile', 'whatsapp', 'email', 'website', 'sector_known', 'company_size'],
   db.execute(f"""select count(coalesce(name_ar,name_en)), count(*) filter (where sub_id not like 'unc.%'), count(*) filter (where sub_id not like 'unc.%' and cls_confidence in ('high','medium')),
     count(latitude), count(city_en), count(district), count(*) filter (where phone is not null or email is not null or website is not null), count(phone),
     count(*) filter (where regexp_matches(phone,'^\\+?9665')), count(*) filter (where has_whatsapp), count(email), count(website),
     count(*) filter (where sector in ('government','private')), count(employees_band) {gs}""").fetchone()))
r['golden_missing'] = dict(db.execute(f"select m, count(*) from (select unnest(missing_fields) m {gs}) group by 1 order by 2 desc").fetchall())
r['golden_by_main'] = dict(db.execute(f"select main_ar, count(*) {gs} group by 1 order by 2 desc").fetchall())
json.dump(r, open(f'{D}golden/completeness_report.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(r, ensure_ascii=False, indent=1))
