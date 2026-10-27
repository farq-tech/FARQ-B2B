#!/usr/bin/env python3
"""Build reference/districts_910ths.json from a browse of the 910ths demographic map.

Input: JSON lines, one per atlas polygon, as written by the sampler that opens the 910ths map centred inside each
polygon and reads the district panel: {"district_id", "n910_name", "n910_population", "male_pct", "saudi_pct",
"income_all", "income_male", "income_female", "income_saudi", "income_non_saudi"}.

A row is kept only when the 910ths district name equals the polygon's canonical name (canonical_data, with
district_corrections.json applied), so a polygon that 910ths places in a different district never borrows its
figures. Polygons merged into one canonical district share one row. Rows that disagree are reported, not guessed.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import canonical_data
import district_reference

FIELDS = ('population', 'male_pct', 'saudi_pct', 'income_all', 'income_male', 'income_female', 'income_saudi', 'income_non_saudi')


def build(samples, collection, city, source, retrieved):
    canonical, id_map = canonical_data.canonical_districts(collection, canonical_data.load_corrections())
    names = {str(f['properties']['id']): f['properties'].get('ar') or f['properties'].get('district_ar') for f in canonical['features']}
    cities = {str(f['properties']['id']): f['properties'].get('city_en') for f in canonical['features']}
    grouped, skipped = defaultdict(list), []
    for row in samples:
        polygon = str(row.get('district_id'))
        key = str(id_map.get(polygon, polygon))
        name = names.get(key)
        if cities.get(key) != city or not row.get('n910_population'):
            continue
        if not name or canonical_data.district_key(row.get('n910_name') or '') != canonical_data.district_key(name):
            skipped.append({'polygon': polygon, 'atlas': name, '910ths': row.get('n910_name')})
            continue
        grouped[name].append((polygon, row))
    rows, conflicts = [], []
    for name, members in sorted(grouped.items()):
        values = {json.dumps([row.get('n910_population'), row.get('male_pct')]) for _, row in members}
        if len(values) > 1:
            conflicts.append({'district_ar': name, 'polygons': [p for p, _ in members]})
            continue
        first = members[0][1]
        rows.append({'district_ar': name, 'polygon_ids': sorted(p for p, _ in members),
                     **{field: first.get('n910_population' if field == 'population' else field) for field in FIELDS}})
    table = {'source': source, 'retrieved': retrieved, 'unit': 'SAR/month',
             'note': 'Population, male and Saudi shares and average monthly income per working person, as published per district on the 910ths demographic map.',
             'cities': {city: rows}}
    return table, skipped, conflicts


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('samples', type=Path, help='JSON lines from the 910ths sampler')
    parser.add_argument('--districts', type=Path, required=True, help='districts.geojson (the atlas polygons the sampler used)')
    parser.add_argument('--city', default='Riyadh')
    parser.add_argument('--retrieved', required=True, help='date the map was read, YYYY-MM-DD')
    parser.add_argument('--out', type=Path, default=Path(district_reference.PATH))
    args = parser.parse_args()
    samples = [json.loads(line) for line in args.samples.read_text(encoding='utf-8').splitlines() if line.startswith('{')]
    table, skipped, conflicts = build(samples, json.loads(args.districts.read_text(encoding='utf-8')), args.city, '910ths.sa (هدف)', args.retrieved)
    existing = district_reference.load(str(args.out)) or {}
    table['cities'] = {**(existing.get('cities') or {}), **table['cities']}   # other cities already in the file are kept
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'city': args.city, 'districts': len(table['cities'][args.city]), 'skipped_name_mismatch': skipped, 'conflicts': conflicts}, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
