"""Names and phones for golden rows that have a location and a subcategory but no name or no phone, from Google Maps through Serper
(`/maps`, 3 credits per call, ~20 places per call). Points are grouped in ~150 m cells and one call per cell and subcategory word is made
around the cell centre; each point then takes the nearest returned place within MAX_M metres (never a guess beyond that). Every raw
response is cached (jsonl) so nothing is paid twice; a hard credit cap stops the run. The key is read from ~/.config/farq/serper.key.
Usage: python3 serper_maps_fill.py --bbox lat0,lon0,lat1,lon1 --cells N --cap CREDITS
Output: /Users/m4pro/farq-taxonomy-data/enrich/serper_maps.parquet (poi_key, place name, phone, rating, type, distance, cell)"""
import argparse, json, math, os, time, urllib.request
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/'
CACHE = D + 'enrich/serper_maps_raw.jsonl'
MAX_M = 50
ap = argparse.ArgumentParser(); ap.add_argument('--bbox', default='16,34.5,32.2,55.7'); ap.add_argument('--min-rows', type=int, default=3); ap.add_argument('--cells', type=int, default=50); ap.add_argument('--cap', type=int, default=150)
a = ap.parse_args()
lat0, lon0, lat1, lon1 = map(float, a.bbox.split(','))
KEY = open(os.path.expanduser('~/.config/farq/serper.key')).read().strip()
db = duckdb.connect()
# candidate rows: located, real subcategory, missing a name or a phone (any exclusion except deleted/closed/duplicate)
rows = db.execute(f"""select poi_key, latitude, longitude, sub_ar, name_ar is null and name_en is null no_name, phone is null no_phone,
   round(latitude/0.0015)::int cy, round(longitude/0.0015)::int cx, city_en, sub_id
   from read_parquet('{D}golden/golden_set.parquet')
   where latitude between {lat0} and {lat1} and longitude between {lon0} and {lon1} and sub_id not like 'unc.%' and sub_id not like 'noncom.%'
     and (phone is null) and coalesce(exclude_reason,'') in ('', 'no_name')""").fetchall()
cells = {}
for r in rows: cells.setdefault((r[6], r[7], r[3]), []).append(r)
done = set()
if os.path.exists(CACHE):
    for line in open(CACHE): done.add(tuple(json.loads(line)['cell']))
# targeted order: expected fills per call, weighted toward weak cities and toward sellers of weak B2B families
STRONG = {'Riyadh', 'Jeddah', 'Dammam', 'Al Khobar'}; MID = {'Makkah Al Mukarramah', 'Al Madinah Al Munawwarah', 'Al Ahsa', 'Al Taif'}
fam = db.execute("""select r.sub_id from read_csv('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/sub_family_relations.csv') r
   join read_csv('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/product_families.csv') f using(family_id)
   where r.relation='sells' and r.strength in ('core','common') and f.group_id in ('mach','kit','chem','pkg','bld','fns','mep','tool','nrg','veh','agr','med','lgs','tsv','cln')""").fetchall()
B2B = {x[0] for x in fam}
def score(k):
    rs = cells[k]; city = rs[0][8]
    w = 1 if city in STRONG else 2 if city in MID else 3
    return len(rs) * w * (2 if rs[0][9] in B2B else 1)
