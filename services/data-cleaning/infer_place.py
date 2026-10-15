"""Fill a missing city or district from the neighbourhood: every point takes the most common city (≈5 km cell) or district (≈500 m cell)
of the known points around it. A 3×3 block of cells is used, and a value is kept only when it wins at least 60 % of the known
points there. Inferred values are marked (city_method / district_method = 'neighbours'). Read-only on the golden set.
Output: /Users/m4pro/farq-taxonomy-data/golden/place_fill.parquet"""
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/golden/'
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='12GB'")
db.execute(f"""create table g as select poi_key, latitude lat, longitude lon, city_en, city_ar, nullif(trim(district),'') district
   from read_parquet('{D}golden_set.parquet') where latitude between 16 and 33 and longitude between 34 and 56""")
def fill(col, cell):
    db.execute(f"""create or replace table known as select floor(lat/{cell})::bigint cy, floor(lon/{cell})::bigint cx, {col} v, count(*) n
       from g where {col} is not null group by all""")
    db.execute(f"""create or replace table nb as select t.cy, t.cx, k.v, sum(k.n) n from (select distinct floor(lat/{cell})::bigint cy, floor(lon/{cell})::bigint cx from g where {col} is null) t
       join known k on k.cy between t.cy-1 and t.cy+1 and k.cx between t.cx-1 and t.cx+1 group by all""")
    db.execute(f"""create or replace table best_{col} as select cy, cx, arg_max(v, n) v, max(n)::double/sum(n) as share_top, sum(n) as support from nb group by cy, cx
       having max(n)::double/sum(n) >= 0.6 and sum(n) >= 3""")
fill('city_en', 0.05); fill('district', 0.005)
db.execute(f"""copy (select g.poi_key,
   coalesce(g.city_en, bc.v) city_en, case when g.city_en is not null then 'source' when bc.v is not null then 'neighbours' end city_method,
   coalesce(g.district, bd.v) district, case when g.district is not null then 'source' when bd.v is not null then 'neighbours' end district_method
   from g left join best_city_en bc on bc.cy=floor(g.lat/0.05)::bigint and bc.cx=floor(g.lon/0.05)::bigint
   left join best_district bd on bd.cy=floor(g.lat/0.005)::bigint and bd.cx=floor(g.lon/0.005)::bigint) to '{D}place_fill.parquet' (format parquet)""")
print(db.execute(f"""select count(*) filter (where city_method='neighbours'), count(*) filter (where city_en is null),
   count(*) filter (where district_method='neighbours'), count(*) filter (where district is null) from read_parquet('{D}place_fill.parquet')""").fetchone())
