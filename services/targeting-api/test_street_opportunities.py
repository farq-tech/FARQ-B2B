"""«فرص الشوارع» against a synthetic street_density.parquet."""
import json
import pathlib
import sys
import tempfile
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
import street_opportunities as so  # noqa: E402

M = 1 / 111000
LAT, LON = 24.70, 46.70


def line(east_m, north_m, length_m=500):
    return json.dumps({'type': 'MultiLineString', 'coordinates': [[[LON + east_m * M, LAT + north_m * M], [LON + (east_m + length_m) * M, LAT + north_m * M]]]})


def row(sub, street, districts, n, north_m, east_m=0, road='main', main='retail', city='Riyadh'):
    return (city, sub, sub, main, main, street, districts.split('|')[0], districts, n, 0, 500, n / 5, None, road, '', line(east_m, north_m))


class StreetOpportunityTests(unittest.TestCase):
    def build(self, rows):
        path = pathlib.Path(tempfile.mkdtemp()) / 'street_density.parquet'
        db = duckdb.connect()
        db.execute("""create table t(city_en varchar, sub_id varchar, sub_ar varchar, main_id varchar, main_ar varchar, street_ar varchar,
            district_ar varchar, districts_ar varchar, n integer, n_wholesale integer, length_m integer, per_100m double, lift double,
            road_class varchar, specialty_ids varchar, geojson varchar)""")
        db.executemany('insert into t values (' + ','.join('?' * 16) + ')', rows)
        db.execute('copy t to ? (format parquet)', [str(path)])
        return db, str(path)

    def setUp(self):
        self.rows = [
            # busy street, no pharmacy: the opportunity
            row('cafe', 'شارع التحلية', 'السليمانية|العليا', 30, 0, main='food'),
            row('fashion', 'شارع التحلية', 'العليا', 25, 0),
            # busy street already full of pharmacies
            row('cafe', 'شارع العليا', 'العليا', 30, 2000, main='food'),
            row('pharmacy', 'شارع العليا', 'العليا', 20, 2000, main='health'),
            # the same name far away, in another district, is another street
            row('cafe', 'شارع التحلية', 'النرجس', 6, 9000, main='food'),
            # a quiet street: too few shops to count as busy
            row('cafe', 'شارع صغير', 'الملز', 8, 4000, main='food'),
            # the kids group duplicates its trades and never adds to a street's total
            row('group.kids', 'شارع التحلية', 'العليا', 7, 0),
            row('retail.toys', 'شارع التحلية', 'العليا', 7, 0),
            # another city
            row('cafe', 'شارع الأمير', 'الروضة', 90, 0, main='food', city='Jeddah'),
        ]
        self.db, self.path = self.build(self.rows)

    def test_busy_street_without_the_activity_ranks_first_and_full_street_is_left_out(self):
        out = so.opportunities(self.db, self.path, 'Riyadh', subs=['pharmacy'])
        names = [f['properties']['street_ar'] for f in out['features']]
        self.assertEqual(names, ['شارع التحلية'])
        top = out['features'][0]['properties']
        self.assertEqual(top['score'], 100)
        self.assertEqual(top['total'], 62)          # 30 + 25 + 7 toys; the kids group is not added again
        self.assertEqual(top['others'], 62)
        self.assertIsNone(top['requested_n'])
        self.assertEqual(top['requested_below'], 5)  # no run there: fewer than 5, not a measured zero
        self.assertEqual(set(top['districts_ar']), {'السليمانية', 'العليا'})
        self.assertEqual(top['nearest']['street_ar'], 'شارع العليا')
        self.assertAlmostEqual(top['nearest']['distance_m'], 2000, delta=30)
        self.assertEqual(out['features'][0]['geometry']['type'], 'MultiLineString')

    def test_specialty_corridors_never_add_to_a_streets_size(self):
        # build_trade_corridors writes a specialty's own corridor («برجر») beside its trade's; its shops are already in it
        db = duckdb.connect()
        db.execute("""create table t(city_en varchar, sub_id varchar, sub_ar varchar, main_id varchar, main_ar varchar, street_ar varchar,
            district_ar varchar, districts_ar varchar, n integer, n_wholesale integer, length_m integer, per_100m double, lift double,
            road_class varchar, specialty_ids varchar, specialty_key varchar, geojson varchar)""")
        rows = [r[:15] + (None,) + r[15:] for r in self.rows] + [
            ('Riyadh', '', 'برجر', 'food', 'food', 'شارع التحلية', 'العليا', 'العليا', 12, 0, 500, 2.4, None, 'main', '',
             'food.fast_food.burger|food.restaurant.burger', line(0, 0))]
        db.executemany('insert into t values (' + ','.join('?' * 17) + ')', rows)
        path = str(pathlib.Path(tempfile.mkdtemp()) / 'street_density.parquet')
        db.execute('copy t to ? (format parquet)', [path])
        top = so.opportunities(db, path, 'Riyadh', subs=['pharmacy'])['features'][0]['properties']
        self.assertEqual((top['street_ar'], top['total']), ('شارع التحلية', 62))

    def test_thin_activity_is_counted_and_scored_below_absent(self):
        rows = self.rows + [row('pharmacy', 'شارع الثلاثين', 'الملقا', 5, 6000, main='health'),
                            row('cafe', 'شارع الثلاثين', 'الملقا', 55, 6000, main='food')]
        db, path = self.build(rows)
        out = so.opportunities(db, path, 'Riyadh', subs=['pharmacy'])
        by_name = {f['properties']['street_ar']: f['properties'] for f in out['features']}
        self.assertEqual(by_name['شارع الثلاثين']['requested_n'], 5)
        self.assertIsNone(by_name['شارع الثلاثين']['requested_below'])
        self.assertGreater(by_name['شارع الثلاثين']['expected'], 5)
        self.assertNotIn('شارع العليا', by_name)
        scores = [f['properties']['score'] for f in out['features']]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0 < s <= 100 for s in scores))

    def test_population_weights_the_score_within_the_city(self):
        rows = self.rows + [row('cafe', 'شارع الثلاثين', 'الملقا', 62, 6000, main='food')]
        db, path = self.build(rows)
        plain = so.opportunities(db, path, 'Riyadh', subs=['pharmacy'])
        self.assertFalse(plain['population_used'])
        weighted = so.opportunities(db, path, 'Riyadh', subs=['pharmacy'],
                                    population={'الملقا': {'population': 90000}, 'العليا': {'population': 10000}, 'السليمانية': {'population': 10000}})
        self.assertTrue(weighted['population_used'])
        self.assertEqual(weighted['features'][0]['properties']['street_ar'], 'شارع الثلاثين')
        self.assertEqual(weighted['features'][0]['properties']['population'], 90000)

    def test_capped_activity_reports_unknown_count(self):
        rows = self.rows + [row('pharmacy', f'شارع {i}', f'حي {i}', 5, 20000 + 100 * i, main='health') for i in range(so.MAX_PER_SUB)]
        db, path = self.build(rows)
        out = so.opportunities(db, path, 'Riyadh', subs=['pharmacy'])
        top = next(f['properties'] for f in out['features'] if f['properties']['street_ar'] == 'شارع التحلية')
        self.assertIsNone(top['requested_n'])
        # the weakest kept run has 5 shops: a street without one has fewer than 5, said as a bound, not unknown
        self.assertEqual(top['requested_below'], 5)

    def test_capped_activity_is_never_scored_as_a_full_gap(self):
        # Riyadh pharmacies as served: past the cap the build kept only the strongest runs, so a busy street without a
        # run may still hold up to floor − 1 shops. Scored on that bound, it no longer outranks a street that has 9 by
        # twice (the 100/100 of «شارع عسير» rested on an unknown read as zero).
        def scores(cap):
            saved = so.MAX_PER_SUB
            so.MAX_PER_SUB = cap
            try:
                rows = [row('pharmacy', f'ص{i}', f'حي {i}', 9, 20000 + 100 * i, main='health') for i in range(3)] + [
                    row('cafe', 'شارع عسير', 'ظهرة لبن', 300, 6000, main='food'),
                    row('cafe', 'شارع ب', 'الملز', 300, 8000, main='food'),
                    row('pharmacy', 'شارع ب', 'الملز', 9, 8000, main='health'),
                ]
                db, path = self.build(rows)
                return {f['properties']['street_ar']: f['properties'] for f in so.opportunities(db, path, 'Riyadh', subs=['pharmacy'])['features']}
            finally:
                so.MAX_PER_SUB = saved
        capped = scores(3)
        self.assertEqual(capped['شارع عسير']['requested_below'], 9)
        self.assertIsNone(capped['شارع عسير']['requested_n'])
        self.assertEqual(capped['شارع عسير']['score'], 100)
        self.assertGreaterEqual(capped['شارع ب']['score'], 85)   # gap 1 − 9 ÷ 17.5 against 1 − 8 ÷ 17.0
        plain = scores(10)
        self.assertEqual(plain['شارع عسير']['requested_below'], so.MIN_SHOPS)
        self.assertLessEqual(plain['شارع ب']['score'], 55)       # uncapped: «fewer than 5» is near none, a full gap

    def test_group_request_and_main_activity(self):
        out = so.opportunities(self.db, self.path, 'Riyadh', subs=['group.kids'])
        by_name = {f['properties']['street_ar']: f['properties'] for f in out['features']}
        # التحلية carries its kids shops (7 of 62); العليا has 50 shops and none
        self.assertIn('شارع العليا', by_name)
        out = so.opportunities(self.db, self.path, 'Riyadh', main_id='health')
        self.assertEqual([f['properties']['street_ar'] for f in out['features']], ['شارع التحلية'])
        with self.assertRaises(ValueError):
            so.opportunities(self.db, self.path, 'Riyadh')

    def test_activity_absent_from_the_city_ranks_by_commerce(self):
        out = so.opportunities(self.db, self.path, 'Jeddah', subs=['pharmacy'])
        self.assertEqual(out['features'][0]['properties']['street_ar'], 'شارع الأمير')
        self.assertIsNone(out['features'][0]['properties']['nearest'])

    def test_line_distance(self):
        a = [[(0.0, 0.0), (100.0, 0.0)]]
        b = [[(50.0, 30.0), (50.0, 80.0)]]
        self.assertAlmostEqual(so.line_distance(a, b), 30.0)

    def test_constants_match_the_build(self):
        try:
            import build_trade_corridors as btc
        except ImportError:
            self.skipTest('build dependencies not installed')
        self.assertEqual((so.MIN_SHOPS, so.MAX_PER_SUB), (btc.MIN_SHOPS, btc.MAX_PER_SUB))


