"""City and district from OpenStreetMap place nodes (Geofabrik gcc-states extract, © OpenStreetMap contributors, ODbL) for golden rows
outside the atlas city outlines. Read-only. Every value carries its OSM origin and distance so it can be separated from official data.
- osm_city: nearest place=city|town within 15 km, else place=village within 4 km (the settlement the point is really in; sources often
  give the REGION, e.g. «Dammam» for Jubail).
- osm_district: nearest place=suburb|neighbourhood|quarter within 1.5 km; for a village with no neighbourhood, the village itself.
Usage: python3 osm_places.py nodes.parquet   (nodes.parquet = tagged OSM nodes: id, tags, lat, lon)
Output: /Users/m4pro/farq-taxonomy-data/golden/osm_places.parquet"""
import duckdb, sys
N = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
db.execute(f"""create table pl as select id, tags['place'] kind, coalesce(tags['name:ar'], tags['name']) name_ar, coalesce(tags['name:en'], tags['name']) name_en,
   lat, lon from read_parquet('{N}') where tags['place'] in ('city','town','village','suburb','neighbourhood','quarter') and tags['name'] is not null""")
db.execute(f"""create table p as select poi_key, latitude y, longitude x from read_parquet('{D}golden_set.parquet')
   where latitude between 16 and 33 and coalesce(city_method,'') <> 'official_boundary'""")
# metres with longitude scaled by cos(lat)
dist = "111320 * sqrt(power(a.lat - p.y, 2) + power((a.lon - p.x) * cos(radians(p.y)), 2))"
def nearest(kinds, max_m, pad):
    return f"""select p.poi_key, arg_min(a.name_ar, {dist}) name_ar, arg_min(a.name_en, {dist}) name_en, arg_min(a.kind, {dist}) kind, round(min({dist})) m
       from p join pl a on a.kind in ({kinds}) and a.lat between p.y - {pad} and p.y + {pad} and a.lon between p.x - {pad} and p.x + {pad}
       group by 1 having min({dist}) <= {max_m}"""
db.execute("create table ct as " + nearest("'city','town'", 15000, 0.15))
db.execute("create table vl as " + nearest("'village'", 4000, 0.04))
db.execute("create table nb as " + nearest("'suburb','neighbourhood','quarter'", 1500, 0.015))
db.execute(f"""copy (select p.poi_key,
   coalesce(ct.name_ar, vl.name_ar) osm_city_ar, coalesce(ct.name_en, vl.name_en) osm_city_en, coalesce(ct.kind, vl.kind) osm_city_kind, coalesce(ct.m, vl.m) osm_city_m,
   coalesce(nb.name_ar, case when ct.poi_key is null then vl.name_ar end) osm_district_ar, coalesce(nb.name_en, case when ct.poi_key is null then vl.name_en end) osm_district_en,
   case when nb.poi_key is not null then nb.kind when ct.poi_key is null and vl.poi_key is not null then 'village' end osm_district_kind, coalesce(nb.m, vl.m) osm_district_m
   from p left join ct using(poi_key) left join vl using(poi_key) left join nb using(poi_key)
   where ct.poi_key is not null or vl.poi_key is not null or nb.poi_key is not null) to '{D}osm_places.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(osm_city_ar), count(osm_district_ar) from read_parquet('{D}osm_places.parquet')").fetchone())
print(db.execute(f"select osm_city_en, count(*) from read_parquet('{D}osm_places.parquet') group by 1 order by 2 desc limit 25").fetchall())
