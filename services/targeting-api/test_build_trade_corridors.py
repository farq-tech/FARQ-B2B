import json
import tempfile
import unittest
from pathlib import Path

import duckdb

import build_trade_corridors as btc
import activity_groups
import market_analytics
import taxonomy_search

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

    def test_unclassified_shops_make_no_corridor(self):
        subs = {**SUBS, 'unc.unknown': {'sub_ar': 'غير مصنف', 'main_id': 'unc', 'main_ar': 'غير مصنف'}}
        rows = [shop('الخليج', 'unc.unknown', 100 + 50 * i, 5) for i in range(8)]
        found, _ = btc.city_corridors('Riyadh', rows, self.segments, subs)
        self.assertEqual(found, [])

    def test_a_crossing_without_the_trade_does_not_split_the_street(self):
        segments = [('شارع الخياطين', 'main', False, [(LON, LAT), (LON + 400 * M, LAT)]),
                    ('شارع الخياطين', 'main', False, [(LON + 575 * M, LAT), (LON + 1000 * M, LAT)])]  # 175 m crossing
        rows = [shop('الخليج', 'tailor', 50 + 70 * i, 5) for i in range(5)]
        rows += [shop('الملك فيصل', 'tailor', 650 + 70 * i, 5) for i in range(5)]
        found, _ = btc.city_corridors('Riyadh', rows, segments, SUBS)
        self.assertEqual([r['n'] for r in found], [10])

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


class NamedStreetTest(unittest.TestCase):
    def test_a_shop_by_an_unnamed_lane_counts_for_the_named_street_beside_it(self):
        segments = [('Abi Said Al Khadri St', 'main', False, [(LON, LAT), (LON + 600 * M, LAT)]),
                    ('', 'secondary', False, [(LON, LAT + 25 * M), (LON + 600 * M, LAT + 25 * M)])]   # service lane
        rows = [shop('الخليج', 'tailor', 50 + 100 * i, 30) + ('أبي سعيد الخدري',) for i in range(5)]
        found, stats = btc.city_corridors('Riyadh', rows, segments, SUBS)
        self.assertEqual(stats['on_named_street'], 5)
        self.assertEqual(len(found), 1)
        # the road file's Latin name gives way to the Arabic name the shops write
        self.assertEqual(found[0]['street_ar'], 'أبي سعيد الخدري')


class KidsGroupCorridorTest(unittest.TestCase):
    def test_kids_trades_on_one_street_also_make_one_group_corridor(self):
        subs = btc.with_groups({**SUBS,
                                'retail.baby': {'sub_ar': 'مستلزمات أطفال', 'main_id': 'retail', 'main_ar': 'تجزئة'},
                                'fashion.kids': {'sub_ar': 'ملابس أطفال', 'main_id': 'fashion', 'main_ar': 'أزياء'},
                                'retail.toys': {'sub_ar': 'ألعاب أطفال', 'main_id': 'retail', 'main_ar': 'تجزئة'}})
        segments = [('شارع الأطفال', 'main', False, [(LON, LAT), (LON + 600 * M, LAT)])]
        rows = [shop('الملز', sub, 50 + 100 * i, 5) for i, sub in enumerate(['retail.baby', 'retail.baby', 'fashion.kids', 'fashion.kids', 'retail.toys', 'retail.toys'])]
        found, _ = btc.city_corridors('Riyadh', rows, segments, subs)
        by_sub = {r['sub_id']: r for r in found}
        self.assertEqual(set(by_sub), {'group.kids'})   # each trade alone has 2 shops, under the 5 a corridor needs
        self.assertEqual(by_sub['group.kids']['n'], 6)
        self.assertEqual(by_sub['group.kids']['sub_ar'], 'أغراض الأطفال والمواليد')


