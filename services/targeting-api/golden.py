"""The golden population table: one figure per canonical district, with its source, that every screen reads.

Districts are golden in canonical_data (one outline and one name per district, edited only through
district_corrections.json) and the directory is golden in its canonical copy. Population had three sources read
in different places; this module is the single place that decides, per district, in this order:

1. 910ths.sa, where it publishes a usable district figure (district_reference): total and male share. A total shared
   by multiple Atlas districts is used only when complete weights can split it once across all expected parts.
2. The building model, where its district total is calibrated on 910ths districts of the same city
   (build_building_population, calibration_source starting with "910ths").
3. WorldPop 2025.

Age groups always add up to the chosen total (WorldPop's age shape, a regional table, scaled to it). Male and
female are given only where 910ths measured them; elsewhere they are unavailable, because WorldPop's split is the
same regional figure in every district.
"""
import math

import district_reference

BUILDINGS = 'farq_buildings_v3'
WORLDPOP = 'WorldPop 2025'   # one label per source on every row, whatever id the source file carries
MIN_HOUSING_UNITS = 200


def housing(rows, id_map, names, min_units=MIN_HOUSING_UNITS):
    """One housing-level row per canonical district, built from classified dwelling-unit estimates.

    `rows` contains one record per source polygon. Villa and classified-home counts share the same modeled unit
    basis; unknown home types are excluded. Old parquet schemas are rejected by the file reader before this call.
    """
    merged, invalid = {}, set()
    for district_id, district_ar, villa_units, classified_units in rows:
        canonical = str(id_map.get(str(district_id), district_id))
        valid_units = all(type(value) in (int, float) and math.isfinite(value) and value >= 0
                          for value in (villa_units, classified_units))
        if not valid_units or villa_units > classified_units:
            invalid.add(canonical)
            continue
        out = merged.setdefault(canonical, {
            'district_id': canonical,
            'district_ar': names.get(canonical, (district_ar, None))[0] or district_ar,
            'villa_units': 0.0,
            'classified_home_units': 0.0,
        })
        out['villa_units'] += float(villa_units)
        out['classified_home_units'] += float(classified_units)

    result = []
    for row in merged.values():
        if row['district_id'] in invalid or row['classified_home_units'] < min_units:
            continue
        row['villa_share_pct'] = round(100 * row['villa_units'] / row['classified_home_units'], 1)
        row['villa_units'] = round(row['villa_units'])
        row['classified_home_units'] = round(row['classified_home_units'])
        result.append(row)
    result.sort(key=lambda row: (-row['villa_share_pct'], row['district_ar'] or ''))
    return result


def building_totals(rows, id_map):
    """{canonical id: population} from building-model rows (district_id, population_estimate, calibration_source),
    summed over a district's polygons; a district counts only when every polygon is calibrated on 910ths."""
    totals, eligible = {}, {}
    for district_id, population, source in rows:
        canonical = str(id_map.get(str(district_id), district_id))
        ok = population is not None and str(source or '').startswith(district_reference.SOURCE)
        totals[canonical] = totals.get(canonical, 0.0) + float(population or 0)
        eligible[canonical] = eligible.get(canonical, True) and ok
    return {key: value for key, value in totals.items() if eligible[key]}


def _has_population(row):
    """A measured zero is a population value; only missing or malformed figures fall through."""
    value = row.get('population') if isinstance(row, dict) else None
    if type(value) not in (int, float) or value < 0:
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _shared_split(rows, reference, buildings):
    """{id(row): population} for districts that share one 910ths figure (reference rows with shared_with): the total
    is split by complete, positive building weights, else complete, positive WorldPop weights. If expected parts or
    usable weights are missing, no shared total is assigned and each part keeps its own WorldPop measurement."""
    groups = {}
    for row in rows:
        ref = reference.get(row.get('district_ar'))
        if ref and _has_population(ref) and ref.get('shared_with'):
            groups.setdefault(tuple(ref['shared_with']), []).append(row)
    shares = {}
    for names, members in groups.items():
        expected_names = set(names)
        member_names = [row.get('district_ar') for row in members]
        # A shared reference total cannot be assigned over only the parts that happened to arrive in this table.
        if len(members) != len(expected_names) or set(member_names) != expected_names:
            continue
        built = [buildings.get(str(row.get('district_id'))) for row in members]
        figure = float(reference[members[0]['district_ar']]['population'])
        building_weights_valid = all(type(value) in (int, float) and math.isfinite(value) and value >= 0 for value in built)
        worldpop_weights_valid = all(_has_population(row) for row in members)
        building_weights = [float(value) for value in built] if building_weights_valid else []
        worldpop_weights = [float(row['population']) for row in members] if worldpop_weights_valid else []
        if building_weights and sum(building_weights) > 0:
            weights = building_weights
        elif worldpop_weights and sum(worldpop_weights) > 0:
            weights = worldpop_weights
        elif figure == 0 and building_weights_valid and building_weights and sum(building_weights) == 0:
            weights = building_weights
        elif figure == 0 and worldpop_weights_valid and worldpop_weights and sum(worldpop_weights) == 0:
            weights = worldpop_weights
        else:
            continue
        total = sum(weights)
        if total == 0:
            for row in members:
                shares[id(row)] = 0.0
            continue
        for row, weight in zip(members, weights):
            shares[id(row)] = figure * weight / total
    return shares


