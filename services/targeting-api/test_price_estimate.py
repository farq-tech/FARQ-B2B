"""«سعّر عقارك»: comparables, widening to the nearest districts, the range and the rules."""
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import price_estimate  # noqa: E402


def card(i, district, lon, price, area, kind='floor', deal='rent_year', **extra):
    return {'id': str(i), 'city': 'Riyadh', 'district_id': district, 'district_ar': {'1': 'الربيع', '2': 'النرجس', '3': 'الملقا'}[district],
            'lon': lon, 'lat': 24.8, 'type': kind, 'deal': deal, 'price_sar': price, 'area_sqm': area, 'photos': ['p.jpg'], **extra}


class PriceEstimateTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        cards = [card(i, '1', 46.66, 90000 + 1000 * i, 180) for i in range(10)]          # الربيع: 10 floors at 500-550/m²
        cards += [card(100 + i, '2', 46.67, 120000, 180) for i in range(10)]            # النرجس, next door: 10 at 667/m²
        cards += [card(200 + i, '3', 46.90, 300000, 180) for i in range(10)]            # الملقا, far: never reached
        cards += [card(300, '1', 46.66, 999999, 180, check=True), card(301, '1', 46.66, 50000, 600), card(302, '1', 46.66, 1, 180, kind='villa')]
        self.cards = self.root / 'cards.json'
        self.cards.write_text(json.dumps({'retrieved': 'd', 'listings': cards}), encoding='utf-8')
        self.rules = self.root / 'rules.json'
        self.rules.write_text(json.dumps({'source': 's', 'retrieved': 'r', 'age': {'0': 4, '6-10': -7}, 'streets': {'1': 0, '2': 10},
                                          'street_width': {'20-29': 5}, 'furnished': {'yes': 24}}), encoding='utf-8')

    def run_estimate(self, **query):
        base = {'district_id': '1', 'deal': 'rent_year', 'type': 'floor', 'area_sqm': 180}
        return price_estimate.estimate('Riyadh', {**base, **query}, cards_path=str(self.cards), rules_path=str(self.rules))

    def test_a_thin_district_borrows_its_nearest_neighbour_never_a_far_one(self):
        result = self.run_estimate()
        self.assertTrue(result['available'])
        self.assertEqual([s['district_id'] for s in result['scope']], ['1', '2'], 'الملقا is farther than النرجس and not needed')
        self.assertEqual(result['comparables'], 20, 'a listing to check, another size or another type is not a comparable')
        self.assertEqual(result['examples'][0]['district_ar'], 'الربيع', "the property's own district shows first")

    def test_the_range_is_the_comparables_quartiles_moved_by_the_rules(self):
        plain = self.run_estimate()
        self.assertLess(plain['price']['low'], plain['price']['mid'])
        self.assertLess(plain['price']['mid'], plain['price']['high'])
        ruled = self.run_estimate(age='0', streets='2', street_width='20-29')
        self.assertEqual([a['factor'] for a in ruled['adjustments']], ['age', 'streets', 'street_width'])
        self.assertAlmostEqual(ruled['per_sqm']['mid'] / plain['per_sqm']['mid'], 1.04 * 1.10 * 1.05, delta=0.01)
        self.assertEqual(ruled['comparables_per_sqm'], plain['comparables_per_sqm'], 'the comparables themselves are shown as they are')
        self.assertEqual(self.run_estimate(streets='1')['adjustments'], [], 'a rule worth 0 is not listed')

    def test_too_few_comparables_or_none_of_the_type_is_unavailable_not_a_guess(self):
        self.assertEqual(self.run_estimate(type='villa')['reason'], 'too_few_comparables')
        self.assertEqual(self.run_estimate(type='warehouse')['reason'], 'no_listings')
        self.assertEqual(self.run_estimate(district_id='9')['reason'], 'district_has_no_listings')


if __name__ == '__main__':
    unittest.main()


class InsightRoutesTests(unittest.TestCase):
    def test_every_path_insight_response_answers_is_routed_to_it(self):
        """A path insight_response handles but the request handler does not route answers 404 in production (as
        /price-estimate did): the two lists must name the same paths."""
        import re
        source = (pathlib.Path(__file__).resolve().parent / 'server.py').read_text(encoding='utf-8')
        body = source.split('def insight_response', 1)[1].split('\ndef ', 1)[0]
        answered = set(re.findall(r"if path == '(/[a-z-]+)'", body))
        routed = re.search(r"elif self\.path in \(([^)]*'/real-estate-listings'[^)]*)\)", source).group(1)
        self.assertEqual(answered - set(re.findall(r"'(/[a-z-]+)'", routed)), set())
