"""District reference figures read from 910ths.sa (هدف): population, male share, Saudi share and income.

WorldPop's district totals are a satellite model, and its age/sex split comes from a regional table, so every
district of a region shows the same male share. Where 910ths publishes a district, its total and male share are
served instead; elsewhere the population stays WorldPop and the male/female split is reported as unavailable
rather than repeating the regional figure as if it were measured per district.

`reference/districts_910ths.json` holds one row per canonical district name (see canonical_data), built from a
browse of the public 910ths demographic map: {"source", "retrieved", "cities": {city_en: [{"district_ar",
"polygon_ids", "population", "male_pct", "saudi_pct", "income_all", "income_male", "income_female",
"income_saudi", "income_non_saudi"}]}}. Only districts whose 910ths name matches the atlas name are listed.
"""
import json
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'districts_910ths.json')
SOURCE = '910ths.sa'
_CACHE = {}


def load(path=PATH):
    """The whole reference table, or None when the file is missing or unreadable. Cached per file version."""
    try:
        stamp = os.stat(path).st_mtime_ns
    except OSError:
        return None
    if _CACHE.get(path, (None,))[0] != stamp:
        try:
            with open(path, encoding='utf-8') as handle:
                _CACHE[path] = (stamp, json.load(handle))
        except (OSError, ValueError):
            return None
    return _CACHE[path][1]


def city_rows(city, path=PATH):
    """Canonical district name -> reference row for one city ({} when none)."""
    table = load(path) or {}
    return {row['district_ar']: row for row in (table.get('cities') or {}).get(city, []) if row.get('district_ar')}


def apply_population(rows, city, path=PATH):
    """Replace WorldPop totals in merged /population-districts rows with the 910ths figure where one exists."""
    reference = city_rows(city, path)
    for row in rows:
        ref = reference.get(row.get('district_ar'))
        if ref and ref.get('population'):
            row.update(population=float(ref['population']), source=SOURCE, license=None, year=None, coverage_pct=None)
    return rows


def apply_demographics(rows, city, path=PATH):
    """Merged by-age rows: in a 910ths district, scale male and female so the district matches its 910ths total and
    male share (the age shape stays WorldPop's); elsewhere blank the regional male/female split."""
    reference = city_rows(city, path)
    by_district = {}
    for row in rows:
        by_district.setdefault(row.get('district_ar'), []).append(row)
    for name, group in by_district.items():
        ref = reference.get(name)
        ages = [row for row in group if row.get('age_code') != 'ALL']
        male = sum(float(row.get('male') or 0) for row in ages)
        female = sum(float(row.get('female') or 0) for row in ages)
        if ref and ref.get('population') and ref.get('male_pct') is not None and male > 0 and female > 0:
            share = float(ref['male_pct']) / 100
            scale_m = float(ref['population']) * share / male
            scale_f = float(ref['population']) * (1 - share) / female
            for row in group:
                row['male'] = float(row.get('male') or 0) * scale_m
                row['female'] = float(row.get('female') or 0) * scale_f
                row['total'] = row['male'] + row['female']
                row.update(source=SOURCE + ' + WorldPop age shape', license=None)
        else:
            for row in group:
                row['male'] = row['female'] = None
    return rows
