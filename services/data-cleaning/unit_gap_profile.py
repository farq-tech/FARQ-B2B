"""Spatial and linked building-evidence CANDIDATES for point businesses, and unit-number forms in their text
(docs/establishment-lifecycle.md 3.2.2). A cross-check next to unit_evidence_inventory.py (3.2.1), which counts
explicit evidence and footprint containment over the whole release: this adds per-row agreement and conflicts between
sources, multiple values within one source as conflicts, and unit-number forms in text.

Read-only: reads the golden set and the evidence files, prints JSON with aggregate counts per city (no business rows).
Needs duckdb with the spatial extension, so it runs without -I. From services/data-cleaning:

    python3 unit_gap_profile.py --golden golden/golden_set.parquet --crs enrich/crs_latest.parquet \
        --urbi enrich/cleaned_data_attrs.parquet --urbi enrich/western_cleaning_attrs.parquet \
        --fsq enrich/fsq_match.parquet --buildings Buildings.shp > ../../docs/unit-gap-figures.json

Population: rows of the given golden set with `in_golden` and `location_precision = 'point'`. It is NOT the whole
release that 3.2.1 counts (that one includes district/city reference points and is another export), so the shares
here are not comparable with 3.2.1 row for row.

Building-evidence candidates, one column each, kept apart so every figure says which source it rests on:
- footprint  the 2GIS footprint (`HouseId`) that contains the point. Spatial: a candidate by the 3.2.1 rule.
- urbi_id    the 2GIS building id of the matched Urbi card (pattern URBI_BUILDING). The card was matched to the row
             by name/phone and distance, so the link itself is a candidate until a sample checks it.
- sa_crs     short national address (pattern SHORT_ADDRESS) from the surveyor change request.
- sa_urbi    short national address in the Urbi card's `makani` column.
Every count of these is a count of candidates. None becomes the `building` level of 3.2.1 or `site_basis = unit`
here; that needs the validation sample of 3.2.2 (Wilson applies there, not to these full counts).

Figures:
- candidates: rows with at least one building-evidence candidate.
- exclusive_single_source: rows whose ONLY candidate is that source. Together with two_or_more_sources they add up
  to `candidates`. This is not the marginal gain of a source added after the others.
- conflict_among_candidates: candidate rows where comparable values disagree (footprint vs urbi_id, sa_crs vs
  sa_urbi, short address whose two farthest businesses are over SPREAD_M m apart (every business on that code),
  surveyor vs Urbi national building number).
  candidates = candidates_no_conflict + conflict_among_candidates (checked).
- conflict_without_candidate: rows with a disagreement but no single candidate: an Urbi card with two building ids
  (so no urbi_id), several distinct short addresses in one source (so no sa_*), a point inside several footprints
  (so no footprint), several building numbers in one source, or two national building numbers without a building candidate (a building number alone, without
  a postal code, is no building identifier by the 3.2.1 rule).
- agreement: on rows where two comparable values are both present, how many agree. A full count of that overlap, not
  a sample, and agreement, not precision.
- unit_text: a unit word WITH a number (محل/مكتب/وحدة/معرض … رقم 12, shop/unit/office/suite 12 …) in the name,
  address, street, description, trade name or legal name fields listed in TEXT_FIELDS. A text form, not a verified
  unit: names often number an organisation (a Hajj service office) rather than a unit.
- unit_field: a structured unit or shop number field. None of the inputs has one.
"""
import argparse
import json
import os
import sys

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from unit_evidence_inventory import FLOOR, SHORT_ADDRESS, URBI_BUILDING  # noqa: E402  one definition of each pattern

SPREAD_M = 150
FLOOR_EMPTY = "('', 'none', 'null', 'nan')"   # as unit_evidence_inventory.floor_of: 0 is the ground floor
UNIT_AR = r'(محل|المحل|وحدة|الوحدة|مكتب|المكتب|معرض|المعرض|شقة|الشقة|جناح|كشك|دكان|بسطة)\s*(رقم|ر\.|no\.?|#)?\s*[0-9٠-٩]{1,4}([^0-9٠-٩]|$)'
UNIT_EN = r'(?i)\b(shop|unit|office|suite|store|kiosk|booth|showroom|flat|apt|apartment|stall|ste)\b\.?\s*(no\.?|number|num|#)?\s*[0-9]{1,4}[a-z]?\b'
# field family -> (table alias, columns) of the text searched for unit_text
TEXT_FIELDS = {
    'name': ('g', ('name_ar', 'name_en', 'tradename', 'legal_name')),
    'address_street': ('g', ('street_ar', 'street_en', 'national_address')),
    'description': ('g', ('description_ar', 'description_en')),
    'foursquare_address': ('f', ('fsq_address',)),
    'urbi_card': ('u', ('brand_name', 'legal_name_ar', 'legal_name_en', 'street_ar', 'street_en')),
}


