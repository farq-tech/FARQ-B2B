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
    'مصنع': 'factory', 'ورشة': 'workshop', 'مجمع': 'compound',
}
# the rent period an advertiser wrote in the text, when the text names one and only one
_MONTHLY, _YEARLY = re.compile('شهري|شهريا|بالشهر|الشهر'), re.compile('سنوي|سنويا|بالسنة|السنة|في السنه')


def text_period(text):
    """'monthly' or 'annually' when the ad's text names exactly one of them, else None."""
    monthly, yearly = bool(_MONTHLY.search(text or '')), bool(_YEARLY.search(text or ''))
    return 'monthly' if monthly and not yearly else 'annually' if yearly and not monthly else None
# the building's age as the ad's text states it: «عمر العقار: 5 سنوات», «عمر العقار سنتين», or a phrase that says it has
# never been lived in («جديد لم يسكن», «أول ساكن», «شقة جديدة»). Read from the description only: a title names streets
# («شارع عمر المختار»), and a lone «جديد» is as often the kitchen as the building
_AGE = re.compile(r'عمر\s*(?:العقار|المبنى|البناء|البيت|الفيلا|الشقة|الشقه|الدور)?\s*[:：\-]?\s*(\d{1,2}|سنه|سنة|سنتين|سنتان)(?!\d)')
_NEW = re.compile(r'لم\s*(?:ي|ت)سكن|(?:اول|أول)\s*ساكن|حديث(?:ة|ه)?\s*البناء|'
                  r'(?:شقة|شقه|فيلا|فيلة|دور|عمارة|عماره|بيت|وحدة|وحده)\s+(?:جديد|جديده|جديدة)(?![\w])')
_AGE_WORDS = {'سنه': 1, 'سنة': 1, 'سنتين': 2, 'سنتان': 2}


def text_age(text):
    """The building's age in years as the description states it, 0 for «new, never lived in», else None."""
    text = str(text or '').translate(_ARABIC_DIGITS)
    found = _AGE.search(text)
    if found:
        value = found.group(1)
        return _AGE_WORDS.get(value, None) if not value.isdigit() else int(value)
    return 0 if _NEW.search(text) else None


# fields the collector asks the map query for beyond the map's own (tools/aqar-collector/relay.js EXTRA_FIELDS)
AQAR_EXTRA_FIELDS = ('rooms', 'stairs', 'furnished', 'maid', 'driver', 'lift', 'ketchen', 'ac', 'duplex', 'pool',
                     'basement', 'backyard', 'car_entrance', 'extra_unit', 'tent', 'playground', 'two_entrances',
                     'apartment_in_villa', 'private_roof', 'stores', 'family', 'men_place', 'create_time', 'refresh',
                     'last_update', 'rega_licensed', 'ad_license_number', 'deed_area', 'rega_rooms', 'rega_category',
                     'usages', 'verified', 'user_type', 'location_street', 'location_district',
                     'location_building_number')


def listing_age(record, text):
    """(age in years, where it came from): Aqar's own age field when the record carries it (a listing's detail page
    does, its map search does not), else the description, else (None, None) and Atlas shows «غير متاح»."""
    age = record.get('age')
    found = text_age(text)
    if isinstance(age, (int, float)) and not isinstance(age, bool) and 0 <= age <= 99:
        # Aqar's 0 is both «new» and «not stated» (land, unfilled forms): an age the text names wins over it
        return (found, 'text') if age == 0 and found else (int(age), 'aqar')
    return (found, 'text') if found is not None else (None, None)


# the facade as Aqar's street_direction codes it, read off the words of the 15,000 ads whose text names one too:
# 1-4 one street, 5-8 a corner, 9 three streets, 10 four streets, 11 and 12 two opposite streets
FACADES = {1: 'شمالية', 2: 'شرقية', 3: 'غربية', 4: 'جنوبية', 5: 'شمالية شرقية', 6: 'جنوبية شرقية', 7: 'جنوبية غربية',
           8: 'شمالية غربية', 9: 'ثلاث واجهات', 10: 'أربع واجهات', 11: 'شمالية جنوبية', 12: 'شرقية غربية'}
_FACADE_TEXT = re.compile(r'واجه[ةه]?\s*[:：\-]?\s*(?:ال)?(شمالي|جنوبي|شرقي|غربي)[ةه]?\s*(?:و\s*)?(?:ال)?(شمالي|جنوبي|شرقي|غربي)?[ةه]?')
_FACADE_BY_WORDS = {('شمالي',): 1, ('شرقي',): 2, ('غربي',): 3, ('جنوبي',): 4, ('شمالي', 'شرقي'): 5, ('جنوبي', 'شرقي'): 6,
                    ('جنوبي', 'غربي'): 7, ('شمالي', 'غربي'): 8, ('شمالي', 'جنوبي'): 11, ('شرقي', 'غربي'): 12}
