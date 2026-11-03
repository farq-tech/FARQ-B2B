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


if __name__ == '__main__':
    unittest.main()
