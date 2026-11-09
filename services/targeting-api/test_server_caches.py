"""Per-city memoisation that keeps cold analytic queries from re-reading the population parquets on every request.

The fixture carries no population layer, so golden_population is None here; the point under test is the caching
contract (compute once per city, serve the same object afterwards), not the population numbers themselves.
"""
import os
import pathlib
import sys
import tempfile
import unittest

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))

server = None
_TEMP = None


def setUpModule():
    global server, _TEMP
    import test_fixture.generate as generate
    _TEMP = tempfile.TemporaryDirectory()
    data_dir = os.path.join(_TEMP.name, 'data')
    generate.main(data_dir)
    os.environ['FARQ_TARGETING_DATA_DIR'] = data_dir
    os.environ['FARQ_TARGETING_AUX_DATA_DIR'] = data_dir
    os.environ['FARQ_TARGETING_CANONICAL_DIR'] = os.path.join(_TEMP.name, 'canonical')
    os.environ.setdefault('TARGETING_PASSWORD', 'test')
    import server as server_module
    server = server_module


def tearDownModule():
    if _TEMP is not None:
        _TEMP.cleanup()


class GoldenPopulationMemoTests(unittest.TestCase):
    def test_golden_population_computed_once_and_stable(self):
        server._GOLDEN_POP.pop('Riyadh', None)
        calls = []
        original = server._golden_population
        server._golden_population = lambda city: calls.append(city) or original(city)
        try:
            first = server.golden_population('Riyadh')
            second = server.golden_population('Riyadh')
        finally:
            server._golden_population = original
        self.assertEqual(calls, ['Riyadh'])          # underlying read happened once, not per call
        self.assertIn('Riyadh', server._GOLDEN_POP)
        self.assertIs(first, second)                 # same object served from the memo

    def test_golden_demographics_city_path_memoised_districts_path_not(self):
        server._GOLDEN_DEMO.pop('Riyadh', None)
        calls = []
        original = server._golden_demographics
        server._golden_demographics = lambda *a, **k: calls.append((a, k)) or original(*a, **k)
        try:
            server.golden_demographics('Riyadh')
            server.golden_demographics('Riyadh')               # cached: no second compute
            server.golden_demographics('Riyadh', ['العليا'])   # districts= path is never cached
            server.golden_demographics('Riyadh', ['العليا'])
        finally:
            server._golden_demographics = original
        self.assertEqual(len(calls), 3)   # 1 whole-city compute + 2 filtered computes
        self.assertIn('Riyadh', server._GOLDEN_DEMO)


class BrandsPopulationCacheTests(unittest.TestCase):
    def test_brands_path_reads_population_through_the_cache(self):
        server._POP_BY_NAME.pop('Riyadh', None)
        calls = []
        original = server.district_population_by_name
        server.district_population_by_name = lambda city: calls.append(city) or original(city)
        try:
            # the same call /brands now makes, twice
            first = server.population_by_name_cached('Riyadh')
            second = server.population_by_name_cached('Riyadh')
        finally:
            server.district_population_by_name = original
        self.assertEqual(calls, ['Riyadh'])   # the uncached builder ran once for both /brands requests
        self.assertIs(first, second)
        self.assertIs(first, server._POP_BY_NAME['Riyadh'])


class ListingFilterApiTests(unittest.TestCase):
    def test_density_map_uses_golden_population_and_area_by_district_id(self):
        server._DISTRICT_DENSITIES.pop('Riyadh', None)
        original_features = server._city_features
        original_areas = server.district_areas
        original_population = server.population_by_name_cached
        server._city_features = lambda city: [
            {'properties': {'id': '1', 'ar': 'حي معلوم'}}, {'properties': {'id': '2', 'ar': 'حي بلا سكان'}}]
        server.district_areas = lambda city: {'حي معلوم': 2.0, 'حي بلا سكان': 1.0}
        server.population_by_name_cached = lambda city: {'حي معلوم': {'population': 1000}, 'حي بلا سكان': {'population': None}}
        try:
            density = server.district_density_by_id('Riyadh')
        finally:
            server._city_features = original_features
            server.district_areas = original_areas
            server.population_by_name_cached = original_population
        self.assertEqual(density, {'1': 500.0, '2': None})
        self.assertIs(server.district_density_by_id('Riyadh'), density)
        server._DISTRICT_DENSITIES.pop('Riyadh', None)

    def test_listing_filter_request_is_validated_and_forwarded_to_the_catalog(self):
        import insights
        calls = []
        original = insights.real_estate_listings
        original_density = server.district_density_by_id
        insights.real_estate_listings = lambda city, filters: calls.append((city, filters)) or {'total': 0, 'listings': []}
        server.district_density_by_id = lambda city: {'1': 1500.0, '2': None}
        body = {'city': 'Riyadh', 'kind': 'rent', 'deal': 'rent_year', 'types': ['apartment'], 'limit': 10,
                'min_price': 20000, 'max_area': 180, 'max_age': 5, 'min_beds': 3, 'min_livings': 1,
                'min_wc': 2, 'min_street_width': 12, 'tenants': 'families', 'features': ['furnished'],
                'min_density': 1000, 'max_density': 5000, 'below_median': True, 'sort': 'price_asc'}
        try:
            result = server.insight_response('/real-estate-listings', body)
        finally:
            insights.real_estate_listings = original
            server.district_density_by_id = original_density
        self.assertEqual(result['total'], 0)
        self.assertEqual(calls[0][0], 'Riyadh')
        self.assertEqual({key: calls[0][1][key] for key in body if key in calls[0][1]}, {
            'kind': 'rent', 'deal': 'rent_year', 'types': ['apartment'], 'limit': 10,
            'min_price': 20000, 'max_area': 180, 'max_age': 5, 'min_beds': 3, 'min_livings': 1,
            'min_wc': 2, 'min_street_width': 12, 'tenants': 'families', 'features': ['furnished'],
            'min_density': 1000, 'max_density': 5000, 'below_median': True, 'sort': 'price_asc',
        })
        self.assertEqual(calls[0][1]['density_by_district'], {'1': 1500.0, '2': None})

    def test_listing_filter_api_rejects_unknown_sort_and_feature(self):
        for body in ({'city': 'Riyadh', 'sort': 'random'}, {'city': 'Riyadh', 'features': ['phone']}):
            with self.subTest(body=body), self.assertRaises(ValueError):
                server.insight_response('/real-estate-listings', body)


if __name__ == '__main__':
    unittest.main()
