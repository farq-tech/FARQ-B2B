"""Unify the businesses that are NOT in the targeting directory into one de-duplicated table, in the directory's schema.
Sources: entity-lake new set (lake_new), master_poi_candidates rows not already in the lake set (cand_new), cleaned_data rows not in the
directory (cleaned_data_new). Duplicates across them collapse when they share a phone within 2 km or a normalised name (>= 4 chars) within 150 m.
Output: /Users/m4pro/farq-taxonomy-data/golden/new_entities.parquet (poi_key = 'new:<n>', all source ids kept). Read-only on every input."""
import duckdb, os
D = '/Users/m4pro/farq-taxonomy-data/'
L = '/Users/m4pro/ksa-entity-lake/master/entities_master.parquet'
O = D + 'golden/'; os.makedirs(O, exist_ok=True)
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
ph = lambda c: f"case when length(regexp_replace(coalesce({c},''),'[^0-9]','','g'))>=9 then '+966' || right(regexp_replace({c},'[^0-9]','','g'),9) end"
db.execute(f"""create table u as
  select 'lake:' || e.entity_id src_key, array_to_string(e.sources, '|') origin, nullif(e.name_ar,'') name_ar, nullif(coalesce(nullif(e.name_en,''), case when e.name_ar='' then e.name end),'') name_en,
     nullif(e.activity,'') activity, nullif(e.category,'') category, nullif(e.subcategory,'') subcategory, e.lat, e.lon, nullif(e.city,'') city, nullif(e.district,'') district,
     {ph("coalesce(nullif(e.mobile,''), e.phone)")} phone, nullif(e.email,'') email, nullif(e.website,'') website, nullif(e.place_id,'') google_place_id, nullif(e.business_id,'') business_id
  from read_parquet('{L}') e where e.entity_id in (select entity_id from read_parquet('{D}lake/lake_new.parquet'))
  union all
  select 'cand:' || c.dedupe_key, 'master_poi_candidates:' || c.source_name, c.name_ar, c.name_en, null, nullif(c.category_en,''), nullif(c.subcategory_en,''), c.lat, c.lon,
     nullif(c.city_en,''), nullif(coalesce(c.district_ar, c.district_en),''), {ph('c.phone')}, null, null, c.google_id, c.license_no
  from read_parquet('{D}candidates/cand_new.parquet') c where not c.also_in_lake_new
  union all
  select 'cleaned:' || row_number() over (), 'cleaned_data', split_part(n.name_ar, ',', 1), split_part(n.name_en, ',', 1), null, n.category_en, null, n.lat, n.lon, 'Riyadh',
     null, {ph('n.phone')}, n.email, n.website, null, null
  from read_parquet('{D}enrich/cleaned_data_new.parquet') n where n.lat between 16 and 33
  union all
  select 'western:' || row_number() over (), 'western_cleaning', split_part(n.name_ar, ',', 1), split_part(n.name_en, ',', 1), null, n.category_en, null, n.lat, n.lon, null,
     n.street_ar, {ph('n.phone')}, n.email, n.website, null, null
  from read_parquet('{D}enrich/western_cleaning_new.parquet') n where n.lat between 16 and 33""")
db.execute(f"alter table u add column k varchar; update u set k = {nm('coalesce(name_ar, name_en)')}")
db.execute("create table freq as select k, count(*) n from u group by k")
db.execute("create table u2 as select row_number() over () rid, * from u")
edges = db.execute("""select a.rid, b.rid from u2 a join u2 b on a.rid<b.rid and a.phone is not null and a.phone=b.phone and abs(a.lat-b.lat)<0.02 and abs(a.lon-b.lon)<0.02
  union all select a.rid, b.rid from u2 a join u2 b on a.rid<b.rid and a.k=b.k and length(a.k)>=4 and abs(a.lat-b.lat)<0.00135 and abs(a.lon-b.lon)<0.0015
     and a.k in (select k from freq where n<=20)""").fetchall()
parent = {}
def find(x):
    r = x
    while parent.get(r, r) != r: r = parent[r]
    while parent.get(x, x) != r: parent[x], x = r, parent[x]
    return r
for a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb: parent[max(ra, rb)] = min(ra, rb)
db.execute("create table g (rid bigint, grp bigint)")
db.executemany("insert into g values (?,?)", [(r, find(r)) for r in parent])
db.execute("insert into g select rid, rid from u2 where rid not in (select rid from g)")
# one row per group: prefer the member with the most fields; fill gaps from the other members; keep every source key
db.execute("""create table score as select u2.*, g.grp, (name_ar is not null)::int*2 + (name_en is not null)::int + (category is not null or activity is not null)::int*3
   + (phone is not null)::int*3 + (email is not null)::int + (website is not null)::int + (city is not null)::int + (district is not null)::int sc from u2 join g using(rid)""")
db.execute(f"""copy (select 'new:' || grp poi_key, arg_max(name_ar, sc) filter (where name_ar is not null) name_ar, arg_max(name_en, sc) filter (where name_en is not null) name_en,
   arg_max(coalesce(category, activity), sc) filter (where coalesce(category, activity) is not null) category, arg_max(subcategory, sc) filter (where subcategory is not null) secondary_category,
   arg_max(lat, sc) latitude, arg_max(lon, sc) longitude, arg_max(city, sc) filter (where city is not null) city_en, arg_max(district, sc) filter (where district is not null) district_ar,
   arg_max(phone, sc) filter (where phone is not null) phone_norm, arg_max(email, sc) filter (where email is not null) email, arg_max(website, sc) filter (where website is not null) website,
   arg_max(google_place_id, sc) filter (where google_place_id is not null) google_place_id, list(distinct src_key) source_keys, list(distinct origin) origins, count(*) n_source_rows
   from score group by grp) to '{O}new_entities.parquet' (format parquet)""")
s = db.execute(f"""select count(*), count(phone_norm), count(*) filter (where phone_norm like '+9665%'), count(category), count(name_ar), count(email), count(website)
   from read_parquet('{O}new_entities.parquet')""").fetchone()
print('source rows:', db.execute('select count(*) from u').fetchone()[0], '| unique new businesses:', s[0], '| phone:', s[1], '| mobile:', s[2], '| category:', s[3], '| arabic name:', s[4], '| email:', s[5], '| website:', s[6])