_FACADE_COUNT = re.compile(r'(ثلاث|ثلاثة|3)\s*(?:واجهات|شوارع)|(أربع|اربع|أربعة|اربعة|4)\s*(?:واجهات|شوارع)')


def text_facade(text):
    """The facade's code (FACADES) as the description names it, else None. «واجهة شمالية شرقية» before «واجهة شمالية»;
    «ثلاث شوارع» and «أربع شوارع» are counts, not directions."""
    text = str(text or '').translate(_ARABIC_DIGITS)
    found = _FACADE_TEXT.search(text)
    if found:
        words = tuple(sorted(w for w in found.groups() if w))
        for key, code in _FACADE_BY_WORDS.items():
            if tuple(sorted(key)) == words:
                return code
    count = _FACADE_COUNT.search(text)
    return (9 if count.group(1) else 10) if count else None


def listing_facade(record, text):
    """(facade in words, where it came from): Aqar's street_direction code, else the description, else (None, None)."""
    code = record.get('street_direction')
    if isinstance(code, (int, float)) and not isinstance(code, bool) and int(code) in FACADES:
        return FACADES[int(code)], 'aqar'
    found = text_facade(text)
    return (FACADES[found], 'text') if found else (None, None)


# the number of floors as the description states it: «دورين», «ثلاثة أدوار», «4 أدوار», «دور واحد»; «الدور الأرضي»
# describes one floor of the building and is no count
_FLOORS_WORDS = {'واحد': 1, 'دورين': 2, 'ثلاث': 3, 'ثلاثة': 3, 'أربع': 4, 'اربع': 4, 'أربعة': 4, 'اربعة': 4, 'خمس': 5, 'خمسة': 5}
_FLOORS = re.compile(r'دور\s*(واحد)\b|(دورين)|(ثلاث|ثلاثة|أربع|اربع|أربعة|اربعة|خمس|خمسة|\d{1,2})\s*(?:أدوار|ادوار|طوابق)')


def text_floors(text):
    """The building's floors as the description states them, else None."""
    found = _FLOORS.search(str(text or '').translate(_ARABIC_DIGITS))
    if not found:
        return None
    word = next(group for group in found.groups() if group)
    value = _FLOORS_WORDS.get(word) or (int(word) if word.isdigit() else None)
    return value if value and value <= 30 else None


# the street's width as the description states it: «شارع 20», «شارع عرض 15م», «عرض الشارع: 25», «20م شارع»
_STREET = re.compile(r'(?:عرض\s*(?:ال)?شارع|شارع\s*(?:عرض|بعرض)?|شوارع\s*(?:عرض|بعرض)?)\s*[:：\-]?\s*(\d{1,3})\s*(?:م|متر)?\b|(\d{1,3})\s*(?:م|متر)\s*شارع')


def text_street_width(text):
    """The street's width in metres as the description states it (4 to 100), else None."""
    found = _STREET.search(str(text or '').translate(_ARABIC_DIGITS))
    if not found:
        return None
    value = int(next(group for group in found.groups() if group))
    return value if 4 <= value <= 100 else None


def listing_street_width(record, text):
    """(width in metres, where it came from): Aqar's street_width field when set, else the description."""
    width = record.get('street_width')
    if isinstance(width, (int, float)) and not isinstance(width, bool) and 4 <= width <= 100:
        return int(width), 'aqar'
    found = text_street_width(text)
    return (found, 'text') if found else (None, None)


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
    """One exported row -> a listing dict, or None for a row that is no listing card (no deal in its title). A card
    without a price or an area is kept; the figures that need them are left out later."""
    title = (row.get('name') or '').strip()
    head = _TITLE.match(title)
    if not head:
        return None
    property_type = TYPES.get(head.group('type').strip(), 'other')
    district = _DISTRICT.search(title)
    price = _number(row.get('data') or row.get('brand'))
    area = _number(row.get('data2'))
    kind = 'sale' if head.group('kind') == 'بيع' else 'rent'
    # the card's «/سنوي» or «/شهري», else what the text says; neither leaves the period unknown (None), never assumed
    label = str(row.get('brand') or '')
    period = 'annually' if '/سنوي' in label else 'monthly' if '/شهري' in label else text_period(str(row.get('description') or ''))
    return {
        'listingType': kind,
        'propertyType': property_type,
        'priceSar': price,
        'areaSqm': area,
        'rentPeriod': period if kind == 'rent' else None,
        'districtArabic': district.group(1).strip() if district else None,
        'city_en': city_en,
        'title': title,
        'image': (row.get('image') or '').strip() or None,
        'url': (row.get('link') or row.get('url') or row.get('href') or '').strip() or None,
    }


