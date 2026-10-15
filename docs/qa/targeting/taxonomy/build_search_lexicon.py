"""Search lexicon: every word or phrase a Saudi buyer/seller may type, mapped to Farq subcategories (and through them to product families).
Built from our own evidence, no external service:
 1. raw activity labels (activity_map.csv, high/medium) — official/ISIC-style wording;
 2. HudHud category names and their Arabic/English search keywords (transaction_management_complete.db `categories`, via hudhud_sub_map);
 3. category labels seen on matched rows: 2GIS/Urbi categories, Google types (Serper cache), Overture categories, OSM types;
 4. name mining: words and two-word phrases that are frequent in the names of rows confidently classified to one subcategory and rare
    elsewhere (precision >= 0.6, support >= 15) — this catches market words like «منجرة», «بوية», «جبسن», brand-free trade words.
Each term keeps its sources and support; ambiguous terms keep their top subcategories with shares so the search can ask the user.
Output: search_lexicon.csv (term, sub_id, share, support, sources)"""
import csv, json, re, sqlite3, collections, duckdb, os
T = os.path.dirname(os.path.abspath(__file__)) + '/'
D = '/Users/m4pro/farq-taxonomy-data/'
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
def norm(s):
    s = (s or '').lower().translate(TR)
    s = re.sub('[ً-ْـ]', '', s)
    return re.sub(r'\s+', ' ', re.sub(r"[^\w\s]+|[0-9_]+", ' ', s)).strip()
tax = json.load(open(T + 'farq_taxonomy.json')); SUBS = {s['sub_id']: s for s in tax['subs']}
STOP = set('مؤسسه شركه محل محلات مركز مكتب فرع للتجاره التجاريه تجاره العامه عامه ابناء اولاد شركاء والتجاره المحدوده ذ م م السعوديه الرياض جده الدمام مكه المدينه '
           'co company est establishment trading branch the and for of in al saudi arabia ksa ltd llc shop store center centre'.split())
votes = collections.defaultdict(lambda: collections.Counter()); srcs = collections.defaultdict(set)
def add(term, sub, src, w=1):
    t = norm(term)
    if not t or len(t) < 3 or t in STOP or sub not in SUBS or sub.startswith('unc.'): return
    votes[t][sub] += w; srcs[t].add(src)
for r in csv.DictReader(open(T + 'activity_map.csv', encoding='utf-8-sig')):
    if r['confidence'] in ('high', 'medium'): add(r['raw_activity'], r['sub_id'], 'activity_map', 5)
hm = {r['hudhud_sub_id'].split('.')[0]: r for r in csv.DictReader(open(T + 'hudhud_sub_map.csv', encoding='utf-8'))}
for r in hm.values():
    if r['confidence'] in ('high', 'medium'): add(r['hudhud_sub_ar'], r['sub_id'], 'hudhud_category', 5); add(r['hudhud_sub_en'], r['sub_id'], 'hudhud_category', 5)
for s in SUBS.values():
    add(s['sub_ar'], s['sub_id'], 'farq_taxonomy', 10); add(s.get('sub_en'), s['sub_id'], 'farq_taxonomy', 10)
try:
    con = sqlite3.connect('file:/Volumes/Archive/Drive_db/transaction_management_complete.db?immutable=1', uri=True)
    import ast
    for cid, kar, ken in con.execute('select id, search_key_words_ar, search_key_words_en from categories'):
        r = hm.get(str(cid))
        if not r or r['confidence'] not in ('high', 'medium'): continue
        for blob in (kar, ken):
            try:
                for w in ast.literal_eval(blob or '[]'): add(w, r['sub_id'], 'hudhud_keywords', 3)
            except Exception: pass
except Exception as e: print('hudhud keywords skipped:', e)
db = duckdb.connect(); db.execute("SET threads=8")
G = f"read_parquet('{D}golden/golden_set.parquet')"
# category labels of rows whose class is confident
for col, src in (('google_categories', 'google_category'),):
    for lab, sub, n in db.execute(f"select {col}, sub_id, count(*) from {G} where {col} is not null and cls_confidence in ('high','medium') and sub_id not like 'unc.%' group by 1,2 having count(*)>=5").fetchall():
        for part in re.split(r'[|,;]', lab or ''): add(part, sub, src, min(n, 50) / 10)
# name mining
rows = db.execute(f"select coalesce(name_ar,'') || ' ' || coalesce(name_en,''), sub_id from {G} where in_golden and cls_confidence in ('high','medium') and sub_id not like 'unc.%' and sub_id not like 'noncom.%'").fetchall()
cnt = collections.defaultdict(collections.Counter)
for name, sub in rows:
    toks = [t for t in norm(name).split() if t not in STOP and len(t) >= 3]
    grams = set(toks) | {' '.join(toks[i:i + 2]) for i in range(len(toks) - 1)}
    for g in grams: cnt[g][sub] += 1
for g, c in cnt.items():
    tot = sum(c.values()); sub, top = c.most_common(1)[0]
    if tot >= 15 and top / tot >= 0.6: add(g, sub, 'name_mining', min(top, 200) / 20)
with open(T + 'search_lexicon.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['term', 'sub_id', 'share', 'support', 'sources'])
    for t, c in sorted(votes.items()):
        tot = sum(c.values())
        for sub, v in c.most_common(3):
            if v / tot >= 0.2: w.writerow([t, sub, round(v / tot, 2), round(v, 1), '|'.join(sorted(srcs[t]))])
print('terms:', len(votes), '| from name mining:', sum(1 for t in srcs if 'name_mining' in srcs[t]))
