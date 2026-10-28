"""Registered sale deals per district from the Ministry of Justice open data (KSA Open Data License).

    python build_registered_deals.py OUT.json MOJ-Sales-2025-Q2.csv MOJ-Sales-2025-Q3.csv ...

Each row of the ministry's sales files is one registered deal: city, «city / district», classification (سكني |
تجاري | زراعي ...), number of properties, price and area. A district's figure is the median price per m² of its
single-property deals of 50 m² or more, per classification, from MIN_DEALS deals up. These are prices paid, the
counterpart of the asking prices in build_real_estate_reference.py; a residential deal is most often a plot of land.
"""
import csv
import json
import statistics
import sys
from collections import defaultdict

import canonical_data

MIN_DEALS = 10
MIN_AREA = 50
CLASSES = {'سكني': 'residential', 'تجاري': 'commercial'}
# Arabic city name (folded) -> the canonical English name the service is keyed by
CITY_EN = {canonical_data.district_key(arabic): english for english, arabic in canonical_data.CITY_ALIAS.values()}


def _number(value):
    try:
        number = float(str(value).replace(',', ''))
    except ValueError:
        return None
    return number if number > 0 else None


def build(paths):
    prices = defaultdict(list)
    quarters = []
    for path in paths:
        quarters.append(path.rsplit('/', 1)[-1].replace('MOJ-Sales-', '').replace('.csv', ''))
        with open(path, encoding='utf-8-sig') as handle:
            for row in csv.DictReader(handle):
                group = CLASSES.get((row.get('تصنيف العقار') or '').strip())
                price, area = _number(row.get('السعر')), _number(row.get('المساحة'))
                if not group or not price or not area or area < MIN_AREA or (row.get('عدد العقارات') or '').strip() != '1':
                    continue
                city = CITY_EN.get(canonical_data.district_key(row.get('المدينة')), (row.get('المدينة') or '').strip())
                district = canonical_data.clean_district((row.get('المدينة / الحي') or '').split('/')[-1])
                if district:
                    prices[(city, district, group)].append(price / area)
    cities = defaultdict(dict)
    for (city, district, group), values in prices.items():
        if len(values) >= MIN_DEALS:
            cities[city].setdefault(district, {})[group] = {'deals': len(values), 'median_sar_per_sqm': round(statistics.median(values))}
    return {
        'source': 'Ministry of Justice registered sale deals, open data (KSA Open Data License)',
        'quarters': sorted(quarters),
        'min_deals': MIN_DEALS,
        'unit': 'SAR per m², median of single-property deals',
        'cities': {city: [{'district_ar': name, **groups} for name, groups in sorted(rows.items())] for city, rows in sorted(cities.items())},
    }


if __name__ == '__main__':
    table = build(sys.argv[2:])
    with open(sys.argv[1], 'w', encoding='utf-8') as handle:
        json.dump(table, handle, ensure_ascii=False, separators=(',', ':'))
    print({city: len(rows) for city, rows in table['cities'].items() if len(rows) >= 50})
