"""«فرص الشوارع»: named commercial streets with strong commercial life where the requested activity is absent or thin.

Read at request time from street_density.parquet (build_trade_corridors.py), one row per (street run, activity) for every
activity with at least MIN_SHOPS businesses on that run. No new data release is needed.

A street here is every run that carries the same street name and shares a district with another run of that name, so a
street keeps one entry across activities whose runs cover different stretches of it, while the same name in two far
parts of the city stays two streets.

For each street:
  total     shops of every activity that clusters on it (an activity with fewer than MIN_SHOPS there is not counted,
            so the figure is a floor);
  requested shops of the requested activity on it; when it has no run there, it has fewer than MIN_SHOPS on that
            street, unless the activity hit the per-city cap of the build (MAX_PER_SUB): the build then kept only
            its strongest runs, so a street without one has fewer than the weakest kept run (`floor`), not none;
  expected  total × the activity's share of clustered shops in the city: what a street that size carries on average.

Score, out of 100 within the city: log(1 + shops of other activities) × gap × demand, scaled so the top street is 100,
where gap = 1 − requested ÷ expected (0 when the street already carries its share or more) and demand = 0.5 + 0.5 ×
the population rank of the street's districts among the candidate streets (0.75 when none of its districts has a
population). A capped activity's street without a kept run is scored on the most it may hold (floor − 1), never as a
full gap from an unknown count, and reports requested_below = floor. Evidence only: no street is called the answer.
"""
from __future__ import annotations

import json
import math

# must match build_trade_corridors.MIN_SHOPS / MAX_PER_SUB (test_street_opportunities checks it)
MIN_SHOPS = 5
MAX_PER_SUB = 400
MIN_OTHERS = 20          # a street needs at least this many shops of other activities to count as busy
LIMIT = 30
NEAREST_ROWS = 2000      # strongest runs of the requested activity searched for the nearest existing cluster


def _is_group(sub_id):
    return (sub_id or '').startswith('group.')


def _street_key(name):
    return ' '.join((name or '').replace('ـ', '').split())


def _lines(geometry):
    if not geometry:
        return []
    if geometry.get('type') == 'LineString':
        return [geometry['coordinates']]
    if geometry.get('type') == 'MultiLineString':
        return list(geometry['coordinates'])
    return []


def _project(lines, lat0):
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
    return [[(x * kx, y * ky) for x, y in line] for line in lines if line]


def _point_segment(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)


def _one_way(a_lines, b_lines, best):
    for line in a_lines:
        for p in line:
            for seg in b_lines:
                if len(seg) == 1:
                    best = min(best, math.hypot(p[0] - seg[0][0], p[1] - seg[0][1]))
                for a, b in zip(seg, seg[1:]):
                    best = min(best, _point_segment(p, a, b))
                    if best == 0:
                        return 0.0
    return best


def line_distance(a_lines, b_lines):
    """Shortest distance in metres between two projected polylines (vertices against segments, both ways)."""
    return min(_one_way(a_lines, b_lines, math.inf), _one_way(b_lines, a_lines, math.inf))


def _bbox(lines):
    xs = [x for line in lines for x, _ in line]; ys = [y for line in lines for _, y in line]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def _bbox_gap(a, b):
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def _rank(values):
    """Percentile rank 0..1 of each value among the values (ties share the lower rank)."""
    ordered = sorted(values)
    count = len(ordered)
    if count <= 1:
        return [1.0] * count
    out = []
    for v in values:
        below = 0
        while below < count and ordered[below] < v:
            below += 1
        out.append(below / (count - 1))
    return out


def has_specialties(db, path):
    """Whether the street table carries specialty corridors (build_trade_corridors.py with a specialties list)."""
    return 'specialty_key' in {row[0] for row in db.execute('describe select * from read_parquet(?)', [path]).fetchall()}


