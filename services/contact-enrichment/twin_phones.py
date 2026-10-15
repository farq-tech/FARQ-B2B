"""Step 0: phones we already hold on a duplicate row of the same business.
Nothing is dropped: every candidate pair is kept in twin_candidates.parquet with a review flag;
the confident file below is the subset safe to show. A no-phone row gets a confident phone only when: same normalised name (>= 6 chars), within ~200 m, the name is not generic
(it appears at most 20 times nationwide), and all twins agree on one number. Read-only; writes a separate file."""
import duckdb, sys
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/Users/m4pro/farq-taxonomy-data/contacts/twin_phones.parquet'
db = duckdb.connect(); db.execute("SET threads=6")
nm = "regexp_replace(translate(lower(coalesce(nullif(name_ar,''),name_en)),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
active = "coalesce(lifecycle_state,'') not in ('closed','permanently_closed') and coalesce(company_status,'') not in ('cancelled','inactive','ملغي','ملغى')"
db.execute(f"create table allrows as select poi_key, {nm} k, latitude lat, longitude lon, nullif(trim(phone_norm),'') phone, has_whatsapp, nullif(trim(phone_raw),'') raw, {active} active, sources from read_parquet('{P}')")
db.execute("create table freq as select k, count(*) n from allrows group by k")
db.execute("""create table pairs as
  select a.poi_key, b.poi_key twin_key, b.phone, b.has_whatsapp, b.sources twin_sources,
         111000*sqrt(power(a.lat-b.lat,2)+power((a.lon-b.lon)*cos(radians(a.lat)),2)) meters
  from allrows a join allrows b on a.k=b.k and a.poi_key<>b.poi_key
  join freq f on f.k=a.k
  where a.phone is null and a.raw is null and b.phone is not null and length(a.k)>=3
    and abs(a.lat-b.lat)<0.002 and abs(a.lon-b.lon)<0.002""")
db.execute("create table cand as select p.*, f.n name_frequency, length(k.k) name_length from pairs p join allrows k on k.poi_key=p.poi_key join freq f on f.k=k.k")
db.execute("""create table flagged as select c.*, case
    when name_length<6 then 'review_short_name' when name_frequency>20 then 'review_generic_name'
    when poi_key in (select poi_key from cand group by poi_key having count(distinct phone)>1) then 'review_conflicting_numbers'
    else 'confident' end review from cand c""")
CAND = OUT.replace('twin_phones.parquet', 'twin_candidates.parquet')
db.execute(f"copy (select poi_key, twin_key, phone, has_whatsapp, meters::int meters, name_frequency, review, 'directory_twin' phone_source, current_date found_on from flagged) to '{CAND}' (format parquet)")
print(db.execute("select review, count(distinct poi_key) from flagged group by 1 order by 1").fetchall())
db.execute("delete from pairs where poi_key not in (select poi_key from flagged where review='confident')")
db.execute("""create table agree as select poi_key from pairs group by poi_key having count(distinct phone)=1""")
db.execute(f"""copy (select p.poi_key, any_value(p.phone) phone, bool_or(p.has_whatsapp) has_whatsapp, min(p.meters)::int meters, count(*) twins,
   any_value(p.twin_key) twin_key, 'directory_twin' phone_source, current_date as found_on
   from pairs p join agree using(poi_key) group by p.poi_key) to '{OUT}' (format parquet)""")
tot = db.execute(f"select count(*), count(*) filter (where has_whatsapp), count(*) filter (where regexp_matches(phone, '^\+?9665')) from read_parquet('{OUT}')").fetchone()
conflict = db.execute("select count(distinct poi_key) from pairs where poi_key not in (select poi_key from agree)").fetchone()[0]
print({'phones_found': tot[0], 'whatsapp': tot[1], 'mobile': tot[2], 'skipped_conflicting_numbers': conflict})
