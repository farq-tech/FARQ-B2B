"""Commercial insights built on the district layers: growth, population around a point, sales territories and
district income. Pure functions over files on the data volume (or the repository reference folder), so the
HTTP layer only validates input and the logic can be tested with small synthetic files."""
import glob
import json
import math
import os
from collections import Counter

import canonical_data
import district_reference
import golden
import market_signals
from shapely.geometry import shape

EARTH_M = 6_371_000.0


def latest(pattern):
    """The newest yearly file matching a glob such as .../district_growth_*.parquet, or None."""
    files = sorted(glob.glob(pattern))
    return files[-1] if files else None


def growth(db, path, polygon_ids, id_map, names):
    """Buildings being built per canonical district of a city (polygon_ids: the city's polygons in the golden
    atlas, since a source file keeps the city a polygon was first filed under), most first."""
    if not path:
        return None
    rows = db.execute("""select district_id, district_ar, under_construction, new_buildings, homes_under_construction, floor_area_m2
                         from read_parquet(?) where cast(district_id as varchar) in (select unnest(?::varchar[]))""", [path, list(polygon_ids)]).fetchall()
    fields = ('under_construction', 'new_buildings', 'homes_under_construction', 'floor_area_m2')
    merged, complete, order = {}, {}, []
    for district_id, district_ar, building, new, homes, area in rows:
        canonical = str(id_map.get(str(district_id), district_id))
        if canonical not in merged:
            merged[canonical] = {'district_id': canonical, 'district_ar': names.get(canonical, (district_ar, None))[0] or district_ar,
                                 **{field: 0 for field in fields}}
            complete[canonical] = {field: True for field in fields}
            order.append(canonical)
        out = merged[canonical]
        for field, value in zip(fields, (building, new, homes, area)):
            valid = type(value) in (int, float) and value >= 0 and math.isfinite(value)
            if valid:
                out[field] += value
            else:
                complete[canonical][field] = False
    result = [merged[key] for key in order]
    for row in result:
        for field in fields:
            if not complete[row['district_id']][field]:
                row[field] = None
        if row['floor_area_m2'] is not None:
            row['floor_area_m2'] = round(row['floor_area_m2'])
    result.sort(key=lambda row: (row['under_construction'] is None or row['new_buildings'] is None,
                                 -(row['under_construction'] + row['new_buildings']) if row['under_construction'] is not None and row['new_buildings'] is not None else 0,
                                 row['district_ar'] or ''))
    return result


MIN_HOUSING_UNITS = golden.MIN_HOUSING_UNITS


def housing_level(db, path, polygon_ids, id_map, names):
    """Estimated share of classified dwelling units in villa buildings, from the buildings layer.
    Old layers with only a villa building count cannot produce this ratio and are unavailable. Every canonical
    district polygon must occur exactly once in the layer before its merged ratio is shown."""
    if not path:
        return None
    columns = {row[0].casefold() for row in db.execute("describe select * from read_parquet(?)", [path]).fetchall()}
    if not {"villa_units", "classified_home_units"}.issubset(columns):
        return None
    rows = db.execute("""select district_id, district_ar, villa_units, classified_home_units from read_parquet(?)
                         where cast(district_id as varchar) in (select unnest(?::varchar[]))""", [path, list(polygon_ids)]).fetchall()
    expected = {str(polygon_id) for polygon_id in polygon_ids}
    observed = Counter(str(row[0]) for row in rows)
    incomplete_districts = {
        str(id_map.get(polygon_id, polygon_id))
        for polygon_id in expected
        if observed[polygon_id] != 1
    }
    if incomplete_districts:
        rows = [row for row in rows if str(id_map.get(str(row[0]), row[0])) not in incomplete_districts]
    return golden.housing(rows, id_map, names)


def _haversine_sql(lon_col, lat_col):
    return (f"2 * {EARTH_M} * asin(sqrt(pow(sin(radians({lat_col} - ?) / 2), 2) + "
            f"cos(radians(?)) * cos(radians({lat_col})) * pow(sin(radians({lon_col} - ?) / 2), 2)))")


