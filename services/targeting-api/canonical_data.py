"""Canonical city and district names for the served directory snapshot.

The directory is assembled from several sources, so one city can arrive under more
than one English spelling («Mecca» next to «Makkah Al Mukarramah», some rows with
no Arabic name) and a district label can be another spelling of an official
district, carry a «حي» prefix, or be a leftover that is no district at all (a
serialised object, «False», a street in Latin letters). Served as-is, a city shows
twice in the city picker with its counts split, and a district's establishments
fall outside the official polygon the map draws.

prepare() writes a canonical copy of the parquet assets into a scratch directory
(never into the mounted data volume, which may be read-only and manifest-verified)
and returns the paths the service should read. A file is rewritten only when its
source changes; any failure falls back to the original file so the service still
starts. The English city spellings follow the targeting service's CITIES table and
the official district atlas; data-cleaning/city_names.py carries the same alias
table for rebuilds of the snapshot itself.
"""
import hashlib
import json
import logging
import math
import os
import re
import shutil

import duckdb
import shapely
import shapely.geometry
import shapely.ops

LOGGER = logging.getLogger('farq.targeting')
VERSION = 4   # bump when the rules below change so cached copies are rebuilt

# key -> (English, Arabic); keep in step with services/data-cleaning/city_names.py
CITY_ALIAS = {
 'riyadh': ('Riyadh', 'الرياض'), 'jeddah': ('Jeddah', 'جدة'), 'jiddah': ('Jeddah', 'جدة'),
 'mecca': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'makkah': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'makkahmukarramah': ('Makkah Al Mukarramah', 'مكة المكرمة'), 'mekkah': ('Makkah Al Mukarramah', 'مكة المكرمة'),
 'medina': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madinah': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madinahmunawwarah': ('Al Madinah Al Munawwarah', 'المدينة المنورة'), 'madina': ('Al Madinah Al Munawwarah', 'المدينة المنورة'),
 'dammam': ('Dammam', 'الدمام'), 'khobar': ('Al Khobar', 'الخبر'), 'dhahran': ('Dhahran', 'الظهران'),
 'hofuf': ('Al Ahsa', 'الأحساء'), 'ahsa': ('Al Ahsa', 'الأحساء'), 'hasa': ('Al Ahsa', 'الأحساء'), 'mubarraz': ('Al Mubarraz', 'المبرز'),
 'taif': ('Al Taif', 'الطائف'), 'yanbu': ('Yanbu', 'ينبع'), 'jubayl': ('Al Jubail', 'الجبيل'), 'jubail': ('Al Jubail', 'الجبيل'),
 'hail': ('Hail', 'حائل'), 'tabuk': ('Tabuk', 'تبوك'), 'buraydah': ('Buraydah', 'بريدة'), 'buraidah': ('Buraydah', 'بريدة'),
 'khamismushayt': ('Khamis Mushayt', 'خميس مشيط'), 'khamismushait': ('Khamis Mushayt', 'خميس مشيط'), 'abha': ('Abha', 'أبها'),
 'jizan': ('Jazan', 'جازان'), 'jazan': ('Jazan', 'جازان'), 'gizan': ('Jazan', 'جازان'), 'arar': ('Arar', 'عرعر'), 'sakaka': ('Sakaka', 'سكاكا'),
 'najran': ('Najran', 'نجران'), 'qatif': ('Qatif', 'القطيف'), 'bishah': ('Bisha', 'بيشة'), 'bisha': ('Bisha', 'بيشة'),
 'hafarbatin': ('Hafar Al Batin', 'حفر الباطن'), 'unaizah': ('Unaizah', 'عنيزة'), 'unayzah': ('Unaizah', 'عنيزة'),
 'diriyah': ('Diriyah', 'الدرعية'), 'kharj': ('Al Kharj', 'الخرج'), 'baha': ('Al Bahah', 'الباحة'), 'bahah': ('Al Bahah', 'الباحة'),
 'qunfudhah': ('Al Qunfudhah', 'القنفذة'), 'majmaah': ('Al Majmaah', 'المجمعة'), 'zulfi': ('Az Zulfi', 'الزلفي'), 'khafji': ('Al Khafji', 'الخفجي'),
 'rastannurah': ('Ras Tanura', 'رأس تنورة'), 'ula': ('AlUla', 'العلا'), 'rabigh': ('Rabigh', 'رابغ'), 'qurayyat': ('Al Qurayyat', 'القريات'),
}
ARTICLES = r'^(al|el|ad|ar|as|at|az|an|ash|adh|ath|aj)[\s\-]+'
AR_LETTERS = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي'})
NOT_A_DISTRICT = {'', 'false', 'true', 'none', 'null', 'nan', 'n/a'}
FILES = ('targets.parquet', 'trade_clusters.parquet', 'street_density.parquet')
CORRECTIONS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'district_corrections.json')


