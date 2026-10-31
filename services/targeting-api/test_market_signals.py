import json
import os
import tempfile
import unittest

import insights
import market_signals


def _cards(district, lon, per_sqm, count=20, kind='apartment', area=100):
    # a spread around per_sqm so the resamples move, all of one district
    return [{'id': f'{district}-{i}', 'city': 'Riyadh', 'district_id': district, 'district_ar': f'حي {district}',
             'lon': lon, 'lat': 24.7, 'deal': 'rent_year', 'kind': 'rent', 'type': kind, 'area_sqm': area,
             'price_sar': per_sqm * area * (0.95 + 0.1 * (i % 5) / 4), 'photo': 'p.jpg', 'check': False}
            for i in range(count)]


def _city(target_rent, target_paid):
    """A target district at lon 46.70 and five neighbours within 3 km at 500 SAR/m² rent and 5,000 SAR/m² paid."""
    cards = _cards('t', 46.70, target_rent)
    deals = [{'district_ar': 'حي t', 'residential': {'deals': 100, 'median_sar_per_sqm': target_paid}}]
    for n in range(5):
        cards += _cards(f'n{n}', 46.705 + 0.005 * n, 500)
        deals.append({'district_ar': f'حي n{n}', 'residential': {'deals': 100, 'median_sar_per_sqm': 5000}})
    return cards, deals


class MarketSignalTests(unittest.TestCase):
    def test_cheaper_rent_and_cheaper_deals_is_a_cheaper_district(self):
        cards, deals = _city(400, 4000)
        found = market_signals.compute(cards, deals)[('t', 'apartment')]
        self.assertEqual(found['kind'], 'cheaper_area')
        self.assertEqual((found['rent_pct'], found['deal_pct']), (-20, -20))

    def test_cheaper_rent_with_dearer_deals_is_rent_under_value(self):
        cards, deals = _city(400, 6000)
        self.assertEqual(market_signals.compute(cards, deals)[('t', 'apartment')]['kind'], 'rent_under_value')

    def test_dearer_rent_without_dearer_deals_is_rent_over_value(self):
        cards, deals = _city(600, 5000)
        self.assertEqual(market_signals.compute(cards, deals)[('t', 'apartment')]['kind'], 'rent_over_value')

    def test_small_gaps_and_implausible_gaps_carry_no_signal(self):
        for rent in (450, 200):  # -10% is under the threshold; -60% is more often a mix of ads than a market
            cards, deals = _city(rent, 4000)
            found = market_signals.compute(cards, deals)[('t', 'apartment')]
            self.assertIsNone(found['kind'])
            self.assertIsNone(found['label'])

    def test_too_few_listings_deals_or_far_neighbours_are_not_scored(self):
        cards, deals = _city(400, 4000)
        few = [c for c in cards if not (c['district_id'] == 't' and int(c['id'].split('-')[1]) >= 10)]
        self.assertNotIn(('t', 'apartment'), market_signals.compute(few, deals))
        thin = [dict(row, residential={'deals': 5, 'median_sar_per_sqm': 4000}) if row['district_ar'] == 'حي t' else row for row in deals]
        self.assertNotIn(('t', 'apartment'), market_signals.compute(cards, thin))
        far = [dict(c, lon=c['lon'] + 1) if c['district_id'] == 'n4' else c for c in cards]
        self.assertNotIn(('t', 'apartment'), market_signals.compute(far, deals))

    def test_a_listing_carries_its_district_signal_only_for_yearly_rent(self):
        cards, deals = _city(400, 4000)
        signals = market_signals.compute(cards, deals)
        self.assertEqual(market_signals.tag(cards[0], signals)['label'], 'حي أرخص من جيرانه')
        self.assertIsNone(market_signals.tag(dict(cards[0], deal='sale'), signals))
        self.assertIsNone(market_signals.tag(cards[-1], signals))  # a neighbour, with no signal of its own

    def test_served_listings_carry_the_tag(self):
        cards, deals = _city(400, 4000)
        with tempfile.TemporaryDirectory() as folder:
            cards_path, deals_path = os.path.join(folder, 'cards.json'), os.path.join(folder, 'deals.json')
            with open(cards_path, 'w', encoding='utf-8') as handle:
                json.dump({'retrieved': '2026-10-29', 'listings': cards}, handle)
            with open(deals_path, 'w', encoding='utf-8') as handle:
                json.dump({'cities': {'Riyadh': deals}}, handle)
            served = insights.real_estate_listings('Riyadh', {'district_ids': ['t']}, path=cards_path, deals_path=deals_path)
            self.assertTrue(all(card['signal']['kind'] == 'cheaper_area' for card in served['listings']))
            # the cached cards themselves stay untagged
            self.assertNotIn('signal', insights._listing_cards(cards_path)['listings'][0])
            os.remove(deals_path)
            served = insights.real_estate_listings('Riyadh', {'district_ids': ['t']}, path=cards_path, deals_path=deals_path)
            self.assertTrue(all(card['signal'] is None for card in served['listings']))


if __name__ == '__main__':
    unittest.main()
