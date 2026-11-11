"""District reference figures read from 910ths.sa (هدف): population, male share, Saudi share and income.
golden.py decides how they combine with the other population sources; this module only reads the table.

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
import math
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'districts_910ths.json')
SOURCE = '910ths.sa'
_CACHE = {}


def measured_percentage(value):
    """A source share in the closed interval 0–100, else unavailable (never clamp a bad measurement)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if math.isfinite(value) and 0 <= value <= 100 else None
    except (OverflowError, TypeError):
        return None


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
    result = {}
    for row in (table.get('cities') or {}).get(city, []):
        name = row.get('district_ar') if isinstance(row, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        normalized = dict(row)
        for key in ('male_pct', 'saudi_pct'):
            if key in normalized:
                normalized[key] = measured_percentage(normalized[key])
        result[name] = normalized
    return result


def reference_year(path=PATH):
    """The year the reference was read (from its "retrieved" date), or None."""
    retrieved = str((load(path) or {}).get('retrieved') or '')
    return int(retrieved[:4]) if retrieved[:4].isdigit() else None