def city_key(name):
    s = (name or '').lower().strip()
    s = re.sub(r"[`'’ʼ]", '', s)
    s = re.sub(ARTICLES, '', s)
    s = re.sub(r'\b(al|el|ad|ar|as|at|az|an|ash|adh)[\s\-]+', '', s)
    s = re.sub(r'\b(city|governorate|province|region)\b', '', s)
    return re.sub(r'[^a-z؀-ۿ]+', '', s)


def canonical_city(name):
    """(English, Arabic) for a known spelling, else None: unknown cities are served as they are."""
    return CITY_ALIAS.get(city_key(name))


def district_key(name):
    s = (name or '').translate(AR_LETTERS)
    s = re.sub(r'[ً-ْـ]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def clean_district(raw):
    """The district label without noise, or None when the value is not a district name at all."""
    s = re.sub(r'\s+', ' ', (raw or '')).strip()
    if s.lower() in NOT_A_DISTRICT or s[0] in '{[' or re.fullmatch(r'[\d\s.,،\-]+', s) or not re.search(r'[؀-ۿ]', s):
        return None
    return re.sub(r'^(حي|حى|حيّ)\s+', '', s) or None


def official_districts(geojson_path):
    """(city_en, spelling key) -> official Arabic spelling from the district atlas."""
    try:
        with open(geojson_path, encoding='utf-8') as handle:
            features = json.load(handle).get('features') or []
    except (OSError, ValueError):
        return {}
    official = {}
    for feature in features:
        props = feature.get('properties') or {}
        name, city = props.get('ar') or props.get('district_ar'), props.get('city_en')
        if name and city:
            official.setdefault((city, district_key(name)), name)
    return official


def load_corrections(path=CORRECTIONS_PATH):
    """(city_en, polygon id) -> corrected names, from the reviewed table kept in the repository."""
    try:
        with open(path, encoding='utf-8') as handle:
            table = json.load(handle)
    except (OSError, ValueError):
        return {}
    return {(row['city_en'], str(row['id'])): row for row in table.get('corrections', []) if row.get('city_en') and row.get('id') is not None and row.get('ar')}


def load_n910_names(path=CORRECTIONS_PATH):
    """(city_en, polygon id) -> the name 910ths gives the district this polygon belongs to, where it differs from the
    atlas name (reviewed links in the same table, under "n910_names")."""
    try:
        with open(path, encoding='utf-8') as handle:
            table = json.load(handle)
    except (OSError, ValueError):
        return {}
    return {(row['city_en'], str(row['id'])): row['n910_ar'] for row in table.get('n910_names', [])
            if row.get('city_en') and row.get('id') is not None and row.get('n910_ar')}


def _polygons(geometry):
    if not geometry:
        return []
    if geometry.get('type') == 'Polygon':
        return [geometry['coordinates']]
    if geometry.get('type') == 'MultiPolygon':
        return list(geometry['coordinates'])
    return []


def _id_order(value):
    text = str(value)
    return (0, int(text), text) if text.isdigit() else (1, 0, text)


TOUCH_DEG = 0.0005   # ~50 m: same-name outlines this close are one district drawn in pieces
DIRECTIONS = [('شرق', 'East'), ('شمال شرق', 'Northeast'), ('شمال', 'North'), ('شمال غرب', 'Northwest'),
              ('غرب', 'West'), ('جنوب غرب', 'Southwest'), ('جنوب', 'South'), ('جنوب شرق', 'Southeast')]


def _components(members):
    """Index lists of same-name polygons that touch one another (within TOUCH_DEG), lowest id first."""
    shapes = []
    for _, geometry in members:
        try:
            shapes.append(shapely.geometry.shape(geometry).buffer(TOUCH_DEG) if geometry else None)
        except Exception:   # an unreadable outline stands alone
            shapes.append(None)
    parent = list(range(len(members)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            if shapes[i] is not None and shapes[j] is not None and shapes[i].intersects(shapes[j]):
                parent[root(j)] = root(i)
    groups = {}
    for i in range(len(members)):
        groups.setdefault(root(i), []).append(i)
    return sorted(groups.values(), key=lambda idx: _id_order(members[idx[0]][0]['id']))


def _centre(geometries):
    try:
        return shapely.ops.unary_union([shapely.geometry.shape(g) for g in geometries if g]).centroid
    except Exception:
        return None


def _qualifiers(centres):
    """A compass word for each separate part of a shared name, from its position around the parts' mean."""
    known = [c for c in centres if c is not None]
    if not known:
        return [None] * len(centres)
    cx, cy = sum(c.x for c in known) / len(known), sum(c.y for c in known) / len(known)
    words = []
    for c in centres:
        if c is None:
            words.append(None)
            continue
        if len(known) == 2:   # two parts: the axis they are spread along reads more plainly than a diagonal
            dx, dy = c.x - cx, c.y - cy
            words.append(DIRECTIONS[0 if dx > 0 else 4] if abs(dx) >= abs(dy) else DIRECTIONS[2 if dy > 0 else 6])
            continue
        octant = int(((math.degrees(math.atan2(c.y - cy, c.x - cx)) + 360 + 22.5) % 360) // 45)
        words.append(DIRECTIONS[octant])
    seen = {}
    for i, word in enumerate(words):   # two parts in the same direction are numbered rather than guessed
        if word is not None:
            seen.setdefault(word, []).append(i)
    return [None if w is None else (w if len(seen[w]) == 1 else (f"{w[0]} {seen[w].index(i) + 1}", f"{w[1]} {seen[w].index(i) + 1}"))
            for i, w in enumerate(words)]


def canonical_districts(collection, corrections):
    """One feature per district: names corrected from the reviewed table, then polygons that carry the same
    name in the same city merged when they touch (a district drawn in pieces). Same-name polygons that do
    not touch are different districts: each keeps its outline and gets the shared name with a compass word,
    e.g. «الشهداء (غرب)», recorded in `name_base_ar` so directory records carrying the bare name can be placed
    by location (canonicalize_file). Returns (collection, {original id: canonical id})."""
    groups, order = {}, []
    for feature in collection.get('features') or []:
        props = dict(feature.get('properties') or {})
        city, ident = props.get('city_en'), props.get('id')
        if ident is None:
            continue
        fix = corrections.get((city, str(ident)))
        if fix:
            props['ar'] = fix['ar']
            if fix.get('en'):
                props['en'] = fix['en']
            if fix.get('qualifier_ar'):   # the place that tells this district from a same-name one, e.g. «بحرة»
                props['_qualifier'] = (fix['qualifier_ar'], fix.get('qualifier_en') or fix['qualifier_ar'])
            if fix.get('to_city_en'):   # the polygon belongs to another city (e.g. الشهداء of Diriyah filed under Riyadh)
                props['moved_from_city_en'] = city
                props['city_en'], city = fix['to_city_en'], fix['to_city_en']
                props['city_ar'] = fix.get('to_city_ar') or props.get('city_ar')
        key = (city, district_key(props.get('ar') or props.get('district_ar') or str(ident)))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append((props, feature.get('geometry')))
    features, id_map = [], {}
    for key in order:
        members = sorted(groups[key], key=lambda member: _id_order(member[0]['id']))
        parts = _components(members) if len(members) > 1 else [[0]]
        qualifiers = [None]
        if len(parts) > 1:
            named = [next((members[i][0]['_qualifier'] for i in part if members[i][0].get('_qualifier')), None) for part in parts]
            plain = [k for k, q in enumerate(named) if q is None]
            # a reviewed place name wins; one part left without one keeps the bare name, several get compass words
            compass = _qualifiers([_centre([members[i][1] for i in parts[k]]) for k in plain]) if len(plain) > 1 else [None] * len(plain)
            qualifiers = list(named)
            for k, word in zip(plain, compass):
                qualifiers[k] = word
        for part, qualifier in zip(parts, qualifiers):
            chosen = [members[i] for i in part]
            props = dict(chosen[0][0])
            props.pop('_qualifier', None)
            canonical_id = props['id']
            if len(chosen) == 1:
                geometry = chosen[0][1]
            else:
                geometry = {'type': 'MultiPolygon', 'coordinates': [ring for _, geom in chosen for ring in _polygons(geom)]}
                props['member_ids'] = [member[0]['id'] for member in chosen]
            if len(parts) > 1:
                base = props.get('ar') or props.get('district_ar')
                props['name_base_ar'] = base
                if qualifier:
                    for field in ('ar', 'district_ar'):
                        if props.get(field):
                            props[field] = f"{props[field]} ({qualifier[0]})"
                    for field in ('en', 'district_en'):
                        if props.get(field):
                            props[field] = f"{props[field]} ({qualifier[1]})"
            for member_props, _ in chosen:
                id_map[str(member_props['id'])] = canonical_id
            features.append({'type': 'Feature', 'id': canonical_id, 'properties': props, 'geometry': geometry})
    return {'type': 'FeatureCollection', 'features': features}, id_map


def merge_population_rows(rows, id_map, names, by_age=False):
    """Sum per-polygon population rows (dicts) into canonical districts; coverage is recomputed from cells
    or, for age groups, weighted by population. Unmapped ids pass through unchanged."""
    merged, order = {}, []
    for row in rows:
        canonical = id_map.get(str(row['district_id']), row['district_id'])
        key = (str(canonical), row.get('age_code')) if by_age else str(canonical)
        if key not in merged:
            out = dict(row)
            out['district_id'] = canonical
            name_ar, name_en = names.get(str(canonical), (None, None))
            out['district_ar'], out['district_en'] = name_ar or row.get('district_ar'), name_en or row.get('district_en')
            out['_weight'] = 0.0
            out['_coverage'] = 0.0
            for field in ('population', 'valid_cells', 'polygon_cells', 'male', 'female', 'total'):
                if field in out:
                    out[field] = None
            merged[key] = out
            order.append(key)
        out = merged[key]
        for field in ('population', 'valid_cells', 'polygon_cells', 'male', 'female', 'total'):
            if field in row and row[field] is not None:
                out[field] = (out[field] or 0) + float(row[field])   # parquet decimals and doubles both sum as floats
        weight = row.get('total') if by_age else row.get('population')
        if weight and row.get('coverage_pct') is not None:
            out['_weight'] += float(weight)
            out['_coverage'] += float(weight) * float(row['coverage_pct'])
    result = []
    for key in order:
        out = merged[key]
        weight, coverage = out.pop('_weight'), out.pop('_coverage')
        if not by_age and out.get('polygon_cells'):
            out['coverage_pct'] = round(100 * (out.get('valid_cells') or 0) / out['polygon_cells'], 4)
        elif weight:
            out['coverage_pct'] = round(coverage / weight, 4)
        result.append(out)
    return result


def _source_signature(path, depends=None):
    """What a canonical copy was built from: the rules version, the source file, and (depends) the district atlas
    and corrections the district names were matched against, so a new atlas or correction rebuilds the copy."""
    stat = os.stat(path)
    return {'version': VERSION, 'size': stat.st_size, 'mtime': stat.st_mtime, **(depends or {})}


def _file_stamp(path):
    try:
        with open(path, 'rb') as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def _fresh(out, signature):
    try:
        with open(out + '.source.json', encoding='utf-8') as handle:
            return os.path.isfile(out) and json.load(handle) == signature
    except (OSError, ValueError):
        return False


def shared_name_parts(collection):
    """[(city the records are filed under, key of the shared name, district name, city the district is in, its Arabic
    city name, centroid lat, centroid lon)] for every name that directory records cannot place by text alone: a
    name two separate districts of one city share (canonical_districts adds a compass word), and the name of a
    polygon moved to another city by a correction, together with the same-name district left in the old city."""
    features = [f.get('properties') or {} for f in collection.get('features') or []]
    centres = {id(p): _centre([f.get('geometry')]) for p, f in zip(features, collection.get('features') or [])}
    parts = []

    def add(filed_under, base, props):
        centre = centres.get(id(props))
        if centre is not None:
            city = canonical_city(props.get('city_en')) or (props.get('city_en'), props.get('city_ar'))   # one spelling per city
            parts.append((filed_under, district_key(base), props.get('ar') or props.get('district_ar'), city[0], city[1], centre.y, centre.x))
    for props in features:
        if props.get('name_base_ar'):
            add(props.get('city_en'), props['name_base_ar'], props)
        if props.get('moved_from_city_en'):
            name = props.get('ar') or props.get('district_ar')
            add(props['moved_from_city_en'], name, props)
            for other in features:   # the district of the same name that stays in the old city
                if other.get('city_en') == props['moved_from_city_en'] and district_key(other.get('name_base_ar') or other.get('ar') or '') == district_key(name):
                    add(props['moved_from_city_en'], name, other)
    return parts


def canonicalize_file(src, out, official, shared=None):
    """Rewrite one parquet asset with canonical city and district values; returns the row count. A record whose
    district is a name two separate districts share (shared, from shared_name_parts) goes to the part nearest
    its coordinates; without coordinates it keeps the bare name, which matches neither part."""
    db = duckdb.connect()
    try:
        # the server waits for this copy before it listens, so use the machine (production: 32 vCPU, 32 GB)
        db.execute(f"SET threads={min(8, os.cpu_count() or 2)}; SET memory_limit='4GB'")
        columns = {row[0] for row in db.execute('describe select * from read_parquet(?)', [src]).fetchall()}
        replace = []
        joins = ''
        city_expr = 't.city_en'
        if 'city_en' in columns:
            cities = [row[0] for row in db.execute('select distinct city_en from read_parquet(?) where city_en is not null', [src]).fetchall()]
            db.execute('create temp table city_map (raw varchar, en varchar, ar varchar)')
            db.executemany('insert into city_map values (?, ?, ?)', [(raw, *canonical_city(raw)) for raw in cities if canonical_city(raw)])
            joins += ' left join city_map c on c.raw = t.city_en'
            city_expr = 'coalesce(c.en, t.city_en)'
            replace.append(f'{city_expr} as city_en')
            if 'city_ar' in columns:
                replace.append('coalesce(c.ar, t.city_ar) as city_ar')
        if 'district_ar' in columns:
            pairs = db.execute(f'select distinct {city_expr}, t.district_ar from read_parquet(?) t{joins} where t.district_ar is not null', [src]).fetchall()
            rows = []
            for city, raw in pairs:
                cleaned = clean_district(raw)
                clean = official.get((city, district_key(cleaned)), cleaned) if cleaned else None
                rows.append((city, raw, clean, district_key(clean) if clean else None))
            db.execute('create temp table district_map (city varchar, raw varchar, clean varchar, key varchar)')
            db.executemany('insert into district_map values (?, ?, ?, ?)', rows)
            joins += f' left join district_map d on d.city is not distinct from {city_expr} and d.raw = t.district_ar'
            lat = next((c for c in ('latitude', 'lat') if c in columns), None)
            lon = next((c for c in ('longitude', 'lon', 'lng') if c in columns), None)
            if shared and lat and lon:
                db.execute('create temp table shared_parts (city varchar, key varchar, label varchar, to_city varchar, to_city_ar varchar, lat double, lon double)')
                db.executemany('insert into shared_parts values (?, ?, ?, ?, ?, ?, ?)', shared)
                y, x = f'try_cast(t.{lat} as double)', f'try_cast(t.{lon} as double)'   # older assets store coordinates as text
                located = f'{y} is not null and {x} is not null'

                def nearest(field):
                    return (f'(select arg_min(s.{field}, (s.lat - {y}) * (s.lat - {y}) + (s.lon - {x}) * (s.lon - {x})) '
                            f'from shared_parts s where s.city is not distinct from {city_expr} and s.key = d.key)')
                replace.append(f'case when {located} then coalesce({nearest("label")}, d.clean) else d.clean end as district_ar')
                # a record placed in a district moved to another city moves with it
                replace[:] = [f'case when {located} then coalesce({nearest("to_city")}, {city_expr}) else {city_expr} end as city_en' if r == f'{city_expr} as city_en'
                              else f'case when {located} then coalesce({nearest("to_city_ar")}, c.ar, t.city_ar) else coalesce(c.ar, t.city_ar) end as city_ar' if r == 'coalesce(c.ar, t.city_ar) as city_ar'
                              else r for r in replace]
            else:
                replace.append('d.clean as district_ar')
            if 'district_reliable' in columns:
                # a value that was never a district name must not place the record inside any polygon
                replace.append('case when t.district_ar is not null and d.clean is null then false else t.district_reliable end as district_reliable')
        if not replace:
            return None
        tmp = out + '.tmp'
        # COPY ... TO takes no bound parameter for the target, so the scratch path is quoted as a literal
        target = tmp.replace("'", "''")
        db.execute(f"copy (select t.* replace ({', '.join(replace)}) from read_parquet(?) t{joins}) to '{target}' (format parquet)", [src])
        os.replace(tmp, out)
        return db.execute('select count(*) from read_parquet(?)', [out]).fetchone()[0]
    finally:
        db.close()


def cross_city_duplicates(collection, share=0.5):
    """[(city, id, other city, other id)] for polygons filed under two cities that cover the same ground (more than
    `share` of the smaller one), after corrections. Each such outline would count its people and businesses twice;
    district_corrections.json moves the copy to the nearer city (to_city_en)."""
    features = [f for f in collection.get('features', []) if f.get('geometry')]
    shapes = [shapely.make_valid(shapely.geometry.shape(f['geometry'])) for f in features]
    tree = shapely.STRtree(shapes)
    found = []
    for i, shape in enumerate(shapes):
        for j in map(int, tree.query(shape)):
            a, b = features[i]['properties'], features[j]['properties']
            if j <= i or a.get('city_en') == b.get('city_en'):
                continue
            smaller = min(shape.area, shapes[j].area)
            if smaller > 0 and shape.intersection(shapes[j]).area / smaller > share:
                found.append((a.get('city_en'), str(a.get('id')), b.get('city_en'), str(b.get('id'))))
    return found


def prepare(data_dir, out_dir):
    """Canonical paths for the parquet assets and the district atlas in data_dir, plus the polygon id map
    and canonical district names; falls back to the originals on any failure."""
    paths = {name: os.path.join(data_dir, name) for name in FILES}
    paths['districts.geojson'] = os.path.join(data_dir, 'districts.geojson')
    paths['district_id_map'], paths['district_names'] = {}, {}
    if os.environ.get('FARQ_TARGETING_CANONICALIZE', '1') in ('0', 'false', 'no'):
        return paths
    try:
        with open(paths['districts.geojson'], encoding='utf-8') as handle:
            collection, id_map = canonical_districts(json.load(handle), load_corrections())
        out = os.path.join(out_dir, 'districts.geojson')
        os.makedirs(out_dir, exist_ok=True)
        with open(out + '.tmp', 'w', encoding='utf-8') as handle:
            json.dump(collection, handle, ensure_ascii=False)
        os.replace(out + '.tmp', out)
        paths['districts.geojson'], paths['district_id_map'] = out, id_map
        paths['district_names'] = {str(f['properties']['id']): (f['properties'].get('ar') or f['properties'].get('district_ar'), f['properties'].get('en') or f['properties'].get('district_en')) for f in collection['features']}
        LOGGER.info('canonical_data file=districts.geojson features=%s merged_polygons=%s', len(collection['features']), sum(1 for k, v in id_map.items() if str(v) != k))
        for city, ident, other, other_id in cross_city_duplicates(collection):
            LOGGER.warning('canonical_data_cross_city_duplicate city=%s id=%s other_city=%s other_id=%s', city, ident, other, other_id)
    except FileNotFoundError:
        pass
    except Exception as error:
        LOGGER.error('canonical_data_failed file=districts.geojson error_type=%s', type(error).__name__)
    official = official_districts(paths['districts.geojson'])
    try:
        with open(paths['districts.geojson'], encoding='utf-8') as handle:
            shared = shared_name_parts(json.load(handle))
    except (OSError, ValueError):
        shared = []
    depends = {'districts': _file_stamp(os.path.join(data_dir, 'districts.geojson')), 'corrections': _file_stamp(CORRECTIONS_PATH)}
    try:   # sizes the decision to keep the copy on the data volume (FARQ_TARGETING_CANONICAL_DIR)
        LOGGER.info('canonical_data out_dir_free_bytes=%s data_dir_free_bytes=%s', shutil.disk_usage(out_dir).free if os.path.isdir(out_dir) else None, shutil.disk_usage(data_dir).free)
    except OSError:
        pass
    for name in FILES:
        src = paths[name]
        if not os.path.isfile(src):
            continue
        out = os.path.join(out_dir, name)
        try:
            os.makedirs(out_dir, exist_ok=True)
            signature = _source_signature(src, depends)
            if not _fresh(out, signature):
                rows = canonicalize_file(src, out, official, shared)
                if rows is None:
                    continue
                with open(out + '.source.json', 'w', encoding='utf-8') as handle:
                    json.dump(signature, handle)
                LOGGER.info('canonical_data file=%s rows=%s bytes=%s', name, rows, os.path.getsize(out))
            paths[name] = out
        except Exception as error:   # the original asset keeps the service up; the log names the file only
            LOGGER.error('canonical_data_failed file=%s error_type=%s', name, type(error).__name__)
    return paths
