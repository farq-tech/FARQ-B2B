"""Data for the map prototype v3 (owner 2026-10-16): official district polygons (MOMRAH atlas), points only inside chosen districts,
precise points only (location_precision='point'), names without phone numbers, badges, no contact fields at all."""
import duckdb, json, re, sys
sys.path.insert(0, '/Users/m4pro/farq-pricing/docs/qa/map-layers'); from icon_map import MAIN, SUB
OUT = sys.argv[1]
T = '/Users/m4pro/farq-taxonomy-data/staging-targeting/data/targets.parquet'
GP = '/Users/m4pro/Desktop/farq-poi-atlas.gpkg'
W, S, E, N = 46.700, 24.640, 46.772, 24.700
c = duckdb.connect(); c.execute('install spatial; load spatial')
c.execute(f"""create table hood as select ArName ar, EnName en, ST_SimplifyPreserveTopology(geom, 0.00012) geom from ST_Read('{GP}', layer='00_Neighborhoods')
  where EnCity ilike '%riyadh%' and ST_Within(ST_Centroid(geom), ST_MakeEnvelope({W},{S},{E},{N}))""")
c.execute(f"""create table p as select t.*, h.ar hood from read_parquet('{T}') t join hood h on ST_Contains(h.geom, ST_Point(t.longitude, t.latitude))
  where t.sub_id is not null and t.sub_id not like 'unc.%' and t.sub_id not like 'noncom.%' and coalesce(t.location_precision,'point') = 'point'""")
tax = json.load(open('/Users/m4pro/farq-pricing/docs/qa/targeting/taxonomy/farq_taxonomy.json'))
subs = {s['sub_id']: s for s in tax['subs']}
rows = c.sql("""select longitude, latitude, hood, sub_id, coalesce(nullif(name_ar,''), name_en), coalesce(specialties_ar, ''), coalesce(role_badges,''),
   coalesce(is_wholesale,false), coalesce(has_whatsapp,false), commercial_license is not null, coalesce(completeness_pct,0), coalesce(street_ar,''),
   coalesce(source_count,1), coalesce(working_hours,'') is not null and coalesce(working_hours,'')<>'', try_cast(rating as double) from p""").fetchall()
PH = re.compile(r'(\+?966|00966)?[\s\-]*0?5[\d\s\-]{8,}|[\d٠-٩][\d٠-٩\s\-]{6,}[\d٠-٩]')
def clean(n):   # never show a phone number inside a business name
    n = PH.sub(' ', n or ''); n = re.sub(r'\s{2,}', ' ', re.sub(r'[|/،,\-–:]+\s*$', '', n)).strip(' -|،,')
    return n[:60] or 'منشأة بدون اسم'
hoods = sorted({r[2] for r in rows}); hi = {h: i for i, h in enumerate(hoods)}
usub = sorted({r[3] for r in rows if r[3] in subs}); si = {s: i for i, s in enumerate(usub)}
umain = sorted({subs[s]['main_id'] for s in usub}); mi = {m: i for i, m in enumerate(umain)}
specs, xi = [], {}
roles = ['يبيع', 'يشتري', 'جملة', 'تجزئة', 'مصنع', 'خدمات وتنفيذ']
pts = []
for r in rows:
    if r[3] not in si: continue
    sp = []
    for t in [x.strip() for x in r[5].split('،') if x.strip()]:
        if t not in xi: xi[t] = len(specs); specs.append(t)
        sp.append(xi[t])
    rb = sum(1 << k for k, name in enumerate(roles) if name in r[6].split('|'))
    pts.append([round(r[0], 5), round(r[1], 5), hi[r[2]], mi[subs[r[3]]['main_id']], si[r[3]], sp, clean(r[4]), rb,
                int(r[7]), int(r[8]), int(r[9]), int(round(r[10])), (r[11] or '')[:40], int(r[12]), int(r[13]), round(r[14], 1) if r[14] else 0])
geo = c.sql("select ar, ST_AsGeoJSON(geom) from hood").fetchall()
polys = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'id': hi[a], 'properties': {'i': hi[a], 'ar': a}, 'geometry': json.loads(g)} for a, g in geo if a in hi]}
data = {'pts': pts, 'hoods': hoods, 'polys': polys, 'roles': roles,
        'mains': [{'ar': next(s['main_ar'] for s in subs.values() if s['main_id'] == m), 'icon': MAIN.get(m, 'help-circle')} for m in umain],
        'subs': [{'ar': subs[s]['sub_ar'], 'main': mi[subs[s]['main_id']], 'icon': SUB.get(s, MAIN.get(subs[s]['main_id']))} for s in usub],
        'specs': specs}
json.dump(data, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(pts), 'points', len(hoods), 'districts', len(usub), 'subs', len(specs), 'specialties')
