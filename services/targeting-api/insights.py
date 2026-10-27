"""Commercial insights built on the district layers: growth, population around a point, sales territories and
district income. Pure functions over files on the data volume (or the repository reference folder), so the
HTTP layer only validates input and the logic can be tested with small synthetic files."""
import glob
import json
import math
import os

import canonical_data
import district_reference

EARTH_M = 6_371_000.0


def latest(pattern):
    """The newest yearly file matching a glob such as .../district_growth_*.parquet, or None."""
    files = sorted(glob.glob(pattern))
    return files[-1] if files else None


def growth(db, path, city, id_map, names):
    """Buildings being built per canonical district of a city, most first."""
    if not path:
        return None
    rows = db.execute("""select district_id, district_ar, under_construction, new_buildings, homes_under_construction, floor_area_m2
                         from read_parquet(?) where city_en = ?""", [path, city]).fetchall()
    merged, order = {}, []
    for district_id, district_ar, building, new, homes, area in rows:
        canonical = str(id_map.get(str(district_id), district_id))
        if canonical not in merged:
            merged[canonical] = {'district_id': canonical, 'district_ar': names.get(canonical, (district_ar, None))[0] or district_ar,
                                 'under_construction': 0, 'new_buildings': 0, 'homes_under_construction': 0, 'floor_area_m2': 0.0}
            order.append(canonical)
        out = merged[canonical]
        out['under_construction'] += building or 0
        out['new_buildings'] += new or 0
        out['homes_under_construction'] += homes or 0
        out['floor_area_m2'] += float(area or 0)
    result = [merged[key] for key in order]
    for row in result:
        row['floor_area_m2'] = round(row['floor_area_m2'])
    result.sort(key=lambda row: (-(row['under_construction'] + row['new_buildings']), row['district_ar'] or ''))
    return result


def _haversine_sql(lon_col, lat_col):
    return (f"2 * {EARTH_M} * asin(sqrt(pow(sin(radians({lat_col} - ?) / 2), 2) + "
            f"cos(radians(?)) * cos(radians({lat_col})) * pow(sin(radians({lon_col} - ?) / 2), 2)))")


def _box(lon, lat, radius_m):
    dlat = math.degrees(radius_m / EARTH_M)
    dlon = math.degrees(radius_m / (EARTH_M * max(0.2, math.cos(math.radians(lat)))))
    return lon - dlon, lon + dlon, lat - dlat, lat + dlat


def population_around(db, points_path, targets_path, search_sql, lon, lat, radius_m, household_size):
    """Homes, people and directory businesses within radius_m metres of a point."""
    west, east, south, north = _box(lon, lat, radius_m)
    result = {'radius_m': radius_m, 'dwellings': None, 'population': None, 'businesses': None, 'top_activities': []}
    if points_path:
        dist = _haversine_sql('longitude', 'latitude')
        # v3 layers carry each building's people (its district's population spread over the district's dwellings);
        # older layers only have dwellings, counted at household_size people each
        has_people = 'population' in {row[0] for row in db.execute('describe select * from read_parquet(?)', [points_path]).fetchall()}
        people = 'sum(population)' if has_people else f'sum(dwellings) * {float(household_size)}'
        homes, dwellings, population = db.execute(
            f"""select count(*), sum(dwellings), {people} from read_parquet(?) where longitude between ? and ? and latitude between ? and ?
                and {dist} <= ?""", [points_path, west, east, south, north, lat, lat, lon, radius_m]).fetchone()
        dwellings = float(dwellings or 0)   # parquet decimals and doubles alike
        result.update(home_buildings=homes or 0, dwellings=round(dwellings, 1), population=round(float(population or 0)), people_per_district=has_people)
    if targets_path:
        dist = _haversine_sql('p.longitude', 'p.latitude')
        where = (f"{search_sql} and p.longitude between ? and ? and p.latitude between ? and ? and {dist} <= ?")
        params = [targets_path, west, east, south, north, lat, lat, lon, radius_m]
        result['businesses'] = db.execute(f"select count(*) from read_parquet(?) p where {where}", params).fetchone()[0]
        result['top_activities'] = [{'activity': name, 'n': n} for name, n in db.execute(
            f"""select coalesce(nullif(p.category_ar, ''), p.category) activity, count(*) n from read_parquet(?) p where {where}
                and coalesce(nullif(p.category_ar, ''), p.category) is not null group by 1 order by 2 desc, 1 limit 10""", params).fetchall()]
    return result


def _hilbert(n, x, y):
    """Distance along a Hilbert curve on an n×n grid (n a power of two)."""
    d, s = 0, n // 2
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        s //= 2
    return d


def _centre(geometry):
    points = []
    for polygon in canonical_data._polygons(geometry):
        if polygon:
            points.extend(polygon[0])
    if not points:
        return None
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def territories(features, weights, count):
    """Split a city's districts into `count` territories of near-equal weight. Districts are ordered along a
    Hilbert curve through their centres, so each territory is a compact run of neighbouring districts, and
    the run is cut where the running weight crosses each equal share."""
    items = []
    for feature in features:
        props = feature.get('properties') or {}
        name = props.get('ar') or props.get('district_ar')
        centre = _centre(feature.get('geometry'))
        weight = weights.get(name) or 0
        if centre and weight > 0:
            items.append((name, props.get('id'), centre, float(weight)))
    if not items or count < 1:
        return []
    xs, ys = [c[0] for _, _, c, _ in items], [c[1] for _, _, c, _ in items]
    span_x, span_y, grid = (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9, 1024
    keyed = sorted(items, key=lambda item: _hilbert(grid, min(grid - 1, int((item[2][0] - min(xs)) / span_x * (grid - 1))),
                                                    min(grid - 1, int((item[2][1] - min(ys)) / span_y * (grid - 1)))))
    total = sum(item[3] for item in keyed)
    share = total / count
    groups = [{'territory': i + 1, 'weight': 0.0, 'districts': []} for i in range(count)]
    running = 0.0
    for name, ident, _, weight in keyed:
        index = min(count - 1, int((running + weight / 2) / share))
        groups[index]['districts'].append({'district_ar': name, 'district_id': ident, 'weight': round(weight)})
        groups[index]['weight'] += weight
        running += weight
    for group in groups:
        group['weight'] = round(group['weight'])
        group['share_pct'] = round(100 * group['weight'] / total, 1) if total else None
    return [group for group in groups if group['districts']]


INCOME_FIELDS = ('income_all', 'income_male', 'income_female', 'income_saudi', 'income_non_saudi')


def district_income(city, path=None):
    """Average monthly income per working person by district, from the 910ths reference table (district_reference)."""
    table = district_reference.load(path or district_reference.PATH)
    rows = ((table or {}).get('cities') or {}).get(city)
    if rows is None:
        return None
    rows = [{'district_ar': row['district_ar'], **{key: row.get(key) for key in INCOME_FIELDS}} for row in rows
            if any(row.get(key) is not None for key in INCOME_FIELDS)]
    return {'source': table.get('source'), 'retrieved': table.get('retrieved'), 'unit': table.get('unit', 'SAR/month'), 'districts': rows}
