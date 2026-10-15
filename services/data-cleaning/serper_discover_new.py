"""New businesses from the Serper discovery cache (serper_discover_raw.jsonl): Google Maps places found by trade searches in weak
cities. A place becomes a new business when it has a name and coordinates, is not marked closed, and no existing golden row has the
same normalised name within ~100 m or the same phone within ~2 km; repeated places (same Google cid) collapse. Classified by the row
classifier (Google type as the activity). Written in the new-entities shape, poi_key 'gm:<cid>', plus the classification.
Output: /Users/m4pro/farq-taxonomy-data/golden/serper_new.parquet, serper_new_taxonomy.parquet"""
import json, os, subprocess, tempfile
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/'
rows = {}
for line in open(D + 'enrich/serper_discover_raw.jsonl'):
    j = json.loads(line)
    for p in j['places']:
        if not (p.get('cid') and p.get('title') and p.get('latitude')): continue
        if 'closed' in json.dumps(p.get('openingHours') or '').lower() and 'permanently' in json.dumps(p).lower(): continue
        rows[p['cid']] = (p['cid'], p['title'], p.get('phoneNumber'), p.get('website'), p.get('type'), ', '.join(p.get('types') or []),
                          p['latitude'], p['longitude'], p.get('rating'), p.get('ratingCount'), json.dumps(p.get('openingHours'), ensure_ascii=False) if p.get('openingHours') else None,
                          p.get('address'), j['city'], j['q'])
db = duckdb.connect(); db.execute("SET threads=6")
db.execute("create table p (cid varchar, title varchar, phone_raw varchar, website varchar, gtype varchar, gtypes varchar, lat double, lon double, rating double, rating_count int, opening_hours varchar, address varchar, city varchar, q varchar)")
db.executemany("insert into p values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", list(rows.values()))
nm = lambda c: f"regexp_replace(translate(lower(coalesce({c},'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g')"
db.execute(f"""create table p2 as select *, {nm('title')} k,
   case when phone_raw is not null then '+966' || regexp_replace(regexp_replace(phone_raw,'[^0-9]','','g'), '^(00966|966|0)', '') end phone from p""")
db.execute(f"create table g as select {nm('name_ar')} ka, {nm('name_en')} ke, phone, latitude y, longitude x from read_parquet('{D}golden/golden_set.parquet') where latitude is not null")
db.execute("""delete from p2 where cid in (
   select p.cid from p2 p join g on p.k=g.ka where length(p.k)>=3 and abs(p.lat-g.y)<0.001 and abs(p.lon-g.x)<0.0011
   union select p.cid from p2 p join g on p.k=g.ke where length(p.k)>=3 and abs(p.lat-g.y)<0.001 and abs(p.lon-g.x)<0.0011
   union select p.cid from p2 p join g on p.phone=g.phone where abs(p.lat-g.y)<0.02 and abs(p.lon-g.x)<0.02)""")
db.execute(f"""copy (select 'gm:' || cid poi_key, case when regexp_matches(title, '[؀-ۿ]') then title end name_ar, case when not regexp_matches(title, '[؀-ۿ]') then title end name_en,
   gtype category, gtypes secondary_category, lat latitude, lon longitude, city city_en, null::varchar district_ar, phone phone_norm, null::varchar email, website,
   cid google_place_id, ['gm:' || cid] source_keys, ['google_maps_serper'] origins, 1 n_source_rows, rating, rating_count, opening_hours, address, q discovered_by
   from p2) to '{D}golden/serper_new.parquet' (format parquet)""")
tmp = tempfile.mkdtemp()
db.execute(f"""copy (select 'gm:' || cid poi_key, case when regexp_matches(title, '[؀-ۿ]') then title end name_ar, case when not regexp_matches(title, '[؀-ۿ]') then title end name_en,
   gtype category, gtype category_ar, gtypes secondary_category, gtype google_category, null::varchar lifecycle_state, null::varchar company_status from p2) to '{tmp}/c.parquet' (format parquet)""")
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/c.csv'], cwd='/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel',
               env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/c.parquet'}, check=True, stdout=subprocess.DEVNULL)
db.execute(f"copy (select * from read_csv('{tmp}/c.csv', all_varchar=true)) to '{D}golden/serper_new_taxonomy.parquet' (format parquet)")
print('places:', len(rows), '| new businesses:', db.execute(f"select count(*), count(phone_norm) from read_parquet('{D}golden/serper_new.parquet')").fetchone(),
      '| classified:', db.execute(f"select count(*) filter (where sub_id not like 'unc.%') from read_parquet('{D}golden/serper_new_taxonomy.parquet')").fetchone())
