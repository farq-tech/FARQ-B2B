"""Free second use of the Serper Google Maps cache: every cached place has a Google type. Places are classified by the row classifier
(type as the activity, title as the name) and matched by name (equal normalised names, or Jaro-Winkler >= 0.92 with a shared two-letter
prefix) within ~100 m to golden rows whose subcategory is unclassified or low. No new credits.
Output: /Users/m4pro/farq-taxonomy-data/enrich/serper_places_class.parquet (poi_key, sub_id, gm_type, gm_name, m)"""
import json, os, subprocess, tempfile
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/'
places = {}
for line in open(D + 'enrich/serper_maps_raw.jsonl'):
    for p in json.loads(line)['places']:
        if p.get('latitude') and p.get('title') and p.get('cid'): places[p['cid']] = p
db = duckdb.connect(); db.execute("SET threads=6")
tmp = tempfile.mkdtemp()
db.execute("create table pl (poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar, secondary_category varchar, google_category varchar, lifecycle_state varchar, company_status varchar, lat double, lon double)")
db.executemany("insert into pl values (?,?,?,?,?,?,?,?,?,?,?)", [(c, p['title'], None, p.get('type'), p.get('type'), ', '.join(p.get('types') or []), p.get('type'), None, None, p['latitude'], p['longitude']) for c, p in places.items()])
db.execute(f"copy (select * exclude (lat, lon) from pl) to '{tmp}/pl.parquet' (format parquet)")
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/pl.csv'], cwd='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel',
               env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/pl.parquet'}, check=True, stdout=subprocess.DEVNULL)
db.execute(f"create table pc as select poi_key cid, sub_id from read_csv('{tmp}/pl.csv', all_varchar=true) where sub_id not like 'unc.%' and sub_id not like 'noncom.%' and confidence in ('high','medium')")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"create table o as select pl.poi_key cid, pl.name_ar gm_name, pl.category gm_type, pl.lat, pl.lon, {nm('pl.name_ar')} k, pc.sub_id from pl join pc on pc.cid=pl.poi_key")
db.execute(f"""create table g as select poi_key, {nm('name_ar')} ka, {nm('name_en')} ke, latitude y, longitude x from read_parquet('{D}golden/golden_set.parquet')
   where latitude is not null and coalesce(name_ar, name_en) is not null and (sub_id like 'unc.%' or cls_confidence='low')""")
dist = "111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2))"
db.execute(f"""create table c as
   select g.poi_key, o.cid, {dist} m, 1.0 sim from g join o on o.k=g.ka where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union all select g.poi_key, o.cid, {dist} m, 1.0 from g join o on o.k=g.ke where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union all select g.poi_key, o.cid, {dist} m, greatest(jaro_winkler_similarity(o.k, g.ka), jaro_winkler_similarity(o.k, g.ke)) from g
     join (select *, left(k,2) p2 from o where length(k)>=5) o on o.p2 in (left(g.ka,2), left(g.ke,2)) and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011""")
db.execute(f"""copy (select c.poi_key, o.sub_id, o.gm_type, o.gm_name, round(c.m) m from c join o using(cid) where c.sim>=0.92 and c.m<=100
   qualify row_number() over (partition by c.poi_key order by c.sim desc, c.m)=1) to '{D}enrich/serper_places_class.parquet' (format parquet)""")
print('places:', len(places), '| classified:', db.execute('select count(*) from pc').fetchone()[0], '| rows classified:',
      db.execute(f"select count(*) from read_parquet('{D}enrich/serper_places_class.parquet')").fetchone()[0])
