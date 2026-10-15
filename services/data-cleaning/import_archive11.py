"""Import the owner's reference files (Archive 11, 2026-10-15) as separate enrichment layers. Read-only on the directory.
Outputs in /Users/m4pro/farq-taxonomy-data/enrich/:
  brand_branches.parquet   poi_key -> matched brand, its category, contacts (from brand review «Branch-to-Brand-Matched-POIs»)
  gmb_match.parquet        poi_key -> Google place id, Google categories, rating, reviews, temp/permanent closure, phone, url
  brand_name_class.parquet poi_key -> sub_id from a known brand name (combined_brands + brand review), for unclassified rows
  gmb_class.parquet        poi_key -> sub_id from matched Google categories
  contracting_suppliers.parquet  poi_key -> curated contracting supplier flag + material groups
Usage: python3 import_archive11.py CSV_DIR"""
import csv, json, os, re, sys
import duckdb

csv.field_size_limit(10 ** 8)
SRC = sys.argv[1]
P = '/Users/m4pro/farq-targeting/data/targets.parquet'
D = '/Users/m4pro/farq-taxonomy-data/'
OUT = D + 'enrich/'
os.makedirs(OUT, exist_ok=True)
T = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/'
sys.path.insert(0, T + 'rowlevel')
from name_rules import RULES  # noqa: E402

TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
def norm(s):
    s = (s or '').lower().translate(TR); s = re.sub('[ً-ْـ]', '', s)
    return re.sub(r'\s+', ' ', re.sub(r"[^\wء-ي]+", ' ', s)).strip()
def key(s): return re.sub(r'[^a-z0-9ء-ي]+', '', norm(s))
def f(path): return os.path.join(SRC, path)
def rows(path):
    with open(f(path), encoding='utf-8') as fh: yield from csv.DictReader(fh)
def nn(v): return None if v in (None, '', 'None', 'nan') else v

# --- category label -> sub_id (confident activity labels from the activity map, then taxonomy keywords) ---
amap = list(csv.DictReader(open(T + 'activity_map.csv', encoding='utf-8-sig')))
LBL = {}
for r in amap:
    if r['confidence'] in ('high', 'medium'):
        for v in (r['raw_activity'], r['raw_ar']):
            if norm(v) and not norm(v).isdigit(): LBL.setdefault(norm(v), r['sub_id'])
KW = {}
for sub, w, kws in RULES:
    for k in kws:
        k = norm(k)
        if k and (k not in KW or KW[k][1] < w): KW[k] = (sub, w)
def label_sub(text):
    """Best sub for a category text such as 'Restaurant|Indian restaurant' or 'Automotive Services'."""
    parts = [p for p in re.split(r'[|,;/]', text or '') if norm(p)]
    for p in parts:                              # exact known label first, most specific (last) part first
        pass
    for p in reversed(parts):
        if norm(p) in LBL: return LBL[norm(p)], p.strip()
    best = None
    for p in parts:
        toks = norm(p).split()
        for n in (3, 2, 1):
            for i in range(len(toks) - n + 1):
                g = ' '.join(toks[i:i + n])
                for v in {g, g[:-1] if g.endswith('s') else g}:
                    if v in KW and (best is None or (KW[v][1], n) > best[0]): best = ((KW[v][1], n), KW[v][0], p.strip())
    return (best[1], best[2]) if best else (None, None)

db = duckdb.connect(); db.execute("SET threads=6")
db.execute(f"""create table dir as select poi_key, hudhud_id, regexp_replace(translate(lower(coalesce(nullif(name_ar,''),name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k,
  regexp_replace(translate(lower(coalesce(name_en,'')),'أإآةىؤئ','اااهيوي'),'[^a-z0-9ء-ي]+','','g') k_en,
  latitude lat, longitude lon, regexp_replace(coalesce(phone_norm,''),'[^0-9]','','g') phone from read_parquet('{P}')""")

# 1) branch -> brand matches (hh ids)
brand_cat = {}
for r in rows('brand review__brand_review_FINAL_CLEAN.csv'):
    for nm in (r.get('Brand Name (English)'), r.get('Brand Name (Arabic)')):
        if nn(nm): brand_cat[key(nm)] = nn(r.get('Primary Category (English)')) or ''