def sql_pattern(rx):
    return rx.pattern.replace('\\d', '[0-9]')


def figure(value, unit, denominator=None, excludes=None):
    out = {'value': value, 'unit': unit}
    if denominator is not None:
        out['denominator'] = denominator
    if excludes:
        out['excludes'] = excludes
    return out


def valid_floor(col):
    value = f"regexp_replace(trim(cast({col} as varchar)), '\\.0$', '')"   # floor_of strips a float's .0
    return f"(lower({value}) not in {FLOOR_EMPTY} and regexp_full_match({value}, '{sql_pattern(FLOOR)}', 'i'))"


def building_digits(col):
    """Digits of a building number, dropping a float's .0 first as unit_evidence_inventory.digits does (1234.0 -> 1234)."""
    text = f"regexp_replace(trim(cast({col} as varchar)), '\\.0$', '')"
    return f"nullif(regexp_replace({text}, '[^0-9]', '', 'g'), '')"


def one_value(expr):
    """(the value when the rows of one business carry exactly one, several distinct ones) for a non-empty expr."""
    return (f"case when count(distinct {expr}) = 1 then max({expr}) end", f"count(distinct {expr}) > 1")


def one_short_address(col):
    """The short address when the rows of one business carry exactly one; several distinct ones are a conflict."""
    code = f"upper(replace({col}, ' ', ''))"
    valid = f"regexp_full_match({code}, '{sql_pattern(SHORT_ADDRESS)}')"
    return (f"case when count(distinct {code}) filter (where {valid}) = 1 "
            f"then max({code}) filter (where {valid}) end",
            f"count(distinct {code}) filter (where {valid}) > 1")


def has_unit_text(cols):
    parts = [f"regexp_matches(coalesce(cast({c} as varchar), ''), '{p}')" for c in cols for p in (UNIT_AR, UNIT_EN)]
    return '(' + ' or '.join(parts) + ')'


