"""Asking prices per district from listings: placement by coordinates, honest units, and the listing floor."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_real_estate_reference as ref  # noqa: E402


def square(x, y, size=0.01):
    return {'type': 'Polygon', 'coordinates': [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]}


ATLAS = {'type': 'FeatureCollection', 'features': [
    {'properties': {'id': 1, 'ar': 'العليا'}, 'geometry': square(46.68, 24.69)},
    {'properties': {'id': 2, 'ar': 'الملقا'}, 'geometry': square(46.60, 24.80)},
]}


def listing(kind, kind_of, price, area, lon=46.685, lat=24.695, period='annually'):
    return {'listingType': kind, 'propertyType': kind_of, 'priceSar': price, 'areaSqm': area, 'rentPeriod': period,
            'longitude': lon, 'latitude': lat, 'sellerPhone': '9665xxxxxxxx', 'sellerName': 'x'}


class RealEstateReferenceTests(unittest.TestCase):
    def test_optional_listing_dates_reject_invalid_or_unrepresentable_timestamps(self):
        self.assertEqual(ref._day(1793000000), '2026-10-26')
        for stamp in (0, -1, True, float('nan'), float('inf'), 10**100):
            with self.subTest(stamp=stamp):
                self.assertIsNone(ref._day(stamp))

    def test_median_per_district_by_coordinates_with_a_listing_floor(self):
        rows = [listing('rent', 'apartment', 60000 + i * 1000, 120) for i in range(5)]       # العليا: 5 rents
        rows += [listing('sale', 'land', 1_000_000, 500, lon=46.605, lat=24.805) for _ in range(4)]   # الملقا: only 4
        doc = ref.build(rows, {'Riyadh': ATLAS}, '2026-10-28')
        riyadh = doc['cities']['Riyadh']
        self.assertEqual([r['district_ar'] for r in riyadh], ['العليا'], 'a group under 5 listings is left out')
        self.assertEqual(riyadh[0]['groups'], {'rent_year_residential': {'listings': 5, 'median_sar_per_sqm': 517, 'reliable': False}})
        self.assertNotIn('9665', str(doc), 'no advertiser detail leaves the script')

    def test_a_district_splits_its_figure_by_building_age_where_ads_state_it(self):
        rows = [dict(listing('rent', 'floor', 100000 + i * 1000, 160), age=0, aqar_id=f'new-{i}') for i in range(5)]        # five new
        rows += [dict(listing('rent', 'floor', 60000 + i * 1000, 160), age=11, aqar_id=f'old-{i}') for i in range(5)]      # five older
        rows += [dict(listing('rent', 'floor', 80000, 160), aqar_id=f'unknown-{i}') for i in range(3)]                    # three unstated
        cards = []
        group = ref.build(rows, {'Riyadh': ATLAS}, 'd', cards=cards)['cities']['Riyadh'][0]['groups']['rent_year_residential']
        self.assertEqual(group['listings'], 13, 'every ad counts in the district figure, stated age or not')
        self.assertEqual(group['by_age'], {'new': {'listings': 5, 'median_sar_per_sqm': 638}, 'older': {'listings': 5, 'median_sar_per_sqm': 388}})
        self.assertEqual(sorted({card.get('age') for card in cards}, key=str), [0, 11, None])
        thin = ref.build([dict(r, age=0) for r in rows[:3]] + rows[5:10], {'Riyadh': ATLAS}, 'd')['cities']['Riyadh'][0]['groups']['rent_year_residential']
        self.assertEqual(list(thin['by_age']), ['older'], 'a band under the listing floor is left out, not shown thin')

    def test_each_rent_period_keeps_its_own_figure_and_nothing_is_converted(self):
        self.assertEqual(ref.price_per_sqm(listing('rent', 'store', 5000, 100, period='monthly')), ('rent_month', 'commercial', 50))
        self.assertEqual(ref.price_per_sqm(listing('rent', 'store', 60000, 100, period='annually')), ('rent_year', 'commercial', 600))
        # a shop rent with no stated period is a yearly rent (owner, 2026-10-28); an office's stays unstated
        self.assertEqual(ref.price_per_sqm(listing('rent', 'store', 60000, 100, period=None)), ('rent_year', 'commercial', 600))
        self.assertEqual(ref.price_per_sqm(listing('rent', 'office', 60000, 100, period=None)), ('rent_unstated', 'office', 600))
        self.assertIsNone(ref.price_per_sqm(listing('rent', 'apartment', 3000, 100, period='annually')), 'a «yearly» 3,000 is a month')
        self.assertIsNone(ref.price_per_sqm(listing('rent', 'chalet', 500, 300, period='daily')), 'a chalet has no group')
        self.assertIsNone(ref.price_per_sqm(listing('sale', 'apartment', 900000, 0)))
        self.assertIsNone(ref.price_per_sqm(listing('sale', 'land', 5, 1000)), 'a price per m² below the floor is a typo')

    def test_a_listing_outside_every_district_is_not_placed(self):
        doc = ref.build([listing('rent', 'apartment', 60000, 120, lon=50.0, lat=26.0)] * 6, {'Riyadh': ATLAS}, 'd')
        self.assertEqual((doc['listings_with_price'], doc['listings_placed']), (6, 0))


    def test_a_listing_without_coordinates_joins_by_an_unambiguous_district_name(self):
        rows = [{'listingType': 'rent', 'propertyType': 'store', 'priceSar': 50000 + i, 'areaSqm': 100, 'rentPeriod': 'annually',
                 'districtArabic': 'حي الملقا'} for i in range(5)]
        doc = ref.build(rows, {'Riyadh': ATLAS}, 'd', default_city='Riyadh')
        self.assertEqual(doc['cities']['Riyadh'][0]['district_ar'], 'الملقا')
        self.assertEqual((doc['listings_placed'], doc['placed_by_coordinates']), (5, 0))
        twice = {'type': 'FeatureCollection', 'features': ATLAS['features'] + [{'properties': {'id': 3, 'ar': 'الملقا'}, 'geometry': square(46.5, 24.5)}]}
        self.assertEqual(ref.build(rows, {'Riyadh': twice}, 'd', default_city='Riyadh')['listings_placed'], 0, 'a shared name is not guessed')


    def test_listing_cards_keep_contact_on_the_private_snapshot_not_the_aggregate(self):
        rows = [dict(listing('rent', 'apartment', 60000 + i * 1000, 120), aqar_id=str(i), url=f'https://sa.aqar.fm/x-{i}',
                     images=[f'{i}.jpg'], title='شقة للإيجار في شارع س, حي العليا, مدينة الرياض', beds=3, phone='0501234567') for i in range(5)]
        cards = []
        ref.build(rows, {'Riyadh': ATLAS}, '2026-10-28', cards=cards)
        self.assertEqual(len(cards), 5)
        first = cards[0]
        self.assertEqual((first['district_ar'], first['kind'], first['group'], first['price_sar'], first['beds']),
                         ('العليا', 'rent', 'residential', 60000, 3))
        self.assertEqual(first['photo'], 'https://images.aqar.fm/webp/350x0/props/0.jpg')
        self.assertEqual(first['url'], 'https://sa.aqar.fm/ad/0/ar', 'the ad opens in the Aqar app, where the person makes contact')
        self.assertEqual(first['address'], 'شارع س, حي العليا, مدينة الرياض')
        self.assertEqual(first['vs_district_pct'], -3)   # 500 per m² against the district's 516.67
        self.assertEqual(first['phone'], '0501234567')
        self.assertFalse({'sellerPhone', 'sellerName'} & set(first))
        self.assertNotIn('0501234567', str(ref.build(rows, {'Riyadh': ATLAS}, '2026-10-28')))

    def test_cards_carry_what_the_property_has_its_dates_and_licence_when_stated(self):
        row = dict(listing('rent', 'apartment', 60000, 120), aqar_id='7', images=['7.jpg'], lift=1, furnished=0,
                   ac=None, pool=3, tenants='families', create_time=1793000000, last_update=0, rega_licensed=True)
        cards = []
        ref.build([row], {'Riyadh': ATLAS}, '2026-10-28', cards=cards)
        card = cards[0]
        self.assertEqual(card['features'], {'lift': 1, 'furnished': 0}, 'unstated and unreadable values stay out')
        self.assertEqual((card['tenants'], card['listed_on'], card['licensed']), ('families', '2026-10-26', True))
        self.assertNotIn('updated_on', card)

    def test_exact_duplicate_listing_rows_count_and_render_once(self):
        rows = [dict(listing('rent', 'apartment', 60000 + i * 1000, 120), aqar_id=str(i)) for i in range(5)]
        rows.append(dict(rows[0]))
        cards = []
        doc = ref.build(rows, {'Riyadh': ATLAS}, '2026-10-28', cards=cards)
        self.assertEqual(doc['listings_with_price'], 5)
        self.assertEqual(doc['cities']['Riyadh'][0]['groups']['rent_year_residential']['listings'], 5)
        self.assertEqual([card['id'] for card in cards], ['0', '1', '2', '3', '4'])

    def test_conflicting_listing_rows_with_the_same_identity_stop_the_build(self):
        first = dict(listing('rent', 'apartment', 60000, 120), aqar_id='same')
        conflicting = dict(first, priceSar=75000)
        with self.assertRaisesRegex(ValueError, 'conflicting listing rows'):
            ref.build([first, conflicting], {'Riyadh': ATLAS}, '2026-10-28', cards=[])

    def test_located_listing_without_an_openable_identity_stops_card_build(self):
        with self.assertRaisesRegex(ValueError, 'no aqar_id or URL identity'):
            ref.build([listing('rent', 'apartment', 60000, 120)], {'Riyadh': ATLAS}, '2026-10-28', cards=[])

    def test_every_located_listing_is_a_card_and_doubtful_ones_are_marked(self):
        rows = [dict(listing('rent', 'apartment', 60000, 120), aqar_id=str(i)) for i in range(5)]
        rows.append(dict(listing('rent', 'apartment', 10000, 120), aqar_id='odd'))           # 83% under: a wrong figure
        rows.append(dict(listing('rent', 'room', 15000, 900), aqar_id='room'))               # a room: no median
        rows.append(dict(listing('rent', 'apartment', 3500, 100, period='monthly'), aqar_id='month'))
        cards = []
        doc = ref.build(rows, {'Riyadh': ATLAS}, '2026-10-28', cards=cards)
        by_id = {card['id']: card for card in cards}
        self.assertEqual(len(cards), 8, 'nothing is left off the map')
        self.assertTrue(by_id['odd']['check'] and by_id['room']['check'])
        self.assertFalse(by_id['0']['check'])
        self.assertEqual((by_id['month']['deal'], by_id['month']['price_sar'], by_id['month']['sar_per_sqm']), ('rent_month', 3500, 35))
        groups = doc['cities']['Riyadh'][0]['groups']
        self.assertEqual(groups['rent_year_residential']['listings'], 6, 'the odd one still counts once in its own median')
        self.assertNotIn('rent_month_residential', groups, 'one monthly rent is not a median')

    def test_a_listing_without_figures_or_outside_every_district_is_still_a_card_with_all_its_photos(self):
        bare = dict(listing('rent', 'store', None, None), aqar_id='bare', images=['a.jpg', 'b.jpg'])
        away = dict(listing('sale', 'villa', 2_000_000, 400, lon=50.0, lat=26.0), aqar_id='away', city_en='Dammam')
        cards = []
        ref.build([bare, away], {'Riyadh': ATLAS}, 'd', cards=cards)
        by_id = {card['id']: card for card in cards}
        self.assertEqual((by_id['bare']['price_sar'], by_id['bare']['sar_per_sqm'], by_id['bare']['check']), (None, None, False),
                         'no figure to doubt: hidden for lack of a price, not marked for checking')
        no_area = [dict(listing('rent', 'store', 90000, None), aqar_id='no_area', images=['a.jpg']),
                   dict(listing('rent', 'store', 4000, None, period='annually'), aqar_id='low_year', images=['a.jpg'])]
        cards = []
        ref.build(no_area, {'Riyadh': ATLAS}, 'd', cards=cards)
        self.assertEqual({card['id']: card['check'] for card in cards}, {'no_area': False, 'low_year': True},
                         'a shop without an area is shown; a yearly rent too low to be one is still doubted')
        self.assertEqual(by_id['bare']['photos'], ['https://images.aqar.fm/webp/750x0/props/a.jpg', 'https://images.aqar.fm/webp/750x0/props/b.jpg'])
        self.assertEqual((by_id['away']['city'], by_id['away']['district_id']), ('Dammam', None))


if __name__ == '__main__':
    unittest.main()
