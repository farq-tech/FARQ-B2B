"""Contacts from Overture Maps places (release 2026-09-23.1, theme=places; Meta/Microsoft/… sources under CDLA-Permissive-2.0 / ODbL for
OSM-derived rows — the dataset list is kept per match). Read from a local Saudi-bbox extract. A golden row matches an Overture place
within ~100 m when the normalised names are equal, or Jaro-Winkler >= 0.92 on names of >= 5 letters sharing the first two letters (stage 2, only rows without an exact match); the closest best match wins and
each Overture place is used once. Phones normalised to +966…; only Saudi numbers are kept. Read-only.
Usage: python3 overture_match.py places_ksa.parquet
Output: /Users/m4pro/farq-taxonomy-data/enrich/overture_match.parquet"""
import duckdb, sys
F = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/'
C = 0.001
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("SET memory_limit='16GB'")
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
ph = "case when length(regexp_replace(p,'[^0-9]','','g'))>=9 and regexp_matches(regexp_replace(p,'[^0-9+]','','g'), '^(\\+?966|0)?5?[0-9]{8}$') then '+966' || right(regexp_replace(p,'[^0-9]','','g'),9) end"
db.execute(f"""create table ov as select id ov_id, nm ov_name, {nm('nm')} k, lat, lon, confidence, operating_status, cat ov_cat, basic_category,
   list_filter(list_transform(phones, p -> {ph}), x -> x is not null) phones, websites, emails, socials, datasets,
   cast(floor(lon/{C}) as bigint) cx, cast(floor(lat/{C}) as bigint) cy
   from read_parquet('{F}') where coalesce(operating_status,'open') <> 'permanently_closed'""")
db.execute(f"""create table g as select poi_key, {nm('name_ar')} ka, {nm('name_en')} ke, latitude y, longitude x,
   cast(floor(longitude/{C}) as bigint) cx, cast(floor(latitude/{C}) as bigint) cy
   from read_parquet('{D}golden/golden_set.parquet') where latitude is not null and coalesce(name_ar, name_en) is not null""")
# stage 1: equal normalised names within ~100 m (hash join on the name, then distance)
db.execute("""create table c1 as select * from (
   select g.poi_key, o.ov_id, 111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2)) m, 1.0 sim from g join ov o on o.k=g.ka
     where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011
   union all
   select g.poi_key, o.ov_id, 111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2)) m, 1.0 sim from g join ov o on o.k=g.ke
     where length(o.k)>=3 and abs(o.lat-g.y)<0.001 and abs(o.lon-g.x)<0.0011)""")
# stage 2: similar names, only for rows still without a match; candidates must share the first two letters (blocking)
db.execute("""create table c2 as select g.poi_key, o.ov_id, 111320*sqrt(power(o.lat-g.y,2)+power((o.lon-g.x)*cos(radians(g.y)),2)) m,
   greatest(case when length(g.ka)>=5 and left(g.ka,2)=left(o.k,2) then jaro_winkler_similarity(o.k, g.ka) else 0 end,
            case when length(g.ke)>=5 and left(g.ke,2)=left(o.k,2) then jaro_winkler_similarity(o.k, g.ke) else 0 end) sim
   from (select * from g where poi_key not in (select poi_key from c1)) g
   join (select *, left(k,2) k2 from ov where length(k)>=5) o on o.k2 in (left(g.ka,2), left(g.ke,2))
     and o.cx between g.cx-1 and g.cx+1 and o.cy between g.cy-1 and g.cy+1""")
db.execute("""create table best as select * from (select * from c1 union all select * from c2) where sim >= 0.92 and m <= 100
   qualify row_number() over (partition by poi_key order by sim desc, m)=1 and row_number() over (partition by ov_id order by sim desc, m)=1""")
db.execute(f"""copy (select b.poi_key, b.ov_id, round(b.m) ov_m, round(b.sim,3) ov_sim, o.ov_name, o.confidence ov_confidence, o.ov_cat, o.basic_category,
   o.phones[1] ov_phone, o.websites[1] ov_website, o.emails[1] ov_email, o.socials ov_socials, o.datasets ov_datasets
   from best b join ov o using(ov_id)) to '{D}enrich/overture_match.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(ov_phone), count(ov_website), count(ov_email) from read_parquet('{D}enrich/overture_match.parquet')""").fetchone())
