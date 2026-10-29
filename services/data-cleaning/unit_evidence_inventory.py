"""Inventory of building and unit evidence for every business of a directory release (docs/establishment-lifecycle.md 3.2).

Read-only. Prints JSON of aggregate counts (no business rows). Denominator: every row of the release; percentages are
plain shares of it (no sampling, so no confidence interval). Run from the repository root:

    python3 -I services/data-cleaning/unit_evidence_inventory.py \
        --release /Users/m4pro/farq-taxonomy-data/export/targets_golden_z19.parquet \
        --data /Users/m4pro/farq-taxonomy-data \
        --trx trx_poi_202412311250.xlsx --survey finalgeo.zip --urbi "urbi brand (version 1)_1_20250305_085350.xlsx" \
        > docs/unit-evidence-inventory.json

Evidence levels, strongest first; a level counts only from an explicit field, each value checked by pattern:
- unit: a unit or shop number inside a building. No source carries one (`secondary_no` of the national address names
  the building, not the unit), so the level is reported and stays empty until a source adds it.
- floor: a valid floor value together with an explicit building identifier from the same source.
- building: an explicit building identifier: Urbi building id, HudHud building id, national short address, building
  number with postal code, Makani, or a HudHud physical parent (mall or complex).
- conflict: two different explicit building identifiers of one kind (across sources or within one); unresolved, so
  not counted as building evidence. Two different floors keep the building level only.
- none: no explicit building identifier in any source.
Spatial matches (a point inside a footprint, a branch within 50 m with the same name) are candidates, reported apart,
and never raise a level.
"""
import argparse
import collections
import json
import math
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--trx')
    parser.add_argument('--survey')
    parser.add_argument('--urbi')
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
    for key in release:
        sources = {s: [row for row in rows if row[0]] for s, rows in evidence.get(key, {}).items()}
        sources = {s: rows for s, rows in sources.items() if rows}
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
            'building_footprint_containment': 'not measured here: the building layer is on the service volume (build_business_building_links.py)',
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
