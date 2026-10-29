"""Review page for the building-link sample of unit_evidence_inventory.py (docs/establishment-lifecycle.md 3.2.1).

Writes one self-contained HTML file: for each proposed link, the business point, the proposed building outlined, and the
buildings around it. The reviewer answers «same building», «different building» or «cannot tell»; answers stay in the
browser and are exported as CSV for score_building_review.py. The page holds business rows, so it is written outside
the repository. Read-only. Run from the repository root:

    python3 services/data-cleaning/building_review_page.py \
        --sample /Users/m4pro/farq-taxonomy-data/analysis/building_link_review_sample.csv \
        --buildings /Users/m4pro/farq-taxonomy-data/server_inputs/buildings.parquet \
        --out /Users/m4pro/farq-taxonomy-data/analysis/building_link_review.html
"""
import argparse
import csv
import json
import sys

import duckdb

NEAR_DEGREES = 0.0006   # about 60 m: enough neighbours to see whether the point sits in the right footprint
STRATA = {'card_crosswalk_only': 'ربط البطاقة بالمبنى', 'containment_only': 'النقطة داخل المبنى'}


def links(sample, buildings):
    rows = list(csv.DictReader(open(sample, encoding='utf-8')))
    db = duckdb.connect()
    db.execute('LOAD spatial')
    # a HouseId held by several features is ambiguous (as in build_business_building_links.py): left out, so the link
    # shows no building rather than one of them
    db.execute("""create table b as select HouseId::varchar h, Number n, PostIndex pi, building_use_ar use_ar, Elevation floors,
                  ST_GeomFromHEXWKB(geometry_wkb_hex) g from read_parquet(?) qualify count(*) over (partition by HouseId) = 1""", [buildings])
    db.execute("create table s(i integer, h varchar, lon double, lat double)")
    db.executemany("insert into s values (?, ?, ?, ?)",
                   [(i, r['proposed_house_id'], float(r['longitude']), float(r['latitude'])) for i, r in enumerate(rows)])
    proposed = {i: (json.loads(geo), n, pi, use, floors, metres) for i, geo, n, pi, use, floors, metres in db.execute(
        """select s.i, ST_AsGeoJSON(ST_ReducePrecision(b.g, 0.0000001)), b.n, b.pi, b.use_ar, b.floors,
                  round(ST_Distance_Sphere(ST_Centroid(b.g), ST_Point(s.lon, s.lat))) from s join b on b.h = s.h""").fetchall()}
    near = {}
    for i, geo in db.execute(
            f"""select s.i, ST_AsGeoJSON(ST_ReducePrecision(b.g, 0.0000001)) from s join b
                on ST_DWithin(b.g, ST_Point(s.lon, s.lat), {NEAR_DEGREES}) and b.h <> s.h""").fetchall():
        near.setdefault(i, []).append(json.loads(geo)['coordinates'])
    out = []
    for i, r in enumerate(rows):
        geo, number, post, use, floors, metres = proposed.get(i, (None, None, None, None, None, None))
        out.append({'key': r['poi_key'], 'stratum': r['stratum'], 'city': r['city_en'], 'name_ar': r['name_ar'], 'name_en': r['name_en'],
                    'lat': float(r['latitude']), 'lon': float(r['longitude']), 'house': r['proposed_house_id'],
                    'number': number, 'post': post, 'use': use, 'floors': floors, 'centroid_m': metres,
                    'building': geo, 'near': near.get(i, [])})
    return out