combined = {}
for r in rows('combined_brands_with_hs_20251118_095050 (1).csv'):
    cats = nn(r.get('categories')) or ''
    for nm in (r.get('normalized_name'), r.get('preferred_name_en'), r.get('preferred_name_ar')):
        if nn(nm) and len(key(nm)) >= 3: combined.setdefault(key(nm), (cats, int(float(r.get('total_branch_count') or 0)), nn(r.get('website'))))
bb = []
for r in rows('brand review__Banch-to-Brand-Matched-POIs( Do.csv'):
    pid = nn(r.get('poi_id'))
    if not pid: continue
    brand = nn(r.get('matched_brand_name_en')) or nn(r.get('matched_brand_name_ar'))
    cat = brand_cat.get(key(brand or ''), '') or combined.get(key(brand or ''), ('',))[0]
    sub, ev = label_sub(cat)
    bb.append(('hh:' + str(int(float(pid))), brand, nn(r.get('matched_brand_name_ar')), cat, sub, nn(r.get('match_score')), nn(r.get('validation_flag')),
               nn(r.get('phone_number')), nn(r.get('website')), nn(r.get('email')), nn(r.get('instagram')), nn(r.get('tiktok')), nn(r.get('snapchat')), nn(r.get('x_link'))))
db.execute("create table bb (poi_key varchar, brand varchar, brand_ar varchar, brand_category varchar, sub_id varchar, match_score varchar, validation_flag varchar, phone varchar, website varchar, email varchar, instagram varchar, tiktok varchar, snapchat varchar, x_link varchar)")
db.executemany("insert into bb values (" + ','.join('?' * 14) + ")", bb)
db.execute(f"copy (select bb.* from bb join dir using(poi_key)) to '{OUT}brand_branches.parquet' (format parquet)")
print('brand branches:', len(bb), 'matched to directory:', db.execute("select count(*) from bb join dir using(poi_key)").fetchone()[0])

# 2) brand-name classification for any row whose whole name is a known brand
bn = []
for k, (cats, branches, web) in combined.items():
    sub, ev = label_sub(cats)
    if sub: bn.append((k, sub, cats[:120], branches))
for k, cat in brand_cat.items():
    sub, ev = label_sub(cat)
    if sub and len(k) >= 3: bn.append((k, sub, cat[:120], 0))
db.execute("create table bn (k varchar, sub_id varchar, cats varchar, branches int)")
db.executemany("insert into bn values (?,?,?,?)", bn)
db.execute("create table bn1 as select k, arg_max(sub_id, branches) sub_id, any_value(cats) cats from bn group by k")
db.execute(f"""copy (select d.poi_key, b.sub_id, 'brand_name' as source, 'medium' as confidence, b.cats as evidence from dir d join bn1 b on b.k=d.k or (d.k_en<>'' and b.k=d.k_en)
  qualify row_number() over (partition by d.poi_key)=1) to '{OUT}brand_name_class.parquet' (format parquet)""")
print('rows matching a known brand name:', db.execute(f"select count(*) from read_parquet('{OUT}brand_name_class.parquet')").fetchone()[0])

# 3) GMB: match by phone (same number within 2 km) or by name within 150 m
g = []
for r in rows('GMB_21May24_20250425_120244__phase1.csv'):
    try: lon, lat = float(r.get('LON') or 'x'), float(r.get('LAT') or 'x')
    except ValueError: continue
    cats = nn(r.get('CATEGORY')) or '|'.join(x for x in (nn(r.get('CATEGORY1')), nn(r.get('CATEGORY2'))) if x)
    ph = re.sub(r'\D', '', (r.get('PHONE_NUMBER_CLEAR') or '').split('.')[0])
    g.append((nn(r.get('PID')), r.get('COMPANY_NAME'), key(r.get('COMPANY_NAME')), lat, lon, ph, cats, nn(r.get('RATING')), nn(r.get('REVIEW_NUMBER')),
              str(r.get('tempClosed') or '').strip().lower() in ('true', '1', 'temporarily closed') or bool(nn(r.get('tempClosed'))),
              str(r.get('permClosed') or '').strip().lower() in ('true', '1', 'permanently closed') or bool(nn(r.get('permClosed'))),
              nn(r.get('COMPANY_URL')), nn(r.get('PHONE_NUMBER_FORMATED'))))
