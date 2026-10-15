"""OSM shops/amenities/offices (Geofabrik gcc-states nodes, © OpenStreetMap contributors, ODbL) matched to golden rows by name within
~100 m (equal normalised names, then Jaro-Winkler >= 0.92 with a shared two-letter prefix), each OSM node used once. Gives the OSM type
(classified into a Farq subcategory by the row classifier, filling only unclassified/low rows) and phone/website (contacts fill last).
Usage: python3 osm_poi_match.py osm_nodes_ksa.parquet
Output: /Users/m4pro/farq-taxonomy-data/enrich/osm_poi_match.parquet"""
import duckdb, os, subprocess, sys, tempfile, csv
N = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=6"); db.execute("SET memory_limit='10GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
ph = "case when regexp_matches(regexp_replace(p,'[^0-9+]','','g'), '^(\\+?966|00966|0)?(5[0-9]{8}|1[1-7][0-9]{7}|9200[0-9]{5})$') then '+966' || regexp_replace(regexp_replace(p,'[^0-9]','','g'), '^(00966|966|0)', '') end"
db.execute(f"""create table o as select id osm_id, coalesce(tags['name:ar'], tags['name']) nm_ar, coalesce(tags['name:en'], tags['name']) nm_en, lat, lon,
   coalesce(tags['shop'], tags['amenity'], tags['craft'], tags['office'], tags['healthcare'], tags['tourism']) kind,
   (select {ph} from (select coalesce(tags['phone'], tags['contact:phone']) p)) phone, coalesce(tags['website'], tags['contact:website']) website,
   {nm("coalesce(tags['name:ar'], tags['name'])")} k1, {nm("tags['name:en']")} k2
   from read_parquet('{N}') where tags['name'] is not null and coalesce(tags['shop'], tags['amenity'], tags['craft'], tags['office'], tags['healthcare'], tags['tourism']) is not null""")
db.execute(f"""create table g as select poi_key, {nm('name_ar')} ka, {nm('name_en')} ke, latitude y, longitude x, cast(floor(longitude/0.001) as bigint) cx, cast(floor(latitude/0.001) as bigint) cy
   from read_parquet('{D}golden/golden_set.parquet') where latitude is not null and coalesce(name_ar, name_en) is not null""")
dist = "111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2))"
near = "abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011"
parts = [f"select g.poi_key, o.osm_id, {dist} m, 1.0 sim from g join o on o.{ok}=g.{gk} where length(o.{ok})>=3 and {near}" for ok in ('k1','k2') for gk in ('ka','ke')]
db.execute("create table c1 as " + " union all ".join(parts))
db.execute(f"""create table c2 as select g.poi_key, o.osm_id, {dist} m, greatest(jaro_winkler_similarity(o.k1, g.ka), jaro_winkler_similarity(o.k1, g.ke)) sim
   from (select * from g where poi_key not in (select poi_key from c1)) g
   join (select *, left(k1,2) p2, cast(floor(lon/0.001) as bigint) ocx, cast(floor(lat/0.001) as bigint) ocy from o where length(k1)>=5) o
     on o.p2 in (left(g.ka,2), left(g.ke,2)) and o.ocx between g.cx-1 and g.cx+1 and o.ocy between g.cy-1 and g.cy+1""")
db.execute("""create table best as select * from (select * from c1 union all select * from c2) where sim>=0.92 and m<=100
   qualify row_number() over (partition by poi_key order by sim desc, m)=1 and row_number() over (partition by osm_id order by sim desc, m)=1""")
# classify the matched OSM nodes (type words as the activity, name as the name)
tmp = tempfile.mkdtemp()
db.execute(f"""copy (select 'osm:'||o.osm_id poi_key, o.nm_ar name_ar, o.nm_en name_en, replace(o.kind,'_',' ') category, null::varchar category_ar,
   null::varchar secondary_category, null::varchar google_category, null::varchar lifecycle_state, null::varchar company_status
   from o where osm_id in (select osm_id from best)) to '{tmp}/o.parquet' (format parquet)""")
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/o.csv'], cwd='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel',
               env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/o.parquet'}, check=True, stdout=subprocess.DEVNULL)
db.execute(f"create table oc as select replace(poi_key,'osm:','')::bigint osm_id, sub_id, confidence from read_csv('{tmp}/o.csv', all_varchar=true) where sub_id not like 'unc.%' and confidence in ('high','medium')")
db.execute(f"""copy (select b.poi_key, b.osm_id, round(b.m) osm_m, o.kind osm_kind, oc.sub_id osm_sub, o.phone osm_phone, o.website osm_website
   from best b join o using(osm_id) left join oc using(osm_id)) to '{D}enrich/osm_poi_match.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(osm_sub), count(osm_phone), count(osm_website) from read_parquet('{D}enrich/osm_poi_match.parquet')").fetchone())
