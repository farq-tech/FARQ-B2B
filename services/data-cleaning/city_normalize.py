"""One canonical city per directory row. Read-only on the directory; writes poi_key -> city_en, city_ar, method.
- en and ar agree (or only one is present and maps cleanly): keep it.
- en and ar name different cities: the city whose centre is closer to the point wins.
- neither is present: the nearest city centre within 25 km (else left empty, never guessed).
City centres are medians of rows whose names agree."""
import duckdb, sys
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/Users/m4pro/farq-taxonomy-data/poi_city.parquet'
db = duckdb.connect(); db.execute("SET threads=6")
db.execute(f"create table t as select poi_key, nullif(trim(city_en),'') en, nullif(trim(city_ar),'') ar, latitude lat, longitude lon from read_parquet('{P}')")
# Arabic name of each English city = its most common pairing; English of each Arabic name likewise
db.execute("create table en2ar as select en, arg_max(ar, n) ar from (select en, ar, count(*) n from t where en is not null and ar is not null group by all) group by en")
db.execute("create table ar2en as select ar, arg_max(en, n) en, max(n) n from (select en, ar, count(*) n from t where en is not null and ar is not null group by all) group by ar")
db.execute("""create table centre as select x.en, median(lat) lat, median(lon) lon, count(*) n from t join en2ar x on t.en=x.en and t.ar=x.ar
  where lat between 16 and 33 and lon between 34 and 56 group by x.en having count(*)>=20""")
db.execute("""create table r as select t.poi_key, t.lat, t.lon, t.en, t.ar, a.en ar_en from t left join ar2en a on a.ar=t.ar""")
dist = lambda c: f"111*sqrt(power(r.lat-{c}.lat,2)+power((r.lon-{c}.lon)*cos(radians(r.lat)),2))"
db.execute(f"""create table res as select r.poi_key,
  case when r.en is not null and (r.ar_en is null or r.ar_en=r.en) then r.en
       when r.en is not null and r.ar_en is not null and r.ar_en<>r.en then
            case when ce.lat is not null and ca.lat is not null and {dist('ca')} < {dist('ce')} then r.ar_en else r.en end
       when r.en is null and r.ar_en is not null then r.ar_en
       else null end as city_en,
  case when r.en is not null and (r.ar_en is null or r.ar_en=r.en) then (case when r.ar is null then 'en_only' else 'agree' end)
       when r.en is not null and r.ar_en is not null and r.ar_en<>r.en then 'conflict_by_distance'
       when r.en is null and r.ar_en is not null then 'ar_only'
       else 'missing' end as method
  from r left join centre ce on ce.en=r.en left join centre ca on ca.en=r.ar_en""")
# fill missing from the nearest centre within 25 km
db.execute(f"""create table near as select poi_key, arg_min(c.en, d) en, min(d) d from (
  select r.poi_key, c.en, {dist('c')} d from res join r using(poi_key) cross join centre c
  where res.city_en is null and r.lat between 16 and 33 and r.lon between 34 and 56) x join centre c on c.en=x.en group by poi_key having min(d)<=25""")
db.execute("update res set city_en=near.en, method='nearest_centre' from near where res.poi_key=near.poi_key")
db.execute(f"copy (select res.poi_key, res.city_en, coalesce(x.ar, res.city_en) as city_ar, res.method from res left join en2ar x on x.en=res.city_en) to '{OUT}' (format parquet)")
print(db.execute(f"select method, count(*) from read_parquet('{OUT}') group by 1 order by 2 desc").fetchall())
print('still no city:', db.execute(f"select count(*) from read_parquet('{OUT}') where city_en is null").fetchone()[0])
print('rows the English-only search could not see before:', db.execute("select count(*) from t where en is null and ar is not null").fetchone()[0])
