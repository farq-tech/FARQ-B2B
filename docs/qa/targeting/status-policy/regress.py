"""Read-only regression + timing on the real directory (symlinked, never copied). Prints aggregates only."""
import sys, os, time, json, socket, urllib.request
CODE = os.path.abspath(sys.argv[1]); sys.path.insert(0, CODE); os.chdir(CODE)
for k in ('ANTHROPIC_API_KEY','GOOGLE_PLACES_API_KEY','CONSTRUCTION_DB_URL','TARGETING_PASSWORD'): os.environ.pop(k, None)
urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(AssertionError('network'))
_c = socket.socket.connect
socket.socket.connect = lambda s, a: (_c(s, a) if (isinstance(a, tuple) and a[0] in ('127.0.0.1','::1')) or not isinstance(a, tuple) else (_ for _ in ()).throw(AssertionError('network')))
t0 = time.time(); import server; out = {'import_s': round(time.time()-t0, 1)}
def timed(f, *a, **k):
    t = time.time(); r = f(*a, **k); return r, round((time.time()-t)*1000)
with server.LOCK: st = server.con.execute("select count(*), count(*) filter (where has_whatsapp), count(*) filter (where email is not null) from t" + (" where " + server.status_policy.SEARCH_SQL if hasattr(server, 'status_policy') else "")).fetchone()
out['status'] = st
cities = ['Riyadh', 'Makkah Al Mukarramah', 'Dammam', 'Al Madinah Al Munawwarah', 'Jeddah']
out['browse'] = {}; out['facets'] = {}
for c in cities:
    r, ms = timed(server.TILES.browse, c, None, 30, 0); out['browse'][c] = (r.get('total'), ms)
    r2, ms2 = timed(server.TILES.browse, c, {'contact': 'whatsapp'}, 30, 0); out['browse'][c + '|wa'] = (r2.get('total'), ms2)
    f, ms3 = timed(server.TILES.facets, c); out['facets'][c] = (sum(x['count'] for x in f['categories']), ms3)
out['search'] = {}
for q in ['سباكة', 'بورسلان', 'حديد', 'كهرباء', 'أثاث مكتبي']:
    pages, keys, ms_all = [], [], []
    r, ms = timed(server.TRIAL_DIRECTORY.search, q, 'Riyadh', 'purchase', 30, 0); ms_all.append(ms)
    total = r['total']; pages.append(len(r['rows'])); keys += [x.get('poi_key') for x in r['rows']]
    for _ in range(2):
        if r.get('next_offset') is None: break
        r, ms = timed(server.TRIAL_DIRECTORY.search, q, 'Riyadh', 'purchase', 30, r['next_offset']); ms_all.append(ms); pages.append(len(r['rows'])); keys += [x.get('poi_key') for x in r['rows']]
    out['search'][q] = {'total': total, 'pages': pages, 'dup_keys_across_pages': len(keys) - len(set(keys)), 'ms': ms_all}
r, ms = timed(server.search, 'سباكة', 3000, False, 'Riyadh', False); out['legacy_search'] = (r.get('total'), ms)
print(json.dumps(out, ensure_ascii=False))
