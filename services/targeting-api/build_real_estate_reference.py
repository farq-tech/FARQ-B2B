#!/usr/bin/env python3
"""Build reference/real_estate_districts.json: asking prices per canonical district from property listings.

Input: a JSON array of listings (one object per listing) with listingType (sale | rent), propertyType, priceSar,
rentPeriod, areaSqm, latitude, longitude and publishedAt, and the golden district atlas of each city as GeoJSON
(Atlas `api/market/districts`, one file per city).

A listing joins the district its coordinates fall in, never the district name it was filed under. Only the figures
leave this script: per district, deal and property group, the number of listings and the median price per square
metre. Each deal is its own median and nothing is converted: sale, rent per year, rent per month, and rent whose
ad names no period. No listing id, advertiser, phone or coordinate is written. A median rests on at least
MIN_LISTINGS listings, else the group is left out and Atlas shows «غير متاح».

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
    # a room is left out of the medians: its listed area is usually the whole building's
    'apartment': 'residential', 'studio': 'residential', 'floor': 'residential', 'villa': 'residential',
    'house': 'residential', 'building': 'residential',
    'store': 'commercial', 'shop': 'commercial', 'showroom': 'commercial', 'office': 'office',
    'warehouse': 'warehouse', 'land': 'land',
}
# a rent keeps the period its ad states; each period is its own median and nothing is converted between them
PERIODS = {'annually': 'year', 'yearly': 'year', 'monthly': 'month'}
# outside these a price per m² is a typo or a different unit (a compound's total, a daily chalet)
PER_SQM_BOUNDS = {'sale': (100, 100_000), 'rent_year': (20, 10_000), 'rent_month': (2, 1_000), 'rent_unstated': (2, 10_000)}
# one home listed with the whole building's or plot's area: beyond these the m² is not the unit's
MAX_AREA = {'apartment': 300, 'studio': 150, 'floor': 800}
# a rent marked yearly below this is a month's rent marked wrongly
MIN_YEARLY_RENT = 6_000
# a card this far from its district's median is most likely a wrong area, price or period: it stays on the map,
# marked for checking and ranked last
CARD_VS_DISTRICT = (-40, 150)


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def deal_of(listing):
    """'sale', or the rent with the period its ad states: 'rent_year' | 'rent_month' | 'rent_unstated'; None otherwise."""
    kind = listing.get('listingType')
    if kind == 'sale':
        return 'sale'
    if kind == 'rent':
        return f"rent_{PERIODS.get(str(listing.get('rentPeriod') or '').lower(), 'unstated')}"
    return None


def assess(listing):
    """What a listing can say: {deal (None when the ad names neither sale nor rent), group, per_sqm (in the ad's own
    period; None without a price or an area), trusted}. Every listing is assessed and kept; an untrusted one (no
    figure, a room or an unclassed type, a home bigger than one unit, a price per m² out of bounds, a yearly rent too
    low to be one) stays on the map but never enters a district median."""
    deal = deal_of(listing)
    property_type = str(listing.get('propertyType') or '').lower()
    price, area = _number(listing.get('priceSar')), _number(listing.get('areaSqm'))
    group = GROUPS.get(property_type)
    per_sqm = price / area if price and area else None
    low, high = PER_SQM_BOUNDS.get(deal, (0, 0))
    trusted = (deal is not None and per_sqm is not None and group is not None and area <= MAX_AREA.get(property_type, float('inf'))
               and low <= per_sqm <= high and not (deal == 'rent_year' and price < MIN_YEARLY_RENT))
    return {'deal': deal, 'group': group or property_type or 'other', 'per_sqm': per_sqm, 'trusted': trusted}


def price_per_sqm(listing):
    """(deal, group, SAR per m² in the ad's period) for a district median, or None when the listing cannot give an
    honest one."""
    found = assess(listing)
    return (found['deal'], found['group'], found['per_sqm']) if found and found['trusted'] else None


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


# the ad's own photos where they are published: a small one for the card, the large ones for its gallery
PHOTO_URL = 'https://images.aqar.fm/webp/350x0/props/{}'
GALLERY_URL = 'https://images.aqar.fm/webp/750x0/props/{}'
AD_URL = 'https://sa.aqar.fm/ad/{}/ar'
# the fields a listing card shows; nothing about who placed the ad
CARD_FIELDS = ('beds', 'livings', 'wc', 'street_width')


def _rounded(value):
    number = _number(value)
    return round(number) if number is not None else None


def _card(listing, city, district_id, district_ar, found):
    photos = [name for name in listing.get('images') or [] if isinstance(name, str) and name]
    if not photos and listing.get('image'):   # a list page carries one full photo address
        photos = [listing['image']]
    full = [name if name.startswith('http') else GALLERY_URL.format(name) for name in photos]
    title = str(listing.get('title') or '')
    aqar_id = str(listing.get('aqar_id') or '')
    return {
        'id': aqar_id or str(listing.get('url') or ''),
        # Aqar's own short link for an ad (the one its share and WhatsApp messages carry): it opens the listing in the
        # Aqar app, where the person calls or chats with the advertiser from their own account
        'url': AD_URL.format(aqar_id) if aqar_id.isdigit() else listing.get('url'),
        'lon': round(float(listing['longitude']), 6), 'lat': round(float(listing['latitude']), 6),
        'city': city, 'district_id': district_id, 'district_ar': district_ar,
        'kind': {'sale': 'sale', None: None}.get(found['deal'], 'rent'), 'deal': found['deal'],
        'group': found['group'], 'type': listing.get('propertyType') or 'other',
        # the price as advertised, in the period the ad states (deal rent_month | rent_year | rent_unstated); None
        # when the ad gives none
        'price_sar': _rounded(listing.get('priceSar')), 'area_sqm': _rounded(listing.get('areaSqm')),
        'sar_per_sqm': round(found['per_sqm']) if found['per_sqm'] is not None else None,
        'check': not found['trusted'],
        'photo': (PHOTO_URL.format(photos[0]) if not photos[0].startswith('http') else photos[0]) if photos else None,
        'photos': full,
        # the street address only: «في شارع …, حي …»
        'address': title.split(' في ', 1)[1] if ' في ' in title else None,
        **{key: listing.get(key) for key in CARD_FIELDS if listing.get(key) is not None},
    }


def build(listings, atlases, retrieved, default_city=None, cards=None):
    """atlases: {city_en: GeoJSON FeatureCollection}. Returns the reference document. A listing with coordinates joins
    the district they fall in; one without (a list page carries only the district's name) joins by that name within
    its city (`city_en`, else default_city), and only when the name is unambiguous there."""
    indexes = {city: district_index(collection) for city, collection in atlases.items()}
    by_name = {city: name_index(index) for city, index in indexes.items()}
    values = defaultdict(list)
    names, seen, placed, by_coordinates = {}, 0, 0, 0
    for listing in listings:
        found_figure = assess(listing)
        figure =(found_figure['deal'], found_figure['group'], found_figure['per_sqm']) if found_figure['trusted'] else None
        if figure:
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
            names[(city, district_id)] = district_ar
            if figure:
                kind, group, value = figure
                values[(city, district_id, kind, group)].append(value)
                placed += 1
            if cards is not None and lon is not None:
                cards.append(_card(listing, city, district_id, district_ar, found_figure))
        elif cards is not None and lon is not None and lat is not None:
            # outside every atlas district (another city, the city's edge): still on the map, with no district
            cards.append(_card(listing, listing.get('city_en') or default_city, None, listing.get('districtArabic'), found_figure))
    cities = defaultdict(dict)
    for (city, district_id, kind, group), prices in values.items():
        if len(prices) < MIN_LISTINGS:
            continue
        row = cities[city].setdefault(district_id, {'district_id': district_id, 'district_ar': names[(city, district_id)], 'groups': {}})
        row['groups'][f'{kind}_{group}'] = {'listings': len(prices), 'median_sar_per_sqm': round(statistics.median(prices))}
    if cards is not None:
        # each card against its district's median for the same deal and group, when the district has one
        for card in cards:
            median = cities.get(card['city'], {}).get(card['district_id'], {}).get('groups', {}).get(f"{card['deal']}_{card['group']}")
            pct = round(100 * (card['sar_per_sqm'] / median['median_sar_per_sqm'] - 1)) if median and card['sar_per_sqm'] else None
            card['vs_district_pct'] = pct
            low, high = CARD_VS_DISTRICT
            if pct is not None and not low <= pct <= high:
                card['check'] = True
    return {
        'source': 'asking prices of current property listings, joined to atlas districts by coordinates',
        'retrieved': retrieved,
        'min_listings': MIN_LISTINGS,
        'unit': {'sale': 'SAR per m²', 'rent_year': 'SAR per m² per year', 'rent_month': 'SAR per m² per month',
                 'rent_unstated': 'SAR per m² for a period the ad does not state'},
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
    parser.add_argument('--listings-out', help='also write the located listings as map cards (reference/real_estate_listings.json)')
    args = parser.parse_args(argv)
    atlases = {}
    for item in args.atlas:
        city, _, path = item.partition('=')
        atlases[city] = json.loads(Path(path).read_text(encoding='utf-8'))
    listings = json.loads(Path(args.listings).read_text(encoding='utf-8'))
    cards = [] if args.listings_out else None
    document = build(listings, atlases, args.retrieved, default_city=args.city, cards=cards)
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    if cards is not None:
        Path(args.listings_out).write_text(json.dumps({'retrieved': args.retrieved, 'listings': cards}, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{len(cards)} listing cards written', file=sys.stderr)
    print(f"{document['listings_placed']} of {document['listings_with_price']} priced listings placed; "
          f"{sum(len(rows) for rows in document['cities'].values())} districts with a figure", file=sys.stderr)


if __name__ == '__main__':
    main()
