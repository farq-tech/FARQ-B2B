#!/bin/zsh
# street density for the 25 largest cities (bbox = 1st–99th percentile of precise points)
OUTD=/Users/m4pro/farq-taxonomy-data/enrich/street_density; mkdir -p $OUTD
python3 - <<'PY' > /tmp/sd_cities.txt
import duckdb
c=duckdb.connect()
for r in c.sql("""select city_en, quantile_cont(longitude,0.01), quantile_cont(latitude,0.01), quantile_cont(longitude,0.99), quantile_cont(latitude,0.99), count(*) n
  from '/Users/m4pro/farq-taxonomy-data/export/targets_golden.parquet' where location_precision='point' and city_en is not null group by 1 order by n desc limit 25""").fetchall():
    print('|'.join(str(x) for x in r[:5]))
PY
while IFS='|' read city w s e n; do
  safe=${city// /_}
  python3 street_density.py "$city" $w $s $e $n $OUTD/$safe.parquet 2>&1 | head -2 | cut -c1-160
done < /tmp/sd_cities.txt
python3 -c "
import duckdb; c=duckdb.connect()
c.sql(\"copy (select * from read_parquet('$OUTD/*.parquet')) to '/Users/m4pro/farq-taxonomy-data/enrich/street_density.parquet' (format parquet)\")
print(c.sql(\"select count(*), count(distinct city_en) from '/Users/m4pro/farq-taxonomy-data/enrich/street_density.parquet'\").fetchone())"
