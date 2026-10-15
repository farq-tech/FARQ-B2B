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
# export placeholders are not names (303 k rows were literally «UNAVAILABLE»)
PLACEHOLDER = "('unavailable','null','none','nan','n/a','na','point','name','false','true','test','لا اسم','لا يوجد','بدون اسم','غير معروف','-','.','0','epsg:4326')"
_clean = clean
db.execute(f"create macro ph_null(v) as case when lower(v) in {PLACEHOLDER} then null else v end")
clean = lambda c: f"ph_null({_clean(c)})"
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
   {clean("coalesce(cr.name_ar, case when regexp_matches(coalesce(b.name_ar,''),'[؀-ۿ]') then b.name_ar end, nf.name_ar, b.name_ar)")} name_ar,
   {clean("coalesce(cr.name_en, case when regexp_matches(coalesce(b.name_en,''),'[A-Za-z]') then b.name_en end, nf.name_en, b.name_en)")} name_en,
   case when cr.name_ar is not null then 'crs_surveyor' when regexp_matches(coalesce(b.name_ar,''),'[؀-ۿ]') then 'source' else nf.name_ar_source end name_ar_source,
   case when cr.name_en is not null then 'crs_surveyor' when regexp_matches(coalesce(b.name_en,''),'[A-Za-z]') then 'source' else nf.name_en_source end name_en_source,
   c.sub_id, s.sub_ar, s.main_id, s.main_ar, s.roles, s.isic4, c.cls_source, c.cls_confidence,
   sec.sector, b.latitude, b.longitude, coalesce(dof.city_en, osm.osm_city_en, ci.city_en, pf.city_en) city_en,
   coalesce(dof.city_ar, osm.osm_city_ar, ci.city_ar, case when ci.city_en is null then pf.city_en end) city_ar,
   case when dof.city_en is not null then 'official_boundary' when osm.osm_city_en is not null then 'osm_nearest_settlement' when ci.city_en is not null then 'source'
        when pf.city_en is not null then 'neighbours' end city_method, ci.city_en city_source_en, osm.osm_city_m, oa.osm_governorate_ar governorate_ar, oa.osm_governorate_en governorate_en,
   coalesce(dof.district_ar, cr.district_ar, nullif(trim(b.district),''), ecd.district_ar, fl.district_ar, oa.osm_bnd_district_ar, dn.district_ar, osm.osm_district_ar, pf.district) district, coalesce(dof.district_ar, cr.district_ar, ecd.district_ar) district_ar,
   coalesce(dof.district_en, cr.district_en, ecd.district_en) district_en,
   case when dof.district_ar is not null then 'official_boundary' when cr.district_ar is not null then 'crs_surveyor' when nullif(trim(b.district),'') is not null then 'source'
        when coalesce(ecd.district_ar, fl.district_ar) is not null then 'urbi_admin_district' when oa.osm_bnd_district_ar is not null then 'osm_boundary' when dn.district_ar is not null then 'nearest_boundary'
        when osm.osm_district_ar is not null then 'osm_' || osm.osm_district_kind
        when pf.district is not null then 'neighbours' end district_method,
   coalesce(cr.phone, b.phone, o.phone, ov.ov_phone) phone, case when cr.phone is not null then 'crs_surveyor' when b.phone is not null then 'source' when o.phone is not null then o.phone_source when ov.ov_phone is not null then 'overture' end phone_source,
   coalesce(cr.license_no, fl.license_no) license_no, fl.license_type, fl.license_end, fl.license_expired, fl.legal_form,
   cr.national_address, cr.verified_at surveyor_verified_at, st.street_ar, st.street_en, st.street_m,
   coalesce(b.has_whatsapp, o.has_whatsapp, false) has_whatsapp, coalesce(b.email, cd.email, ov.ov_email) email, coalesce(b.website, cd.website, bb.website, ov.ov_website) website,
   coalesce(b.instagram, cd.instagram, bb.instagram) instagram, cd.linkedin, cd.twitter,
   cd.employees_band, cd.branches_count, coalesce(cd.legal_name_ar, cd.legal_name_en) legal_name, cd.makani, b.commercial_license,
   bb.brand brand, gm.google_categories, gm.rating google_rating, gm.reviews google_reviews, coalesce(gm.perm_closed, false) google_perm_closed,
   coalesce(gm.temp_closed, false) google_temp_closed, (coalesce(h.last_operation='delete' and h.last_review_status='approved', false) or coalesce(ts.is_deleted, false) or coalesce(cr.deleted, false) or coalesce(pl.deleted, false)) hudhud_deleted, ts.state hudhud_state,
   cs.poi_key is not null curated_contracting_supplier, coalesce(cs.qualified, false) qualified_distributor,
   gr.group_id dup_group, coalesce(gr.is_primary, true) dup_primary, gd.gdup_group, gd.gdup_primary, gd.gdup_size, b.sources
   from base b
   left join (select b2.poi_key, coalesce(cs2b.crs_sub, c0b.sub_id) sub_id, case when cs2b.crs_sub is not null then 'crs_surveyor' else c0b.cls_source end cls_source,
        case when cs2b.crs_sub is not null then 'high' else c0b.cls_confidence end cls_confidence from base b2
        left join (select c.poi_key, case when (c.sub_id is null or c.sub_id like 'unc.%' or c.cls_confidence='low') and ec.sub_id is not null then ec.sub_id else c.sub_id end sub_id,
          case when (c.sub_id is null or c.sub_id like 'unc.%' or c.cls_confidence='low') and ec.sub_id is not null then 'urbi_category' else c.cls_source end cls_source,
          case when (c.sub_id is null or c.sub_id like 'unc.%' or c.cls_confidence='low') and ec.sub_id is not null then 'medium' else c.cls_confidence end cls_confidence
          from cls c left join (select poi_key, any_value(sub_id) sub_id from (select poi_key, sub_id from read_parquet('{D}enrich/eastern_cards.parquet') where sub_id is not null
             union all select poi_key, sub_id from read_parquet('{D}enrich/firms_license.parquet') where sub_id is not null) group by 1) ec using(poi_key)) c0b using(poi_key)
        left join (select poi_key, sub_id crs_sub from read_parquet('{D}enrich/crs_latest.parquet') where sub_id is not null and sub_confidence in ('high','medium')) cs2b using(poi_key)) c using(poi_key)
   left join (select * from read_parquet('{D}enrich/crs_latest.parquet') qualify row_number() over (partition by poi_key)=1) cr using(poi_key)
   left join (select * from read_parquet('{D}golden/name_fill.parquet') qualify row_number() over (partition by poi_key)=1) nf using(poi_key)
   left join (select * from read_parquet('{D}golden/place_fill.parquet') qualify row_number() over (partition by poi_key)=1) pf using(poi_key)
   left join (select * from read_parquet('{D}golden/district_nearest.parquet') qualify row_number() over (partition by poi_key)=1) dn using(poi_key)
   left join (select * from read_parquet('{D}enrich/firms_license.parquet') qualify row_number() over (partition by poi_key)=1) fl using(poi_key)
   left join (select * from read_parquet('{D}golden/osm_streets.parquet') qualify row_number() over (partition by poi_key)=1) st using(poi_key)
   left join (select * from read_parquet('{D}enrich/overture_match.parquet') qualify row_number() over (partition by poi_key)=1) ov using(poi_key)
   left join (select * from read_parquet('{D}golden/osm_admin.parquet') qualify row_number() over (partition by poi_key)=1) oa using(poi_key)
   left join (select * from read_parquet('{D}golden/osm_places.parquet') qualify row_number() over (partition by poi_key)=1) osm using(poi_key)
   left join (select * from read_parquet('{D}golden/district_official.parquet') qualify row_number() over (partition by poi_key)=1) dof using(poi_key)
   left join (select poi_key, district_ar, district_en from read_parquet('{D}enrich/eastern_cards.parquet')) ecd using(poi_key) left join subs s on s.sub_id = c.sub_id left join city ci using(poi_key)
   left join (select * from read_parquet('{D}poi_sector.parquet') qualify row_number() over (partition by poi_key)=1) sec using(poi_key)
   left join (select * from read_parquet('{D}contacts/contacts_overlay.parquet') qualify row_number() over (partition by poi_key)=1) o using(poi_key)
   left join (select * from (select * from read_parquet('{D}enrich/cleaned_data_attrs.parquet') union all by name select * from read_parquet('{D}enrich/western_cleaning_attrs.parquet'))
     qualify row_number() over (partition by poi_key order by (employees_band is null), matched_by)=1) cd using(poi_key)
   left join (select poi_key, any_value(brand) brand, any_value(website) website, any_value(instagram) instagram from read_parquet('{D}enrich/brand_branches.parquet') group by 1) bb using(poi_key)
   left join (select * from read_parquet('{D}enrich/gmb_match.parquet') qualify row_number() over (partition by poi_key)=1) gm using(poi_key)
   left join (select * from read_parquet('{D}enrich/hudhud_logs_status.parquet') qualify row_number() over (partition by poi_key order by last_log_at desc)=1) h using(poi_key)
   left join (select * from read_parquet('{D}enrich/hudhud_poi_logs_db.parquet') qualify row_number() over (partition by poi_key)=1) pl using(poi_key)
   left join (select * from read_parquet('{D}enrich/hudhud_trx_state.parquet') qualify row_number() over (partition by poi_key)=1) ts using(poi_key)
   left join (select * from read_parquet('{D}enrich/contracting_suppliers.parquet') qualify row_number() over (partition by poi_key order by qualified desc)=1) cs using(poi_key)
   left join (select * from read_parquet('{D}golden/golden_dups.parquet') qualify row_number() over (partition by poi_key)=1) gd using(poi_key)
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
        when cls_source = 'vacant' then 'vacant_unit' when not dup_primary or not coalesce(gdup_primary, true) then 'duplicate_copy'
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
r['golden_field_fill'] = dict(zip(['name', 'subcategory', 'subcategory_high_or_medium', 'location', 'city', 'district', 'any_contact', 'phone', 'mobile', 'whatsapp', 'email', 'website', 'sector_known', 'company_size', 'street_ar', 'license_no'],
   db.execute(f"""select count(coalesce(name_ar,name_en)), count(*) filter (where sub_id not like 'unc.%'), count(*) filter (where sub_id not like 'unc.%' and cls_confidence in ('high','medium')),
     count(latitude), count(city_en), count(district), count(*) filter (where phone is not null or email is not null or website is not null), count(phone),
     count(*) filter (where regexp_matches(phone,'^\\+?9665')), count(*) filter (where has_whatsapp), count(email), count(website),
     count(*) filter (where sector in ('government','private')), count(employees_band), count(street_ar), count(license_no) {gs}""").fetchone()))
r['golden_missing'] = dict(db.execute(f"select m, count(*) from (select unnest(missing_fields) m {gs}) group by 1 order by 2 desc").fetchall())
r['golden_by_main'] = dict(db.execute(f"select main_ar, count(*) {gs} group by 1 order by 2 desc").fetchall())
json.dump(r, open(f'{D}golden/completeness_report.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(r, ensure_ascii=False, indent=1))
