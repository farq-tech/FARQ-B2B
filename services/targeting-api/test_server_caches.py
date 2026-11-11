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


class TerritoriesActivityTests(unittest.TestCase):
    def test_business_weight_reads_the_picked_subcategory_or_specialty(self):
        # owner 2026-11-11: the specialty is the unit of every figure; territories used to keep only q and main_id
        seen = []
        original_counts, original_features = server.MARKET_ANALYTICS.district_counts, server._city_features
        server.MARKET_ANALYTICS.district_counts = lambda body: seen.append(body) or {'districts': []}
        server._city_features = lambda city: []
        try:
            server.insight_response('/territories', {'city': 'Riyadh', 'weight': 'businesses', 'count': 3,
                                                      'sub_ids': ['personal.laundry'], 'specialty_ids': ['food.fast_food.burger']})
        finally:
            server.MARKET_ANALYTICS.district_counts, server._city_features = original_counts, original_features
        self.assertEqual(seen, [{'city': 'Riyadh', 'sub_ids': ['personal.laundry'], 'specialty_ids': ['food.fast_food.burger']}])


class StreetSpecialtyTests(unittest.TestCase):
    """A street row counts its whole subcategory, so a specialty pick must not be shown that figure under its name."""

    def post(self, path, body):
        import io, json
        handler = object.__new__(server.H)
        raw = json.dumps(body).encode()
        handler.path, handler.headers, handler.rfile = path, {'Content-Length': str(len(raw))}, io.BytesIO(raw)
        handler._authed = lambda: True
        sent = []
        handler._json = lambda obj, code=200: sent.append((code, obj))
        handler.do_POST()
        return sent[-1]

    def setUp(self):
        import duckdb
        self.temp = tempfile.TemporaryDirectory()
        path = os.path.join(self.temp.name, 'street_density.parquet')
        db = duckdb.connect()
        db.execute("""copy (select 'Riyadh' city_en, 'food.restaurant' sub_id, 'مطعم' sub_ar, 'food' main_id, 'أغذية' main_ar,
                      'شارع الأمير بندر' street_ar, 'النخيل' district_ar, 'النخيل' districts_ar, 245 n, 0 n_wholesale, 4200 length_m,
                      5.8 per_100m, 1.0 lift, 'main' road_class, 'food.restaurant.burger|food.restaurant.indian' specialty_ids,
                      '{"type":"LineString","coordinates":[[46.6,24.7],[46.7,24.7]]}' geojson) to ? (format parquet)""", [path])
        db.close()
        self.original = server.STREET_DENSITY
        server.STREET_DENSITY = path

    def tearDown(self):
        server.STREET_DENSITY = self.original
        self.temp.cleanup()

    def test_a_specialty_is_unavailable_on_streets_not_given_the_parent_count(self):
        code, result = self.post('/street-density', {'city': 'Riyadh', 'specialty_ids': ['food.restaurant.burger']})
        self.assertEqual(code, 200)
        self.assertEqual(result['features'], [])
        self.assertIs(result['specialty_available'], False)

    def test_a_picked_subcategory_still_gets_its_streets(self):
        code, result = self.post('/street-density', {'city': 'Riyadh', 'sub_ids': ['food.restaurant']})
        self.assertEqual((code, len(result['features']), result['features'][0]['properties']['n']), (200, 1, 245))

    def with_specialty_rows(self):
        import duckdb
        path = os.path.join(self.temp.name, 'street_density_v2.parquet')
        line = '{"type":"LineString","coordinates":[[46.6,24.7],[46.7,24.7]]}'
        db = duckdb.connect()
        db.execute("""create table v(city_en varchar, sub_id varchar, sub_ar varchar, main_id varchar, main_ar varchar,
            street_ar varchar, district_ar varchar, districts_ar varchar, n integer, n_wholesale integer, length_m integer,
            per_100m double, lift double, road_class varchar, specialty_ids varchar, specialty_key varchar, geojson varchar)""")
        db.executemany('insert into v values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            ('Riyadh', 'food.restaurant', 'مطعم', 'food', 'أغذية', 'شارع الأمير بندر', 'النخيل', 'النخيل', 245, 0, 4200, 5.8, 1.0,
             'main', 'food.restaurant.burger', None, line),
            ('Riyadh', '', 'برجر', 'food', 'أغذية', 'شارع الأمير بندر', 'النخيل', 'النخيل', 21, 0, 4200, 0.5, 2.0,
             'main', 'food.restaurant.burger', 'food.fast_food.burger|food.restaurant.burger', line)])
        db.execute(f"copy v to '{path}' (format parquet)")
        db.close()
        server.STREET_DENSITY = path

    def test_a_specialty_gets_its_own_corridors_once_the_table_counts_them(self):
        self.with_specialty_rows()
        # the picker sends the entry's ids; their order does not matter
        code, result = self.post('/street-density', {'city': 'Riyadh', 'specialty_ids': ['food.restaurant.burger', 'food.fast_food.burger']})
        self.assertEqual(code, 200)
        self.assertEqual([(f['properties']['sub_ar'], f['properties']['n']) for f in result['features']], [('برجر', 21)])
        self.assertIs(result['specialty_available'], True)
        # one id of a two-parent entry is not that entry: nothing, rather than a figure for something else
        code, result = self.post('/street-density', {'city': 'Riyadh', 'specialty_ids': ['food.restaurant.burger']})
        self.assertEqual(result['features'], [])

    def test_specialty_rows_never_add_to_the_trades(self):
        self.with_specialty_rows()
        _, everything = self.post('/street-density', {'city': 'Riyadh'})
        self.assertEqual([f['properties']['n'] for f in everything['features']], [245])
        _, main = self.post('/street-density', {'city': 'Riyadh', 'main_id': 'food'})
        self.assertEqual([f['properties']['n'] for f in main['features']], [245])
        _, catalog = self.post('/street-density/catalog', {'city': 'Riyadh'})
        self.assertEqual(catalog['mains'][0]['shops'], 245)

    def test_street_opportunities_take_a_subcategory_and_refuse_a_specialty(self):
        code, result = self.post('/street-opportunities', {'city': 'Riyadh', 'specialty_ids': ['food.restaurant.burger']})
        self.assertEqual((code, result['available'], result['specialty_available']), (200, False, False))
        code, result = self.post('/street-opportunities', {'city': 'Riyadh', 'sub_ids': ['food.restaurant']})
        self.assertEqual(code, 200)
        self.assertEqual(result['sub_ids'], ['food.restaurant'])
        code, _ = self.post('/street-opportunities', {'city': 'Riyadh', 'sub_ids': ['x' * 81]})
        self.assertEqual(code, 400)