order = sorted([k for k in cells if len(cells[k]) >= a.min_rows], key=lambda k: -score(k))
todo = [c for c in order if (c[0], c[1], c[2]) not in done][:a.cells]
# 8 calls in parallel; the cap is enforced up front (3 credits per call) so parallelism can never overspend
import threading, concurrent.futures
todo = todo[:max(0, a.cap // 3)]
lock = threading.Lock(); spent = 0
def call(cell):
    cy, cx, sub = cell
    body = json.dumps({'q': sub, 'll': f'@{cy * 0.0015:.5f},{cx * 0.0015:.5f},18z', 'gl': 'sa', 'hl': 'ar'}).encode()
    req = urllib.request.Request('https://google.serper.dev/maps', body, {'X-API-KEY': KEY, 'Content-Type': 'application/json'})
    for attempt in range(3):
        try: return cell, json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e: time.sleep(2 + attempt * 3)
    return cell, None
with open(CACHE, 'a') as out, concurrent.futures.ThreadPoolExecutor(8) as ex:
    for cell, d in ex.map(call, todo):
        if d is None: continue
        with lock:
            spent += d.get('credits', 3)
            out.write(json.dumps({'cell': list(cell), 'places': d.get('places', [])}, ensure_ascii=False) + '\n')
print('cells with candidates:', len(cells), '| rows:', len(rows), '| called now:', len(todo), '| credits spent now:', spent)
# classify every returned place with the row classifier (Google type as the activity, title as the name), then match each candidate
# row to the nearest place within MAX_M metres that has the SAME main category; a place is used once
import csv, subprocess, tempfile, json as _j
places = {}
for line in open(CACHE):
    for p in json.loads(line)['places']:
        if p.get('latitude') and p.get('title') and p.get('cid'): places[p['cid']] = p
tmp = tempfile.mkdtemp()
db.execute("create table pl (poi_key varchar, name_ar varchar, name_en varchar, category varchar, category_ar varchar, secondary_category varchar, google_category varchar, lifecycle_state varchar, company_status varchar)")
db.executemany("insert into pl values (?,?,?,?,?,?,?,?,?)", [(c, p['title'], None, p.get('type'), p.get('type'), ', '.join(p.get('types') or []), p.get('type'), None, None) for c, p in places.items()])
db.execute(f"copy pl to '{tmp}/pl.parquet' (format parquet)")
RL = '/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/rowlevel'
subprocess.run(['python3', 'classify_rows.py', f'{tmp}/pl.csv'], cwd=RL, env={**os.environ, 'CLASSIFY_INPUT': f'{tmp}/pl.parquet'}, check=True, stdout=subprocess.DEVNULL)
tax = _j.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json')); MAIN = {x['sub_id']: x['main_id'] for x in tax['subs']}
psub = {r['poi_key']: r['sub_id'] for r in csv.DictReader(open(f'{tmp}/pl.csv', encoding='utf-8')) if not r['sub_id'].startswith('unc.')}
rmain = dict(db.execute(f"select poi_key, main_id from read_parquet('{D}golden/golden_set.parquet') where poi_key in (select unnest(?))", [[r[0] for r in rows]]).fetchall())
def dist(a1, o1, a2, o2): return 111320 * math.hypot(a2 - a1, (o2 - o1) * math.cos(math.radians(a1)))
grid = {}
for c, p in places.items(): grid.setdefault((round(p['latitude'] / 0.001), round(p['longitude'] / 0.001)), []).append((c, p))
cands = []
for r in rows:
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for c, p in grid.get((round(r[1] / 0.001) + dy, round(r[2] / 0.001) + dx), []):
                m = dist(r[1], r[2], p['latitude'], p['longitude'])
                if m <= MAX_M and c in psub and MAIN.get(psub[c]) == rmain.get(r[0]): cands.append((m, r[0], c))
res, used_p, used_r = [], set(), set()
for m, k, c in sorted(cands):
    if k in used_r or c in used_p: continue
    used_r.add(k); used_p.add(c); p = places[c]
    res.append((k, p['title'], p.get('phoneNumber'), p.get('rating'), p.get('type'), psub[c], round(m), c))
db.execute("create table r (poi_key varchar, gm_name varchar, gm_phone varchar, gm_rating double, gm_type varchar, gm_sub varchar, gm_m int, gm_cid varchar)")
if res: db.executemany("insert into r values (?,?,?,?,?,?,?,?)", res)
db.execute(f"copy r to '{D}enrich/serper_maps.parquet' (format parquet)")
print('places cached:', len(places), '| classified:', len(psub), '| matched rows (same main category):', len(res), '| with phone:', sum(1 for x in res if x[2]))
