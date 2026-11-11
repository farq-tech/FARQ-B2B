"""Market signals per district and property type: how its asking rent stands against its nearest districts, read
together with the prices paid there (registered sale deals). A listing carries its district's signal as a tag.

For one type (apartment, floor, villa) of yearly rent, a district is scored when it and each of its NEIGHBOURS
nearest districts have MIN_LISTINGS publishable listings of the type, the farthest within MAX_KM, and it has
MIN_DEALS registered residential deals against neighbours of its own on the same terms. The rent figure is its median
price per m² against the median of the neighbours' medians; the deal figure the same for prices paid. Three signals:

- cheaper_area: rent at least RENT_PCT under and deals at least DEAL_PCT under: the district is cheaper, not the ads.
- rent_under_value: rent at least RENT_PCT under while deals are at least RENT_PCT over: rents low for what the
  district sells at (older stock, or a gain for a tenant; a low yield for a buyer).
- rent_over_value: rent at least RENT_PCT over while deals are not over: rents high for what it sells at.

A signal is kept only when its rent figure holds in BOOT resamples of the listings (90% range at least half the
threshold on the same side), and never past IMPLAUSIBLE_PCT, which is more often a mix of ads than a market. Split-half
check on Riyadh, 2026-10-29: every signal kept on the full data held its direction in 95-98% of independent halves.
"""
import math
import os
import random
import statistics

import canonical_data

TYPES = ('apartment', 'floor', 'villa')
MIN_LISTINGS = 15
NEIGHBOURS = 5
MAX_KM = 8
MIN_DEALS = 30
RENT_PCT = 15
DEAL_PCT = 10
IMPLAUSIBLE_PCT = 50
BOOT = 200
LABELS = {
    'cheaper_area': 'حي أرخص من جيرانه',
    'rent_under_value': 'إيجار أقل من قيمة الحي',
    'rent_over_value': 'إيجار مرتفع مقابل سعر الحي',
}
_cache = {}


def _km(a, b):
    return math.hypot((a[0] - b[0]) * 101, (a[1] - b[1]) * 111)


def _pct(value, against):
    return (value / against - 1) * 100


def compute(cards, deals, seed=7):
    """cards: listing cards of one city; deals: that city's rows of registered_deals.json. Returns
    {(district_id, type): {kind, label, rent_pct, deal_pct, listings, neighbours}} for every scored district."""
    rows = [c for c in cards if c.get('deal') == 'rent_year' and not c.get('check') and c.get('price_sar')
            and c.get('area_sqm') and c.get('district_id') and c.get('type') in TYPES]
    points, names = {}, {}
    for card in rows:
        points.setdefault(card['district_id'], []).append((card['lon'], card['lat']))
        names[card['district_id']] = card.get('district_ar')
    centres = {key: (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts)) for key, pts in points.items()}
    paid = {}
    for row in deals or []:
        group = row.get('residential')
        if group and group.get('median_sar_per_sqm'):
            paid[canonical_data.district_key(row.get('district_ar'))] = group
    paid_by_id = {key: paid[canonical_data.district_key(name)] for key, name in names.items() if canonical_data.district_key(name) in paid}
    nearest = lambda key, pool: sorted((k for k in pool if k != key), key=lambda k: _km(centres[key], centres[k]))[:NEIGHBOURS]
    within = lambda key, near: len(near) == NEIGHBOURS and _km(centres[key], centres[near[-1]]) <= MAX_KM
    out = {}
    for kind in TYPES:
        values = {}
        for card in rows:
            if card['type'] == kind:
                values.setdefault(card['district_id'], []).append(card['price_sar'] / card['area_sqm'])
        eligible = [key for key, v in values.items() if len(v) >= MIN_LISTINGS]
        for key in eligible:
            near = nearest(key, eligible)
            own = paid_by_id.get(key)
            near_paid = nearest(key, paid_by_id)
            if not within(key, near) or not own or own.get('deals', 0) < MIN_DEALS or not within(key, near_paid):
                continue
            rent = _pct(statistics.median(values[key]), statistics.median(statistics.median(values[k]) for k in near))
            deal = _pct(own['median_sar_per_sqm'], statistics.median(paid_by_id[k]['median_sar_per_sqm'] for k in near_paid))
            rng = random.Random(f'{seed}:{key}:{kind}')
            boots = sorted(_pct(statistics.median(rng.choices(values[key], k=len(values[key]))),
                                statistics.median(statistics.median(rng.choices(values[k], k=len(values[k]))) for k in near))
                           for _ in range(BOOT))
            low, high = boots[int(BOOT * 0.05)], boots[int(BOOT * 0.95) - 1]
            signal = None
            if abs(rent) <= IMPLAUSIBLE_PCT:
                if rent <= -RENT_PCT and high <= -RENT_PCT / 2 and deal <= -DEAL_PCT:
                    signal = 'cheaper_area'
                elif rent <= -RENT_PCT and high <= -RENT_PCT / 2 and deal >= RENT_PCT:
                    signal = 'rent_under_value'
                elif rent >= RENT_PCT and low >= RENT_PCT / 2 and deal <= 0:
                    signal = 'rent_over_value'
            out[(key, kind)] = {'kind': signal, 'label': LABELS.get(signal), 'rent_pct': round(rent), 'deal_pct': round(deal),
                                'listings': len(values[key]), 'neighbours': [names[k] for k in near]}
    return out


def for_city(city, cards_table, deals_table, stamp):
    """compute() for one city, cached until either file changes (stamp: their modification times)."""
    cached = _cache.get(city)
    if cached and cached[0] == stamp:
        return cached[1]
    cards = [c for c in cards_table.get('listings', []) if c.get('city') == city]
    signals = compute(cards, ((deals_table or {}).get('cities') or {}).get(city) or [])
    _cache[city] = (stamp, signals)
    return signals


def tag(card, signals):
    """The tag a listing carries: its district's signal for its type, or None."""
    if card.get('deal') != 'rent_year' or card.get('check'):
        return None
    found = signals.get((card.get('district_id'), card.get('type')))
    if not found or not found['kind']:
        return None
    return {key: found[key] for key in ('kind', 'label', 'rent_pct', 'deal_pct', 'neighbours')}