db.execute("create table g (place_id varchar, name varchar, k varchar, lat double, lon double, phone varchar, cats varchar, rating varchar, reviews varchar, temp_closed bool, perm_closed bool, url varchar, phone_fmt varchar)")
db.executemany("insert into g values (" + ','.join('?' * 13) + ")", g)
db.execute("""create table gm as
  select d.poi_key, g.*, 'phone' how from g join dir d on d.phone<>'' and length(g.phone)>=9 and right(d.phone,9)=right(g.phone,9)
     and abs(d.lat-g.lat)<0.02 and abs(d.lon-g.lon)<0.02
  union all
  select d.poi_key, g.*, 'name_150m' from g join dir d on d.k=g.k and length(g.k)>=4 and abs(d.lat-g.lat)<0.00135 and abs(d.lon-g.lon)<0.0015""")
db.execute(f"""copy (select poi_key, arg_min(place_id, case how when 'phone' then 0 else 1 end) place_id, any_value(cats) google_categories, any_value(rating) rating,
   any_value(reviews) reviews, bool_or(temp_closed) temp_closed, bool_or(perm_closed) perm_closed, any_value(url) url, any_value(phone_fmt) phone, min(how) matched_by
   from gm group by poi_key) to '{OUT}gmb_match.parquet' (format parquet)""")
s = db.execute(f"select count(*), count(*) filter (where perm_closed), count(*) filter (where temp_closed) from read_parquet('{OUT}gmb_match.parquet')").fetchone()
print('gmb rows:', len(g), '| matched directory rows:', s[0], '| permanently closed:', s[1], '| temporarily closed:', s[2])
gc = []
for k, cats in db.execute(f"select poi_key, google_categories from read_parquet('{OUT}gmb_match.parquet') where google_categories is not null").fetchall():
    sub, ev = label_sub(cats)
    if sub: gc.append((k, sub, 'gmb_category', 'medium', cats[:120]))
db.execute("create table gc (poi_key varchar, sub_id varchar, source varchar, confidence varchar, evidence varchar)")
db.executemany("insert into gc values (?,?,?,?,?)", gc)
db.execute(f"copy gc to '{OUT}gmb_class.parquet' (format parquet)")
print('gmb categories mapped to a subcategory:', len(gc))

# 4) curated contracting suppliers
cs = []
for r in rows('موزعو المقاولات المؤهلون__محلات ومواد المقاولات.csv'):
    sid = nn(r.get('معرف المصدر'))
    if sid and sid.replace('.0', '').isdigit(): cs.append(('hh:' + sid.replace('.0', ''), nn(r.get('فئات القطع والمواد')), nn(r.get('نوع الجهة')), nn(r.get('ثقة المطابقة')), False))
for r in rows('موزعو المقاولات المؤهلون__الموزعون المؤهلون.csv'):
    sid = nn(r.get('معرف المصدر'))
    if sid and sid.replace('.0', '').isdigit(): cs.append(('hh:' + sid.replace('.0', ''), nn(r.get('التصنيف الرئيسي')), 'موزع مؤهل', nn(r.get('الثقة')), True))
db.execute("create table cs (poi_key varchar, materials varchar, kind varchar, confidence varchar, qualified bool)")
db.executemany("insert into cs values (?,?,?,?,?)", cs)
db.execute(f"copy (select poi_key, string_agg(distinct materials, ' | ') materials, any_value(kind) kind, any_value(confidence) confidence, bool_or(qualified) qualified from cs join dir using(poi_key) group by poi_key) to '{OUT}contracting_suppliers.parquet' (format parquet)")
print('contracting suppliers matched:', db.execute(f"select count(*), count(*) filter (where qualified) from read_parquet('{OUT}contracting_suppliers.parquet')").fetchone())
