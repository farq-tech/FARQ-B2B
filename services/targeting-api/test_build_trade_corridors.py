import json
import tempfile
import unittest
from pathlib import Path

import duckdb

import build_trade_corridors as btc

SUBS = {
    'tailor': {'sub_ar': 'خياطة وتفصيل', 'main_id': 'services', 'main_ar': 'خدمات'},
    'cafe': {'sub_ar': 'مقهى', 'main_id': 'food', 'main_ar': 'أغذية ومشروبات'},
}
LAT, LON = 24.70, 46.70
M = 1 / 111000  # about one metre in degrees


def shop(district, sub, east_m, north_m, wholesale=False, specialty=''):
    return (district, sub, LAT + north_m * M, LON + east_m * M, wholesale, specialty)


class TradeCorridorTest(unittest.TestCase):
    def setUp(self):
        # one divided street drawn as two one-way carriageways 30 m apart, 1 km long, across two districts
        self.segments = [
            ('شارع الخياطين', 'main', True, [(LON, LAT), (LON + 500 * M, LAT)]),
            ('شارع الخياطين', 'main', True, [(LON + 500 * M, LAT), (LON + 1000 * M, LAT)]),
            ('شارع الخياطين', 'main', True, [(LON, LAT + 30 * M), (LON + 1000 * M, LAT + 30 * M)]),
            # the same name 5 km away is another street
            ('شارع الخياطين', 'secondary', False, [(LON, LAT + 5000 * M), (LON + 400 * M, LAT + 5000 * M)]),
            # an unnamed lane right next to some shops
            ('', 'secondary', False, [(LON + 2000 * M, LAT), (LON + 2300 * M, LAT)]),
        ]

    def corridors(self, rows):
        found, stats = btc.city_corridors('Riyadh', rows, self.segments, SUBS)
        return found, stats

    def test_both_sides_and_both_districts_make_one_corridor(self):
        rows = [shop('الخليج', 'tailor', 100 + 50 * i, 5, specialty='abaya') for i in range(4)]
        rows += [shop('الملك فيصل', 'tailor', 600 + 50 * i, 28) for i in range(4)]
        rows += [shop('الملك فيصل', 'cafe', 900, 5)]
        found, _ = self.corridors(rows)
        tailors = [r for r in found if r['sub_id'] == 'tailor']
        self.assertEqual(len(tailors), 1)
        corridor = tailors[0]
        self.assertEqual(corridor['n'], 8)
        self.assertEqual(corridor['street_ar'], 'شارع الخياطين')
        self.assertEqual(set(corridor['districts_ar'].split('|')), {'الخليج', 'الملك فيصل'})
        self.assertEqual(corridor['road_class'], 'main')
        self.assertEqual(corridor['specialty_ids'], 'abaya')
        # two one-way carriageways count once: about 1 km, not 2
        self.assertLess(corridor['length_m'], 1100)
        self.assertEqual(json.loads(corridor['geojson'])['type'], 'MultiLineString')

    def test_same_name_far_away_is_a_separate_corridor(self):
        rows = [shop('الخليج', 'tailor', 100 + 50 * i, 5) for i in range(5)]
        rows += [shop('النرجس', 'tailor', 50 + 60 * i, 5005) for i in range(5)]
        found, _ = self.corridors(rows)
        self.assertEqual(sorted(r['district_ar'] for r in found), ['الخليج', 'النرجس'])

    def test_below_minimum_or_unnamed_or_far_is_not_a_corridor(self):
        rows = [shop('الخليج', 'tailor', 100 + 50 * i, 5) for i in range(4)]          # only 4
        rows += [shop('الخليج', 'cafe', 2050 + 40 * i, 3) for i in range(6)]          # on the unnamed lane
        rows += [shop('الخليج', 'cafe', 300 + 40 * i, -200) for i in range(6)]        # 200 m from any road
        found, stats = self.corridors(rows)
        self.assertEqual(found, [])
        self.assertEqual(stats['on_named_street'], 4)

    def test_unknown_activity_is_skipped(self):
        rows = [shop('الخليج', 'unc.other', 100 + 50 * i, 5) for i in range(6)]
        found, _ = self.corridors(rows)
        self.assertEqual(found, [])

    def test_written_file_keeps_the_columns_the_service_reads(self):
        rows = [shop('الخليج', 'tailor', 100 + 50 * i, 5, wholesale=i == 0) for i in range(6)]
        found, _ = self.corridors(rows)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'street_density.parquet'
            btc.write(found, out)
            cols = [c[0] for c in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()]
            for needed in ('city_en', 'sub_id', 'sub_ar', 'main_id', 'main_ar', 'street_ar', 'district_ar', 'n',
                           'n_wholesale', 'length_m', 'per_100m', 'lift', 'geojson', 'specialty_ids', 'road_class'):
                self.assertIn(needed, cols)
            n, nw = duckdb.sql(f"select n, n_wholesale from read_parquet('{out}')").fetchone()
            self.assertEqual((n, nw), (6, 1))


if __name__ == '__main__':
    unittest.main()