def _box(lon, lat, radius_m):
    dlat = math.degrees(radius_m / EARTH_M)
    dlon = math.degrees(radius_m / (EARTH_M * max(0.2, math.cos(math.radians(lat)))))
    return lon - dlon, lon + dlon, lat - dlat, lat + dlat


def population_around(db, points_path, targets_path, search_sql, lon, lat, radius_m):
    """Measured building population, dwellings and directory businesses within radius_m metres of a point."""
    west, east, south, north = _box(lon, lat, radius_m)
    result = {'radius_m': radius_m, 'dwellings': None, 'population': None, 'businesses': None,
              'people_per_district': False, 'top_activities': []}
    if points_path:
        dist = _haversine_sql('longitude', 'latitude')
        # Building population is the district population allocated by dwellings.
        # Older layers with dwellings only cannot support a population count.
        has_people = 'population' in {row[0] for row in db.execute('describe select * from read_parquet(?)', [points_path]).fetchall()}
        people = 'sum(population)' if has_people else 'NULL::DOUBLE'
        missing_dwellings = 'count(*) filter (where dwellings is null)'
        missing_people = 'count(*) filter (where population is null)' if has_people else '0'
        homes, dwellings, population, missing_dwelling_count, missing_population = db.execute(
            f"""select count(*), sum(dwellings), {people}, {missing_dwellings}, {missing_people} from read_parquet(?) where longitude between ? and ? and latitude between ? and ?
                and {dist} <= ?""", [points_path, west, east, south, north, lat, lat, lon, radius_m]).fetchone()
        # Each output measure has its own coverage: a missing dwelling count must
        # not lower the radius total, nor hide a complete population figure.
        dwellings = round(float(dwellings or 0), 1) if not missing_dwelling_count else None
        population = round(float(population or 0)) if has_people and not missing_population else None
        result.update(home_buildings=homes or 0, dwellings=dwellings, population=population, people_per_district=has_people)
    if targets_path:
        dist = _haversine_sql('p.longitude', 'p.latitude')
        where = (f"{search_sql} and p.longitude between ? and ? and p.latitude between ? and ? and {dist} <= ?")
        params = [targets_path, west, east, south, north, lat, lat, lon, radius_m]
        result['businesses'] = db.execute(f"select count(*) from read_parquet(?) p where {where}", params).fetchone()[0]
        result['top_activities'] = [{'activity': name, 'n': n} for name, n in db.execute(
            f"""select coalesce(nullif(p.category_ar, ''), p.category) activity, count(*) n from read_parquet(?) p where {where}
                and coalesce(nullif(p.category_ar, ''), p.category) is not null group by 1 order by 2 desc, 1 limit 10""", params).fetchall()]
    return result


def _inside(x, y, polygons):
    """Even-odd ray casting over every ring, so holes count as outside."""
    for rings in polygons:
        inside = False
        for ring in rings:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi = ring[i][0], ring[i][1]
                xj, yj = ring[j][0], ring[j][1]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
                    inside = not inside
                j = i
        if inside:
            return True
    return False


