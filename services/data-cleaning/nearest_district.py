"""Nearest official district for golden rows that still have no district and lie just outside the atlas neighbourhood polygons
(MOMRAH coverage stops short of the city edges). A row gets the nearest polygon only when it is within MAX_M metres; the method is
recorded as `nearest_boundary` with the distance, so it is never confused with a point that is inside a boundary. Read-only.
Output: /Users/m4pro/farq-taxonomy-data/golden/district_nearest.parquet (poi_key, district_ar, district_en, distance_m)"""
import duckdb, sys
GP = sys.argv[1] if len(sys.argv) > 1 else '/Users/m4pro/Desktop/farq-poi-atlas.gpkg'
MAX_M = 1000
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'"); db.execute("LOAD spatial")
db.execute(f"""create table hood as select ArName district_ar, EnName district_en, geom, ST_XMin(geom) x0, ST_XMax(geom) x1, ST_YMin(geom) y0, ST_YMax(geom) y1
   from ST_Read('{GP}', layer='00_Neighborhoods')""")
db.execute(f"""create table p as select poi_key, longitude x, latitude y from read_parquet('{D}golden_set.parquet')
   where in_golden and district is null and latitude between 16 and 33""")
e = MAX_M / 100000   # bbox pad in degrees (generous at these latitudes)
db.execute(f"""create table c as select p.poi_key, h.district_ar, h.district_en,
   ST_Distance(h.geom, ST_Point(p.x, p.y)) * 111320 * (case when abs(p.y - (h.y0+h.y1)/2) < 90 then 1 end) d_deg_m
   from p join hood h on p.x between h.x0 - {e} and h.x1 + {e} and p.y between h.y0 - {e} and h.y1 + {e}""")
# metres: degrees scaled by 111.32 km; longitude shrinks by cos(lat) so this over-estimates east-west distance (conservative)
db.execute(f"""copy (select poi_key, arg_min(district_ar, d_deg_m) district_ar, arg_min(district_en, d_deg_m) district_en, round(min(d_deg_m)) distance_m
   from c group by 1 having min(d_deg_m) <= {MAX_M}) to '{D}district_nearest.parquet' (format parquet)""")
print('rows without district:', db.execute('select count(*) from p').fetchone()[0], '| filled within', MAX_M, 'm:',
      db.execute(f"select count(*), median(distance_m) from read_parquet('{D}district_nearest.parquet')").fetchone())
