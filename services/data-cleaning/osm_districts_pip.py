"""Point-in-polygon against the OSM admin boundaries built by osm_admin_boundaries.py (ODbL): district (admin_level 10),
municipality/city (8, else 9) and governorate (6) for every located golden row. The smallest containing polygon wins per level. Read-only.
Usage: python3 osm_districts_pip.py admin_boundaries_ksa.parquet
Output: /Users/m4pro/farq-taxonomy-data/golden/osm_admin.parquet"""
import duckdb, sys
B = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='16GB'"); db.execute("LOAD spatial")
db.execute(f"""create table b as select lvl, name_ar, name_en, g, ST_XMin(g) x0, ST_XMax(g) x1, ST_YMin(g) y0, ST_YMax(g) y1, ST_Area(g) ar
   from (select *, wkb::geometry g from read_parquet('{B}'))""")
db.execute(f"create table p as select poi_key, longitude x, latitude y from read_parquet('{D}golden_set.parquet') where latitude between 16 and 33")
db.execute("""create table hit as select p.poi_key, case when b.lvl in ('8','9') then 'city' when b.lvl='10' then 'district' else 'gov' end k,
   arg_min(b.name_ar, b.ar) name_ar, arg_min(b.name_en, b.ar) name_en
   from p join b on p.x between b.x0 and b.x1 and p.y between b.y0 and b.y1 and b.lvl in ('6','8','9','10') and ST_Contains(b.g, ST_Point(p.x, p.y))
   group by 1, 2""")
db.execute(f"""copy (select poi_key, max(name_ar) filter (where k='district') osm_bnd_district_ar, max(name_en) filter (where k='district') osm_bnd_district_en,
   max(name_ar) filter (where k='city') osm_bnd_city_ar, max(name_en) filter (where k='city') osm_bnd_city_en,
   max(name_ar) filter (where k='gov') osm_governorate_ar, max(name_en) filter (where k='gov') osm_governorate_en from hit group by 1) to '{D}osm_admin.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(osm_bnd_district_ar), count(osm_bnd_city_ar), count(osm_governorate_ar) from read_parquet('{D}osm_admin.parquet')").fetchone())
