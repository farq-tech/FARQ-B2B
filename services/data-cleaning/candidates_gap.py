"""Compare «master_poi_candidates.csv» (Drive, 1.92 M rows from 6 sources) with the directory AND the entity lake. Read-only.
Only rows with coordinates can be placed; Arabic names that were saved as «????» are ignored for name matching (the English name or phone is used).
Writes /Users/m4pro/farq-taxonomy-data/candidates/{cand_match,cand_new,cand_phone_fill}.parquet"""
import duckdb, os, sys
F = sys.argv[1]
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
L = '/Users/m4pro/ksa-entity-lake/master/entities_master.parquet'
LN = '/Users/m4pro/farq-taxonomy-data/lake/lake_new.parquet'
O = '/Users/m4pro/farq-taxonomy-data/candidates/'; os.makedirs(O, exist_ok=True)
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"""create table c as select dedupe_key, source_name, nullif(google_id,'') google_id, nullif(license_no,'') license_no,
   case when regexp_matches(name_ar,'[؀-ۿ]') then name_ar end name_ar, nullif(name_en,'') name_en,
   category_ar, category_en, subcategory_en, city_en, district_ar, district_en, try_cast(latitude as double) lat, try_cast(longitude as double) lon,
   nullif(phone_number,'') phone, status, rating, reviews_count, trx_id,
   {nm("case when regexp_matches(name_ar,'[؀-ۿ]') then name_ar end")} k_ar, {nm('name_en')} k_en,
   right(regexp_replace(coalesce(phone_number,''),'[^0-9]','','g'),9) ph
   from read_csv(?, all_varchar=true, header=true, ignore_errors=true) where try_cast(latitude as double) between 16 and 33 and try_cast(longitude as double) between 34 and 56""", [F])
db.execute(f"""create table t as select poi_key, {nm("coalesce(nullif(name_ar,''),name_en)")} k, {nm('name_en')} k_en, latitude lat, longitude lon,
   right(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'),9) ph, nullif(trim(phone_norm),'') phone, split_part(poi_key,':',2) native from read_parquet('{P}') where latitude is not null""")
db.execute("""create table m as
  select c.dedupe_key, t.poi_key, 0 pr from c join t on c.trx_id is not null and split_part(c.trx_id,'.',1)=t.native
  union all select c.dedupe_key, t.poi_key, 1 from c join t on length(c.ph)=9 and c.ph=t.ph and abs(c.lat-t.lat)<0.02 and abs(c.lon-t.lon)<0.02
  union all select c.dedupe_key, t.poi_key, 2 from c join t on length(c.k_ar)>=4 and c.k_ar=t.k and abs(c.lat-t.lat)<0.0018 and abs(c.lon-t.lon)<0.002
  union all select c.dedupe_key, t.poi_key, 2 from c join t on length(c.k_en)>=4 and c.k_en in (t.k, t.k_en) and abs(c.lat-t.lat)<0.0018 and abs(c.lon-t.lon)<0.002""")
db.execute(f"copy (select dedupe_key, arg_min(poi_key, pr) poi_key, min(pr) pr from m group by dedupe_key) to '{O}cand_match.parquet' (format parquet)")
db.execute(f"create table mm as select * from read_parquet('{O}cand_match.parquet')")
# not in the directory: also check the lake's new set, so the two «new» lists do not double count
db.execute(f"""create table ln as select entity_id, {nm("coalesce(nullif(name_ar,''),name_en)")} k, lat, lon from read_parquet('{L}') where entity_id in (select entity_id from read_parquet('{LN}'))""")
db.execute("create table rest as select c.* from c anti join mm using(dedupe_key)")
db.execute("""create table in_lake as select distinct r.dedupe_key from rest r join ln on (r.k_ar=ln.k or r.k_en=ln.k) and length(ln.k)>=4
   and abs(r.lat-ln.lat)<0.0018 and abs(r.lon-ln.lon)<0.002""")
db.execute(f"copy (select r.* exclude (k_ar, k_en, ph), r.dedupe_key in (select dedupe_key from in_lake) also_in_lake_new from rest r) to '{O}cand_new.parquet' (format parquet)")
db.execute(f"""copy (select mm.poi_key, '+966' || right(regexp_replace(c.phone,'[^0-9]','','g'),9) phone, c.source_name, c.google_id from mm join c using(dedupe_key) join t using(poi_key)
   where t.phone is null and c.phone is not null and length(regexp_replace(c.phone,'[^0-9]','','g'))>=9) to '{O}cand_phone_fill.parquet' (format parquet)""")
tot = db.execute('select count(*) from c').fetchone()[0]; mt = db.execute('select count(*) from mm').fetchone()[0]
print('rows with KSA coords:', tot, '| matched to directory:', mt, '| not in directory:', tot - mt)
print(db.execute(f"""select source_name, count(*), count(*) filter (where not also_in_lake_new) truly_new, count(phone), count(category_en) from read_parquet('{O}cand_new.parquet') group by 1 order by 2 desc""").fetchall())
print('directory rows without phone that this file fills:', db.execute(f"select count(distinct poi_key) from read_parquet('{O}cand_phone_fill.parquet')").fetchone()[0])