def population_within(db, points_path, targets_path, search_sql, geometry):
    """Homes, people and directory businesses inside a polygon, such as a drive-time area. Same layers and the same
    people figure as population_around; only the boundary differs. Points are pre-filtered by the polygon's box in
    SQL and then tested exactly."""
    polygons = canonical_data._polygons(geometry)
    coords = [point for rings in polygons for ring in rings for point in ring]
    result = {'dwellings': None, 'population': None, 'businesses': None,
              'people_per_district': False, 'top_activities': []}
    if not coords:
        return result
    west, east = min(p[0] for p in coords), max(p[0] for p in coords)
    south, north = min(p[1] for p in coords), max(p[1] for p in coords)
    if points_path:
        has_people = 'population' in {row[0] for row in db.execute('describe select * from read_parquet(?)', [points_path]).fetchall()}
        people = 'population' if has_people else 'NULL::DOUBLE'
        rows = db.execute(f"""select longitude, latitude, dwellings, {people} from read_parquet(?)
                              where longitude between ? and ? and latitude between ? and ?""",
                          [points_path, west, east, south, north]).fetchall()
        inside = [row for row in rows if _inside(row[0], row[1], polygons)]
        population = round(sum(float(row[3]) for row in inside)) if has_people and not any(row[3] is None for row in inside) else None
        dwellings = round(sum(float(row[2]) for row in inside), 1) if not any(row[2] is None for row in inside) else None
        result.update(home_buildings=len(inside), dwellings=dwellings,
                      population=population, people_per_district=has_people)
    if targets_path:
        rows = db.execute(f"""select p.longitude, p.latitude, coalesce(nullif(p.category_ar, ''), p.category) from read_parquet(?) p
                              where {search_sql} and p.longitude between ? and ? and p.latitude between ? and ?""",
                          [targets_path, west, east, south, north]).fetchall()
        inside = [row for row in rows if _inside(row[0], row[1], polygons)]
        result['businesses'] = len(inside)
        counts = {}
        for row in inside:
            if row[2]:
                counts[row[2]] = counts.get(row[2], 0) + 1
        result['top_activities'] = [{'activity': name, 'n': n} for name, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:10]]
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
    """Return an interior representative point; a concave district's centroid may fall outside it."""
    try:
        district = shape(geometry)
        if district.is_empty or not district.is_valid:
            return None
        point = district.centroid
        if not district.contains(point):
            point = district.representative_point()
        if not math.isfinite(point.x) or not math.isfinite(point.y):
            return None
        return point.x, point.y
    except (TypeError, ValueError, AttributeError):
        return None


def territory_centres(features):
    """Interior representative points in the same compact Hilbert order used for territory groups."""
    items = []
    for feature in features:
        props = feature.get('properties') or {}
        name = props.get('ar') or props.get('district_ar')
        centre = _centre(feature.get('geometry'))
        if name and centre and 34 <= centre[0] <= 56 and 16 <= centre[1] <= 33:
            items.append((name, props.get('id'), centre))
    if not items:
        return []
    xs = [item[2][0] for item in items]
    ys = [item[2][1] for item in items]
    span_x, span_y, grid = (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9, 1024
    ordered = sorted(items, key=lambda item: _hilbert(
        grid,
        min(grid - 1, int((item[2][0] - min(xs)) / span_x * (grid - 1))),
        min(grid - 1, int((item[2][1] - min(ys)) / span_y * (grid - 1))),
    ))
    return [
        {'district_ar': name, 'district_id': ident, 'lon': centre[0], 'lat': centre[1]}
        for name, ident, centre in ordered
    ]


def territories(features, weights, count, by_id=False):
    """Split a city's districts into `count` territories of near-equal weight. Districts are ordered along a
    Hilbert curve through their centres, so each territory is a compact run of neighbouring districts, and
    the run is cut where the running weight crosses each equal share. Measured zero-weight districts remain in the
    run for geographic coverage; districts absent from `weights` stay excluded as unmeasured."""
    items = []
    id_counts = {}
    if by_id:
        for feature in features:
            district_id = (feature.get('properties') or {}).get('id')
            if district_id is not None:
                key = str(district_id)
                id_counts[key] = id_counts.get(key, 0) + 1
    for feature in features:
        props = feature.get('properties') or {}
        name = props.get('ar') or props.get('district_ar')
        centre = _centre(feature.get('geometry'))
        district_id = props.get('id')
        if by_id and (district_id is None or id_counts.get(str(district_id)) != 1):
            continue
        weight = weights.get(str(district_id)) if by_id and district_id is not None else weights.get(name) if not by_id else None
        if centre and isinstance(weight, (int, float)) and not isinstance(weight, bool) and math.isfinite(weight) and weight >= 0:
            items.append((name, props.get('id'), centre, float(weight)))
    if not items or count < 1:
        return []
    xs, ys = [c[0] for _, _, c, _ in items], [c[1] for _, _, c, _ in items]
    span_x, span_y, grid = (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9, 1024
    keyed = sorted(items, key=lambda item: _hilbert(grid, min(grid - 1, int((item[2][0] - min(xs)) / span_x * (grid - 1))),
                                                    min(grid - 1, int((item[2][1] - min(ys)) / span_y * (grid - 1)))))
    total = sum(item[3] for item in keyed)
    if total <= 0:
        return []
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


# the district table lives on the service's data volume in production (REAL_ESTATE_DISTRICTS), like the listing cards
REAL_ESTATE_PATH = os.environ.get('REAL_ESTATE_DISTRICTS') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'real_estate_districts.json')


REGISTERED_DEALS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'registered_deals.json')


