"""Read listing rows exported from Aqar's search list (a browser scraper's columns) into the listings
build_real_estate_reference.py takes.

A list card carries a title such as «شقة للإيجار في شارع مالك بن الحارث, حي بدر, مدينة الرياض, منطقة الرياض», a price
(«599,000 § ريال», with «/سنوي» on yearly rents), an area («168م²»), a photo and, when the scraper takes it, the
listing's link. The district comes from the title (it names the street's own district); the photo URL identifies the
listing for de-duplication, since the same card appears on more than one result page.
"""
import re

import canonical_data

TYPES = {
    'شقة': 'apartment', 'استوديو': 'studio', 'دور': 'floor', 'فيلا': 'villa', 'بيت': 'house', 'غرفة': 'room',
    'عمارة': 'building', 'محل': 'store', 'محلات': 'store', 'معرض': 'showroom', 'مكتب تجاري': 'office', 'مكتب': 'office',
    'مستودع': 'warehouse', 'أرض': 'land', 'ارض': 'land', 'استراحة': 'rest_house', 'شاليه': 'chalet', 'مزرعة': 'farm',
    'مصنع': 'factory',
}
_TITLE = re.compile(r'^(?P<type>.+?)\s+لل(?P<kind>إيجار|ايجار|بيع)\b')
_DISTRICT = re.compile(r'حي\s+([^,،]+)')
_NUMBER = re.compile(r'[\d٠-٩][\d٠-٩,٬]*(?:\.\d+)?')
_ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


def _number(text):
    match = _NUMBER.search(str(text or '').translate(_ARABIC_DIGITS))
    if not match:
        return None
    try:
        return float(match.group(0).replace(',', '').replace('٬', ''))
    except ValueError:
        return None


def parse_row(row, city_en='Riyadh'):
    """One exported row -> a listing dict, or None when the card has no readable type, deal, price or area."""
    title = (row.get('name') or '').strip()
    head = _TITLE.match(title)
    if not head:
        return None
    property_type = TYPES.get(head.group('type').strip())
    district = _DISTRICT.search(title)
    price = _number(row.get('data') or row.get('brand'))
    area = _number(row.get('data2'))
    if not property_type or not price or not area:
        return None
    kind = 'sale' if head.group('kind') == 'بيع' else 'rent'
    # «/سنوي» on the card while the advertiser writes a monthly rent in the text: the period is unknown, so no figure
    yearly = '/سنوي' in str(row.get('brand') or '') and 'شهري' not in str(row.get('description') or '')
    return {
        'listingType': kind,
        'propertyType': property_type,
        'priceSar': price,
        'areaSqm': area,
        # a list card marks only yearly rents; anything else has no period we can trust
        'rentPeriod': 'annually' if kind == 'rent' and yearly else None,
        'districtArabic': district.group(1).strip() if district else None,
        'city_en': city_en,
        'title': title,
        'image': (row.get('image') or '').strip() or None,
        'url': (row.get('link') or row.get('url') or row.get('href') or '').strip() or None,
    }


_CITY_EN = {canonical_data.district_key(ar): en for en, ar in canonical_data.CITY_ALIAS.values()}
_PERIOD = {'/سنوي': 'annually', '/شهري': 'monthly'}


def parse_collected(record, city_en=None):
    """One listing from tools/aqar-collector -> a listing dict, or None. The card's text arrives as lines; its link
    path is type / city / region / district / street-id, and the district there is Aqar's own filing of the listing,
    preferred over the street address in the title."""
    lines = [str(line).strip() for line in record.get('lines') or [] if str(line).strip()]
    title = next((line for line in lines if _TITLE.match(line)), '')
    head = _TITLE.match(title)
    property_type = TYPES.get(head.group('type').strip()) if head else None
    price_line = next((line for line in lines if '§' in line or 'ريال' in line), '')
    area_line = next((line for line in lines if 'م²' in line), '')
    price, area = _number(price_line), _number(area_line)
    if not property_type or not price or not area:
        return None
    kind = 'sale' if head.group('kind') == 'بيع' else 'rent'
    period = next((value for label, value in _PERIOD.items() if label in price_line), None)
    description = max(lines, key=len)
    if period == 'annually' and 'شهري' in description:
        period = None
    path = record.get('path') or []
    district = next((segment[3:].replace('-', ' ') for segment in path[2:4] if segment.startswith('حي-')), None)
    if not district:
        found = _DISTRICT.search(title)
        district = found.group(1).strip() if found else None
    city = city_en or (_CITY_EN.get(canonical_data.district_key(path[1].replace('-', ' '))) if len(path) > 1 else None)
    return {
        'listingType': kind, 'propertyType': property_type, 'priceSar': price, 'areaSqm': area,
        'rentPeriod': period if kind == 'rent' else None, 'districtArabic': district, 'city_en': city,
        'title': title, 'image': record.get('image'), 'url': record.get('url'), 'aqar_id': record.get('id'),
    }