def build(c, a):
    c.execute('load spatial')
    urbi_rx = sql_pattern(URBI_BUILDING)
    crs_sa, crs_sa_multi = one_short_address('national_address')
    urbi_sa, urbi_sa_multi = one_short_address('makani')
    crs_bno, crs_bno_multi = one_value(building_digits('building_no'))
    urbi_bno, urbi_bno_multi = one_value(building_digits('building_number'))
    g_text = ', '.join(sorted({col for alias, cols in TEXT_FIELDS.values() if alias == 'g' for col in cols}))
    c.execute(f"""create temp table pts as
        select poi_key, coalesce(city_en, 'unknown') as city, latitude as lat, longitude as lon, {g_text}
        from read_parquet('{a.golden}') where in_golden and location_precision = 'point'
          and latitude is not null and longitude is not null""")
    c.execute(f"""create temp table crs as
        select poi_key,
               {crs_sa} as sa_crs, {crs_sa_multi} as sa_crs_multi,
               {crs_bno} as bno_crs, {crs_bno_multi} as bno_crs_multi,
               bool_or({valid_floor('floorno')}) as floor_crs
        from read_parquet('{a.crs}') group by poi_key""")
    u_cols = TEXT_FIELDS['urbi_card'][1]
    urbi = ' union all '.join(
        f"select poi_key, cast(building_id as varchar) as building_id, cast(makani as varchar) as makani, "
        f"cast(floor as varchar) as floor, cast(building_number as varchar) as building_number, "
        + ', '.join(f'cast({col} as varchar) as {col}' for col in u_cols) + f" from read_parquet('{p}')" for p in a.urbi)
    c.execute(f"""create temp table urbi as
        select poi_key,
               case when count(distinct building_id) filter (where regexp_full_match(building_id, '{urbi_rx}')) = 1
                    then max(building_id) filter (where regexp_full_match(building_id, '{urbi_rx}')) end as urbi_id,
               count(distinct building_id) filter (where regexp_full_match(building_id, '{urbi_rx}')) > 1
                    as urbi_id_multi,
               {urbi_sa} as sa_urbi, {urbi_sa_multi} as sa_urbi_multi,
               bool_or({valid_floor('floor')}) as floor_urbi,
               {urbi_bno} as bno_urbi, {urbi_bno_multi} as bno_urbi_multi,
               bool_or({has_unit_text(u_cols)}) as text_urbi_card
        from ({urbi}) group by poi_key""")
    c.execute(f"""create temp table fsq as
        select poi_key, bool_or({has_unit_text(TEXT_FIELDS['foursquare_address'][1])}) as text_foursquare_address
        from read_parquet('{a.fsq}') where fsq_address is not null group by poi_key""")
    shp = a.buildings.lower().endswith('.shp')
    src = f"st_read('{a.buildings}')" if shp else f"read_parquet('{a.buildings}')"
    if shp:
        geom = 'geom'
    else:   # duckdb writes the wkb column as GeoParquet and reads it back as GEOMETRY
        kind = {row[0]: row[1] for row in c.execute(f'describe select * from {src}').fetchall()}['wkb']
        geom = 'wkb' if kind == 'GEOMETRY' else 'st_geomfromwkb(wkb)'
    hid = 'HouseId' if shp else 'house_id'
    c.execute(f"""create temp table bld as
        select cast({hid} as varchar) as house_id, {geom} as geom from {src} where {geom} is not null""")
    c.execute("""create temp table pip as
        select p.poi_key, min(b.house_id) as footprint, count(distinct b.house_id) as n_fp
        from pts p join bld b on st_contains(b.geom, st_point(p.lon, p.lat)) group by p.poi_key""")
    g_flags = ', '.join(f'{has_unit_text(cols)} as text_{fam}'
                        for fam, (alias, cols) in TEXT_FIELDS.items() if alias == 'g')
    c.execute(f"""create temp table ev as
        select p.poi_key, p.city, p.lat, p.lon, {g_flags},
               case when pip.n_fp = 1 then pip.footprint end as footprint,
               coalesce(pip.n_fp, 0) > 1 as fp_multi,
               coalesce(u.bno_urbi_multi, false) or coalesce(r.bno_crs_multi, false) as bno_multi,
               u.urbi_id, coalesce(u.urbi_id_multi, false) as urbi_id_multi, u.sa_urbi, u.bno_urbi,
               coalesce(u.sa_urbi_multi, false) or coalesce(r.sa_crs_multi, false) as sa_multi,
               r.sa_crs, r.bno_crs,
               coalesce(r.floor_crs, false) or coalesce(u.floor_urbi, false) as has_floor,
               coalesce(u.text_urbi_card, false) as text_urbi_card,
               coalesce(f.text_foursquare_address, false) as text_foursquare_address
        from pts p left join pip using (poi_key) left join urbi u using (poi_key)
             left join crs r using (poi_key) left join fsq f using (poi_key)""")
    # A short address names one building, so when the FARTHEST pair of its businesses is more than SPREAD_M metres
    # apart the code is in doubt for every business on it (not only for the ones far from a centre).
    c.execute(f"""create temp table sa_spread as
        with s as (select poi_key, lat, lon, sa_crs as code from ev where sa_crs is not null
                   union select poi_key, lat, lon, sa_urbi from ev where sa_urbi is not null),
             far as (select a.code   -- st_distance_sphere takes (lat, lon); st_contains above stays x = lon
                     from s a join s b on a.code = b.code and a.poi_key < b.poi_key
                     group by a.code
                     having max(st_distance_sphere(st_point(a.lat, a.lon), st_point(b.lat, b.lon))) > {SPREAD_M})
        select distinct s.poi_key from s join far using (code)""")
    c.execute("""create temp table occ as select footprint, count(*) as occupants from ev
                 where footprint is not null group by footprint""")
    any_text = ' or '.join(f'text_{fam}' for fam in TEXT_FIELDS)
    c.execute(f"""create temp table r2 as
        with x as (
            select e.*,
                   e.footprint is not null and e.urbi_id is not null and e.footprint <> e.urbi_id as x_fp_urbi,
                   e.footprint is not null and e.urbi_id is not null and e.footprint = e.urbi_id as a_fp_urbi,
                   e.sa_crs is not null and e.sa_urbi is not null and e.sa_crs <> e.sa_urbi as x_sa,
                   e.sa_crs is not null and e.sa_urbi is not null and e.sa_crs = e.sa_urbi as a_sa,
                   e.bno_crs is not null and e.bno_urbi is not null and e.bno_crs <> e.bno_urbi as x_bno,
                   e.bno_crs is not null and e.bno_urbi is not null and e.bno_crs = e.bno_urbi as a_bno,
                   s.poi_key is not null as x_spread,
                   (e.footprint is not null)::int + (e.urbi_id is not null)::int
                     + (e.sa_crs is not null)::int + (e.sa_urbi is not null)::int as n_sources,
                   o.occupants, ({any_text}) as unit_text
            from ev e left join sa_spread s using (poi_key) left join occ o using (footprint))
        select *, n_sources > 0 as candidate,
               x_fp_urbi or x_sa or x_bno or x_spread or urbi_id_multi or sa_multi or bno_multi or fp_multi
                 as conflict from x""")


