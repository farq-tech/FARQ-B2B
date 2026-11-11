"""Trade corridors: where one activity lines a real street, built on the road network.

Each business with a precise point is placed on its nearest road (up to 40 m). Segments of the
same street that carry the same activity and lie within 100 m of each other join into one corridor,
so a street keeps one line across district borders and across both sides of a divided road.

Output keeps the street_density.parquet columns the service already reads (city_en, sub_id,
street_ar, n, n_wholesale, length_m, per_100m, lift, geojson, district_ar, sub_ar, main_id,
main_ar, specialty_ids) and adds road_class (main/secondary) and districts_ar (every district
the corridor crosses, «|»-joined).

  python3 build_trade_corridors.py --roads /app/data/buildings_ingest/roads \
      --data /app/data/releases/<release> --out street_density.parquet

Specialties (owner 2026-11-11: the specialty is the unit of every figure): each specialty is also an activity of its
own, with the rule market_analytics.activities uses, so «برجر» under restaurant and under fast food is one corridor.
Those rows carry `specialty_key` (the specialty ids, sorted, «|»-joined) and their own count `n` of the shops tagged
with it; every other row has a null `specialty_key`, and readers leave specialty rows out unless one is asked for.
Every row also carries `road_name`, the road file's own name for the street: `street_ar` may be the name most of a
corridor's shops write, which can differ between a specialty and its subcategory on the same road, so readers join a
specialty to its trade's corridor by `road_name`.

Limits: a business on an unnamed lane counts for no street. Length is the length of the
segments that hold the activity (a short empty block bridged inside a corridor is not added),
halved where the corridor is mostly one-way carriageways drawn as two lines.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import pickle
import re
import sys
import tempfile
from pathlib import Path

import duckdb
import numpy as np
import shapely

import status_policy
from activity_groups import groups_of, with_groups
from market_analytics import MAX_SPECIALTY_IDS

SNAP_M = 60          # a business further than this from any named road is not on a street (wide roads: the
                     # shop front stands 40-60 m from the centre line the road file draws)
JOIN_M = 200         # segments of one street with the activity, closer than this, are one corridor (a crossing
                     # or a block without the trade does not split the street)
MIN_SHOPS = 5        # a corridor needs at least this many businesses of the activity
MAX_PER_SUB = 400    # strongest corridors kept per city and activity
ROAD_FILES = {'Основные': 'main', 'Прочие': 'secondary'}
_SPACES = re.compile(r'\s+')
_ARABIC = re.compile('[\u0600-\u06ff]')


def street_name(title: str) -> str:
    return _SPACES.sub(' ', (title or '').replace('ـ', '')).strip()


def businesses(con, targets: Path):
    """Open, precisely located businesses with a classified activity."""
    rows = con.execute(f"""
        select city_en, coalesce(district_ar, ''), sub_id, latitude, longitude,
               coalesce(is_wholesale, false), coalesce(specialty_ids, ''), coalesce(street_ar, '')
        from read_parquet(?)
        where location_precision = 'point' and latitude between -85 and 85 and longitude between -180 and 180
          and sub_id is not null and sub_id <> '' and city_en is not null and city_en <> ''
          and {status_policy.CLASS_SQL} <> 'closed_permanent'
    """, [str(targets)]).fetchall()
    by_city = collections.defaultdict(list)
    for row in rows:
        by_city[row[0]].append(row[1:])
    return by_city


def city_boxes(by_city, pad=0.03):
    """Bounding box of each city's businesses, trimmed of stray points."""
    boxes = {}
    for city, rows in by_city.items():
        if len(rows) < 50:
            continue
        lat = np.array([r[2] for r in rows]); lon = np.array([r[3] for r in rows])
        boxes[city] = (np.percentile(lon, 0.2) - pad, np.percentile(lat, 0.2) - pad,
                       np.percentile(lon, 99.8) + pad, np.percentile(lat, 99.8) + pad)
    return boxes