def registered_deals(city, path=None):
    """Prices paid per district from registered sale deals (build_registered_deals.py): per classification, the deals
    and the median price per m². None when there is no table for the city."""
    try:
        with open(path or REGISTERED_DEALS_PATH, encoding='utf-8') as handle:
            table = json.load(handle)
    except (OSError, ValueError):
        return None
    rows = (table.get('cities') or {}).get(city)
    if rows is None:
        return None
    return {'quarters': table.get('quarters'), 'min_deals': table.get('min_deals'), 'unit': table.get('unit'), 'districts': rows}


def real_estate(city, path=None):
    """Asking prices per district from build_real_estate_reference.py: per property group, the listings and the median
    price per m² (sale) or per m² per year (rent). None when there is no table for the city yet."""
    try:
        with open(path or REAL_ESTATE_PATH, encoding='utf-8') as handle:
            table = json.load(handle)
    except (OSError, ValueError):
        return None
    rows = (table.get('cities') or {}).get(city)
    if rows is None:
        return None
    return {'retrieved': table.get('retrieved'), 'min_listings': table.get('min_listings'), 'unit': table.get('unit'), 'districts': rows}


# the listing cards are a data file, not source: kept on the service's data volume (REAL_ESTATE_LISTINGS), never in Git
REAL_ESTATE_LISTINGS_PATH = os.environ.get('REAL_ESTATE_LISTINGS') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'real_estate_listings.json')
BEST_DISCOUNT_FLOOR = -30
LISTING_TYPES = ('apartment', 'studio', 'floor', 'villa', 'house', 'building', 'room', 'store', 'showroom', 'office', 'warehouse',
                 'land', 'rest_house', 'chalet', 'farm', 'factory', 'workshop', 'compound', 'other')
LISTINGS_MAX = 1500
LISTING_FEATURES = ('furnished', 'ketchen', 'ac', 'lift', 'car_entrance', 'extra_unit', 'two_entrances', 'private_roof', 'stairs', 'maid', 'driver', 'backyard', 'pool', 'basement', 'tent')
LISTING_SORTS = ('best', 'price_asc', 'price_desc', 'area_desc', 'sqm_asc')
_listings_cache = {}


def _listing_cards(path):
    """The listing cards file, read once per change on disk."""
    stamp = os.path.getmtime(path)
    cached = _listings_cache.get(path)
    if cached and cached[0] == stamp:
        return cached[1]
    with open(path, encoding='utf-8') as handle:
        table = json.load(handle)
    _listings_cache[path] = (stamp, table)
    return table


def _publishable(card):
    """A listing Atlas shows: a price, a stated period, at least one photo, and figures that need no checking."""
    return (not card.get('check') and card.get('price_sar') is not None and card.get('deal') != 'rent_unstated'
            and bool(card.get('photos') or card.get('photo')))


