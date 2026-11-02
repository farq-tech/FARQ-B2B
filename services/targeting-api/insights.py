"""Commercial insights built on the district layers: growth, population around a point, sales territories and
district income. Pure functions over files on the data volume (or the repository reference folder), so the
HTTP layer only validates input and the logic can be tested with small synthetic files."""
import glob
import json
import math
import os
import statistics

import canonical_data
import district_reference
import market_signals

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


MIN_HOUSING_UNITS = 200


def housing_level(db, path, polygon_ids, id_map, names):
    """Share of a canonical district's homes that are villas, from the buildings layer: a named stand-in for income
    where no income is published (docs/atlas-product-foundation.md §7). A district with fewer than MIN_HOUSING_UNITS
    dwellings is left out: a handful of buildings is no level."""
    if not path:
        return None
    rows = db.execute("""select district_id, district_ar, villas, dwelling_units from read_parquet(?)
                         where cast(district_id as varchar) in (select unnest(?::varchar[]))""", [path, list(polygon_ids)]).fetchall()
    merged = {}
    for district_id, district_ar, villas, units in rows:
        canonical = str(id_map.get(str(district_id), district_id))
        out = merged.setdefault(canonical, {'district_id': canonical, 'district_ar': names.get(canonical, (district_ar, None))[0] or district_ar,
                                            'villas': 0, 'dwelling_units': 0.0})
        out['villas'] += int(villas or 0)
        out['dwelling_units'] += float(units or 0)
    result = []
    for row in merged.values():
        if row['dwelling_units'] < MIN_HOUSING_UNITS:
            continue
        row['villa_share_pct'] = round(min(100.0, 100 * row['villas'] / row['dwelling_units']), 1)
        row['dwelling_units'] = round(row['dwelling_units'])
        result.append(row)
    result.sort(key=lambda row: (-row['villa_share_pct'], row['district_ar'] or ''))
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


def population_within(db, points_path, targets_path, search_sql, geometry, household_size):
    """Homes, people and directory businesses inside a polygon, such as a drive-time area. Same layers and the same
    people figure as population_around; only the boundary differs. Points are pre-filtered by the polygon's box in
    SQL and then tested exactly."""
    polygons = canonical_data._polygons(geometry)
    coords = [point for rings in polygons for ring in rings for point in ring]
    result = {'dwellings': None, 'population': None, 'businesses': None, 'top_activities': []}
    if not coords:
        return result
    west, east = min(p[0] for p in coords), max(p[0] for p in coords)
    south, north = min(p[1] for p in coords), max(p[1] for p in coords)
    if points_path:
        has_people = 'population' in {row[0] for row in db.execute('describe select * from read_parquet(?)', [points_path]).fetchall()}
        people = 'population' if has_people else f'dwellings * {float(household_size)}'
        rows = db.execute(f"""select longitude, latitude, dwellings, {people} from read_parquet(?)
                              where longitude between ? and ? and latitude between ? and ?""",
                          [points_path, west, east, south, north]).fetchall()
        inside = [row for row in rows if _inside(row[0], row[1], polygons)]
        result.update(home_buildings=len(inside), dwellings=round(sum(float(r[2] or 0) for r in inside), 1),
                      population=round(sum(float(r[3] or 0) for r in inside)), people_per_district=has_people)
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
# commercial units a shop can open in: what «محلات متاحة على هذا الشارع» lists along an activity street
COMMERCIAL_TYPES = ('store', 'showroom', 'office')
NEAR_DEFAULT_M, NEAR_MAX_M, NEAR_MAX_VERTICES = 60, 200, 5000
_listings_cache = {}


def near_lines(geometry):
    """The coordinate runs of a LineString or MultiLineString inside the kingdom's box, for `near`; ValueError otherwise."""
    if not isinstance(geometry, dict) or geometry.get('type') not in ('LineString', 'MultiLineString'):
        raise ValueError('near')
    runs = [geometry.get('coordinates')] if geometry['type'] == 'LineString' else geometry.get('coordinates')
    if not isinstance(runs, list) or not runs:
        raise ValueError('near')
    total = 0
    for run in runs:
        if not isinstance(run, list) or not run:
            raise ValueError('near')
        total += len(run)
        for point in run:
            if not (isinstance(point, list) and len(point) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in point[:2])
                    and 34 <= point[0] <= 56 and 16 <= point[1] <= 33):
                raise ValueError('near')
    if total > NEAR_MAX_VERTICES:
        raise ValueError('near')
    return [[(float(p[0]), float(p[1])) for p in run] for run in runs]


def distance_to_lines_m(lon, lat, runs):
    """Metres from a point to the nearest segment of the runs, on a flat projection around the point (exact enough
    within a few hundred metres)."""
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    best = math.inf
    for run in runs:
        points = [((x - lon) * kx, (y - lat) * ky) for x, y in run]
        if len(points) == 1:
            best = min(best, math.hypot(*points[0]))
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            dx, dy = bx - ax, by - ay
            length = dx * dx + dy * dy
            t = 0 if not length else max(0.0, min(1.0, -(ax * dx + ay * dy) / length))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


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


