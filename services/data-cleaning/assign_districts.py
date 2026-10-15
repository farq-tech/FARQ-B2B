"""Official district and city for every point inside the atlas boundaries (farq-poi-atlas.gpkg: 777 MOMRAH neighbourhoods in 6 cities,
plus the 6 city outlines). Point-in-polygon; read-only on every input.
Output: /Users/m4pro/farq-taxonomy-data/golden/district_official.parquet (poi_key, district_ar, district_en, city_ar, city_en)"""
import duckdb, sys
GP = sys.argv[1] if len(sys.argv) > 1 else '/Users/m4pro/Desktop/farq-poi-atlas.gpkg'
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
db.execute("INSTALL spatial; LOAD spatial;")
db.execute(f"""create table hood as select ArName district_ar, EnName district_en, geom, ST_XMin(geom) x0, ST_XMax(geom) x1, ST_YMin(geom) y0, ST_YMax(geom) y1
   from ST_Read('{GP}', layer='00_Neighborhoods')""")
db.execute(f"""create table city as select city_ar, city_en, geom, ST_XMin(geom) x0, ST_XMax(geom) x1, ST_YMin(geom) y0, ST_YMax(geom) y1
   from ST_Read('{GP}', layer='00_Cities')""")
db.execute(f"""create table p as select poi_key, longitude x, latitude y from read_parquet('{D}golden_set.parquet')
   where latitude between 16 and 33 and longitude between 34 and 56""")
db.execute("""create table ph as select p.poi_key, arg_min(h.district_ar, ST_Area(h.geom)) district_ar, arg_min(h.district_en, ST_Area(h.geom)) district_en
   from p join hood h on p.x between h.x0 and h.x1 and p.y between h.y0 and h.y1 and ST_Contains(h.geom, ST_Point(p.x, p.y)) group by p.poi_key""")
db.execute("""create table pc as select p.poi_key, any_value(c.city_ar) city_ar, any_value(c.city_en) city_en
   from p join city c on p.x between c.x0 and c.x1 and p.y between c.y0 and c.y1 and ST_Contains(c.geom, ST_Point(p.x, p.y)) group by p.poi_key""")
db.execute(f"""copy (select coalesce(ph.poi_key, pc.poi_key) poi_key, ph.district_ar, ph.district_en, pc.city_ar, pc.city_en
   from ph full join pc using(poi_key)) to '{D}district_official.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(district_ar), count(city_en) from read_parquet('{D}district_official.parquet')").fetchone())
print(db.execute(f"select city_en, count(*), count(district_ar) from read_parquet('{D}district_official.parquet') group by 1 order by 2 desc").fetchall())
