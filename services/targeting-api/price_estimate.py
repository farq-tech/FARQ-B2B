"""«سعّر عقارك»: a price range for one property from the listings most like it, then the stable rules for what makes it
differ from them (reference/price_rules.json).

Comparables are current publishable listings (insights.real_estate_listings' cards) of the same deal and property type,
within AREA_BAND of its area, in its district; when the district has fewer than MIN_COMPARABLES, the nearest districts
(by the centre of their listings) join one at a time, up to MAX_DISTRICTS. The range is the lower quartile, the median
and the upper quartile of their price per m², times the area; each rule then moves all three by its percentage. Too few
comparables even then, or no listing of the type in the city, answers available False and Atlas shows «غير متاح».
"""
import json
import math
import os
import statistics

import insights

RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference', 'price_rules.json')
MIN_COMPARABLES = 15
MAX_DISTRICTS = 6
AREA_BAND = (0.7, 1.4)
EXAMPLES = 8
TYPES = ('apartment', 'floor', 'villa', 'house', 'studio', 'store', 'office', 'warehouse', 'land')
DEALS = ('rent_year', 'rent_month', 'sale')
AGE_BANDS = ('0', '1-2', '3-5', '6-10', '11+')
STREETS = ('1', '2', '3+')
WIDTHS = ('lt15', '15-19', '20-29', '30+')
LABELS = {
    'age': {'0': 'جديد', '1-2': 'عمره سنة أو سنتان', '3-5': 'عمره 3–5 سنوات', '6-10': 'عمره 6–10 سنوات', '11+': 'عمره 11 سنة فأكثر'},
    'streets': {'1': 'على شارع واحد', '2': 'زاوية على شارعين', '3+': 'على 3 شوارع فأكثر'},
    'street_width': {'lt15': 'شارع أقل من 15 م', '15-19': 'شارع 15–19 م', '20-29': 'شارع 20–29 م', '30+': 'شارع 30 م فأكثر'},
    'furnished': {'no': 'غير مفروش', 'yes': 'مفروش'},
}


def _rules(path=None):
    with open(path or RULES_PATH, encoding='utf-8') as handle:
        return json.load(handle)


def _distance_km(a, b):
    rad = math.pi / 180
    h = math.sin((b[1] - a[1]) * rad / 2) ** 2 + math.cos(a[1] * rad) * math.cos(b[1] * rad) * math.sin((b[0] - a[0]) * rad / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _quartiles(values):
    values = sorted(values)
    q = statistics.quantiles(values, n=4, method='inclusive')
    return q[0], statistics.median(values), q[2]


def estimate(city, query, cards_path=None, rules_path=None):
    """query: district_id, deal, type, area_sqm, and optional age, streets, street_width, furnished (see the tuples
    above). Returns the range, the comparables' scope and the adjustments, or available False with the reason."""
    table = insights._listing_cards(cards_path or insights.REAL_ESTATE_LISTINGS_PATH)
    rules = _rules(rules_path)
    deal, kind, area = query['deal'], query['type'], float(query['area_sqm'])
    publishable = lambda c: (not c.get('check') and c.get('price_sar') and c.get('area_sqm') and c.get('deal') == deal
                             and (c.get('photos') or c.get('photo')))
    same = [c for c in table.get('listings', []) if c['city'] == city and c.get('type') == kind and publishable(c)]
    if not same:
        return {'available': False, 'reason': 'no_listings'}
    # each district's centre is the middle of its own listings, so «nearest» needs no other file
    centres = {}
    for card in same:
        if card.get('district_id'):
            centres.setdefault(card['district_id'], []).append((card['lon'], card['lat']))
    centres = {key: (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts)) for key, pts in centres.items()}
    home = centres.get(query['district_id'])
    if home is None:
        return {'available': False, 'reason': 'district_has_no_listings'}
    order = sorted(centres, key=lambda key: _distance_km(home, centres[key]))
    low, high = AREA_BAND[0] * area, AREA_BAND[1] * area
    scope, comparables = [], []
    for key in order[:MAX_DISTRICTS]:
        scope.append(key)
        comparables += [c for c in same if c.get('district_id') == key and low <= c['area_sqm'] <= high]
        if len(comparables) >= MIN_COMPARABLES:
            break
    if len(comparables) < MIN_COMPARABLES:
        return {'available': False, 'reason': 'too_few_comparables', 'comparables': len(comparables)}
    q1, median, q3 = _quartiles([c['price_sar'] / c['area_sqm'] for c in comparables])
    adjustments = []
    for key in ('age', 'streets', 'street_width', 'furnished'):
        value = query.get(key)
        pct = (rules.get(key) or {}).get(value) if value is not None else None
        if pct:
            adjustments.append({'factor': key, 'value': value, 'label': LABELS[key][value], 'pct': pct})
    factor = math.prod(1 + a['pct'] / 100 for a in adjustments)
    names = {c['district_id']: c.get('district_ar') for c in comparables}
    examples = sorted(comparables, key=lambda c: (c.get('district_id') != query['district_id'], abs(c['area_sqm'] - area)))[:EXAMPLES]
    return {
        'available': True,
        'deal': deal, 'type': kind, 'area_sqm': area,
        'comparables': len(comparables),
        'scope': [{'district_id': key, 'district_ar': names.get(key) or next((c.get('district_ar') for c in same if c.get('district_id') == key), None),
                   'comparables': sum(1 for c in comparables if c.get('district_id') == key)} for key in scope],
        'per_sqm': {'low': round(q1 * factor), 'mid': round(median * factor), 'high': round(q3 * factor)},
        'price': {'low': round(q1 * factor * area, -3), 'mid': round(median * factor * area, -3), 'high': round(q3 * factor * area, -3)},
        'comparables_per_sqm': {'low': round(q1), 'mid': round(median), 'high': round(q3)},
        'adjustments': adjustments,
        'examples': [{key: c.get(key) for key in ('id', 'url', 'photo', 'district_ar', 'type', 'price_sar', 'area_sqm', 'beds', 'age')} for c in examples],
        'rules_source': rules.get('source'), 'rules_retrieved': rules.get('retrieved'),
        'listings_retrieved': table.get('retrieved'),
    }
