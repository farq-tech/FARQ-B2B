"""The store owners' site card: segment splits, children as an estimate, nearest competitors, and no guessing."""
import os
import pathlib
import tempfile
import threading
import unittest

import duckdb

import market_analytics
import site_card
from market_analytics import MarketAnalytics

SQUARE = {'type': 'Polygon', 'coordinates': [[[46.60, 24.60], [46.70, 24.60], [46.70, 24.70], [46.60, 24.70], [46.60, 24.60]]]}
ID_MAP = {'p1': 'd1', 'p2': 'd2', 'p3': 'd2'}   # polygon p3 was merged into canonical district d2
NAMES = {'d1': ('النخيل', 'Al Nakheel'), 'd2': ('الياسمين', 'Al Yasmin'), 'd3': ('الربيع', 'Al Rabi')}
AUDIENCE = [{'district_ar': 'النخيل', 'male_pct': 60.0, 'saudi_pct': 50.0},
            {'district_ar': 'الياسمين', 'male_pct': 50.0, 'saudi_pct': 80.0}]


class SegmentTests(unittest.TestCase):
    def test_each_district_is_split_by_its_own_measured_share(self):
        people = site_card.segments({'p1': 1000.0, 'p2': 600.0, 'p3': 400.0}, ID_MAP, NAMES, AUDIENCE, {'النخيل': 0.3, 'الياسمين': 0.2})
        self.assertEqual(people['population'], 2000)
        self.assertEqual((people['men'], people['women']), (1100, 900))          # 600 + 500, 400 + 500
        self.assertEqual((people['saudi'], people['non_saudi']), (1300, 700))     # 500 + 800
        self.assertEqual(people['children'], 500)                                 # 300 + 200
        self.assertTrue(people['children_is_estimate'])
        self.assertEqual(people['districts'], 2)

    def test_a_district_without_a_share_makes_the_segment_unavailable(self):
        people = site_card.segments({'p1': 1000.0, 'p4': 10.0}, {**ID_MAP, 'p4': 'd3'}, NAMES, AUDIENCE, {'النخيل': 0.3, 'الربيع': 0.25})
        self.assertEqual(people['population'], 1010)
        self.assertIsNone(people['women'], 'الربيع has no measured share: no guess, not a partial sum')
        self.assertIsNone(people['saudi'])
        self.assertEqual(people['children'], 302)

    def test_people_outside_every_named_district_are_not_split(self):
        people = site_card.segments({'p1': 100.0, 'x': 50.0}, ID_MAP, NAMES, AUDIENCE, {'النخيل': 0.3})
        self.assertEqual(people['population'], 150)
        self.assertIsNone(people['women'])

    def test_no_building_layer_is_unavailable_not_zero(self):
        people = site_card.segments(None, ID_MAP, NAMES, AUDIENCE, {})
        self.assertIsNone(people['population'])
        self.assertIsNone(people['women'])

    def test_child_share_comes_from_the_age_rows_under_15(self):
        rows = [{'district_ar': 'النخيل', 'age_code': 'ALL', 'total': 100.0}]
        rows += [{'district_ar': 'النخيل', 'age_code': code, 'total': 10.0} for code in ('00', '01', '05', '10', '15', '20', '25', '30', '35', '40')]
        self.assertAlmostEqual(site_card.child_shares(rows)['النخيل'], 0.4)


class PeopleTests(unittest.TestCase):
    def test_residents_inside_the_range_by_building_district(self):
        root = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('create table b(longitude double, latitude double, district_id varchar, dwellings double, population double)')
        db.executemany('insert into b values (?, ?, ?, ?, ?)', [(46.65, 24.65, 'p1', 10, 50.0), (46.66, 24.66, 'p2', 4, 20.0),
                                                                (46.80, 24.80, 'p1', 99, 999.0)])
        db.execute('copy b to ? (format parquet)', [str(root / 'points.parquet')])
        self.assertEqual(site_card.people_by_district(db, str(root / 'points.parquet'), SQUARE, 5.0), {'p1': 50.0, 'p2': 20.0})


class CompetitorTests(unittest.TestCase):
    def setUp(self):
        root = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("""create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, district_ar varchar,
            district_reliable boolean, location_precision varchar, longitude double, latitude double, phone_norm varchar)""")
        db.executemany('insert into t values (?,?,?,?,?,?,?,?,?,?)', [
            ('a', 'Riyadh', 'صيدلية القريبة', None, 'النخيل', True, 'point', 46.651, 24.651, '0500000001'),
            ('b', 'Riyadh', 'صيدلية البعيدة', None, 'النخيل', True, 'point', 46.690, 24.690, None),
            ('c', 'Riyadh', 'صيدلية خارج المنطقة', None, 'الربيع', True, 'point', 46.900, 24.900, None),
            ('d', 'Riyadh', 'مطعم', None, 'النخيل', True, 'point', 46.652, 24.652, None),
            ('e', 'Riyadh', 'صيدلية بلا موقع دقيق', None, 'النخيل', True, 'district', 46.653, 24.653, None),
        ])
        db.execute('copy t to ? (format parquet)', [str(root / 'targets.parquet')])
        db.execute('create table c(poi_key varchar, sub_id varchar, source varchar, confidence varchar)')
        db.executemany('insert into c values (?,?,?,?)', [(k, 'health.pharmacy', 's', 'high') for k in 'abce'] + [('d', 'food.restaurant', 's', 'high')])
        db.execute('copy c to ? (format parquet)', [str(root / 'poi_taxonomy.parquet')])
        self.original = market_analytics.POI_TAXONOMY
        market_analytics.POI_TAXONOMY = str(root / 'poi_taxonomy.parquet')
        os.environ.pop('FARQ_AI_CLASSIFICATION', None)
        tiles = type('Tiles', (), {})()
        tiles.db, tiles.lock, tiles.search_sql, tiles.path = duckdb.connect(), threading.RLock(), 'true', str(root / 'targets.parquet')
        self.analytics = MarketAnalytics(tiles)
        tx = type('Tx', (), {})()
        tx.subs = {'health.pharmacy': {'main_id': 'health', 'sub_ar': 'صيدلية'}, 'food.restaurant': {'main_id': 'food', 'sub_ar': 'مطعم'}}
        tx.spec_hits = lambda q: ([], None)
        tx.subs_in = lambda q: (['health.pharmacy'] if 'صيدلية' in q else [], None)
        tx.specs = {}
        self.analytics._tx = lambda: tx

    def tearDown(self):
        market_analytics.POI_TAXONOMY = self.original

    def test_competitors_inside_the_range_nearest_first(self):
        result = self.analytics.competitors_within({'city': 'Riyadh', 'q': 'صيدلية'}, SQUARE, centre=[46.65, 24.65])
        self.assertEqual(result['n'], 2, 'outside the range and district-level locations do not count; the restaurant is another activity')
        self.assertEqual([row['name'] for row in result['nearest']], ['صيدلية القريبة', 'صيدلية البعيدة'])
        self.assertLess(result['nearest'][0]['distance_m'], result['nearest'][1]['distance_m'])
        self.assertGreater(result['area_km2'], 100)
        self.assertEqual(set(result['nearest'][0]), {'name', 'district_ar', 'distance_m'}, 'no contact, key or coordinate')

    def test_no_activity_means_no_competitor_figure(self):
        self.assertIsNone(self.analytics.competitors_within({'city': 'Riyadh'}, SQUARE, centre=[46.65, 24.65]))


if __name__ == '__main__':
    unittest.main()