def per_city(c, where):
    text_counts = ',\n        '.join(f'count(*) filter (where text_{fam}) as text_{fam}' for fam in TEXT_FIELDS)
    q = f"""select
        count(*) as points,
        count(*) filter (where candidate) as candidates,
        count(*) filter (where candidate and not conflict) as candidates_no_conflict,
        count(*) filter (where candidate and conflict) as conflict_among_candidates,
        count(*) filter (where not candidate and conflict) as conflict_without_candidate,
        count(*) filter (where not candidate and urbi_id_multi) as wo_urbi_card_two_buildings,
        count(*) filter (where not candidate and x_bno) as wo_building_no,
        count(*) filter (where not candidate and sa_multi) as wo_sa_multi,
        count(*) filter (where not candidate and bno_multi) as wo_bno_multi,
        count(*) filter (where not candidate and fp_multi) as wo_fp_multi,
        count(*) filter (where footprint is not null) as src_footprint,
        count(*) filter (where urbi_id is not null) as src_urbi_id,
        count(*) filter (where sa_crs is not null) as src_sa_crs,
        count(*) filter (where sa_urbi is not null) as src_sa_urbi,
        count(*) filter (where n_sources = 1 and footprint is not null) as only_footprint,
        count(*) filter (where n_sources = 1 and urbi_id is not null) as only_urbi_id,
        count(*) filter (where n_sources = 1 and sa_crs is not null) as only_sa_crs,
        count(*) filter (where n_sources = 1 and sa_urbi is not null) as only_sa_urbi,
        count(*) filter (where n_sources >= 2) as two_or_more_sources,
        count(*) filter (where a_fp_urbi) as agree_fp_urbi, count(*) filter (where x_fp_urbi) as disagree_fp_urbi,
        count(*) filter (where a_sa) as agree_sa, count(*) filter (where x_sa) as disagree_sa,
        count(*) filter (where a_bno) as agree_bno, count(*) filter (where x_bno) as disagree_bno,
        count(*) filter (where candidate and x_fp_urbi) as c_fp_urbi,
        count(*) filter (where candidate and x_sa) as c_sa,
        count(*) filter (where candidate and x_spread) as c_spread,
        count(*) filter (where candidate and x_bno) as c_bno,
        count(*) filter (where candidate and urbi_id_multi) as c_urbi_multi,
        count(*) filter (where candidate and sa_multi) as c_sa_multi,
        count(*) filter (where candidate and bno_multi) as c_bno_multi,
        count(*) filter (where candidate and fp_multi) as c_fp_multi,
        count(*) filter (where candidate and not conflict and has_floor) as cand_floor,
        count(*) filter (where candidate and not conflict and unit_text) as cand_unit_text,
        count(*) filter (where footprint is not null and occupants = 1 and not conflict) as cand_sole_occupant,
        count(*) filter (where unit_text) as unit_text_any,
        count(*) filter (where unit_text and not text_name) as unit_text_outside_names,
        {text_counts}
        from r2 where {where}"""
    cur = c.execute(q)
    raw = dict(zip([d[0] for d in cur.description], cur.fetchone()))
    if raw['candidates'] != raw['candidates_no_conflict'] + raw['conflict_among_candidates']:
        raise SystemExit(f'candidates do not add up: {raw}')
    if raw['candidates'] != sum(raw[f'only_{k}'] for k in ('footprint', 'urbi_id', 'sa_crs', 'sa_urbi')) \
            + raw['two_or_more_sources']:
        raise SystemExit(f'exclusive + multi-source do not add up: {raw}')
    return raw


