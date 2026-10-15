"""New businesses from Overture Maps places (release 2026-09-23.1): Saudi places (address country SA) that are open, named, have a
contact (Saudi phone, website or e-mail), confidence >= 0.5, were not matched to an existing row (overture_match.parquet), and have no
existing row (any golden row, kept or excluded) with the same normalised name within ~100 m or the same phone within ~2 km.
Duplicates inside Overture collapse the same way. Written in the new-entities shape, poi_key 'ov:<id>', plus a classify input.
Usage: python3 overture_new.py places_ksa.parquet
Output: /Users/m4pro/farq-taxonomy-data/golden/overture_new.parquet, overture_for_classify.parquet"""
import duckdb, sys
F = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
ph = "case when regexp_matches(regexp_replace(p,'[^0-9+]','','g'), '^(\\+?966|00966|0)?(5[0-9]{8}|1[1-7][0-9]{7}|9200[0-9]{5}|800[0-9]{7})$') then '+966' || regexp_replace(regexp_replace(p,'[^0-9]','','g'), '^(00966|966|0)', '') end"
db.execute(f"""create table ov as select id, nm, case when regexp_matches(nm, '[؀-ۿ]') then nm end name_ar, case when not regexp_matches(nm, '[؀-ۿ]') then nm end name_en,
   cat, array_to_string(cat_hier, ' | ') hier, basic_category, confidence, lat, lon, addresses[1].locality locality,
   list_filter(list_transform(phones, p -> {ph}), x -> x is not null)[1] phone, websites[1] website, emails[1] email, {nm('nm')} k
   from read_parquet('{F}') where addresses[1].country='SA' and coalesce(operating_status,'open') not in ('permanently_closed','closed')
     and nullif(trim(nm),'') is not null and confidence >= 0.5
     and id not in (select ov_id from read_parquet('{D}enrich/overture_match.parquet'))""")
db.execute("delete from ov where phone is null and website is null and email is null")
db.execute(f"""create table g as select {nm('name_ar')} ka, {nm('name_en')} ke, phone, latitude y, longitude x from read_parquet('{D}golden/golden_set.parquet') where latitude is not null""")
db.execute("""delete from ov where id in (
   select o.id from ov o join g on o.k=g.ka where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union select o.id from ov o join g on o.k=g.ke where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union select o.id from ov o join g on o.phone=g.phone where abs(o.lat-g.y)<0.02 and abs(o.lon-g.x)<0.02)""")
# inside Overture: keep one row per phone within ~200 m and per name within ~100 m (highest confidence)
db.execute("""create table ov2 as select * from ov qualify row_number() over (partition by phone, round(lat,2), round(lon,2) order by confidence desc)=1 or phone is null""")
db.execute("""create table ov3 as select * from ov2 qualify row_number() over (partition by k, round(lat,3), round(lon,3) order by confidence desc)=1""")
db.execute(f"""copy (select 'ov:' || id poi_key, name_ar, name_en, cat category, hier secondary_category, lat latitude, lon longitude, locality city_en, null::varchar district_ar,
   phone phone_norm, email, website, null::varchar google_place_id, ['ov:' || id] source_keys, ['overture'] origins, 1 n_source_rows, confidence ov_confidence
   from ov3) to '{D}golden/overture_new.parquet' (format parquet)""")
db.execute(f"""copy (select 'ov:' || id poi_key, name_ar, name_en, replace(cat,'_',' ') category, null::varchar category_ar, replace(hier,'_',' ') secondary_category,
   replace(basic_category,'_',' ') google_category, null::varchar lifecycle_state, null::varchar company_status from ov3) to '{D}golden/overture_for_classify.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(phone_norm), count(*) filter (where phone_norm like '+9665%'), count(website), count(category)
   from read_parquet('{D}golden/overture_new.parquet')""").fetchone())