def real_estate_listings(city, filters, path=None, deals_path=None):
    """Current listings of a city for the map and the side panel, from build_real_estate_reference.py
    --listings-out: within a box or in chosen districts, of one deal (rent | sale) and optional property types,
    optionally one deal with its rent period (rent_year | rent_month | rent_unstated | sale), a price range as
    advertised, an area range and a building no older than `max_age` years. An ad that does not state the figure a range asks about is left out of that range,
    never counted as zero. Only a publishable listing is served: one with a price, a stated period, at least one photo,
    and figures that do not need checking. Sorted with the listings
    furthest under their district's median price per m² first, then those without a comparison, then those marked
    for checking; paged by `offset` and capped at `limit`, while `total` counts every match. Each served card carries `signal`, its district's
    market signal for its type (market_signals.tag), or None. None when there is no file yet."""
    try:
        table = _listing_cards(path or REAL_ESTATE_LISTINGS_PATH)
    except (OSError, ValueError):
        return None
    box, district_filter = filters.get('bbox'), filters.get('district_ids')
    districts = set(district_filter or [])
    types, kind, deal = set(filters.get('types') or []), filters.get('kind'), filters.get('deal')
    features, tenants = set(filters.get('features') or []), filters.get('tenants')
    within = lambda value, low, high: (low is None and high is None) or (value is not None and (low is None or value >= low) and (high is None or value <= high))
    found = [card for card in table.get('listings', []) if card['city'] == city and _publishable(card)
             and (not kind or card['kind'] == kind) and (not deal or card.get('deal') == deal) and (not types or card['type'] in types)
             and (district_filter is None or card['district_id'] in districts)
             and (not box or (box[0] <= card['lon'] <= box[2] and box[1] <= card['lat'] <= box[3]))
             and within(card.get('price_sar'), filters.get('min_price'), filters.get('max_price'))
             and within(card.get('area_sqm'), filters.get('min_area'), filters.get('max_area'))
             and within(card.get('beds'), filters.get('min_beds'), None)
             and within(card.get('livings'), filters.get('min_livings'), None)
             and within(card.get('wc'), filters.get('min_wc'), None)
             and within(card.get('street_width'), filters.get('min_street_width'), None)
             and (not tenants or card.get('tenants') in (tenants, 'both'))
             and all((card.get('features') or {}).get(feature) == 1 for feature in features)
             and within(card.get('vs_district_pct'), filters.get('min_vs_district_pct'), filters.get('max_vs_district_pct'))
             and within(card.get('age'), None, filters.get('max_age'))]
    sort = filters.get('sort', 'best')
    def sort_key(card):
        if sort == 'price_asc':
            return (card.get('price_sar') is None, card.get('price_sar') or 0, str(card.get('id') or ''))
        if sort == 'price_desc':
            return (card.get('price_sar') is None, -(card.get('price_sar') or 0), str(card.get('id') or ''))
        if sort == 'area_desc':
            return (card.get('area_sqm') is None, -(card.get('area_sqm') or 0), str(card.get('id') or ''))
        if sort == 'sqm_asc':
            return (card.get('sar_per_sqm') is None, card.get('sar_per_sqm') or 0, str(card.get('id') or ''))
        # A card to check goes last; otherwise rank by district discount, then photo presence.
        floor = (card.get('vs_district_pct') or 0) < BEST_DISCOUNT_FLOOR
        return (bool(card.get('check')), card.get('vs_district_pct') is None, floor, not card.get('photo'),
                card.get('vs_district_pct') or 0, str(card.get('id') or ''))
    found.sort(key=sort_key)
    limit = filters.get('limit') or LISTINGS_MAX
    offset = filters.get('offset') or 0
    shown = found[offset:offset + limit]
    signals = _market_signals(city, table, path or REAL_ESTATE_LISTINGS_PATH, deals_path)
    # The number stays out of a list: a signed-in person requests one displayed listing's number separately.
    shown = [{**{key: value for key, value in card.items() if key != 'phone'}, 'has_phone': bool(card.get('phone')),
              'signal': market_signals.tag(card, signals)} for card in shown]
    return {'retrieved': table.get('retrieved'), 'total': len(found), 'offset': offset, 'listings': shown}


