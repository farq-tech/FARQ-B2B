"""2GIS/Urbi «Firms with trade license» layer (Feb 2024, MOMRAH project cities Riyadh, Dammam/Khobar, Makkah, Madinah; 232,458 firm cards,
93,639 with a trade-licence number, licence type and end date; dbf read in place, attributes only). Joins by SynCode (card or firm) =
the lake's business_id, like the Eastern cards. Gives the licence number/type/end date, a subcategory from the 2GIS categories
(through activity_map.csv, high/medium only) and the administrative district. Read-only.
Usage: python3 import_firms_license.py firms.dbf
Output: /Users/m4pro/farq-taxonomy-data/enrich/firms_license.parquet"""
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
    for part in re.split(r'[|;,\n]', cats or ''):
        k = norm(part)
        if k in LBL: return LBL[k]
    return None
db = duckdb.connect(); db.execute("SET threads=8"); db.execute("LOAD spatial")
nz = lambda c: f"case when {c} in ('', 'NULL') then null else {c} end"
db.execute(f"""create table fm as select CardSyncod card, FirmSyncod firm, {nz('Categories')} categories, {nz('ArName')} district_ar, {nz('EnName')} district_en,
   {nz('trade_lice')} license_no, {nz('license_ty')} license_type, {nz('legal_form')} legal_form,
   try_strptime({nz('end_date')}, '%d.%m.%Y')::date license_end, Project project from ST_Read('{F}')""")
db.execute(f"""create table k as select m.poi_key, e.business_id syn from read_parquet('{D}lake/lake_match.parquet') m join read_parquet('{LM}') e using(entity_id) where e.business_id<>''
   union all select n.poi_key, e.business_id from (select poi_key, replace(unnest(source_keys),'lake:','') entity_id from read_parquet('{D}golden/new_entities.parquet')) n
     join read_parquet('{LM}') e using(entity_id) where e.business_id<>''""")
db.execute("create table j as select k.poi_key, fm.* from (select card syn, * from fm union all select firm, * from fm) fm join k using(syn)")
rows = db.execute("select distinct categories from j where categories is not null").fetchall()
db.execute("create table cm (categories varchar, sub_id varchar)")
db.executemany("insert into cm values (?,?)", [(c, cat_sub(c)) for (c,) in rows])
db.execute(f"""copy (select j.poi_key, j.card syncode, j.categories, cm.sub_id, j.district_ar, j.district_en, j.license_no, j.license_type, j.legal_form, j.license_end,
   j.license_end < current_date license_expired, j.project from j left join cm using(categories)
   qualify row_number() over (partition by j.poi_key order by (j.license_no is null), (cm.sub_id is null))=1) to '{D}enrich/firms_license.parquet' (format parquet)""")
print(db.execute(f"""select count(*), count(sub_id), count(license_no), count(*) filter (where license_expired), count(district_ar)
   from read_parquet('{D}enrich/firms_license.parquet')""").fetchone())