PAGE = r'''<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مراجعة ربط المباني</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root { --bg:#f7f6f2; --card:#fff; --ink:#1f2a1d; --muted:#6b7266; --line:#e2e0d8; --olive:#3E573B; --leaf:#6B923A; --terra:#B5643C; --slate:#6F8796; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141714; --card:#1d211c; --ink:#eef0ea; --muted:#a3aa9d; --line:#30362e; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; height:100vh; display:flex; flex-direction:column; }
header { display:flex; gap:16px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--card); flex-wrap:wrap; }
header h1 { font-size:16px; margin:0; }
.progress { color:var(--muted); font-size:13px; }
.progress b { color:var(--ink); }
header .spacer { flex:1; }
button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:10px; padding:8px 14px; cursor:pointer; }
button:hover { border-color:var(--olive); }
main { flex:1; display:flex; min-height:0; }
#map { flex:1; min-width:0; }
aside { width:360px; max-width:42vw; background:var(--card); border-inline-start:1px solid var(--line); display:flex; flex-direction:column; }
.card { padding:16px; border-bottom:1px solid var(--line); }
.stratum { display:inline-block; font-size:12px; padding:2px 8px; border-radius:999px; background:color-mix(in srgb, var(--leaf) 18%, transparent); color:var(--olive); }
.name { font-size:18px; font-weight:600; margin:8px 0 2px; }
.en { color:var(--muted); direction:ltr; text-align:right; }
dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:12px 0 0; font-size:14px; }
dt { color:var(--muted); }
dd { margin:0; direction:ltr; text-align:right; }
.answers { display:grid; gap:8px; padding:16px; }
.answers button { padding:12px; font-size:15px; text-align:right; display:flex; justify-content:space-between; }
.answers button kbd { color:var(--muted); font-family:inherit; }
.answers button.on { border-width:2px; }
.yes.on { border-color:var(--leaf); background:color-mix(in srgb, var(--leaf) 12%, var(--card)); }
.no.on { border-color:var(--terra); background:color-mix(in srgb, var(--terra) 12%, var(--card)); }
.skip.on { border-color:var(--slate); background:color-mix(in srgb, var(--slate) 12%, var(--card)); }
textarea { margin:0 16px; font:inherit; padding:8px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--ink); min-height:56px; }
.nav { display:flex; gap:8px; padding:16px; margin-top:auto; }
.nav button { flex:1; }
.legend { font-size:12px; color:var(--muted); padding:0 16px 12px; display:flex; gap:12px; flex-wrap:wrap; }
.sw { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-2px; margin-inline-end:4px; }
a { color:var(--olive); }
@media (max-width: 760px) { main { flex-direction:column; } aside { width:auto; max-width:none; border-inline-start:0; border-top:1px solid var(--line); } #map { min-height:45vh; } }
</style>
</head>
<body>
<header>
  <h1>مراجعة ربط المباني</h1>
  <span class="progress" id="progress"></span>
  <span class="spacer"></span>
  <button id="layer">صورة جوية</button>
  <button id="export">تصدير الإجابات CSV</button>
  <label><button id="importBtn" type="button">استيراد</button><input id="import" type="file" accept=".csv" hidden></label>
</header>
<main>
  <div id="map"></div>
  <aside>
    <div class="card">
      <span class="stratum" id="stratum"></span>
      <div class="name" id="name"></div>
      <div class="en" id="en"></div>
      <dl>
        <dt>المدينة</dt><dd id="city"></dd>
        <dt>رقم المبنى</dt><dd id="number"></dd>
        <dt>الرمز البريدي</dt><dd id="post"></dd>
        <dt>استخدام المبنى</dt><dd id="use"></dd>
        <dt>البُعد عن مركز المبنى</dt><dd id="dist"></dd>
        <dt>معرّف المبنى</dt><dd id="house"></dd>
      </dl>
      <p style="margin:12px 0 0"><a id="gmaps" target="_blank" rel="noopener">افتح الموقع في خرائط Google</a></p>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:#6B923A"></i>المبنى المقترح</span>
      <span><i class="sw" style="border:1px solid #6F8796"></i>مبانٍ مجاورة</span>
      <span><i class="sw" style="background:#B5643C;border-radius:50%"></i>موقع المنشأة</span>
    </div>
    <div class="answers">
      <div style="font-weight:600">هل المنشأة في المبنى المقترح؟</div>
      <button class="yes" data-a="same">نعم، المبنى نفسه <kbd>1</kbd></button>
      <button class="no" data-a="different">لا، مبنى آخر <kbd>2</kbd></button>
      <button class="skip" data-a="cannot_tell">لا يمكن الحكم <kbd>3</kbd></button>
    </div>
    <textarea id="note" placeholder="ملاحظة (اختيارية)"></textarea>
    <div class="nav">
      <button id="prev">السابق ←</button>
      <button id="nextOpen">التالي غير المراجَع</button>
      <button id="next">→ التالي</button>
    </div>
  </aside>
</main>
<script>
const LINKS = __LINKS__;
const STRATA = __STRATA__;
const STORE = 'farq-building-review-v1';
let answers = {};
try { answers = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { answers = {}; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(answers)); } catch (e) {} };
const fmt = n => n == null || n === '' ? 'غير متاح' : String(n);

const map = L.map('map', { zoomControl: true });
const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
const aerial = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Esri World Imagery' });
let base = aerial.addTo(map);
document.getElementById('layer').onclick = e => {
  map.removeLayer(base); base = (base === aerial ? streets : aerial).addTo(map);
  e.target.textContent = base === aerial ? 'خريطة الشوارع' : 'صورة جوية';
};
document.getElementById('layer').textContent = 'خريطة الشوارع';
const drawn = L.layerGroup().addTo(map);
const ring = c => c.map(r => r.map(([x, y]) => [y, x]));

let at = 0;
function show(i) {
  at = (i + LINKS.length) % LINKS.length;
  const l = LINKS[at];
  drawn.clearLayers();
  for (const poly of l.near) {
    const rings = typeof poly[0][0][0] === 'number' ? [poly] : poly;
    for (const p of rings) L.polygon(ring(p), { color: '#6F8796', weight: 1, fillOpacity: 0.05, interactive: false }).addTo(drawn);
  }
  let bounds = L.latLngBounds([[l.lat, l.lon]]);
  if (l.building) {
    const shape = L.geoJSON(l.building, { style: { color: '#3E573B', weight: 3, fillColor: '#6B923A', fillOpacity: 0.35 } }).addTo(drawn);
    bounds = bounds.extend(shape.getBounds());
  }
  L.circleMarker([l.lat, l.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#B5643C', fillOpacity: 1 }).addTo(drawn);
  map.fitBounds(bounds.pad(0.6), { maxZoom: 19 });
  document.getElementById('stratum').textContent = STRATA[l.stratum] || l.stratum;
  document.getElementById('name').textContent = l.name_ar || l.name_en || 'غير متاح';
  document.getElementById('en').textContent = l.name_ar ? (l.name_en || '') : '';
  document.getElementById('city').textContent = fmt(l.city);
  document.getElementById('number').textContent = fmt(l.number);
  document.getElementById('post').textContent = fmt(l.post);
  document.getElementById('use').textContent = fmt(l.use);
  document.getElementById('dist').textContent = l.centroid_m == null ? 'غير متاح' : Math.round(l.centroid_m) + ' م';
  document.getElementById('house').textContent = l.house;
  document.getElementById('gmaps').href = 'https://www.google.com/maps/search/?api=1&query=' + l.lat + ',' + l.lon;
  const a = answers[l.key] || {};
  document.querySelectorAll('.answers button').forEach(b => b.classList.toggle('on', b.dataset.a === a.answer));
  document.getElementById('note').value = a.note || '';
  progress();
}
function progress() {
  const parts = Object.keys(STRATA).map(s => {
    const all = LINKS.filter(l => l.stratum === s), done = all.filter(l => answers[l.key] && answers[l.key].answer);
    return STRATA[s] + ': <b>' + done.length + '</b> من ' + all.length;
  });
  document.getElementById('progress').innerHTML = 'الرابط ' + (at + 1) + ' من ' + LINKS.length + ' · ' + parts.join(' · ');
}
function answer(a) {
  const l = LINKS[at];
  answers[l.key] = { answer: a, note: document.getElementById('note').value, at: new Date().toISOString() };
  save();
  show(at + 1);
}
function nextOpen() {
  for (let k = 1; k <= LINKS.length; k++) {
    const i = (at + k) % LINKS.length;
    if (!(answers[LINKS[i].key] && answers[LINKS[i].key].answer)) return show(i);
  }
  alert('روجعت كل الروابط. صدّر الإجابات CSV.');
}
document.querySelectorAll('.answers button').forEach(b => b.onclick = () => answer(b.dataset.a));
document.getElementById('note').oninput = e => {
  const l = LINKS[at];
  answers[l.key] = Object.assign({}, answers[l.key], { note: e.target.value });
  save();
};
document.getElementById('prev').onclick = () => show(at - 1);
document.getElementById('next').onclick = () => show(at + 1);
document.getElementById('nextOpen').onclick = nextOpen;
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') answer('same');
  else if (e.key === '2') answer('different');
  else if (e.key === '3') answer('cannot_tell');
  else if (e.key === 'ArrowLeft') show(at + 1);
  else if (e.key === 'ArrowRight') show(at - 1);
});
// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks (a note written over several lines)
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
document.getElementById('export').onclick = () => {
  const head = ['stratum', 'poi_key', 'proposed_house_id', 'review_same_building', 'review_note', 'reviewed_at'];
  const lines = [head.join(',')].concat(LINKS.map(l => {
    const a = answers[l.key] || {};
    return [l.stratum, l.key, l.house, a.answer || '', a.note || '', a.at || ''].map(cell).join(',');
  }));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'building_link_review_answers.csv'; link.click();
};
document.getElementById('importBtn').onclick = () => document.getElementById('import').click();
document.getElementById('import').onchange = async e => {
  const text = (await e.target.files[0].text()).replace(/^﻿/, '');
  const rows = parseCsv(text).filter(r => r.some(Boolean));
  const head = rows.shift();
  const col = n => head.indexOf(n);
  for (const r of rows) if (r[col('review_same_building')]) answers[r[col('poi_key')]] = { answer: r[col('review_same_building')], note: r[col('review_note')], at: r[col('reviewed_at')] };
  save(); show(at);
};
const first = LINKS.findIndex(l => !(answers[l.key] && answers[l.key].answer));
show(first < 0 ? 0 : first);
</script>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', required=True)
    parser.add_argument('--buildings', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    data = links(args.sample, args.buildings)
    page = PAGE.replace('__LINKS__', json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/'))
    page = page.replace('__STRATA__', json.dumps(STRATA, ensure_ascii=False))
    with open(args.out, 'w', encoding='utf-8') as handle:
        handle.write(page)
    print(json.dumps({'links': len(data), 'with_building': sum(d['building'] is not None for d in data),
                      'out': args.out, 'bytes': len(page.encode())}, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
