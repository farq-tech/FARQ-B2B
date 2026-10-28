#!/usr/bin/env python3
"""Build reference/real_estate_districts.json: asking prices per canonical district from property listings.

Input: a JSON array of listings (one object per listing) with listingType (sale | rent), propertyType, priceSar,
rentPeriod, areaSqm, latitude, longitude and publishedAt, and the golden district atlas of each city as GeoJSON
(Atlas `api/market/districts`, one file per city).

A listing joins the district its coordinates fall in, never the district name it was filed under. Only the figures
leave this script: per district and per property group, the number of listings and the median price per square
metre (sale) or per square metre per year (rent). No listing id, advertiser, phone or coordinate is written. A
median rests on at least MIN_LISTINGS listings, else the group is left out and Atlas shows «غير متاح».

These are asking prices from current offers, not deal prices, and Atlas says so.
"""
import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import canonical_data
import insights

MIN_LISTINGS = 5

# property types as the listings name them -> the groups Atlas shows
GROUPS = {
    'apartment': 'residential', 'studio': 'residential', 'floor': 'residential', 'villa': 'residential',
    'house': 'residential', 'room': 'residential', 'building': 'residential',
    'store': 'commercial', 'shop': 'commercial', 'showroom': 'commercial', 'office': 'office',
    'warehouse': 'warehouse', 'land': 'land',
}
RENT_PER_YEAR = {'annually': 1, 'yearly': 1, 'monthly': 12}
# outside these a figure is a typo or a different unit (a total for a compound, a daily chalet), not a price per m²
PER_SQM_BOUNDS = {'sale': (100, 100_000), 'rent': (20, 10_000)}


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def price_per_sqm(listing):
    """(kind, group, SAR per m² — per year for rent) or None when the listing cannot give an honest figure."""
    kind = listing.get('listingType')
    group = GROUPS.get(str(listing.get('propertyType') or '').lower())
    price, area = _number(listing.get('priceSar')), _number(listing.get('areaSqm'))
    if kind not in PER_SQM_BOUNDS or not group or not price or not area:
        return None
    if kind == 'rent':
        factor = RENT_PER_YEAR.get(str(listing.get('rentPeriod') or '').lower())
        if not factor:   # a daily or unlabelled period is not a yearly rent
            return None
        price *= factor
    value = price / area
    low, high = PER_SQM_BOUNDS[kind]
    return (kind, group, value) if low <= value <= high else None


def district_index(collection):
    """[(district_id, district_ar, polygons, bbox)] of one city's atlas."""
    out = []
    for feature in collection.get('features', []):
        props = feature.get('properties') or {}
        polygons = canonical_data._polygons(feature.get('geometry'))
        coords = [p for rings in polygons for ring in rings for p in ring]
        if not coords:
            continue
        bbox = (min(p[0] for p in coords), min(p[1] for p in coords), max(p[0] for p in coords), max(p[1] for p in coords))
        out.append((str(props.get('id')), props.get('ar') or props.get('district_ar'), polygons, bbox))
    return out


def locate(index, lon, lat):
    for district_id, name, polygons, (w, s, e, n) in index:
        if w <= lon <= e and s <= lat <= n and insights._inside(lon, lat, polygons):
            return district_id, name
    return None


def name_index(index):
    """district key -> (district_id, district_ar) for the names that only one district of the city carries; a name
    two districts share is never guessed."""
    found = defaultdict(set)
    for district_id, name, _, _ in index:
        if name:
            found[canonical_data.district_key(canonical_data.clean_district(name) or name)].add((district_id, name))
    return {key: next(iter(hits)) for key, hits in found.items() if len(hits) == 1}


def build(listings, atlases, retrieved, default_city=None):
    """atlases: {city_en: GeoJSON FeatureCollection}. Returns the reference document. A listing with coordinates joins
    the district they fall in; one without (a list page carries only the district's name) joins by that name within
    its city (`city_en`, else default_city), and only when the name is unambiguous there."""
    indexes = {city: district_index(collection) for city, collection in atlases.items()}
    by_name = {city: name_index(index) for city, index in indexes.items()}
    values = defaultdict(list)
    names, seen, placed, by_coordinates = {}, 0, 0, 0
    for listing in listings:
        figure = price_per_sqm(listing)
        if not figure:
            continue
        seen += 1
        lon, lat = _number(listing.get('longitude')), _number(listing.get('latitude'))
        hit = None
        if lon is not None and lat is not None:
            for city, index in indexes.items():
                found = locate(index, lon, lat)
                if found:
                    hit = (city, *found)
                    by_coordinates += 1
                    break
        else:
            city = listing.get('city_en') or default_city
            raw = listing.get('districtArabic') or listing.get('district_ar') or ''
            key = canonical_data.district_key(canonical_data.clean_district(raw) or raw) if raw else None
            found = by_name.get(city, {}).get(key) if key else None
            if found:
                hit = (city, *found)
        if hit:
            city, district_id, district_ar = hit
            kind, group, value = figure
            values[(city, district_id, kind, group)].append(value)
            names[(city, district_id)] = district_ar
            placed += 1
    cities = defaultdict(dict)
    for (city, district_id, kind, group), prices in values.items():
        if len(prices) < MIN_LISTINGS:
            continue
        row = cities[city].setdefault(district_id, {'district_id': district_id, 'district_ar': names[(city, district_id)], 'groups': {}})
        row['groups'][f'{kind}_{group}'] = {'listings': len(prices), 'median_sar_per_sqm': round(statistics.median(prices))}
    return {
        'source': 'asking prices of current property listings, joined to atlas districts by coordinates',
        'retrieved': retrieved,
        'min_listings': MIN_LISTINGS,
        'unit': {'sale': 'SAR per m²', 'rent': 'SAR per m² per year'},
        'listings_with_price': seen,
        'listings_placed': placed,
        'placed_by_coordinates': by_coordinates,
        'cities': {city: sorted(rows.values(), key=lambda r: r['district_ar'] or '') for city, rows in sorted(cities.items())},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('listings', help='JSON array of listings')
    parser.add_argument('--atlas', action='append', default=[], metavar='CITY=PATH', help='a city and its districts GeoJSON')
    parser.add_argument('--out', default=str(Path(__file__).with_name('reference') / 'real_estate_districts.json'))
    parser.add_argument('--retrieved', default=date.today().isoformat())
    parser.add_argument('--city', help='city_en for listings that carry no coordinates and no city_en')
    args = parser.parse_args(argv)
    atlases = {}
    for item in args.atlas:
        city, _, path = item.partition('=')
        atlases[city] = json.loads(Path(path).read_text(encoding='utf-8'))
    listings = json.loads(Path(args.listings).read_text(encoding='utf-8'))
    document = build(listings, atlases, args.retrieved, default_city=args.city)
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f"{document['listings_placed']} of {document['listings_with_price']} priced listings placed; "
          f"{sum(len(rows) for rows in document['cities'].values())} districts with a figure", file=sys.stderr)


if __name__ == '__main__':
    main()