_CITY_EN = {canonical_data.district_key(ar): en for en, ar in canonical_data.CITY_ALIAS.values()}
_PERIOD = {'/سنوي': 'annually', '/شهري': 'monthly'}


def _kind(head, slug):
    """'sale' | 'rent' from the title («… للبيع في …»), else from the link's first segment («شقق-للإيجار»), else None."""
    if head:
        return 'sale' if head.group('kind') == 'بيع' else 'rent'
    return 'sale' if 'للبيع' in slug else 'rent' if 'للإيجار' in slug or 'للايجار' in slug else None


def parse_collected(record, city_en=None):
    """One listing from tools/aqar-collector -> a listing dict; every card is kept, whatever it lacks. The card's
    text arrives as lines; its link path is type / city / region / district / street-id, and the district there is
    Aqar's own filing of the listing, preferred over the street address in the title."""
    lines = [str(line).strip() for line in record.get('lines') or [] if str(line).strip()]
    path = record.get('path') or []
    title = next((line for line in lines if _TITLE.match(line)), '')
    head = _TITLE.match(title)
    property_type = TYPES.get(head.group('type').strip(), 'other') if head else 'other'
    price_line = next((line for line in lines if '§' in line or 'ريال' in line), '')
    area_line = next((line for line in lines if 'م²' in line), '')
    price, area = _number(price_line), _number(area_line)
    kind = _kind(head, path[0] if path else '')
    period = next((value for label, value in _PERIOD.items() if label in price_line), None) or text_period(max(lines, key=len, default=''))
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
    """One listing of Aqar's map search (Web.find, kept by tools/aqar-collector) -> a listing dict; every listing is
    kept, whatever it lacks (a price on request, no area, an unnamed type). It carries its own location, so it joins
    its district by coordinates. The rent period is the one the ad states, or None. No advertiser field is copied."""
    title = (record.get('title') or '').strip()
    path = record.get('path') or ''
    head = _TITLE.match(title)
    property_type = TYPES.get(head.group('type').strip(), 'other') if head else 'other'
    price, area = _number(record.get('price')), _number(record.get('area'))
    kind = _kind(head, path.strip('/').split('/')[0] if path else '')
    text = str(record.get('content') or '')
    # the period as the ad states it, never assumed: what the text says first (an advertiser who writes «شهري» under
    # Aqar's yearly field means monthly), then a twelve-payment total many times the price (the price is a month's
    # rent, whatever the field says), then Aqar's field (3 is the «/سنوي» of the list cards); otherwise unknown (None)
    twelve = _number(record.get('price_12_payments'))
    period = (text_period(text) or ('monthly' if twelve and price and twelve >= 6 * price else None)
              or ('annually' if record.get('rent_period') == 3 else None))
    location = record.get('location') or {}
    district = str(record.get('district') or '').strip()
    age, age_source = listing_age(record, text)
    facade, facade_source = listing_facade(record, text)
    floors = text_floors(text)
    street_width, street_width_source = listing_street_width(record, text)
    # a city outside the alias table keeps Aqar's Arabic name rather than borrowing another city's
    city = city_en or _CITY_EN.get(canonical_data.district_key(str(record.get('city') or ''))) or record.get('city')
    return {
        'listingType': kind, 'propertyType': property_type, 'priceSar': price, 'areaSqm': area,
        'rentPeriod': period if kind == 'rent' else None,
        'latitude': location.get('lat'), 'longitude': location.get('lng'),
        'districtArabic': district[3:] if district.startswith('حي ') else district or None,
        'aqar_district_id': record.get('district_id'), 'city_en': city, 'title': title,
        **{key: record.get(key) for key in ('beds', 'livings', 'wc')},
        'street_width': street_width, 'street_width_source': street_width_source,
        'facade': facade, 'facade_source': facade_source,
        'floors': floors, 'floors_source': 'text' if floors is not None else None,
        'age': age, 'age_source': age_source,
        'images': record.get('imgs') or [], 'url': f'https://sa.aqar.fm{path}' if path else None,
        'aqar_id': str(record.get('id')),
        # what the collector's widened map query carries, passed through as Aqar names it (only when stated)
        **{key: record[key] for key in AQAR_EXTRA_FIELDS if record.get(key) not in (None, '', [])},
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
        key = listing.get('aqar_id') or listing.get('url') or listing.get('image') or (listing['title'], listing['priceSar'], listing['areaSqm'])
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
