"""Foursquare OS Places (Apache-2.0; owner's copy of release dt=2026-10-15 on /Volumes/Archive/FSQ, from the HF bucket
FARQSA/fsq-os-places-bucket). Saudi places only (country = 'SA'); places with date_closed or unresolved flags (closed, delete,
doesnt_exist, privatevenue …) are dropped.
1. Matches to golden rows within ~100 m (equal normalised names, then Jaro-Winkler >= 0.92 with a shared 2-letter prefix; each FSQ place
   used once) give contacts and attributes in their own columns (phone/website/e-mail fill only missing values):
   enrich/fsq_match.parquet.
2. The rest become new businesses when named, with a contact, and no golden row has the same name within ~100 m or the same phone within
   ~2 km: golden/fsq_new.parquet (poi_key 'fsq:<id>'), classified by the row classifier from the FSQ category labels:
   golden/fsq_new_taxonomy.parquet.
Usage: python3 fsq_places.py /Volumes/Archive/FSQ/dt=2026-10-15/places"""
import os, subprocess, sys, tempfile
import duckdb
F = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
ph = lambda c: f"case when regexp_matches(regexp_replace(coalesce({c},''),'[^0-9]','','g'), '^(00966|966|0)?(5[0-9]{{8}}|1[1-7][0-9]{{7}}|9200[0-9]{{5}}|800[0-9]{{7}})$') then '+966' || regexp_replace(regexp_replace({c},'[^0-9]','','g'), '^(00966|966|0)', '') end"
db.execute(f"""create table f as select fsq_place_id fid, name, {nm('name')} k, latitude lat, longitude lon, address, locality, region, postcode,
   {ph('tel')} phone, website, email, instagram, twitter, facebook_id, array_to_string(fsq_category_labels, ' | ') cats, date_refreshed
   from read_parquet('{F}/*.parquet') where country = 'SA' and date_closed is null and nullif(trim(name),'') is not null
     and latitude between 16 and 33 and not list_has_any(coalesce(unresolved_flags, []), ['closed','delete','doesnt_exist','privatevenue','inappropriate','duplicate'])""")
print('saudi open places:', db.execute("select count(*), count(phone), count(website), count(cats) from f").fetchone())
db.execute(f"""create table g as select poi_key, {nm('name_ar')} ka, {nm('name_en')} ke, phone, latitude y, longitude x, cast(floor(longitude/0.001) as bigint) cx, cast(floor(latitude/0.001) as bigint) cy
   from read_parquet('{D}golden/golden_set.parquet') where latitude is not null and coalesce(name_ar, name_en) is not null and coalesce(location_precision,'point')='point'""")
dist = "111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2))"
near = "abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011"
db.execute(f"""create table c as
   select g.poi_key, o.fid, {dist} m, 1.0 sim from g join f o on o.k=g.ka where length(o.k)>=3 and {near}
   union all select g.poi_key, o.fid, {dist} m, 1.0 from g join f o on o.k=g.ke where length(o.k)>=3 and {near}
   union all select g.poi_key, o.fid, {dist} m, greatest(jaro_winkler_similarity(o.k, g.ka), jaro_winkler_similarity(o.k, g.ke)) from g
     join (select *, left(k,2) p2, cast(floor(lon/0.001) as bigint) ocx, cast(floor(lat/0.001) as bigint) ocy from f where length(k)>=5) o
       on o.p2 in (left(g.ka,2), left(g.ke,2)) and o.ocx between g.cx-1 and g.cx+1 and o.ocy between g.cy-1 and g.cy+1""")
db.execute("""create table best as select * from c where sim>=0.92 and m<=100
   qualify row_number() over (partition by poi_key order by sim desc, m)=1 and row_number() over (partition by fid order by sim desc, m)=1""")
db.execute(f"""copy (select b.poi_key, b.fid, round(b.m) fsq_m, f.phone fsq_phone, f.website fsq_website, f.email fsq_email, f.instagram fsq_instagram,
   f.twitter fsq_twitter, f.facebook_id fsq_facebook_id, f.cats fsq_categories, f.address fsq_address, f.postcode fsq_postcode
   from best b join f using(fid)) to '{D}enrich/fsq_match.parquet' (format parquet)""")
print('matched:', db.execute(f"select count(*), count(fsq_phone), count(fsq_website) from read_parquet('{D}enrich/fsq_match.parquet')").fetchone())
db.execute("create table n as select * from f where fid not in (select fid from best) and (phone is not null or website is not null or email is not null)")
db.execute("""delete from n where fid in (
   select o.fid from n o join g on o.k=g.ka where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union select o.fid from n o join g on o.k=g.ke where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union select o.fid from n o join g on o.phone=g.phone where abs(o.lat-g.y)<0.02 and abs(o.lon-g.x)<0.02)""")
db.execute(f"""copy (select 'fsq:' || fid poi_key, case when regexp_matches(name, '[؀-ۿ]') then name end name_ar, case when not regexp_matches(name, '[؀-ۿ]') then name end name_en,
   cats category, cats secondary_category, lat latitude, lon longitude, locality city_en, null::varchar district_ar, phone phone_norm, email, website,
   null::varchar google_place_id, ['fsq:' || fid] source_keys, ['foursquare_os'] origins, 1 n_source_rows, instagram, twitter, address, postcode
   from n) to '{D}golden/fsq_new.parquet' (format parquet)""")
tmp = tempfile.mkdtemp()
db.execute(f"""copy (select 'fsq:' || fid poi_key, case when regexp_matches(name, '[؀-ۿ]') then name end name_ar, case when not regexp_matches(name, '[؀-ۿ]') then name end name_en,
   split_part(cats, ' | ', 1) category, null::varchar category_ar, cats secondary_category, cats google_category, null::varchar lifecycle_state, null::varchar company_status from n) to '{tmp}/c.parquet' (format parquet)""")
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/c.csv'], cwd='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel',
               env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/c.parquet'}, check=True, stdout=subprocess.DEVNULL)
db.execute(f"copy (select * from read_csv('{tmp}/c.csv', all_varchar=true)) to '{D}golden/fsq_new_taxonomy.parquet' (format parquet)")
print('new businesses:', db.execute(f"select count(*), count(phone_norm) from read_parquet('{D}golden/fsq_new.parquet')").fetchone(),
      '| classified:', db.execute(f"select count(*) filter (where sub_id not like 'unc.%') from read_parquet('{D}golden/fsq_new_taxonomy.parquet')").fetchone())