def shape(raw):
    n = raw['points']
    cand = raw['candidates']
    sources = ('footprint', 'urbi_id', 'sa_crs', 'sa_urbi')

    def agreement(a, x):
        return figure(a, 'row', a + x, 'rows where either value is missing') if a + x else figure(None, 'row', 0)

    return {
        'points': figure(n, 'row', excludes='not in_golden; district/city precision; not the 3.2.1 release'),
        'candidates': figure(cand, 'row', n),
        'candidates_no_conflict': figure(raw['candidates_no_conflict'], 'row', n),
        'conflict_among_candidates': figure(raw['conflict_among_candidates'], 'row', n),
        'conflict_without_candidate': figure(raw['conflict_without_candidate'], 'row', n, 'rows with a candidate'),
        'conflict_without_candidate_by_kind': {
            'urbi_card_two_building_ids': figure(raw['wo_urbi_card_two_buildings'], 'row', n),
            'national_building_no': figure(raw['wo_building_no'], 'row', n),
            'several_short_addresses': figure(raw['wo_sa_multi'], 'row', n),
            'several_national_building_nos': figure(raw['wo_bno_multi'], 'row', n),
            'point_in_several_footprints': figure(raw['wo_fp_multi'], 'row', n),
        },
        'by_source': {k: figure(raw[f'src_{k}'], 'row', n) for k in sources},
        'exclusive_single_source': {k: figure(raw[f'only_{k}'], 'row', cand) for k in sources},
        'two_or_more_sources': figure(raw['two_or_more_sources'], 'row', cand),
        'agreement': {
            'footprint_vs_urbi_id': agreement(raw['agree_fp_urbi'], raw['disagree_fp_urbi']),
            'sa_crs_vs_sa_urbi': agreement(raw['agree_sa'], raw['disagree_sa']),
            'surveyor_vs_urbi_national_building_no': agreement(raw['agree_bno'], raw['disagree_bno']),
        },
        'conflict_among_candidates_by_kind': {
            'footprint_vs_urbi_id': figure(raw['c_fp_urbi'], 'row', cand),
            'sa_crs_vs_sa_urbi': figure(raw['c_sa'], 'row', cand),
            f'short_address_spread_over_{SPREAD_M}m': figure(raw['c_spread'], 'row', cand),
            'national_building_no': figure(raw['c_bno'], 'row', cand),
            'urbi_card_two_building_ids': figure(raw['c_urbi_multi'], 'row', cand),
            'several_short_addresses': figure(raw['c_sa_multi'], 'row', cand),
            'several_national_building_nos': figure(raw['c_bno_multi'], 'row', cand),
            'point_in_several_footprints': figure(raw['c_fp_multi'], 'row', cand),
        },
        'unit_candidates': {
            'candidate_building_plus_valid_floor': figure(raw['cand_floor'], 'row', n),
            'candidate_building_plus_unit_text': figure(raw['cand_unit_text'], 'row', n),
            'sole_targetable_occupant_of_footprint': figure(raw['cand_sole_occupant'], 'row', n),
        },
        'unit_text': {
            'any_field': figure(raw['unit_text_any'], 'row', n),
            'outside_name_fields': figure(raw['unit_text_outside_names'], 'row', n),
            **{f'field_{fam}': figure(raw[f'text_{fam}'], 'row', n) for fam in TEXT_FIELDS},
        },
        'unit_field': figure(0, 'row', n, 'no structured unit or shop number field in the inputs'),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--golden', required=True)
    ap.add_argument('--crs', required=True)
    ap.add_argument('--urbi', action='append', required=True)
    ap.add_argument('--fsq', required=True)
    ap.add_argument('--buildings', required=True, help='Buildings.shp, or a parquet with house_id and wkb')
    ap.add_argument('--min-points', type=int, default=20000, help='cities below this are reported together')
    a = ap.parse_args()
    c = duckdb.connect()
    build(c, a)
    cities = [r[0] for r in c.execute(
        'select city from r2 group by city having count(*) >= ? order by count(*) desc', [a.min_points]).fetchall()]
    covered = {r[0] for r in c.execute('select distinct city from r2 where footprint is not null').fetchall()}

    def literal(text):
        return "'" + text.replace("'", "''") + "'"

    out = {
        'definitions': __doc__.split('Building-evidence candidates,')[1].strip(),
        'text_fields': {fam: list(cols) for fam, (_, cols) in TEXT_FIELDS.items()},
        'all': shape(per_city(c, 'true')),
        'cities': {},
        'other_cities': shape(per_city(c, f"city not in ({', '.join(map(literal, cities))})")) if cities else None,
    }
    for city in cities:
        row = shape(per_city(c, f'city = {literal(city)}'))
        row['footprints_cover_city'] = city in covered
        out['cities'][city] = row
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