def listing_phone(listing_id, path=None):
    """One displayed listing's advertiser number, or None when it has none or the source is unavailable."""
    try:
        table = _listing_cards(path or REAL_ESTATE_LISTINGS_PATH)
    except (OSError, ValueError):
        return None
    return _phone_index(table).get(str(listing_id))


_phone_indexes = {}


def _phone_index(table):
    key = id(table)
    if key not in _phone_indexes:
        _phone_indexes.clear()
        # only a listing Atlas shows gives its number; the page never receives a directory of advertiser phones
        _phone_indexes[key] = {str(card['id']): card['phone'] for card in table.get('listings', []) if card.get('phone') and _publishable(card)}
    return _phone_indexes[key]


def _market_signals(city, table, cards_path, deals_path=None):
    """market_signals for the city's listings and registered deals; empty without the deals file, so no tag."""
    deals_path = deals_path or REGISTERED_DEALS_PATH
    try:
        stamp = (os.path.getmtime(cards_path), os.path.getmtime(deals_path))
        with open(deals_path, encoding='utf-8') as handle:
            deals = json.load(handle)
    except (OSError, ValueError):
        return {}
    return market_signals.for_city(city, table, deals, stamp)


AUDIENCE_FIELDS = ('male_pct', 'saudi_pct')


def district_audience(city, path=None, id_map=None):
    """Measured audience shares by district: the share of men and of Saudis, from the 910ths reference table. A
    district is kept when either share is measured; the caller can still use that segment while showing the other as
    «غير متاح». A district with neither measured share is omitted. When supplied, id_map adds the canonical district
    identity resolved from every source polygon; an unresolved mapping is explicit null, never inferred from its name."""
    table = district_reference.load(path or district_reference.PATH)
    rows_by_name = district_reference.city_rows(city, path or district_reference.PATH)
    cities = (table or {}).get('cities') or {}
    if city not in cities or cities.get(city) is None:
        return None
    rows = rows_by_name.values()
    districts = []
    for row in rows:
        if not any(row.get(key) is not None for key in AUDIENCE_FIELDS):
            continue
        result = {'district_ar': row['district_ar'], **{key: row.get(key) for key in AUDIENCE_FIELDS}}
        if id_map is not None:
            result['district_id'] = canonical_reference_district_id(row, id_map)
        districts.append(result)
    return {'districts': districts}


def canonical_reference_district_id(row, id_map):
    """Resolve a 910ths row to one canonical district only when all of its source polygons agree."""
    polygon_ids = row.get('polygon_ids') if isinstance(row, dict) else None
    if not isinstance(polygon_ids, list) or not polygon_ids:
        return None
    canonical = set()
    for polygon_id in polygon_ids:
        if isinstance(polygon_id, bool) or not isinstance(polygon_id, (str, int)) or not str(polygon_id).strip():
            return None
        key = str(polygon_id)
        if key not in id_map:
            return None
        canonical.add(str(id_map[key]))
    return next(iter(canonical)) if len(canonical) == 1 else None


def district_income(city, path=None, id_map=None):
    """Average monthly income per working person by district, from the 910ths reference table (district_reference)."""
    table = district_reference.load(path or district_reference.PATH)
    rows = ((table or {}).get('cities') or {}).get(city)
    if rows is None:
        return None
    selected = []
    for row in rows:
        if not any(row.get(key) is not None for key in INCOME_FIELDS):
            continue
        item = {'district_ar': row['district_ar'], **{key: row.get(key) for key in INCOME_FIELDS}}
        if id_map is not None:
            item['district_id'] = canonical_reference_district_id(row, id_map)
        selected.append(item)
    rows = selected
    return {'source': table.get('source'), 'retrieved': table.get('retrieved'), 'unit': table.get('unit', 'SAR/month'), 'districts': rows}