# a yearly rent below this is a month's rent marked wrongly (build_real_estate_reference.MIN_YEARLY_RENT)
MIN_YEARLY_RENT = 6_000


def _suspect(card):
    """Whether a card's figures need checking. A card built before 2026-11-02 is marked for checking whenever it has
    no price per m², so an ad that states no area was hidden although it has no figure to doubt; such a card is
    suspect only when its yearly rent is too low to be one."""
    if not card.get('check'):
        return False
    if card.get('area_sqm') is None and card.get('sar_per_sqm') is None and card.get('price_sar') is not None:
        return card.get('deal') == 'rent_year' and card['price_sar'] < MIN_YEARLY_RENT
    return True


def _hidden_reason(card):
    """Why a card is not served ('check' | 'no_price' | 'rent_unstated' | 'no_photo'), or None when it is."""
    if _suspect(card):
        return 'check'
    if card.get('price_sar') is None:
        return 'no_price'
    if card.get('deal') == 'rent_unstated':
        return 'rent_unstated'
    if not (card.get('photos') or card.get('photo')):
        return 'no_photo'
    return None


def _publishable(card):
    """A listing Atlas shows: a price, a stated period, at least one photo, and figures that need no checking."""
    return _hidden_reason(card) is None


# the surroundings a street's rent is set against: units this far from its line, beyond the street's own buffer
RENT_AROUND_M = 500
# a median rests on at least this many units, else «غير متاح»
RENT_MIN_UNITS = 3


def annual_rent(card):
    """A rent card's price for a year: a yearly rent as it is, a monthly one twelve times; None for a sale or a rent
    whose period the ad does not state."""
    price = card.get('price_sar')
    if price is None:
        return None
    return {'rent_year': price, 'rent_month': 12 * price}.get(card.get('deal'))


def rent_level(cards):
    """{units, median_annual_sar, per_sqm_units, median_annual_sar_per_sqm} of the rents among cards; a median is None
    below RENT_MIN_UNITS. The rent per m² counts only the ads that state an area."""
    rents = [(rent, card.get('area_sqm')) for card in cards if (rent := annual_rent(card)) is not None]
    per_sqm = [rent / area for rent, area in rents if area]
    median = lambda values: round(statistics.median(values)) if len(values) >= RENT_MIN_UNITS else None
    return {'units': len(rents), 'median_annual_sar': median([rent for rent, _ in rents]),
            'per_sqm_units': len(per_sqm), 'median_annual_sar_per_sqm': median(per_sqm)}


def rent_summary(street, around):
    """The street's rent level against its surroundings', and the gap in % where both medians exist."""
    here, there = rent_level(street), rent_level(around)
    gap = lambda key: round(100 * (here[key] / there[key] - 1)) if here[key] and there[key] else None
    return {'street': here, 'around': there, 'around_m': RENT_AROUND_M, 'min_units': RENT_MIN_UNITS,
            'vs_around_pct': {'annual': gap('median_annual_sar'), 'per_sqm': gap('median_annual_sar_per_sqm')}}