def population(rows, city, buildings=None, path=district_reference.PATH):
    """Merged WorldPop district rows (canonical_data.merge_population_rows) with the golden total and its source.
    Atlas keeps only rows with a numeric year and coverage, so a non-WorldPop figure carries both."""
    reference = district_reference.city_rows(city, path)
    year = district_reference.reference_year(path)
    buildings = buildings or {}
    shares = _shared_split(rows, reference, buildings)
    for row in rows:
        ref = reference.get(row.get('district_ar'))
        built = buildings.get(str(row.get('district_id')))
        if ref and _has_population(ref):
            if ref.get('shared_with'):
                figure = shares.get(id(row))
                if figure is None:
                    # Preserve a measured WorldPop row when the shared 910ths total cannot be split completely.
                    row['source'] = WORLDPOP
                    continue
            else:
                figure = float(ref['population'])
            # whole people: a split share or a building model gives fractions, and «58,770.9 ساكن» is not a count
            row.update(population=round(figure), source=district_reference.SOURCE, license=None,
                       year=year if year is not None else row.get('year'), coverage_pct=100.0)
        elif built is not None and round(built) > 0:
            row.update(population=round(built), source=BUILDINGS, license=None, coverage_pct=100.0)
        else:
            row['source'] = WORLDPOP
        # no model's 0 is a count of people (owner, 2026-11-02): a district that every source puts at 0 has no
        # figure, so it reads «غير متاح» on every screen instead of «السكان 0» and «ساكن لكل منشأة 0»
        if not row.get('population'):
            row['population'] = None
    return rows


def with_settled_share(rows):
    """Each row's `settled_pct`: the share of the district's grid cells the population grid holds as settled
    (valid_cells ÷ polygon_cells, the grid's own count, kept whatever source the total came from). A district settled
    over little of its area (وادي لبن: 2,309 of 5,519 cells, 42%) reads «light» per km² and «empty» inside its edge
    while its people live on a part of it. None without the cell counts. The figures themselves are not changed."""
    for row in rows:
        valid, cells = row.get('valid_cells'), row.get('polygon_cells')
        row['settled_pct'] = round(100.0 * float(valid) / float(cells)) if valid is not None and cells else None
    return rows


def population_by_name(rows, district_names):
    """Golden population map keyed by canonical name, retaining every city district as unavailable if absent."""
    result = {
        row['district_ar']: {'population': row.get('population'), 'male': None, 'female': None, 'source': row.get('source')}
        for row in rows or [] if row.get('district_ar')
    }
    for name in district_names:
        if name:
            result.setdefault(name, {'population': None, 'male': None, 'female': None, 'source': None})
    return result


def demographics(rows, totals, city, path=district_reference.PATH):
    """Merged by-age rows scaled so each district adds up to its golden total (`totals`: district name ->
    population). Male and female follow the 910ths male share where it is published and are None elsewhere."""
    reference = district_reference.city_rows(city, path)
    by_district = {}
    for row in rows:
        by_district.setdefault(row.get('district_ar'), []).append(row)
    for name, group in by_district.items():
        ages = [row for row in group if row.get('age_code') != 'ALL'] or group   # a district with only its ALL row
        complete_age_shape = bool(ages) and all(row.get('total') is not None for row in ages)
        model = sum(float(row['total']) for row in ages) if complete_age_shape else 0.0
        target = totals.get(name)
        ref = reference.get(name)
        share = float(ref['male_pct']) / 100 if ref and ref.get('male_pct') is not None else None
        complete_sex_shape = bool(ages) and all(row.get('male') is not None and row.get('female') is not None for row in ages)
        male = sum(float(row['male']) for row in ages) if complete_sex_shape else 0.0
        female = sum(float(row['female']) for row in ages) if complete_sex_shape else 0.0
        scale = (float(target) / model) if target is not None and model > 0 else 1.0
        for row in group:
            if row.get('age_code') == 'ALL':
                total = float(target) if target is not None else row.get('total')
            else:
                total = float(row['total']) * scale if complete_age_shape else None
            if share is not None and row.get('age_code') == 'ALL' and total is not None:
                row['male'], row['female'] = total * share, total * (1 - share)
                row['total'] = total
                row.update(source=district_reference.SOURCE + ' + WorldPop age shape', license=None)
            elif share is not None and complete_sex_shape and male > 0 and female > 0 and target is not None and row.get('age_code') != 'ALL':
                if total is not None:
                    row['male'] = float(row['male']) * float(target) * share / male
                    row['female'] = float(row['female']) * float(target) * (1 - share) / female
                    row['total'] = row['male'] + row['female']
                else:
                    row['male'] = row['female'] = None
                row.update(source=district_reference.SOURCE + ' + WorldPop age shape', license=None)
            elif row.get('age_code') != 'ALL':
                row['male'] = row['female'] = None
                row['total'] = total
                row['source'] = WORLDPOP + ' age shape'
            else:
                row['male'] = row['female'] = None
                row['total'] = total
                row['source'] = WORLDPOP + ' age shape'
    return rows