if __name__ == '__main__':
    unittest.main()


class SpecialtyOpportunityTests(unittest.TestCase):
    """A specialty («برجر») is scored on its own corridors; its shops sit inside its subcategory's row."""
    KEY = 'food.fast_food.burger|food.restaurant.burger'

    def setUp(self):
        self.db = duckdb.connect()
        self.db.execute("""create table t(city_en varchar, sub_id varchar, sub_ar varchar, main_id varchar, main_ar varchar, street_ar varchar,
            district_ar varchar, districts_ar varchar, n integer, n_wholesale integer, length_m integer, per_100m double, lift double,
            road_class varchar, specialty_ids varchar, specialty_key varchar, geojson varchar)""")
        trade = lambda *a, **k: (lambda r: r[:15] + (None,) + r[15:])(row(*a, **k))
        rows = [
            # burgers gather here: 12 of the 30 fast-food shops
            trade('food.fast_food', 'شارع التحلية', 'العليا', 30, 0, main='food'),
            trade('fashion', 'شارع التحلية', 'العليا', 25, 0),
            ('Riyadh', '', 'برجر', 'food', 'food', 'شارع التحلية', 'العليا', 'العليا', 12, 0, 500, 2.4, None, 'main', '', self.KEY, line(0, 0)),
            # fast food, but fewer than 5 burger shops: no burger corridor
            trade('food.fast_food', 'شارع العليا', 'العليا', 20, 2000, main='food'),
            trade('cafe', 'شارع العليا', 'العليا', 30, 2000, main='food'),
            # a busy street with no fast food at all
            trade('fashion', 'شارع الملك فهد', 'الورود', 40, 4000),
            trade('cafe', 'شارع الملك فهد', 'الورود', 20, 4000, main='food'),
            # another specialty's corridor is never read for burgers
            ('Riyadh', '', 'بيتزا', 'food', 'food', 'شارع الملك فهد', 'الورود', 'الورود', 9, 0, 500, 1.8, None, 'main', '', 'food.fast_food.pizza', line(0, 4000)),
        ]
        self.db.executemany('insert into t values (' + ','.join('?' * 17) + ')', rows)
        self.path = str(pathlib.Path(tempfile.mkdtemp()) / 'street_density.parquet')
        self.db.execute('copy t to ? (format parquet)', [self.path])

    def test_streets_without_the_specialty_are_its_opportunities_measured_by_their_own_size(self):
        out = so.opportunities(self.db, self.path, 'Riyadh', specialty_ids=self.KEY.split('|')[::-1])
        by_name = {f['properties']['street_ar']: f['properties'] for f in out['features']}
        self.assertEqual(set(by_name), {'شارع العليا', 'شارع الملك فهد'}, 'the street burgers gather on is no opportunity')
        self.assertEqual(out['share'], round(12 / 165, 4), 'burger shops are part of the streets, never added on top')
        self.assertEqual(out['requested_kinds'], 1)
        self.assertEqual((by_name['شارع الملك فهد']['total'], by_name['شارع الملك فهد']['others']), (60, 60))
        self.assertEqual(by_name['شارع العليا']['requested_below'], 5)
        self.assertEqual(by_name['شارع العليا']['nearest']['street_ar'], 'شارع التحلية')
        self.assertEqual(by_name['شارع العليا']['nearest']['n'], 12, 'the nearest cluster is told by its burger count')

    def test_a_specialty_street_is_counted_by_its_own_shops(self):
        # a street with burgers, but fewer than its size calls for, shows its burger count against the rest
        self.db.execute("""insert into t values ('Riyadh', 'food.fast_food', 'food.fast_food', 'food', 'food', 'شارع الثلاثين', 'الملقا', 'الملقا',
            70, 0, 500, 14, null, 'main', '', null, ?), ('Riyadh', '', 'برجر', 'food', 'food', 'شارع الثلاثين', 'الملقا', 'الملقا',
            5, 0, 500, 1, null, 'main', '', ?, ?)""", [line(0, 6000), self.KEY, line(0, 6000)])
        self.db.execute('copy t to ? (format parquet)', [self.path])
        out = so.opportunities(self.db, self.path, 'Riyadh', specialty_ids=self.KEY.split('|'))
        top = {f['properties']['street_ar']: f['properties'] for f in out['features']}['شارع الثلاثين']
        self.assertEqual((top['requested_n'], top['total'], top['others']), (5, 70, 65))

    def test_a_table_without_specialty_corridors_refuses_a_specialty(self):
        db, path = StreetOpportunityTests.build(self, [row('cafe', 'شارع التحلية', 'العليا', 30, 0)])
        self.assertFalse(so.has_specialties(db, path))
        with self.assertRaises(ValueError):
            so.opportunities(db, path, 'Riyadh', specialty_ids=['food.fast_food.burger'])
        self.assertTrue(so.has_specialties(self.db, self.path))

    def test_a_specialty_named_otherwise_by_its_shops_still_joins_its_trades_street(self):
        # the road file names the street in Latin letters, so each corridor takes the name most of its shops write:
        # the burger shops write it one way, the fast-food shops another, and the road's own name joins them
        db = duckdb.connect()
        db.execute("""create table t(city_en varchar, sub_id varchar, sub_ar varchar, main_id varchar, main_ar varchar, street_ar varchar,
            district_ar varchar, districts_ar varchar, n integer, n_wholesale integer, length_m integer, per_100m double, lift double,
            road_class varchar, specialty_ids varchar, specialty_key varchar, road_name varchar, geojson varchar)""")
        road = lambda r, key, name: r[:15] + (key, name) + r[15:]
        rows = [
            road(row('food.fast_food', 'طريق الملك عبدالله', 'العليا', 30, 0, main='food'), None, 'King Abdullah Rd'),
            road(row('fashion', 'طريق الملك عبدالله', 'العليا', 25, 0), None, 'King Abdullah Rd'),
            ('Riyadh', '', 'برجر', 'food', 'food', 'طريق الملك عبد الله', 'العليا', 'العليا', 12, 0, 500, 2.4, None, 'main', '',
             self.KEY, 'King Abdullah Rd', line(0, 0)),
            road(row('fashion', 'شارع الملك فهد', 'الورود', 40, 4000), None, 'شارع الملك فهد'),
            road(row('cafe', 'شارع الملك فهد', 'الورود', 20, 4000, main='food'), None, 'شارع الملك فهد'),
        ]
        db.executemany('insert into t values (' + ','.join('?' * 18) + ')', rows)
        path = str(pathlib.Path(tempfile.mkdtemp()) / 'street_density.parquet')
        db.execute('copy t to ? (format parquet)', [path])
        out = so.opportunities(db, path, 'Riyadh', specialty_ids=self.KEY.split('|'))
        self.assertEqual([f['properties']['street_ar'] for f in out['features']], ['شارع الملك فهد'],
                         'the road burgers gather on is never reported as lacking them')

    def test_a_specialty_corridor_whose_trade_row_was_not_kept_still_counts_in_the_citys_total(self):
        # restaurants line more streets than the build keeps: a burger corridor may stand where its trade's row was cut
        self.db.execute("""insert into t values ('Riyadh', '', 'برجر', 'food', 'food', 'شارع الثلاثين', 'الملقا', 'الملقا',
            8, 0, 500, 1.6, null, 'main', '', ?, ?)""", [self.KEY, line(0, 6000)])
        self.db.execute('copy t to ? (format parquet)', [self.path])
        out = so.opportunities(self.db, self.path, 'Riyadh', specialty_ids=self.KEY.split('|'))
        self.assertEqual(out['share'], round(20 / 173, 4), 'its 8 shops are in the total as in the share')