def read_roads(roads_dir: Path, boxes, cache: Path | None):
    """Road segments inside the cities: (city, name, class, one_way, [(lon, lat), ...])."""
    if cache and cache.is_file():
        with cache.open('rb') as f:
            return pickle.load(f)
    import shapefile
    out = collections.defaultdict(list)
    for stem, road_class in ROAD_FILES.items():
        reader = shapefile.Reader(str(roads_dir / stem), encoding='utf-8', encodingErrors='replace')
        fields = ['StreetTitl', 'IsRoadRamp', 'RoadDirect']
        for i, sr in enumerate(reader.iterShapeRecords(fields=fields)):
            shape = sr.shape
            if not shape.points:
                continue
            x0, y0, x1, y1 = shape.bbox
            cities = [c for c, (a, b, c2, d) in boxes.items() if x1 >= a and x0 <= c2 and y1 >= b and y0 <= d]
            if not cities:
                continue
            rec = sr.record
            if rec['IsRoadRamp'] == 'True':
                continue
            one_way = rec['RoadDirect'] in ('1', '2')
            name = street_name(rec['StreetTitl'])
            parts = list(shape.parts) + [len(shape.points)]
            for a, b in zip(parts[:-1], parts[1:]):
                pts = [(round(p[0], 6), round(p[1], 6)) for p in shape.points[a:b]]
                if len(pts) >= 2:
                    for city in cities:
                        out[city].append((name, road_class, one_way, pts))
            if i % 200000 == 0:
                print(f'{stem}: {i} read', file=sys.stderr, flush=True)
    out = dict(out)
    if cache:
        with cache.open('wb') as f:
            pickle.dump(out, f, protocol=pickle.HIGHEST_PROTOCOL)
    return out


def taxonomy(tax_file: Path):
    tax = json.loads(tax_file.read_text(encoding='utf-8'))
    return {s['sub_id']: s for s in tax['subs']}


