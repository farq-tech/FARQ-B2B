"""The golden population table: one figure per canonical district, with its source, that every screen reads.

Districts are golden in canonical_data (one outline and one name per district, edited only through
district_corrections.json) and the directory is golden in its canonical copy. Population had three sources read
in different places; this module is the single place that decides, per district, in this order:

1. 910ths.sa, where it publishes the district (district_reference): total and male share.
2. The building model, where its district total is calibrated on 910ths districts of the same city
   (build_building_population, calibration_source starting with "910ths").
3. WorldPop 2025.

Age groups always add up to the chosen total (WorldPop's age shape, a regional table, scaled to it). Male and
female are given only where 910ths measured them; elsewhere they are unavailable, because WorldPop's split is the
same regional figure in every district.
"""
import district_reference

BUILDINGS = 'farq_buildings_v3'
WORLDPOP = 'WorldPop 2025'   # one label per source on every row, whatever id the source file carries


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


def population(rows, city, buildings=None, path=district_reference.PATH):
    """Merged WorldPop district rows (canonical_data.merge_population_rows) with the golden total and its source.
    Atlas keeps only rows with a numeric year and coverage, so a non-WorldPop figure carries both."""
    reference = district_reference.city_rows(city, path)
    year = district_reference.reference_year(path)
    buildings = buildings or {}
    for row in rows:
        ref = reference.get(row.get('district_ar'))
        built = buildings.get(str(row.get('district_id')))
        if ref and ref.get('population'):
            row.update(population=float(ref['population']), source=district_reference.SOURCE, license=None,
                       year=year if year is not None else row.get('year'), coverage_pct=100.0)
        elif built is not None:
            row.update(population=round(built, 1), source=BUILDINGS, license=None, coverage_pct=100.0)
        else:
            row['source'] = WORLDPOP
    return rows


def demographics(rows, totals, city, path=district_reference.PATH):
    """Merged by-age rows scaled so each district adds up to its golden total (`totals`: district name ->
    population). Male and female follow the 910ths male share where it is published and are None elsewhere."""
    reference = district_reference.city_rows(city, path)
    by_district = {}
    for row in rows:
        by_district.setdefault(row.get('district_ar'), []).append(row)
    for name, group in by_district.items():
        ages = [row for row in group if row.get('age_code') != 'ALL'] or group   # a district with only its ALL row
        model = sum(float(row.get('total') or 0) for row in ages)
        target = totals.get(name)
        ref = reference.get(name)
        share = float(ref['male_pct']) / 100 if ref and ref.get('male_pct') is not None else None
        male = sum(float(row.get('male') or 0) for row in ages)
        female = sum(float(row.get('female') or 0) for row in ages)
        scale = (float(target) / model) if target and model > 0 else 1.0
        for row in group:
            total = float(target) if row.get('age_code') == 'ALL' and target else float(row.get('total') or 0) * scale
            if share is not None and male > 0 and female > 0 and target:
                if row.get('age_code') == 'ALL':
                    row['male'], row['female'] = total * share, total * (1 - share)
                else:   # keep the age shape of each sex, rescaled to the measured split
                    row['male'] = float(row.get('male') or 0) * float(target) * share / male
                    row['female'] = float(row.get('female') or 0) * float(target) * (1 - share) / female
                row['total'] = row['male'] + row['female']
                row.update(source=district_reference.SOURCE + ' + WorldPop age shape', license=None)
            else:
                row['male'] = row['female'] = None
                row['total'] = total
                row['source'] = WORLDPOP + ' age shape'
    return rows
