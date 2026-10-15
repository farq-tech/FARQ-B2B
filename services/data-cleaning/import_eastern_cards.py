"""Eastern Province 2GIS/Urbi cards (2024-01): 64,335 firms with SynCode, 2GIS categories, administrative district (AR/EN) and a
trade-licence flag. The lake's «Firms with Coordinates» copy has the same SynCodes but no category. Read-only.
Joins: SynCode = lake business_id -> lake entity -> directory row (lake_match) or new business (source_keys).
Output: /Users/m4pro/farq-taxonomy-data/enrich/eastern_cards.parquet (poi_key, syncode, categories, sub_id from the categories,
district_ar, district_en, trade_license)
Usage: python3 import_eastern_cards.py cards.csv"""
import csv, re, sys
import duckdb
F = sys.argv[1]
D = '/Users/m4pro/farq-taxonomy-data/'
LM = '/Users/m4pro/ksa-entity-lake/master/entities_master.parquet'
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
def norm(s):
    s = (s or '').lower().translate(TR)
    return re.sub(r'\s+', ' ', re.sub(r"[^\wء-ي]+", ' ', s)).strip()
LBL = {}
for r in csv.DictReader(open(T + 'activity_map.csv', encoding='utf-8-sig')):
    if r['confidence'] in ('high', 'medium') and norm(r['raw_activity']): LBL.setdefault(norm(r['raw_activity']), r['sub_id'])
def cat_sub(cats):
    for part in re.split(r'[|;,\n]', cats or ''):   # most specific label first as listed
        k = norm(part)
        if k in LBL: return LBL[k], part.strip()
    return None, None
db = duckdb.connect(); db.execute("SET threads=8")
db.execute("create table c as select * from read_csv(?, all_varchar=true, header=true, ignore_errors=true)", [F])
db.execute(f"""create table k as
   select m.poi_key, e.business_id syncode from read_parquet('{D}lake/lake_match.parquet') m join read_parquet('{LM}') e using(entity_id) where e.business_id<>''
   union all select n.poi_key, e.business_id from (select poi_key, replace(unnest(source_keys),'lake:','') entity_id from read_parquet('{D}golden/new_entities.parquet')) n
     join read_parquet('{LM}') e using(entity_id) where e.business_id<>''""")
rows = db.execute("""select k.poi_key, c.SynCode, nullif(c.Categories,'NULL'), regexp_replace(split_part(c.N_AdmDisAR, ',', 1), ' район$', ''),
   regexp_replace(split_part(c.N_AdDisEN, ',', 1), ' district$', ''), nullif(c.trade_license,'NULL'), c.Territory
   from c join k on k.syncode = c.SynCode""").fetchall()
out = []
for key, syn, cats, dar, den, lic, terr in rows:
    sub, ev = cat_sub(cats)
    out.append((key, syn, cats, sub, ev, (dar or '').strip() or None, (den or '').strip() or None, lic, terr))
db.execute("create table o (poi_key varchar, syncode varchar, categories varchar, sub_id varchar, sub_evidence varchar, district_ar varchar, district_en varchar, trade_license varchar, territory varchar)")
db.executemany("insert into o values (?,?,?,?,?,?,?,?,?)", out)
db.execute(f"copy (select * from o qualify row_number() over (partition by poi_key)=1) to '{D}enrich/eastern_cards.parquet' (format parquet)")
print('cards:', db.execute('select count(*) from c').fetchone()[0], '| matched rows:', db.execute(f"select count(*), count(sub_id), count(district_ar), count(trade_license) from read_parquet('{D}enrich/eastern_cards.parquet')").fetchone())
print('unmapped categories:', db.execute("select categories, count(*) from o where sub_id is null and categories is not null group by 1 order by 2 desc limit 15").fetchall())
