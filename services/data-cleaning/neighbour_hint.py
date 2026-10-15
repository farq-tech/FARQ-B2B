"""Low-confidence hint for unclassified rows: the dominant activity of classified neighbours in the same spot.
Kept as a separate hint file (never overwrites the classification). Rule: at least 3 classified commercial neighbours within ~30 m,
and at least 70 % of them share one subcategory (a market of spare-parts shops, a row of tailors …)."""
import duckdb
P = '/Users/m4pro/farq-targeting/data/targets.parquet'; D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=6")
db.execute(f"""create table t as select c.poi_key, c.sub_id, c.source, c.confidence, x.latitude lat, x.longitude lon
  from read_parquet('{D}poi_taxonomy.parquet') c join read_parquet('{P}') x using(poi_key) where x.latitude is not null""")
db.execute("""create table nb as select u.poi_key, n.sub_id, count(*) k from t u join t n
  on abs(u.lat-n.lat)<0.00027 and abs(u.lon-n.lon)<0.0003 and u.poi_key<>n.poi_key
  where u.source='none' and n.sub_id not like 'unc.%' and n.sub_id not like 'noncom.%' and n.confidence in ('high','medium')
  group by all""")
db.execute(f"""copy (select poi_key, arg_max(sub_id,k) as sub_id, max(k) as agree, sum(k) as neighbours, round(max(k)/sum(k),2) as share, 'neighbours_30m' as source, 'low' as confidence
  from nb group by poi_key having sum(k)>=3 and max(k)::double/sum(k)>=0.7) to '{D}neighbour_hints.parquet' (format parquet)""")
print(db.execute(f"select count(*), count(*) filter (where share>=0.9) from read_parquet('{D}neighbour_hints.parquet')").fetchone())
print(db.execute(f"select sub_id, count(*) n from read_parquet('{D}neighbour_hints.parquet') group by 1 order by n desc limit 10").fetchall())