def specialty_groups(subs, specialties_csv: Path | None):
    """specialty id -> (key, name, main_id, main_ar): one entry per specialty name under one main activity, exactly as
    market_analytics.activities groups them, so a corridor answers the same `specialty_ids` the picker sends."""
    if not specialties_csv or not specialties_csv.is_file():
        return {}
    import csv
    grouped = collections.defaultdict(list)
    with specialties_csv.open(encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            parent = subs.get(row.get('sub_id') or '')
            name = (row.get('specialty_ar') or '').strip()
            if not parent or not name or name == '—' or row['sub_id'].startswith(('unc.', 'noncom.')):
                continue
            grouped[(parent.get('main_id') or '', name)].append(row['specialty_id'])
    out = {}
    for (main_id, name), ids in grouped.items():
        if len(ids) > MAX_SPECIALTY_IDS:
            continue
        key = '|'.join(sorted(ids))
        main_ar = next((s.get('main_ar') for s in subs.values() if s.get('main_id') == main_id), '') or ''
        for spec_id in ids:
            out[spec_id] = (key, name, main_id, main_ar)
    return out


def _groups(geoms, distance):
    """Union-find over geometries closer than distance; returns a group label per geometry."""
    n = len(geoms)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if n > 1:
        tree = shapely.STRtree(geoms)
        left, right = tree.query(geoms, predicate='dwithin', distance=distance)
        for a, b in zip(left.tolist(), right.tolist()):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    return [find(i) for i in range(n)]


def city_corridors(city, rows, segments, subs, spec_groups=None):
    lat0 = float(np.median([r[2] for r in rows])); lon0 = float(np.median([r[3] for r in rows]))
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0

    def to_m(lon, lat):
        return (np.asarray(lon) - lon0) * kx, (np.asarray(lat) - lat0) * ky

    lines = []
    for _, _, _, pts in segments:
        arr = np.asarray(pts)
        x, y = to_m(arr[:, 0], arr[:, 1])
        lines.append(shapely.linestrings(np.column_stack([x, y])))
    lines = np.array(lines, dtype=object)
    lengths = shapely.length(lines)
    names = [s[0] for s in segments]

    bx, by = to_m([r[3] for r in rows], [r[2] for r in rows])
    points = shapely.points(np.column_stack([bx, by]))
    # a shop faces the named street even when an unnamed service lane or parking runs between them, so only named
    # segments are candidates (in Riyadh most shops sit nearer an unnamed lane than the street they are on)
    named = np.array([k for k, name in enumerate(names) if name], dtype=int)
    seg_of = np.full(len(rows), -1)
    if len(named):
        tree = shapely.STRtree(lines[named])
        pi, si = tree.query_nearest(points, max_distance=SNAP_M, all_matches=False)
        seg_of[pi] = named[si]

    on_street = [(i, int(s)) for i, s in enumerate(seg_of.tolist()) if s >= 0 and names[s]]
    city_all = collections.Counter(rows[i][1] for i, _ in on_street)
    total_all = sum(city_all.values())
    for sub, count in list(city_all.items()):
        for gid in groups_of(sub):
            city_all[gid] += count
    seg_all = collections.Counter(s for _, s in on_street)
    by_street_sub = collections.defaultdict(lambda: collections.defaultdict(list))
    spec_groups = spec_groups or {}
    specs = {}   # 'spec:<key>' -> (name, main_id, main_ar, key)
    for i, s in on_street:
        by_street_sub[(names[s], rows[i][1])][s].append(i)
        # a group («أغراض الأطفال والمواليد») is one more activity: its trades' shops line one corridor together
        for gid in groups_of(rows[i][1]):
            by_street_sub[(names[s], gid)][s].append(i)
        # and so is each specialty the shop is tagged with, counted once per shop
        for key in {spec_groups[x][0] for x in rows[i][5].split('|') if x in spec_groups}:
            spec = 'spec:' + key
            by_street_sub[(names[s], spec)][s].append(i)
            city_all[spec] += 1
    for spec_id, (key, name, main_id, main_ar) in spec_groups.items():
        specs['spec:' + key] = (name, main_id, main_ar, key)

    out = []
    for (name, sub), seg_rows in by_street_sub.items():
        spec = specs.get(sub)
        if sum(len(v) for v in seg_rows.values()) < MIN_SHOPS or (spec is None and (sub not in subs or sub.startswith('unc.'))):
            continue
        segs = list(seg_rows)
        labels = _groups(lines[segs], JOIN_M)
        runs = collections.defaultdict(list)
        for seg, label in zip(segs, labels):
            runs[label].append(seg)
        for run in runs.values():
            members = [i for s in run for i in seg_rows[s]]
            n = len(members)
            if n < MIN_SHOPS:
                continue
            length = float(sum(lengths[s] for s in run))
            one_way = sum(lengths[s] for s in run if segments[s][2])
            if one_way > length / 2:
                length /= 2
            length = max(length, 50.0)
            main_len = sum(lengths[s] for s in run if segments[s][1] == 'main')
            n_all = sum(seg_all[s] for s in run)
            districts = collections.Counter(rows[i][0] for i in members if rows[i][0])
            specialties = sorted({x for i in members for x in rows[i][5].split('|') if x})
            # the road file names many Riyadh streets in Latin letters; the Arabic name the shops give wins then
            written = collections.Counter(street_name(rows[i][6]) for i in members if len(rows[i]) > 6 and _ARABIC.search(rows[i][6] or ''))
            label = name if _ARABIC.search(name) or not written else written.most_common(1)[0][0]
            geometry = shapely.simplify(shapely.multilinestrings([shapely.linestrings(segments[s][3]) for s in run]), 0.00002)
            share_city = city_all[sub] / total_all if total_all else 0
            if spec:
                # a specialty corridor: named and counted as the specialty, under no subcategory of its own
                activity = {'sub_id': '', 'sub_ar': spec[0], 'main_id': spec[1], 'main_ar': spec[2], 'specialty_key': spec[3]}
            else:
                activity = {'sub_id': sub, 'sub_ar': subs[sub]['sub_ar'], 'main_id': subs[sub]['main_id'],
                            'main_ar': subs[sub]['main_ar'], 'specialty_key': None}
            out.append({
                'city_en': city, **activity, 'street_ar': label, 'road_name': name,
                'district_ar': districts.most_common(1)[0][0] if districts else '',
                'districts_ar': '|'.join(d for d, _ in districts.most_common()),
                'n': n, 'n_wholesale': sum(1 for i in members if rows[i][4]),
                'length_m': int(round(length)), 'per_100m': round(n / length * 100, 2),
                'lift': round((n / n_all) / share_city, 2) if n_all and share_city else None,
                'road_class': 'main' if main_len >= length / 2 else 'secondary',
                'specialty_ids': '|'.join(specialties),
                'geojson': json.dumps(shapely.geometry.mapping(geometry), ensure_ascii=False, separators=(',', ':')),
            })
    keep = []
    by_sub = collections.defaultdict(list)
    for row in out:
        by_sub[row['specialty_key'] or row['sub_id']].append(row)
    for rows_ in by_sub.values():
        keep += sorted(rows_, key=lambda r: (-r['n'], -r['per_100m']))[:MAX_PER_SUB]
    return keep, {'businesses': len(rows), 'on_named_street': len(on_street), 'segments': len(segments), 'corridors': len(keep)}


COLUMNS = {'city_en': 'VARCHAR', 'sub_id': 'VARCHAR', 'sub_ar': 'VARCHAR', 'main_id': 'VARCHAR', 'main_ar': 'VARCHAR',
           'street_ar': 'VARCHAR', 'district_ar': 'VARCHAR', 'districts_ar': 'VARCHAR', 'n': 'INTEGER',
           'n_wholesale': 'INTEGER', 'length_m': 'INTEGER', 'per_100m': 'DOUBLE', 'lift': 'DOUBLE',
           'road_class': 'VARCHAR', 'specialty_ids': 'VARCHAR', 'specialty_key': 'VARCHAR', 'road_name': 'VARCHAR',
           'geojson': 'VARCHAR'}


def write(rows, out: Path):
    with tempfile.NamedTemporaryFile('w', suffix='.ndjson', delete=False, encoding='utf-8') as tmp:
        for row in rows:
            tmp.write(json.dumps(row, ensure_ascii=False) + '\n')
    try:
        cols = ', '.join(f"'{k}': '{v}'" for k, v in COLUMNS.items())
        duckdb.execute(f"copy (select * from read_json(?, format='newline_delimited', columns={{{cols}}}) "
                       f"order by city_en, sub_id, n desc) to '{out}' (format parquet, compression zstd)", [tmp.name])
    finally:
        os.unlink(tmp.name)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--roads', type=Path, required=True, help='folder with Основные.* and Прочие.* shapefiles')
    p.add_argument('--data', type=Path, required=True, help='release folder (targets.parquet, taxonomy/)')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--cache', type=Path, help='pickle of the city road segments, reused when present')
    p.add_argument('--cities', nargs='*', help='only these cities (city_en)')
    a = p.parse_args(argv)
    con = duckdb.connect()
    by_city = businesses(con, a.data / 'targets.parquet')
    if a.cities:
        by_city = {c: r for c, r in by_city.items() if c in a.cities}
    subs = with_groups(taxonomy(a.data / 'taxonomy' / 'farq_taxonomy.json'))
    spec_groups = specialty_groups(subs, a.data / 'taxonomy' / 'specialties.csv')
    roads = read_roads(a.roads, city_boxes(by_city), a.cache)
    rows, report = [], {}
    for city, segments in sorted(roads.items(), key=lambda kv: -len(kv[1])):
        if city not in by_city:
            continue
        found, stats = city_corridors(city, by_city[city], segments, subs, spec_groups)
        rows += found; report[city] = stats
        print(city, stats, file=sys.stderr, flush=True)
    write(rows, a.out)
    report = {'corridors': len(rows), 'cities': report, 'snap_m': SNAP_M, 'join_m': JOIN_M, 'min_shops': MIN_SHOPS}
    a.out.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'corridors': len(rows)}), flush=True)


if __name__ == '__main__':
    main()