def real_estate_listings(city, filters, path=None, deals_path=None):
    """Current listings of a city for the map and the side panel, from build_real_estate_reference.py
    --listings-out: within a box or in chosen districts, of one deal (rent | sale) and optional property types,
    optionally one deal with its rent period (rent_year | rent_month | rent_unstated | sale), optionally within `near`
    {'runs': near_lines(geometry), 'meters': m} of a street (sorted nearest first, each card with `distance_m`), a price range as
    advertised, an area range and a building no older than `max_age` years. An ad that does not state the figure a range asks about is left out of that range,
    never counted as zero. Only a publishable listing is served: one with a price, a stated period, at least one photo,
    and figures that do not need checking. Sorted with the listings
    furthest under their district's median price per m² first, then those without a comparison, then those marked
    for checking; capped at `limit`, while `total` counts every match. Each served card carries `signal`, its district's
    market signal for its type (market_signals.tag), or None. With `near` the answer also carries `rent_summary`, the
    street's rent level against the units within RENT_AROUND_M of its line (rent_summary), and `hidden`, the matching
    ads on the street left out, by reason. None when there is no file yet."""
    try:
        table = _listing_cards(path or REAL_ESTATE_LISTINGS_PATH)
    except (OSError, ValueError):
        return None
    box, districts = filters.get('bbox'), set(filters.get('district_ids') or [])
    types, kind, deal = set(filters.get('types') or []), filters.get('kind'), filters.get('deal')
    near = filters.get('near')
    if near:
        # a corridor's buffer: first the line's box widened by the surroundings' reach, then the exact distance to its segments
        runs, metres = near['runs'], near.get('meters') or NEAR_DEFAULT_M
        reach = max(metres, RENT_AROUND_M)
        pad_lat = reach / 110540
        pad_lon = reach / (111320 * math.cos(math.radians(sum(y for run in runs for _, y in run) / sum(len(run) for run in runs))))
        xs, ys = [x for run in runs for x, _ in run], [y for run in runs for _, y in run]
        near_box = (min(xs) - pad_lon, min(ys) - pad_lat, max(xs) + pad_lon, max(ys) + pad_lat)
    within = lambda value, low, high: (low is None and high is None) or (value is not None and (low is None or value >= low) and (high is None or value <= high))
    matches = [card for card in table.get('listings', []) if card['city'] == city
               and (not kind or card['kind'] == kind) and (not deal or card.get('deal') == deal) and (not types or card['type'] in types)
               and (not districts or card['district_id'] in districts)
               and (not box or (box[0] <= card['lon'] <= box[2] and box[1] <= card['lat'] <= box[3]))
               and within(card.get('price_sar'), filters.get('min_price'), filters.get('max_price'))
               and within(card.get('area_sqm'), filters.get('min_area'), filters.get('max_area'))
               and within(card.get('age'), None, filters.get('max_age'))]
    found = [card for card in matches if _publishable(card)]
    # a card to check (its figures look wrong) goes after every other, then those without a district comparison
    # best value first among believable prices: a discount past BEST_DISCOUNT_FLOOR is more often a typo than a bargain,
    # so those follow the rest; an ad with photos goes before one without at the same price standing
    floor = lambda card: (card.get('vs_district_pct') or 0) < BEST_DISCOUNT_FLOOR
    found.sort(key=lambda card: (bool(card.get('check')), card.get('vs_district_pct') is None, floor(card), not card.get('photo'),
                                 card.get('vs_district_pct') or 0))
    extra = {}
    if near:
        inside = lambda card: near_box[0] <= card['lon'] <= near_box[2] and near_box[1] <= card['lat'] <= near_box[3]
        measured = [(distance_to_lines_m(card['lon'], card['lat'], runs), card) for card in found if inside(card)]
        # the street's rent against the units around it (beyond its own buffer, within RENT_AROUND_M of its line)
        extra['rent_summary'] = rent_summary([card for d, card in measured if d <= metres],
                                             [card for d, card in measured if metres < d <= RENT_AROUND_M])
        # the matching ads on the street that are not served, by reason: a street with none served shows why
        hidden = {}
        for card in matches:
            reason = _hidden_reason(card)
            if reason and inside(card) and distance_to_lines_m(card['lon'], card['lat'], runs) <= metres:
                hidden[reason] = hidden.get(reason, 0) + 1
        extra['hidden'] = hidden
        # along a street the nearest unit comes first; the stable sort keeps the best-value order among equals
        measured = sorted([(d, card) for d, card in measured if d <= metres], key=lambda pair: round(pair[0]))
        found = [dict(card, distance_m=round(d)) for d, card in measured]
    shown = found[:filters.get('limit') or LISTINGS_MAX]
    signals = _market_signals(city, table, path or REAL_ESTATE_LISTINGS_PATH, deals_path)
    # the number stays out of a list of listings: a signed-in person asks for one listing's number (listing_phone);
    # a served card needs no checking, whatever an older file marked on it (_suspect)
    shown = [{**{key: value for key, value in card.items() if key != 'phone'}, 'check': False, 'has_phone': bool(card.get('phone')),
              'signal': market_signals.tag(card, signals)} for card in shown]
    return {'retrieved': table.get('retrieved'), 'total': len(found), 'listings': shown, **extra}


def listing_phone(listing_id, path=None):
    """One listing's advertiser number (05XXXXXXXX), or None when it has none or there is no file."""
    try:
        table = _listing_cards(path or REAL_ESTATE_LISTINGS_PATH)
    except (OSError, ValueError):
        return None
    index = _phone_index(table)
    return index.get(str(listing_id))


_phone_indexes = {}


def _phone_index(table):
    key = id(table)
    if key not in _phone_indexes:
        _phone_indexes.clear()
        # only a listing Atlas shows gives its number: a hidden one cannot be reached by guessing its id
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


def district_audience(city, path=None):
    """Measured audience shares by district: the share of men and of Saudis, from the 910ths reference table. A
    district without a measured share is left out, so the caller shows «غير متاح» for it rather than a guess."""
    table = district_reference.load(path or district_reference.PATH)
    rows = ((table or {}).get('cities') or {}).get(city)
    if rows is None:
        return None
    return {'districts': [{'district_ar': row['district_ar'], **{key: row.get(key) for key in AUDIENCE_FIELDS}} for row in rows
                          if all(row.get(key) is not None for key in AUDIENCE_FIELDS)]}


def district_income(city, path=None):
    """Average monthly income per working person by district, from the 910ths reference table (district_reference)."""
    table = district_reference.load(path or district_reference.PATH)
    rows = ((table or {}).get('cities') or {}).get(city)
    if rows is None:
        return None
    rows = [{'district_ar': row['district_ar'], **{key: row.get(key) for key in INCOME_FIELDS}} for row in rows
            if any(row.get(key) is not None for key in INCOME_FIELDS)]
    return {'source': table.get('source'), 'retrieved': table.get('retrieved'), 'unit': table.get('unit', 'SAR/month'), 'districts': rows}
