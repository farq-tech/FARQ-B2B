"""Inventory of building and unit evidence for every business of a directory release (docs/establishment-lifecycle.md 3.2).

Read-only. Prints JSON of aggregate counts (no business rows). Denominator: every row of the release; percentages are
plain shares of it (no sampling, so no confidence interval). Run from the repository root:

    python3 -I services/data-cleaning/unit_evidence_inventory.py \
        --release /Users/m4pro/farq-taxonomy-data/export/targets_golden_z19.parquet \
        --data /Users/m4pro/farq-taxonomy-data \
        --trx trx_poi_202412311250.xlsx --survey finalgeo.zip --urbi "urbi brand (version 1)_1_20250305_085350.xlsx" \
        --buildings /Users/m4pro/farq-taxonomy-data/server_inputs/buildings.parquet \
        --card-links /Users/m4pro/farq-taxonomy-data/server_inputs/card_build_links.csv \
        --osm /Users/m4pro/farq-taxonomy-data/raw/osm/osm_nodes_ksa.parquet \
        --crs-db /Users/m4pro/Desktop/crs_fixed.duckdb \
        --sample-out /Users/m4pro/farq-taxonomy-data/analysis/building_link_review_sample.csv \
        > docs/unit-evidence-inventory.json

The building layer and the card-to-building crosswalk are copies of the service volume
(buildings_ingest/normalized/buildings.parquet, buildings_ingest/golden/v2/card_build_links.csv), checked by SHA-256.
The review sample holds business rows, so it is written outside the repository.

Evidence levels, strongest first; a level counts only from an explicit field, each value checked by pattern:
- unit: a unit or shop number inside a building. No source carries one (`secondary_no` of the national address names
  the building, not the unit), so the level is reported and stays empty until a source adds it.
- floor: a valid floor value together with an explicit building identifier from the same source.
- building: an explicit building identifier: Urbi building id, HudHud building id, national short address, building
  number with postal code, Makani, or a HudHud physical parent (mall or complex). A release row whose key is a 2GIS card
  (urbi_coords:, urbi_allsaudi:, firms_shp:) takes that card's building from the vendor crosswalk (card -> BuildSynco).
- conflict: two different explicit building identifiers of one kind (across sources or within one); unresolved, so
  not counted as building evidence. Two different floors keep the building level only.
- none: no explicit building identifier in any source.
Spatial and name matches are candidates, reported apart, and never raise a level: a point inside a footprint, an Urbi
brand branch within 50 m with the same name, and the address tags of an OSM node matched by name within 100 m.
"""
import argparse
import collections
import csv
import hashlib
import json
import math
import random
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import duckdb

SHORT_ADDRESS = re.compile(r'^[A-Z]{4}\d{4}$')
BUILDING_NO = re.compile(r'^\d{4}$')
POSTAL = re.compile(r'^\d{5}$')
URBI_BUILDING = re.compile(r'^700300\d{11}$')
FLOOR = re.compile(r'^(G|GF|UG|LG|M|MZ|B\d{0,2}|P\d{0,2}|R|RF|L?-?\d{1,3}|ground|first|second|third|basement|mezzanine)$', re.I)
# spellings of one floor, so 0 and GF are not a conflict
FLOOR_SAME = {'G': '0', 'GF': '0', 'GROUND': '0', 'FIRST': '1', 'SECOND': '2', 'THIRD': '3',
              'BASEMENT': 'B', 'MZ': 'M', 'MEZZANINE': 'M', 'RF': 'R'}
CARD_KEYS = ('urbi_coords', 'urbi_allsaudi', 'firms_shp')
CITIES = ('Riyadh', 'Jeddah', 'Makkah Al Mukarramah', 'Al Madinah Al Munawwarah', 'Dammam', 'Al Khobar')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def clean(value):
    text = '' if value is None else str(value).strip()
    return '' if text.lower() in ('', 'none', 'null', 'nan', '0') else text


