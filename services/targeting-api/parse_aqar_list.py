"""Read listing rows exported from Aqar's search list (a browser scraper's columns) into the listings
build_real_estate_reference.py takes.

A list card carries a title such as «شقة للإيجار في شارع مالك بن الحارث, حي بدر, مدينة الرياض, منطقة الرياض», a price
(«599,000 § ريال», with «/سنوي» on yearly rents), an area («168م²»), a photo and, when the scraper takes it, the
listing's link. The district comes from the title (it names the street's own district); the photo URL identifies the
listing for de-duplication, since the same card appears on more than one result page.
"""
import re

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


def parse_rows(rows, city_en='Riyadh'):
    """Parsed listings without the repeats a paginated list produces (same photo or same link = same listing)."""
    seen, out = set(), []
    for row in rows:
        listing = parse_row(row, city_en)
        if not listing:
            continue
        key = listing['url'] or listing['image'] or (listing['title'], listing['priceSar'], listing['areaSqm'])
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
    parser.add_argument('--city', default='Riyadh')
    args = parser.parse_args(argv)
    path = Path(args.export)
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as handle:
            rows = list(csv.DictReader(handle))
    else:
        rows = json.loads(path.read_text(encoding='utf-8'))
    listings = parse_rows(rows, args.city)
    Path(args.out).write_text(json.dumps(listings, ensure_ascii=False), encoding='utf-8')
    with_link = sum(1 for listing in listings if listing['url'])
    print(f'{len(listings)} listings from {len(rows)} rows; {with_link} carry the listing link', file=sys.stderr)


if __name__ == '__main__':
    main()
