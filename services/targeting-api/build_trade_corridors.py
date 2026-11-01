"""Trade corridors: where one activity lines a real street, built on the road network.

Each business with a precise point is placed on its nearest road (up to 40 m). Segments of the
same street that carry the same activity and lie within 60 m of each other join into one corridor,
so a street keeps one line across district borders and across both sides of a divided road.

Output keeps the street_density.parquet columns the service already reads (city_en, sub_id,
street_ar, n, n_wholesale, length_m, per_100m, lift, geojson, district_ar, sub_ar, main_id,
main_ar, specialty_ids) and adds road_class (main/secondary) and districts_ar (every district
the corridor crosses, «|»-joined).

  python3 build_trade_corridors.py --roads /app/data/buildings_ingest/roads \
      --data /app/data/releases/<release> --out street_density.parquet

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

SNAP_M = 40          # a business further than this from any road is not on a street
JOIN_M = 60          # segments of one street with the activity, closer than this, are one corridor
MIN_SHOPS = 5        # a corridor needs at least this many businesses of the activity
MAX_PER_SUB = 400    # strongest corridors kept per city and activity
ROAD_FILES = {'Основные': 'main', 'Прочие': 'secondary'}
_SPACES = re.compile(r'\s+')


def street_name(title: str) -> str:
    return _SPACES.sub(' ', (title or '').replace('ـ', '')).strip()


def businesses(con, targets: Path):
    """Open, precisely located businesses with a classified activity."""
    rows = con.execute(f"""
        select city_en, coalesce(district_ar, ''), sub_id, latitude, longitude,
               coalesce(is_wholesale, false), coalesce(specialty_ids, '')
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


def city_corridors(city, rows, segments, subs):
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
    tree = shapely.STRtree(lines)
    pi, si = tree.query_nearest(points, max_distance=SNAP_M, all_matches=False)
    seg_of = np.full(len(rows), -1); seg_of[pi] = si

    on_street = [(i, int(s)) for i, s in enumerate(seg_of.tolist()) if s >= 0 and names[s]]
    city_all = collections.Counter(rows[i][1] for i, _ in on_street)
    total_all = sum(city_all.values())
    seg_all = collections.Counter(s for _, s in on_street)
    by_street_sub = collections.defaultdict(lambda: collections.defaultdict(list))
    for i, s in on_street:
        by_street_sub[(names[s], rows[i][1])][s].append(i)

    out = []
    for (name, sub), seg_rows in by_street_sub.items():
        if sum(len(v) for v in seg_rows.values()) < MIN_SHOPS or sub not in subs:
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
            geometry = shapely.simplify(shapely.multilinestrings([shapely.linestrings(segments[s][3]) for s in run]), 0.00002)
            share_city = city_all[sub] / total_all if total_all else 0
            out.append({
                'city_en': city, 'sub_id': sub, 'sub_ar': subs[sub]['sub_ar'], 'main_id': subs[sub]['main_id'],
                'main_ar': subs[sub]['main_ar'], 'street_ar': name,
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
        by_sub[row['sub_id']].append(row)
    for rows_ in by_sub.values():
        keep += sorted(rows_, key=lambda r: (-r['n'], -r['per_100m']))[:MAX_PER_SUB]
    return keep, {'businesses': len(rows), 'on_named_street': len(on_street), 'segments': len(segments), 'corridors': len(keep)}


COLUMNS = {'city_en': 'VARCHAR', 'sub_id': 'VARCHAR', 'sub_ar': 'VARCHAR', 'main_id': 'VARCHAR', 'main_ar': 'VARCHAR',
           'street_ar': 'VARCHAR', 'district_ar': 'VARCHAR', 'districts_ar': 'VARCHAR', 'n': 'INTEGER',
           'n_wholesale': 'INTEGER', 'length_m': 'INTEGER', 'per_100m': 'DOUBLE', 'lift': 'DOUBLE',
           'road_class': 'VARCHAR', 'specialty_ids': 'VARCHAR', 'geojson': 'VARCHAR'}


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
    subs = taxonomy(a.data / 'taxonomy' / 'farq_taxonomy.json')
    roads = read_roads(a.roads, city_boxes(by_city), a.cache)
    rows, report = [], {}
    for city, segments in sorted(roads.items(), key=lambda kv: -len(kv[1])):
        if city not in by_city:
            continue
        found, stats = city_corridors(city, by_city[city], segments, subs)
        rows += found; report[city] = stats
        print(city, stats, file=sys.stderr, flush=True)
    write(rows, a.out)
    report = {'corridors': len(rows), 'cities': report, 'snap_m': SNAP_M, 'join_m': JOIN_M, 'min_shops': MIN_SHOPS}
    a.out.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'corridors': len(rows)}), flush=True)


if __name__ == '__main__':
    main()