def digits(value):
    text = clean(value)
    return text[:-2] if text.endswith('.0') else text


def building_ids(row):
    """{kind: value} of the explicit building identifiers in one source row (keys already normalised)."""
    out = {}
    short = clean(row.get('national_address')).upper().replace(' ', '')
    if SHORT_ADDRESS.match(short):
        out['short_address'] = short
    makani = clean(row.get('makani')).upper().replace(' ', '')
    if SHORT_ADDRESS.match(makani):
        out['short_address'] = out.get('short_address', makani)
    number, postal = digits(row.get('building_no')), digits(row.get('postal_code'))
    if BUILDING_NO.match(number) and POSTAL.match(postal):
        out['number_postal'] = f'{number}/{postal}'
    urbi = digits(row.get('urbi_building_id'))
    if URBI_BUILDING.match(urbi):
        out['urbi_building'] = urbi
    hudhud = digits(row.get('hudhud_building_id'))
    if hudhud.isdigit():
        out['hudhud_building'] = hudhud
    parent = digits(row.get('physical_parent'))
    if parent.isdigit():
        out['physical_parent'] = parent
    return out


def floor_of(row):
    # ground floor is often 0: keep it here, unlike identifiers where 0 means missing
    value = '' if row.get('floor') is None else str(row.get('floor')).strip()
    value = value[:-2] if value.endswith('.0') else value
    if not FLOOR.match(value):
        return None
    value = value.upper()
    return FLOOR_SAME.get(value, value[1:] if value.startswith('L') and value[1:].lstrip('-').isdigit() else value)


