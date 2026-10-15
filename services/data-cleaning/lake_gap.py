"""Compare the local KSA entity lake (4.41 M entities) with the targeting directory. Read-only on both.
Match: same phone (last 9 digits) within 2 km, or same normalised name (>= 4 chars) within 200 m, or same Urbi/2GIS id.
Writes /Users/m4pro/farq-taxonomy-data/lake/lake_match.parquet (entity_id -> poi_key, how) and lake_new.parquet (unmatched entities)."""
import duckdb, os
L = '/Users/m4pro/ksa-entity-lake/master/entities_master.parquet'
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
O = '/Users/m4pro/farq-taxonomy-data/lake/'
os.makedirs(O, exist_ok=True)
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"""create table e as select entity_id, {nm("coalesce(nullif(name_ar,''),nullif(name_en,''),name)")} k, {nm('name_en')} k_en, lat, lon,
   right(regexp_replace(coalesce(nullif(mobile,''),phone,''),'[^0-9]','','g'),9) ph, business_id, sources, nullif(mobile,'') mobile, nullif(phone,'') phone,
   nullif(email,'') email, nullif(website,'') website, nullif(category,'') category, nullif(activity,'') activity
   from read_parquet('{L}') where lat between 16 and 33 and lon between 34 and 56""")
db.execute(f"""create table t as select poi_key, {nm("coalesce(nullif(name_ar,''),name_en)")} k, {nm('name_en')} k_en, latitude lat, longitude lon,
   right(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'),9) ph, nullif(trim(phone_norm),'') phone, split_part(poi_key,':',2) native
   from read_parquet('{P}') where latitude is not null""")
db.execute("""create table m as
  select e.entity_id, t.poi_key, 'native_id' how from e join t on e.business_id<>'' and e.business_id=t.native
  union all select e.entity_id, t.poi_key, 'phone_2km' from e join t on e.ph<>'' and length(e.ph)=9 and e.ph=t.ph and abs(e.lat-t.lat)<0.02 and abs(e.lon-t.lon)<0.02
  union all select e.entity_id, t.poi_key, 'name_200m' from e join t on e.k=t.k and length(e.k)>=4 and abs(e.lat-t.lat)<0.0018 and abs(e.lon-t.lon)<0.002
  union all select e.entity_id, t.poi_key, 'name_en_200m' from e join t on e.k_en=t.k_en and length(e.k_en)>=4 and abs(e.lat-t.lat)<0.0018 and abs(e.lon-t.lon)<0.002""")
db.execute(f"copy (select entity_id, arg_min(poi_key, case how when 'native_id' then 0 when 'phone_2km' then 1 else 2 end) poi_key, min(how) how from m group by entity_id) to '{O}lake_match.parquet' (format parquet)")
db.execute(f"create table mm as select * from read_parquet('{O}lake_match.parquet')")
db.execute(f"copy (select e.* exclude (k, k_en, ph) from e anti join mm using(entity_id)) to '{O}lake_new.parquet' (format parquet)")
tot = db.execute("select count(*) from e").fetchone()[0]
mt = db.execute("select count(*) from mm").fetchone()[0]
print('lake entities with KSA coords:', tot, '| matched to directory:', mt, '| not in directory:', tot - mt)
print('match by:', db.execute("select how, count(*) from mm group by 1 order by 2 desc").fetchall())
n = db.execute(f"""select count(*), count(mobile), count(*) filter (where mobile is not null and (category is not null or activity is not null)), count(email), count(website),
   count(category) + 0, count(*) filter (where category is null and activity is null) from read_parquet('{O}lake_new.parquet')""").fetchone()
print('NEW entities:', n[0], '| with mobile:', n[1], '| mobile+category:', n[2], '| email:', n[3], '| website:', n[4], '| category:', n[5], '| no category:', n[6])
print('new by first source:', db.execute(f"select sources[1] s, count(*), count(mobile) from read_parquet('{O}lake_new.parquet') group by 1 order by 2 desc").fetchall())
gain = db.execute(f"""select count(*), count(*) filter (where e.mobile is not null) from mm join e using(entity_id) join t using(poi_key)
   where t.phone is null and coalesce(e.mobile,e.phone) is not null""").fetchone()
print('directory rows WITHOUT phone that the lake can fill:', gain[0], '| mobiles:', gain[1])
