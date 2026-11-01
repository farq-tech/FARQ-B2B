"""Archive 13 (2026-10-15): SPD TRX final state («draft_full_datav», 751,752 transactions after cleaning) and the Google-scrape
batches (original rows vs manual review of the LLM-normalised names). Read-only on the directory.
Writes /Users/m4pro/farq-taxonomy-data/enrich/hudhud_trx_state.parquet  (poi_key, state, is_deleted, category_id, category_en, confidence, media_count)
       /Users/m4pro/farq-taxonomy-data/enrich/google_batches.parquet     (poi_key match, google_id, phone, google categories, manual verdict, names)
Usage: python3 import_archive13.py ARCHIVE13_DIR"""
import duckdb, glob, os, sys
A = sys.argv[1]
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
O = '/Users/m4pro/farq-taxonomy-data/enrich/'
db = duckdb.connect(); db.execute("SET threads=8")
db.execute(f"""copy (select 'hh:' || id poi_key, state, is_deleted='True' is_deleted, try_cast(category_id as double)::int category_id, category_en, category_ar,
   try_cast(confidence as int) confidence, try_cast(media_count as int) media_count
   from read_csv('{A}/draft_full_datav.csv', all_varchar=true, header=true, ignore_errors=true)
   where 'hh:' || id in (select poi_key from read_parquet('{P}'))) to '{O}hudhud_trx_state.parquet' (format parquet)""")
print('TRX states matched:', db.execute(f"select count(*), count(*) filter (where is_deleted), count(*) filter (where state='ready to publish') from read_parquet('{O}hudhud_trx_state.parquet')").fetchone())
# Google batches: original rows carry the phone, Google categories and SPD category ids; the manual files carry the reviewer verdict (same row order)
rows = []
for b in ('2', '3', '4'):
    orig = glob.glob(f'{A}/batches/[Bb]atch{b}_original.csv')[0]
    man = glob.glob(f'{A}/batches/[Bb]atch{b}_manual*.csv')[0]
    db.execute(f"create or replace table o as select row_number() over () rn, * from read_csv(?, all_varchar=true, header=true, ignore_errors=true)", [orig])
    db.execute(f"create or replace table m as select row_number() over () rn, * from read_csv(?, all_varchar=true, header=true, ignore_errors=true)", [man])
    mcols = [c[0] for c in db.execute("describe m").fetchall()]
    na = 'new_name_ar' if 'new_name_ar' in mcols else 'normalized_arabic_name'
    ne = 'new_name_en' if 'new_name_en' in mcols else 'normalized_english_name'
    db.execute(f"""create or replace table b{b} as select '{b}' batch, o.google_id, coalesce(nullif(o.name_ar,'None'), o.name) name_raw, m."{na}" name_ar_reviewed, m."{ne}" name_en_reviewed,
       lower(trim(m."manual review")) verdict, o.google_categories, o.phone_number, try_cast(o.latitude as double) lat, try_cast(o.longitude as double) lon,
       o.category_id, o.subcategory_ids, nullif(o.matching_trx_id,'None') matching_trx_id, o.rating, o.reviews_count
       from o left join m using(rn)""")
db.execute("create table bb as select * from b2 union all select * from b3 union all select * from b4")
db.execute(f"""create table t as select poi_key, regexp_replace(translate(lower(coalesce(nullif(name_ar,''),name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k,
   latitude lat, longitude lon, right(regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g'),9) ph from read_parquet('{P}') where latitude is not null""")
db.execute("""create table bm as select bb.*, coalesce(
     (select 'hh:' || split_part(bb.matching_trx_id,'.',1) where bb.matching_trx_id is not null),
     (select arg_min(t.poi_key, abs(t.lat-bb.lat)+abs(t.lon-bb.lon)) from t where t.ph<>'' and t.ph=right(regexp_replace(coalesce(bb.phone_number,''),'[^0-9]','','g'),9)
        and abs(t.lat-bb.lat)<0.02 and abs(t.lon-bb.lon)<0.02)) poi_key from bb""")
db.execute(f"copy bm to '{O}google_batches.parquet' (format parquet)")
print('google batch rows:', db.execute("select count(*), count(phone_number), count(poi_key), count(*) filter (where verdict like 'good%'), count(*) filter (where verdict like 'bad%') from bm").fetchone())