def xlsx_rows(path, sheet_index=0):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        shared = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m']))
                  for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheet = list(ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', NS))[sheet_index]
    target = rels[sheet.get('{%s}id' % NS['r'])].lstrip('/')

    def column(ref):
        n = 0
        for ch in ref:
            if not ch.isalpha():
                break
            n = n * 26 + ord(ch.upper()) - 64
        return n - 1

    header = None
    with z.open(target if target.startswith('xl/') else 'xl/' + target) as handle:
        for _, el in ET.iterparse(handle):
            if el.tag != '{%s}row' % NS['m']:
                continue
            cells = {}
            for c in el.findall('m:c', NS):
                v = c.find('m:v', NS)
                # shared strings, plain values, and inline strings (<is><t>…</t></is>, rich text split over runs)
                cells[column(c.get('r'))] = (shared[int(v.text)] if c.get('t') == 's' and v is not None
                                             else v.text if v is not None
                                             else ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m'])))
            el.clear()
            values = [cells.get(i, '') for i in range(max(cells) + 1)] if cells else []
            if header is None:
                if any(values):
                    header = values
                continue
            yield dict(zip(header, values + [''] * (len(header) - len(values))))


def metres(lat1, lon1, lat2, lon2):
    k = math.pi / 180
    h = math.sin((lat2 - lat1) * k / 2) ** 2 + math.cos(lat1 * k) * math.cos(lat2 * k) * math.sin((lon2 - lon1) * k / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 22), b''):
            digest.update(block)
    return digest.hexdigest()


def geography(db, args, release, evidence, level_of, city_of, explicit):
    """Checks the explicit Urbi ids against the building layer and measures the spatial and OSM candidates.

    Counters are per city; nothing here raises a level. Agreement is a census of every business that has both an
    explicit Urbi building and a footprint around its point, so it carries no confidence interval."""
    C = collections.Counter
    db.execute('LOAD spatial')
    # a HouseId held by several features is ambiguous (build_business_building_links.py excludes it too): such features
    # are left out of every footprint, and an explicit id that names one is counted apart
    db.execute("""create table b as select HouseId::varchar h, Number n, PostIndex pi, Purpose purpose,
                  ST_GeomFromHEXWKB(geometry_wkb_hex) g from read_parquet(?) qualify count(*) over (partition by HouseId) = 1""", [args.buildings])
    ambiguous = {h for (h,) in db.execute(
        "select HouseId::varchar from read_parquet(?) group by 1 having count(*) > 1", [args.buildings]).fetchall()}
    layer = {h: (n, pi, purpose) for h, n, pi, purpose in db.execute("select h, n, pi, purpose from b").fetchall()}
    db.execute("create table p as select poi_key, ST_Point(longitude, latitude) g from read_parquet(?) "
               "where latitude is not null and longitude is not null", [args.release])
    inside = collections.defaultdict(set)
    for key, house in db.execute("select p.poi_key, b.h from p join b on ST_Contains(b.g, p.g)").fetchall():
        inside[key].add(house)

    urbi_of = lambda rows: {v for ids, _ in rows for k, v in explicit(ids).items() if k == 'urbi_building'}
    numbers_of = lambda rows: {v for ids, _ in rows for k, v in explicit(ids).items() if k == 'number_postal'}
    footprint = collections.defaultdict(C)
    in_layer = collections.defaultdict(C)
    agreement = collections.defaultdict(C)
    number_check = collections.defaultdict(C)
    gain = collections.defaultdict(C)
    card_only, containment_only = [], []
    for key in release:
        city, lv, houses = city_of(key), level_of(key), inside.get(key, set())
        sources = {s: rows for s, rows in evidence.get(key, {}).items() if any(ids for ids, _ in rows)}
        footprint['one' if len(houses) == 1 else 'several' if houses else 'none'][city] += 1
        for source, rows in sources.items():
            for house in urbi_of(rows):
                in_layer[source]['in_layer' if house in layer else 'ambiguous_in_layer' if house in ambiguous else 'not_in_layer'] += 1
            urbi = urbi_of(rows)
            # agreement only for an id the layer names unambiguously; the others are counted above
            if lv != 'conflict' and len(urbi) == 1 and next(iter(urbi)) in layer:
                house = next(iter(urbi))
                agreement[source]['same' if house in houses else 'different' if houses else 'no_footprint_at_point'] += 1
        urbi = urbi_of([row for rows in sources.values() for row in rows])
        if lv != 'conflict' and len(urbi) == 1 and next(iter(urbi)) in layer:
            number, post, _ = layer[next(iter(urbi))]
            stated = numbers_of([row for rows in sources.values() for row in rows])
            if stated:
                number_check['agree' if f'{number}/{post}' in stated else 'layer_has_no_number' if not (number and post) else 'differ'][city] += 1
        if lv == 'none':
            gain['containment_one_building' if len(houses) == 1 else 'containment_several_buildings' if houses else 'no_footprint'][city] += 1
            if len(houses) == 1:
                containment_only.append((key, next(iter(houses))))
        if set(sources) == {'urbi_card_building'} and lv == 'building':
            card_only.append((key, next(iter(urbi))))
            gain['new_from_card_crosswalk'][city] += 1

    out = {
        'inputs_sha256': {'buildings': sha256(args.buildings), 'card_links': sha256(args.card_links) if args.card_links else None},
        'layer_rows': db.execute("select count(*) from read_parquet(?)", [args.buildings]).fetchone()[0],
        'layer_unique_house_ids': len(layer), 'layer_ambiguous_house_ids_left_out': len(ambiguous),
        # 2GIS fields that could carry a unit or a floor count; empty means the layer cannot give the unit level
        'layer_fields_filled': dict(zip(('number', 'post_index', 'number_and_post_index', 'apartments', 'entrances', 'elevation'), db.execute(
            """select count(*) filter (where nullif(trim(Number), '') is not null), count(*) filter (where nullif(trim(PostIndex), '') is not null),
                      count(*) filter (where nullif(trim(Number), '') is not null and nullif(trim(PostIndex), '') is not null),
                      count(*) filter (where nullif(trim(Apartments::varchar), '') is not null), count(*) filter (where nullif(trim(Entrances::varchar), '') is not null),
                      count(*) filter (where nullif(trim(Elevation::varchar), '') is not null) from read_parquet(?)""", [args.buildings]).fetchone())),
        'points_by_footprint': dict(footprint),
        'urbi_ids_found_in_layer_by_source': {s: dict(v) for s, v in in_layer.items()},
        'explicit_urbi_vs_footprint_at_point_by_source': {s: dict(v) for s, v in agreement.items()},
        'layer_number_postal_vs_stated': dict(number_check),
        'net_gain_for_businesses_without_evidence': dict(gain),
    }

    if args.urbi:
        # the workbook's float id loses the last digit: the exact id is the one layer id with the same float whose
        # footprint holds the branch point
        same_float = C(float(h) for h in layer)
        sheet = [i for i, n in enumerate(ET.fromstring(zipfile.ZipFile(args.urbi).read('xl/workbook.xml')).find('m:sheets', NS)) if n.get('name') == 'data'][0]
        rows = []
        for i, row in enumerate(xlsx_rows(args.urbi, sheet_index=sheet)):
            try:
                rows.append((i, float(row['Longitude']), float(row['Latitude']), float(row['Building ID']), floor_of({'floor': row.get('Floor')}) is not None))
            except (KeyError, ValueError, TypeError):
                continue
        db.execute("create table w(i integer, lon double, lat double, fid double, has_floor boolean)")
        db.executemany("insert into w values (?, ?, ?, ?, ?)", rows)
        hits = C(i for (i,) in db.execute("select w.i from w join b on ST_Contains(b.g, ST_Point(w.lon, w.lat)) where b.h::double = w.fid").fetchall())
        floors = {i for i, *_, f in rows if f}
        out['urbi_workbook_ids_recovered'] = {
            'rows_with_float_id': len(rows),
            'float_shared_by_several_layer_ids': sum(same_float.get(fid, 0) > 1 for _, _, _, fid, _ in rows),
            'recovered_exactly_one': sum(hits.get(i) == 1 for i, *_ in rows),
            'recovered_with_floor': sum(hits.get(i) == 1 and i in floors for i, *_ in rows),
            'not_recovered': sum(i not in hits for i, *_ in rows),
            'note': 'recovered ids name the branch building; the branch has no key to the release, so a business link stays a candidate',
        }

    if args.osm:
        osm = collections.defaultdict(C)
        tags = db.execute("""select m.poi_key, o.tags['addr:housenumber'], o.tags['addr:postcode'], coalesce(o.tags['addr:floor'], o.tags['level']),
                                    o.tags['addr:unit'] from read_parquet(?) m join read_parquet(?) o on o.id = m.osm_id""",
                          [f'{args.data}/enrich/osm_poi_match.parquet', args.osm]).fetchall()
        for key, number, postal, floor, unit in tags:
            if key not in release:
                continue
            city, lv = city_of(key), level_of(key)
            ids = building_ids({'building_no': number, 'postal_code': postal})
            stated = numbers_of([row for rows in evidence.get(key, {}).values() for row in rows])
            osm['matched'][city] += 1
            if ids:
                osm['number_postal'][city] += 1
                osm['number_postal_new' if lv == 'none' else 'number_postal_agrees' if ids['number_postal'] in stated
                    else 'number_postal_differs' if stated else 'number_postal_other_kind_only'][city] += 1
            if floor_of({'floor': floor}):
                osm['floor'][city] += 1
            if clean(unit):
                osm['unit'][city] += 1
        whole = db.execute("""select count(*) filter (where tags['addr:unit'] is not null), count(*) filter (where tags['addr:floor'] is not null),
                                     count(*) filter (where tags['level'] is not null),
                                     count(*) filter (where tags['addr:housenumber'] is not null and tags['addr:postcode'] is not null)
                              from read_parquet(?)""", [args.osm]).fetchone()
        out['osm_candidates'] = dict(osm)
        out['osm_whole_extract_nodes_with'] = dict(zip(('addr_unit', 'addr_floor', 'level', 'housenumber_and_postcode'), whole))

    if args.sample_out:
        # a fixed seed so the sample can be drawn again; 300 per stratum is the size section 6 sets for a 0.95 rule
        draw = random.Random(20261029)
        sample = [('card_crosswalk_only', k, h) for k, h in draw.sample(sorted(card_only), min(args.sample_size, len(card_only)))]
        sample += [('containment_only', k, h) for k, h in draw.sample(sorted(containment_only), min(args.sample_size, len(containment_only)))]
        names = {k: rest for k, *rest in db.execute(
            "select poi_key, city_en, name_ar, name_en, latitude, longitude from read_parquet(?) where poi_key in (select unnest(?))",
            [args.release, [k for _, k, _ in sample]]).fetchall()}
        with open(args.sample_out, 'w', newline='', encoding='utf-8') as handle:
            writer = csv.writer(handle)
            writer.writerow(['stratum', 'poi_key', 'city_en', 'name_ar', 'name_en', 'latitude', 'longitude', 'proposed_house_id',
                             'building_number', 'post_index', 'building_purpose', 'review_same_building', 'review_note'])
            for stratum, key, house in sample:
                number, post, purpose = layer.get(house, (None, None, None))
                writer.writerow([stratum, key, *names.get(key, [None] * 5), house, number, post, purpose, '', ''])
        out['review_sample'] = {'strata': dict(C(s for s, _, _ in sample)), 'seed': 20261029, 'reviewed': 0}
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--trx')
    parser.add_argument('--survey')
    parser.add_argument('--urbi')
    parser.add_argument('--buildings')
    parser.add_argument('--card-links')
    parser.add_argument('--osm')
    parser.add_argument('--crs-db')
    parser.add_argument('--sample-out')
    parser.add_argument('--sample-size', type=int, default=300)
    args = parser.parse_args()
    db = duckdb.connect()

    release = {key: (city or '', hh) for key, city, hh in db.execute(
        "select poi_key, city_en, cast(hudhud_id as varchar) from read_parquet(?)", [args.release]).fetchall()}
    by_hudhud = {digits(hh): key for key, (_, hh) in release.items() if hh}
    # per business, per source: every (building ids, floor) row; a source can hold several rows for one business
    evidence = collections.defaultdict(lambda: collections.defaultdict(list))

    def add(source, key, row):
        if key not in release:
            return
        ids = building_ids(row)
        floor = floor_of(row) if ids else None
        if ids or floor:
            evidence[key][source].append((ids, floor))

    for key, number, address, postal, floor in db.execute(
            "select poi_key, building_no, national_address, postal_code, floor_no from read_parquet(?)", [args.release]).fetchall():
        add('release', key, {'building_no': number, 'national_address': address, 'postal_code': postal, 'floor': floor})
    for key, makani in db.execute(
            f"select poi_key, makani from read_parquet('{args.data}/golden/golden_set.parquet') where in_golden").fetchall():
        add('golden_set_makani', key, {'makani': makani})
    for key, address, number, postal, floor in db.execute(
            f"select poi_key, national_address, building_no, postal_code, floorno from read_parquet('{args.data}/enrich/crs_latest.parquet')").fetchall():
        add('hudhud_crs_latest', key, {'national_address': address, 'building_no': number, 'postal_code': postal, 'floor': floor})
    for name in ('cleaned_data_attrs', 'western_cleaning_attrs'):
        for key, urbi, number, makani, floor in db.execute(
                f"select poi_key, building_id, building_number, makani, floor from read_parquet('{args.data}/enrich/{name}.parquet')").fetchall():
            add(name, key, {'urbi_building_id': urbi, 'building_no': number, 'makani': makani, 'floor': floor})
    if args.trx:
        for row in xlsx_rows(args.trx):
            key = by_hudhud.get(digits(row.get('id')))
            if key:
                add('trx_2024_12', key, {'national_address': row.get('national_address'), 'building_no': row.get('building_no'),
                                         'postal_code': row.get('postal_code'), 'hudhud_building_id': row.get('building_id'),
                                         'physical_parent': row.get('physical_parent'), 'floor': row.get('floorno')})
    if args.card_links:
        # the 2GIS card id is the key itself; the vendor crosswalk names its building (one building per card)
        cards = {card: house for card, house in db.execute(
            "select source_coordinate_id, building_house_id from read_csv(?, all_varchar=true, header=true)", [args.card_links]).fetchall()}
        for key in release:
            prefix, _, card = key.partition(':')
            if prefix in CARD_KEYS and card in cards:
                add('urbi_card_building', key, {'urbi_building_id': cards[card]})
    if args.crs_db:
        # the full HudHud change-request database: each place's current state (trx_*), the same on every CR of it
        db.execute(f"attach '{args.crs_db}' as crs (read_only)")
        for hid, address, number, postal, floor, parent in db.execute("""select split_part(cr_entity_id::varchar, '.', 1),
                any_value(trx_national_address), any_value(trx_building_no)::varchar, any_value(trx_postal_code)::varchar,
                any_value(trx_floorno)::varchar, any_value(trx_physical_parent)::varchar from crs.crs group by 1""").fetchall():
            key = by_hudhud.get(hid)
            if key:
                add('hudhud_cr_current', key, {'national_address': address, 'building_no': number, 'postal_code': postal,
                                               'physical_parent': parent, 'floor': floor})
    survey_rows = 0
    if args.survey:
        db.execute('LOAD spatial')
        gdb = [n for n in zipfile.ZipFile(args.survey).namelist() if '.gdb/' in n][0].split('.gdb/')[0] + '.gdb'
        for poi, number, floor in db.execute(
                f"select selected_poi, building_number, floor_number from ST_Read('/vsizip/{args.survey}/{gdb}', layer='poi_field_survey_v2')").fetchall():
            survey_rows += 1
            key = by_hudhud.get(digits(poi))
            if key and BUILDING_NO.match(digits(number)):
                # the surveyor's building number has no postal code: it names a building only with the release's postal code
                evidence[key]['field_survey'].append(({'survey_building_no': digits(number)}, floor_of({'floor': floor})))

    # Urbi brand branches: no key to the release, so a same-name branch within 50 m is a candidate only
    urbi_candidates = collections.Counter()
    urbi_float_ids = 0
    if args.urbi:
        points = collections.defaultdict(list)
        for key, city, lat, lon, ar, en in db.execute(
                "select poi_key, city_en, latitude, longitude, name_ar, name_en from read_parquet(?) where latitude is not null", [args.release]).fetchall():
            points[(round(lat, 3), round(lon, 3))].append((key, city or '', lat, lon, (ar or '').strip(), (en or '').strip().lower()))
        for row in xlsx_rows(args.urbi, sheet_index=[i for i, n in enumerate(ET.fromstring(zipfile.ZipFile(args.urbi).read('xl/workbook.xml')).find('m:sheets', NS)) if n.get('name') == 'data'][0]):
            try:
                lat, lon = float(row['Latitude']), float(row['Longitude'])
            except (KeyError, ValueError):
                continue
            # the workbook stores the 17-digit building id as a float («7.003007620190968E+16»), so its last digit is
            # lost: the id cannot be joined exactly, and the branch is only a spatial candidate
            if not clean(row.get('Building ID')):
                continue
            urbi_float_ids += 'E+' in str(row.get('Building ID'))
            names = {(row.get('Name Arabic') or '').split(',')[0].strip(), (row.get('Name') or '').split(',')[0].strip().lower()} - {''}
            for dy in (-0.001, 0, 0.001):
                for dx in (-0.001, 0, 0.001):
                    for key, city, plat, plon, ar, en in points.get((round(lat + dy, 3), round(lon + dx, 3)), ()):
                        if (ar in names or en in names) and metres(lat, lon, plat, plon) <= 50:
                            urbi_candidates[city if city in CITIES else 'other'] += 1

    # a surveyor's building number without a postal code is not unique across the city: kept, but not a building id
    explicit = lambda ids: {k: v for k, v in ids.items() if k != 'survey_building_no'}

    def conflicts(sources):
        """Kinds that carry two different values for one business, across sources and within one source."""
        seen = collections.defaultdict(set)
        floors = set()
        for rows in sources.values():
            for ids, floor in rows:
                for kind, value in explicit(ids).items():
                    seen[kind].add(value)
                if floor:
                    floors.add(floor)
        return [kind for kind, values in seen.items() if len(values) > 1] + (['floor'] if len(floors) > 1 else [])

    def level(sources, clash):
        """A building conflict is unresolved evidence, never a level; a floor conflict keeps the building level only."""
        if any(kind != 'floor' for kind in clash):
            return 'conflict'
        rows = [(explicit(ids), floor) for rows in sources.values() for ids, floor in rows]
        if any(ids and floor for ids, floor in rows) and 'floor' not in clash:
            return 'floor'
        return 'building' if any(ids for ids, _ in rows) else 'none'

    city_of = lambda key: release[key][0] if release[key][0] in CITIES else 'other'
    totals = collections.Counter(city_of(k) for k in release)
    levels = collections.defaultdict(collections.Counter)
    by_source = collections.defaultdict(collections.Counter)
    only_source = collections.defaultdict(collections.Counter)
    multi = collections.Counter()
    conflict = collections.defaultdict(collections.Counter)
    def sources_of(key):
        sources = {s: [row for row in rows if row[0]] for s, rows in evidence.get(key, {}).items()}
        return {s: rows for s, rows in sources.items() if rows}

    def level_of(key):
        sources = sources_of(key)
        return level(sources, conflicts(sources))

    for key in release:
        sources = sources_of(key)
        city = city_of(key)
        clash = conflicts(sources)
        levels[city][level(sources, clash)] += 1
        for kind in clash:
            conflict[kind][city] += 1
        for source in sources:
            by_source[source][city] += 1
        if len(sources) == 1:
            only_source[next(iter(sources))][city] += 1
        elif len(sources) > 1:
            multi[city] += 1

    share = lambda n, d: round(100 * n / d, 2) if d else None
    cities = list(CITIES) + ['other', 'all']
    total = lambda counter, c: sum(counter.values()) if c == 'all' else counter.get(c, 0)
    per_city = lambda counter: {c: total(counter, c) for c in cities}
    geo = geography(db, args, release, evidence, level_of, city_of, explicit) if args.buildings else None
    if geo:
        geo = {name: (per_city(v) if isinstance(v, collections.Counter) else
                      {k: per_city(w) for k, w in v.items()} if isinstance(v, dict) and v and all(isinstance(w, collections.Counter) for w in v.values())
                      else v) for name, v in geo.items()}
    out = {
        'release': args.release, 'rows': len(release),
        'rows_by_city': {c: total(totals, c) for c in cities},
        'survey_rows_read': survey_rows,
        'level_by_city': {c: {lv: {'n': n, 'pct': share(n, total(totals, c))}
                              for lv in ('unit', 'floor', 'building', 'conflict', 'none')
                              for n in [sum(levels[cc][lv] for cc in levels) if c == 'all' else levels[c][lv]]}
                          for c in cities},
        'source_coverage_by_city': {s: {c: {'n': total(v, c), 'pct': share(total(v, c), total(totals, c))} for c in cities} for s, v in by_source.items()},
        'source_only_evidence_by_city': {s: {c: total(v, c) for c in cities} for s, v in only_source.items()},
        'businesses_with_two_or_more_sources': {c: total(multi, c) for c in cities},
        'conflicts_by_kind_and_city': {k: {c: total(v, c) for c in cities} for k, v in conflict.items()},
        'candidates_spatial_not_counted': {
            'urbi_same_name_within_50m': {c: total(urbi_candidates, c) for c in cities},
            'urbi_building_ids_stored_as_float': urbi_float_ids,
        },
    }
    if geo:
        out['building_layer'] = geo
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