class SpecialtyCorridorTest(unittest.TestCase):
    """A specialty («برجر») lines its own corridor, counted by its own shops, grouped as market-activities groups it."""
    SUBS = {'food.restaurant': {'sub_ar': 'مطعم', 'main_id': 'food', 'main_ar': 'أغذية ومشروبات'},
            'food.fast_food': {'sub_ar': 'وجبات سريعة', 'main_id': 'food', 'main_ar': 'أغذية ومشروبات'},
            'personal.laundry': {'sub_ar': 'مغسلة ملابس', 'main_id': 'personal', 'main_ar': 'خدمات شخصية'},
            'auto.car_wash': {'sub_ar': 'مغسلة سيارات', 'main_id': 'auto', 'main_ar': 'سيارات'}}

    def groups(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'specialties.csv'
            path.write_text('sub_id,specialty_id,specialty_ar\n'
                            'food.restaurant,food.restaurant.burger,برجر\n'
                            'food.fast_food,food.fast_food.burger,برجر\n'
                            'personal.laundry,personal.laundry.self_service,مغسلة خدمة ذاتية\n'
                            'auto.car_wash,auto.car_wash.self_service,مغسلة خدمة ذاتية\n'
                            'unc.unknown,unc.x,شيء\n', encoding='utf-8')
            return btc.specialty_groups(self.SUBS, path)

    def test_groups_follow_the_picker(self):
        groups = self.groups()
        self.assertEqual(groups['food.restaurant.burger'][0], 'food.fast_food.burger|food.restaurant.burger')
        self.assertEqual(groups['food.fast_food.burger'][0], groups['food.restaurant.burger'][0])
        self.assertNotEqual(groups['personal.laundry.self_service'][0], groups['auto.car_wash.self_service'][0])
        self.assertNotIn('unc.x', groups)
        self.assertEqual(btc.specialty_groups(self.SUBS, None), {})

    def test_a_specialty_corridor_counts_its_own_shops_across_both_parents(self):
        segments = [('شارع التحلية', 'main', False, [(LON, LAT), (LON + 1000 * M, LAT)])]
        rows = [shop('العليا', 'food.restaurant', 50 + 60 * i, 5, specialty='food.restaurant.burger') for i in range(3)]
        rows += [shop('العليا', 'food.fast_food', 300 + 60 * i, 5, specialty='food.fast_food.burger') for i in range(3)]
        rows += [shop('العليا', 'food.restaurant', 600 + 60 * i, 5, specialty='food.restaurant.indian') for i in range(2)]
        found, _ = btc.city_corridors('Riyadh', rows, segments, self.SUBS, self.groups())
        by = {(r['sub_id'], r['specialty_key']): r for r in found}
        self.assertEqual(by[('food.restaurant', None)]['n'], 5)            # the trade still counts all its shops
        self.assertNotIn(('food.fast_food', None), by)                      # 3 fast-food shops: under the 5 a corridor needs
        burger = by[('', 'food.fast_food.burger|food.restaurant.burger')]
        self.assertEqual((burger['n'], burger['sub_ar'], burger['main_id']), (6, 'برجر', 'food'))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'street_density.parquet'
            btc.write(found, out)
            keys = sorted(str(r[0]) for r in duckdb.sql(f"select specialty_key from read_parquet('{out}')").fetchall())
            self.assertEqual(keys, ['None', 'food.fast_food.burger|food.restaurant.burger'])


class CorridorActivityTest(unittest.TestCase):
    class Taxonomy:
        subs = {'auto.workshop': {}, 'beauty.barber': {}, 'equip.workshop_equipment': {}}
        named = {'ورش سيارات': (['auto.workshop'], 20.0), 'حلاق': (['beauty.barber'], 10.0),
                 'ملابس اطفال': (['fashion.kids'], 20.1), 'اطفال': (['beauty.barber'], 10.0)}

        def subs_in(self, q):
            return self.named.get(q, ([], 0))

        def group_in(self, q, named, score):
            return activity_groups.group_named(taxonomy_search.norm(q).split(), named, score)

        def understand(self, q, objective):
            # the commercial resolver reads «ورش» as equipment to buy
            return {'targets': {'equip.workshop_equipment': 2.0} if 'ورش' in q else {}}

    def test_the_named_trade_wins_over_a_product_reading(self):
        tx = self.Taxonomy()
        self.assertEqual(market_analytics.corridor_subs(tx, 'ورش سيارات'), ['auto.workshop'])
        self.assertEqual(market_analytics.corridor_subs(tx, 'حلاق'), ['beauty.barber'])

    def test_kids_words_ask_for_the_kids_group_unless_a_kids_trade_is_named(self):
        tx = self.Taxonomy()
        tx.subs = {**tx.subs, 'fashion.kids': {}}
        self.assertEqual(market_analytics.corridor_subs(tx, 'أغراض مواليد'), ['group.kids'])
        self.assertEqual(market_analytics.corridor_subs(tx, 'اطفال'), ['group.kids'])        # not barbers
        self.assertEqual(market_analytics.corridor_subs(tx, 'ملابس اطفال'), ['fashion.kids'])

    def test_no_named_trade_or_a_seller_falls_back_to_the_resolver(self):
        tx = self.Taxonomy()
        self.assertEqual(market_analytics.corridor_subs(tx, 'معدات ورش'), ['equip.workshop_equipment'])
        self.assertEqual(market_analytics.corridor_subs(tx, 'ورش سيارات', 'marketing'), ['equip.workshop_equipment'])
        self.assertEqual(market_analytics.corridor_subs(tx, 'شيء غير معروف'), [])


class StreetDistrictFilterTest(unittest.TestCase):
    def test_a_corridor_matches_every_district_it_crosses(self):
        con = duckdb.connect()
        con.execute("create table t as select * from (values ('شارع أ', 'الخليج', 'الخليج|الملك فيصل'), ('شارع ب', 'النرجس', '')) v(street_ar, district_ar, districts_ar)")
        where = market_analytics.street_density_district_sql({'district_ar', 'districts_ar'})
        found = lambda d: [r[0] for r in con.execute(f'select street_ar from t where {where} order by 1', [d]).fetchall()]
        self.assertEqual(found(['الملك فيصل']), ['شارع أ'])
        self.assertEqual(found(['النرجس']), ['شارع ب'])   # empty districts_ar falls back to district_ar
        self.assertIn('district_ar in', market_analytics.street_density_district_sql({'district_ar'}))


if __name__ == '__main__':
    unittest.main()