def opportunities(db, path, city, subs=None, main_id=None, population=None, limit=LIMIT, specialty_ids=None):
    """The streets of `city` where `subs`, a specialty (`specialty_ids`, read from its own corridors) or every trade of
    `main_id` is absent or thin against the street's size."""
    columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [path]).fetchall()}
    districts_col = "coalesce(nullif(districts_ar, ''), district_ar)" if 'districts_ar' in columns else 'district_ar'
    road_col = 'road_class' if 'road_class' in columns else 'null'
    spec_key = '|'.join(sorted({s for s in (specialty_ids or []) if s}))
    if spec_key and 'specialty_key' not in columns:
        raise ValueError('specialty')
    # specialty corridors repeat shops their subcategory rows already count: a street's size is read without them,
    # and only the requested specialty's own corridors are read beside them
    params = [path, city]
    if 'specialty_key' not in columns:
        only_trades, key_col = '', 'null'
    elif spec_key:
        only_trades, key_col = ' and (specialty_key is null or specialty_key = ?)', 'specialty_key'
        params.append(spec_key)
    else:
        only_trades, key_col = ' and specialty_key is null', 'null'
    road_name_col = 'road_name' if 'road_name' in columns else 'null'
    raw_rows = db.execute(f"""select file_row_number, sub_id, main_id, street_ar, {districts_col}, n, {road_col}, {key_col},
            {road_name_col}
        from read_parquet(?, file_row_number = true) where city_en = ?{only_trades}""", params).fetchall()
    # a specialty corridor is named by its key, so it is told apart from the trade rows it sits inside
    rows = [(r[0], 'spec:' + r[7] if r[7] else r[1], *r[2:7]) for r in raw_rows]
    # the road file's own name: a corridor's shown name may be what most of its shops write, which can differ between
    # a specialty and its subcategory on the same road, so runs are also joined by it
    road_names = [r[8] for r in raw_rows]

    subs = [s for s in (subs or []) if s]
    if spec_key:
        wanted_spec = 'spec:' + spec_key
        # the subcategories the specialty's shops sit in: «food.fast_food.burger» is a shop of «food.fast_food»
        spec_parents = {x.rsplit('.', 1)[0] for x in spec_key.split('|')}

        def is_requested(sub, main):
            return sub == wanted_spec

        def is_member(sub, main):
            return sub == wanted_spec
    elif subs:
        wanted = set(subs)
        if any(_is_group(s) for s in subs):
            import activity_groups
            members = {m for s in subs for m in activity_groups.GROUPS.get(s, {}).get('subs', ())}
        else:
            members = set()

        def is_requested(sub, main):
            return sub in wanted

        def is_member(sub, main):
            return sub in wanted or sub in members
    elif main_id:
        def is_requested(sub, main):
            return main == main_id and not _is_group(sub)
        is_member = is_requested
    else:
        raise ValueError('activity')

    requested_kinds = sorted({r[1] for r in rows if is_requested(r[1], r[2])}) or subs or ([spec_key] if spec_key else [])
    runs_per_kind = {}
    for r in rows:
        if is_requested(r[1], r[2]):
            runs_per_kind[r[1]] = runs_per_kind.get(r[1], 0) + 1
    # the build keeps only the strongest MAX_PER_SUB runs per activity and city: past that, a street without a run
    # has fewer shops of it than the weakest run kept (the floor), which may be well above MIN_SHOPS
    floors = {}
    for r in rows:
        if is_requested(r[1], r[2]) and runs_per_kind.get(r[1], 0) >= MAX_PER_SUB:
            floors[r[1]] = min(floors.get(r[1], r[5]), r[5])
    capped = bool(floors)
    # what a street without a run of the capped activity may hold at most: scored on that, not on an unknown zero
    unknown_most = max(floors.values()) - 1 if floors else 0

    # streets: runs of one name that share a district are one street
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    first_seen = {}
    for i, r in enumerate(rows):
        if _is_group(r[1]) and not is_requested(r[1], r[2]):
            continue
        name = _street_key(r[3])
        if not name:
            continue
        keys = [('label', name)] + ([('road', road_names[i])] if road_names[i] else [])
        for d in (r[4] or '').split('|'):
            if not d:
                continue
            for key in keys:
                j = first_seen.setdefault((*key, d), i)
                if j != i:
                    ri, rj = find(i), find(j)
                    if ri != rj:
                        parent[ri] = rj

    streets = {}
    for i, r in enumerate(rows):
        row_id, sub, main, name, districts, n, road = r
        requested = is_requested(sub, main)
        if (_is_group(sub) and not requested) or not _street_key(name):
            continue
        s = streets.setdefault(find(i), {'names': {}, 'districts': {}, 'total': 0, 'requested': 0, 'others': 0,
                                         'kinds': set(), 'main': False, 'row_ids': [], 'requested_rows': set(),
                                         'parent': False})
        if spec_key and requested:
            # the specialty's shops already sit inside its subcategory's row on this street: they are its count, not
            # more street, and its line is that row's line
            s['requested'] += n
            s['requested_rows'].add(row_id)
            continue
        s['names'][name] = s['names'].get(name, 0) + n
        for d in (districts or '').split('|'):
            if d:
                s['districts'][d] = s['districts'].get(d, 0) + n
        s['row_ids'].append(row_id)
        s['main'] = s['main'] or road == 'main'
        if requested:
            s['requested'] += n
            s['requested_rows'].add(row_id)
        if not _is_group(sub):
            if spec_key and sub in spec_parents:
                s['parent'] = True
            s['total'] += n
            if not is_member(sub, main):
                s['others'] += n
                s['kinds'].add(sub)

    if spec_key:
        # the specialty's shops are part of its subcategory's row, so the street's other shops are the rest of it;
        # where that row was not kept (its subcategory passed the build's cap) they are in no other row: they are added
        # to the street, so they count in the city's total as they do in its share, and no other trade loses them
        for s in streets.values():
            if s['parent']:
                s['others'] = max(0, s['total'] - s['requested'])
            else:
                s['total'] += s['requested']

    all_total = sum(s['total'] for s in streets.values())
    all_requested = sum(s['requested'] for s in streets.values())
    share = all_requested / all_total if all_total else 0.0

    candidates = []
    for key, s in streets.items():
        if s['others'] < MIN_OTHERS:
            continue
        expected = (s['others'] + s['requested']) * share
        counted = s['requested'] if s['requested'] > 0 or not capped else unknown_most
        gap = 1.0 if share == 0 else max(0.0, 1.0 - counted / expected) if expected > 0 else 0.0
        if gap <= 0:
            continue
        pops = [population[d]['population'] for d in s['districts'] if population and d in population and population[d].get('population')]
        candidates.append((key, s, expected, gap, sum(pops) / len(pops) if pops else None))

    population_used = any(c[4] is not None for c in candidates)
    known = [c[4] for c in candidates if c[4] is not None]
    ranks = dict(zip(known, _rank(known))) if known else {}
    scored = []
    for key, s, expected, gap, pop in candidates:
        demand = 1.0 if not population_used else (0.5 + 0.5 * ranks[pop]) if pop is not None else 0.75
        scored.append((math.log1p(s['others']) * gap * demand, key, s, expected, gap, pop))
    scored.sort(key=lambda t: (-t[0], -t[2]['others']))
    top = scored[:limit]
    best = top[0][0] if top else 0.0

    # geometry of the streets shown, and of the requested activity's own runs for the nearest existing cluster
    wanted_ids = {row_id for _, _, s, *_ in top for row_id in s['row_ids']}
    requested_ids = [r[0] for r in sorted((r for r in rows if is_requested(r[1], r[2])), key=lambda r: -r[5])[:NEAREST_ROWS]]
    geometry = {}
    ids = sorted(wanted_ids | set(requested_ids))
    if ids:
        for row_id, g in db.execute("""select file_row_number, geojson from read_parquet(?, file_row_number = true)
                where file_row_number in (select unnest(?::bigint[]))""", [path, ids]).fetchall():
            geometry[row_id] = _lines(json.loads(g)) if g else []
    by_id = {r[0]: r for r in rows}
    lats = [y for lines in geometry.values() for line in lines for _, y in line]
    lat0 = sorted(lats)[len(lats) // 2] if lats else 24.7
    clusters = []
    for row_id in requested_ids:
        lines = _project(geometry.get(row_id, []), lat0)
        box = _bbox(lines)
        if box:
            clusters.append((row_id, lines, box))

    features = []
    for raw, key, s, expected, gap, pop in top:
        lines = [line for row_id in s['row_ids'] for line in geometry.get(row_id, [])]
        if not lines:
            continue
        projected = _project(lines, lat0)
        box = _bbox(projected)
        nearest = None
        if box:
            near_d = math.inf
            for row_id, c_lines, c_box in sorted((c for c in clusters if c[0] not in s['requested_rows']), key=lambda c: _bbox_gap(box, c[2])):
                if _bbox_gap(box, c_box) >= near_d:
                    break
                d = line_distance(projected, c_lines)
                if d < near_d:
                    near_d, nearest = d, row_id
            if nearest is not None:
                r = by_id[nearest]
                nearest = {'street_ar': r[3], 'n': r[5], 'distance_m': int(round(near_d / 10.0) * 10)}
        if s['requested'] > 0:
            requested_n, below = s['requested'], None
        elif capped:
            requested_n, below = None, unknown_most + 1
        else:
            requested_n, below = None, MIN_SHOPS
        name = max(s['names'].items(), key=lambda kv: kv[1])[0]
        features.append({'type': 'Feature', 'geometry': {'type': 'MultiLineString', 'coordinates': lines}, 'properties': {
            'street_ar': name, 'districts_ar': [d for d, _ in sorted(s['districts'].items(), key=lambda kv: -kv[1])],
            'road_class': 'main' if s['main'] else 'secondary', 'total': s['total'], 'others': s['others'],
            'activities': len(s['kinds']), 'requested_n': requested_n, 'requested_below': below,
            'expected': round(expected, 1), 'population': int(round(pop)) if pop is not None else None,
            'score': max(1, int(round(100 * raw / best))) if best else 0, 'nearest': nearest,
        }})
    return {'type': 'FeatureCollection', 'features': features, 'requested_kinds': len(requested_kinds),
            'share': round(share, 4), 'population_used': population_used, 'min_shops': MIN_SHOPS, 'min_others': MIN_OTHERS}