def parse_map_listing(record, city_en=None):
    """One listing of Aqar's map search (Web.find, kept by tools/aqar-collector) -> a listing dict, or None. It carries
    its own location, so it joins its district by coordinates. rent_period 3 is the yearly rent the list cards mark
    «/سنوي»; advertisers sometimes put a monthly figure there, so a text that speaks of a monthly rent and not a
    yearly one leaves the period unknown. No advertiser field is copied."""
    title = (record.get('title') or '').strip()
    head = _TITLE.match(title)
    property_type = TYPES.get(head.group('type').strip()) if head else None
    price, area = _number(record.get('price')), _number(record.get('area'))
    if not property_type or not price or not area:
        return None
    kind = 'sale' if head.group('kind') == 'بيع' else 'rent'
    text = str(record.get('content') or '')
    period = 'annually' if record.get('rent_period') == 3 and not ('شهري' in text and 'سنوي' not in text) else None
    # the yearly total of twelve monthly payments, when it is many times the price, shows the price is a month's rent
    twelve = _number(record.get('price_12_payments'))
    if kind == 'rent' and twelve and twelve >= 6 * price:
        period = 'monthly'
    location = record.get('location') or {}
    district = str(record.get('district') or '').strip()
    # a city outside the alias table keeps Aqar's Arabic name rather than borrowing another city's
    city = city_en or _CITY_EN.get(canonical_data.district_key(str(record.get('city') or ''))) or record.get('city')
    path = record.get('path') or ''
    return {
        'listingType': kind, 'propertyType': property_type, 'priceSar': price, 'areaSqm': area,
        'rentPeriod': period if kind == 'rent' else None,
        'latitude': location.get('lat'), 'longitude': location.get('lng'),
        'districtArabic': district[3:] if district.startswith('حي ') else district or None,
        'aqar_district_id': record.get('district_id'), 'city_en': city, 'title': title,
        **{key: record.get(key) for key in ('beds', 'livings', 'wc', 'street_width')},
        'images': record.get('imgs') or [], 'url': f'https://sa.aqar.fm{path}' if path else None,
        'aqar_id': str(record.get('id')),
    }


def parse_rows(rows, city_en='Riyadh'):
    """Parsed listings without the repeats a paginated list produces (same photo or same link = same listing).
    Takes either a browser scraper's columns or tools/aqar-collector's records."""
    seen, out = set(), []
    for row in rows:
        if 'location' in row or 'rent_period' in row:
            listing = parse_map_listing(row, city_en)
        elif 'lines' in row:
            listing = parse_collected(row, city_en)
        else:
            listing = parse_row(row, city_en)
        if not listing:
            continue
        key = listing.get('aqar_id') or listing['url'] or listing.get('image') or (listing['title'], listing['priceSar'], listing['areaSqm'])
        if key in seen:
            continue
        seen.add(key)
        out.append(listing)
    return out


def main(argv=None):
    """parse_aqar_list.py EXPORT.(csv|json) OUT.json [--city Riyadh] — the input for build_real_estate_reference.py."""
    import argparse
    import csv
    import json
    import sys
    from pathlib import Path
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument('export')
    parser.add_argument('out')
    parser.add_argument('--city', help='city_en when the export does not say (default: from each link, else Riyadh)')
    args = parser.parse_args(argv)
    path = Path(args.export)
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as handle:
            rows = list(csv.DictReader(handle))
    else:
        rows = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(rows, dict):   # tools/aqar-collector export: map listings first, they carry a location
            rows = rows.get('mapListings', []) + rows.get('listings', [])
    listings = parse_rows(rows, args.city)
    for listing in listings:
        listing['city_en'] = listing['city_en'] or 'Riyadh'
    Path(args.out).write_text(json.dumps(listings, ensure_ascii=False), encoding='utf-8')
    with_link = sum(1 for listing in listings if listing['url'])
    print(f'{len(listings)} listings from {len(rows)} rows; {with_link} carry the listing link', file=sys.stderr)


if __name__ == '__main__':
    main()
