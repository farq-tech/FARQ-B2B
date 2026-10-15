"""Discover missing suppliers/technical services in weak cities from Google Maps through Serper (owner-approved, 2026-10-16).
For each target city, search points are the busiest ~3 km cells of existing golden points; at each point one /maps call per trade word
(zoom 14, ~20 places, 3 credits). Credits are split by city weight (Qassim first). Raw responses are cached (serper_discover_raw.jsonl);
a hard cap stops the run. Places become candidate new businesses in a later step (dedupe + classification), never directly.
Usage: python3 serper_discover.py --cap 4800"""
import argparse, json, os, time, urllib.request, concurrent.futures, threading
import duckdb
D = '/Users/m4pro/farq-taxonomy-data/'
CACHE = D + 'enrich/serper_discover_raw.jsonl'
TERMS = ['سباك', 'كهربائي', 'تكييف وتبريد', 'مواد بناء', 'جبس بورد وديكور', 'أدوات صحية', 'مقاولات', 'ألمنيوم وحدادة']
CITIES = {  # canonical city_en -> weight
 'Buraydah': 6, 'Unaizah': 3, 'Ar Rass': 2, 'Albukayriyah': 1, 'Al Mithnab': 1,
 'Hail': 2, 'Tabuk': 2, 'Jazan': 2, 'Abha': 2, 'Khamis Mushayt': 2, 'Najran': 2, 'Al Taif': 2, 'Hafar Al Batin': 2, 'Arar': 1, 'Sakaka': 1, 'Al Bahah': 1, 'Yanbu': 1,
}
ap = argparse.ArgumentParser(); ap.add_argument('--cap', type=int, default=4800); a = ap.parse_args()
KEY = open(os.path.expanduser('~/.config/farq/serper.key')).read().strip()
db = duckdb.connect()
calls_total = a.cap // 3
wsum = sum(CITIES.values())
done = set()
if os.path.exists(CACHE):
    for line in open(CACHE): j = json.loads(line); done.add((j['lat'], j['lon'], j['q']))
plan = []
for city, w in CITIES.items():
    n_points = max(1, (calls_total * w // wsum) // len(TERMS))
    pts = db.execute(f"""select round(latitude/0.027)*0.027 la, round(longitude/0.03)*0.03 lo, count(*) n from read_parquet('{D}golden/golden_set.parquet')
       where city_en = ? and latitude is not null group by 1,2 order by 3 desc limit ?""", [city, n_points]).fetchall()
    for la, lo, n in pts:
        for t in TERMS:
            if (round(la, 5), round(lo, 5), t) not in done: plan.append((city, round(la, 5), round(lo, 5), t))
plan = plan[:calls_total]
print('planned calls:', len(plan), 'credits:', len(plan) * 3, '| by city:', {c: sum(1 for p in plan if p[0] == c) for c in CITIES})
lock = threading.Lock()
def call(p):
    city, la, lo, t = p
    body = json.dumps({'q': t, 'll': f'@{la},{lo},14z', 'gl': 'sa', 'hl': 'ar'}).encode()
    req = urllib.request.Request('https://google.serper.dev/maps', body, {'X-API-KEY': KEY, 'Content-Type': 'application/json'})
    for k in range(3):
        try: return p, json.load(urllib.request.urlopen(req, timeout=30))
        except Exception: time.sleep(2 + 3 * k)
    return p, None
spent = 0
with open(CACHE, 'a') as out, concurrent.futures.ThreadPoolExecutor(8) as ex:
    for (city, la, lo, t), d in ex.map(call, plan):
        if d is None: continue
        with lock:
            spent += d.get('credits', 3)
            out.write(json.dumps({'city': city, 'lat': la, 'lon': lo, 'q': t, 'places': d.get('places', [])}, ensure_ascii=False) + '\n')
print('credits spent:', spent)
