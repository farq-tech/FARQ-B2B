import unittest

import build_real_estate_reference as reference
import parse_aqar_list as parse

SALE = {'name': 'شقة للبيع في شارع مالك بن الحارث, حي بدر, مدينة الرياض, منطقة الرياض', 'data': '599,000 § ريال',
        'data2': '168م²', 'image': 'https://images.aqar.fm/a.jpg'}
RENT = {'name': 'محل للإيجار في شارع الأمير سلطان, حي المحمدية, مدينة الرياض, منطقة الرياض', 'data': '120,000',
        'brand': '120,000 § ريال/سنوي', 'data2': '100م²', 'image': 'https://images.aqar.fm/b.jpg',
        'link': 'https://sa.aqar.fm/ad/1'}


class ParseAqarListTest(unittest.TestCase):
    def test_sale_card(self):
        listing = parse.parse_row(SALE)
        self.assertEqual((listing['listingType'], listing['propertyType'], listing['priceSar'], listing['areaSqm']),
                         ('sale', 'apartment', 599000, 168))
        self.assertEqual(listing['districtArabic'], 'بدر')
        self.assertEqual(reference.price_per_sqm(listing)[:2], ('sale', 'residential'))

    def test_yearly_rent_and_link(self):
        listing = parse.parse_row(RENT)
        self.assertEqual((listing['rentPeriod'], listing['url']), ('annually', 'https://sa.aqar.fm/ad/1'))
        self.assertEqual(reference.price_per_sqm(listing), ('rent_year', 'commercial', 1200))

    def test_the_period_is_the_one_the_card_or_text_states(self):
        self.assertEqual(parse.parse_row({**RENT, 'brand': '3,800 § ريال', 'description': 'الإيجار شهري 3800'})['rentPeriod'], 'monthly')
        self.assertIsNone(parse.parse_row({**RENT, 'brand': '3,800 § ريال'})['rentPeriod'], 'no period stated, none assumed')

    def test_unreadable_card_and_repeats(self):
        self.assertIsNone(parse.parse_row({'name': 'إعلان مميز', 'data': '1'}))
        self.assertEqual(len(parse.parse_rows([SALE, SALE, RENT, {**RENT, 'image': 'x'}])), 2)

    def test_collector_record(self):
        record = {'id': '6896439', 'url': 'https://sa.aqar.fm/x-6896439', 'image': 'https://images.aqar.fm/p.jpg',
                  'path': ['فلل-للإيجار', 'الرياض', 'شمال-الرياض', 'حي-جامعة-الأميرة-نورة', 'شارع-رقم-1095-6896439'],
                  'lines': ['فيلا للإيجار في شارع رقم 1095, حي سدرة, مدينة الرياض, منطقة الرياض', '145,000 § ريال /سنوي',
                            '300م²', '4', 'للإيجار فيلا جديدة سدرة روشن المساحة 300 م²']}
        listing = parse.parse_collected(record)
        self.assertEqual((listing['districtArabic'], listing['city_en'], listing['rentPeriod'], listing['aqar_id']),
                         ('جامعة الأميرة نورة', 'Riyadh', 'annually', '6896439'))
        self.assertEqual(reference.price_per_sqm(listing), ('rent_year', 'residential', 145000 / 300))
        self.assertEqual(len(parse.parse_rows([record, record])), 1)

    def test_map_listing(self):
        record = {'id': 6896439, 'title': 'فيلا للإيجار في شارع رقم 1095, حي سدرة, مدينة الرياض, منطقة الرياض',
                  'price': 145000, 'area': 300, 'rent_period': 3, 'content': 'فيلا جديدة الإيجار سنوي',
                  'location': {'lat': 24.85, 'lng': 46.72}, 'district': 'حي جامعة الأميرة نورة', 'district_id': 1,
                  'city': 'الرياض', 'path': '/فلل-للإيجار/الرياض/x-6896439', 'imgs': ['a.jpg'], 'user': {'name': 'x'}}
        listing = parse.parse_map_listing(record)
        self.assertEqual((listing['latitude'], listing['rentPeriod'], listing['city_en'], listing['url']),
                         (24.85, 'annually', 'Riyadh', 'https://sa.aqar.fm/فلل-للإيجار/الرياض/x-6896439'))
        self.assertNotIn('user', listing)
        monthly = parse.parse_map_listing({**record, 'price': 2500, 'content': 'إيجار شهري'})
        self.assertEqual(monthly['rentPeriod'], 'monthly', 'the text wins over Aqar\'s yearly field')
        self.assertIsNone(parse.parse_map_listing({**record, 'rent_period': None, 'content': ''})['rentPeriod'])
        room = parse.parse_map_listing({**record, 'title': 'غرفة للإيجار في حي العليا, مدينة الرياض', 'area': 2921})
        self.assertIsNone(reference.price_per_sqm(room))
        twelve = parse.parse_map_listing({**record, 'title': 'دور للإيجار في حي طويق, مدينة الرياض', 'price': 3750,
                                          'area': 175, 'content': '', 'price_12_payments': 45600})
        self.assertEqual(twelve['rentPeriod'], 'monthly')
        self.assertEqual(reference.price_per_sqm(twelve), ('rent_month', 'residential', 3750 / 175))
        unmarked = parse.parse_map_listing({**record, 'title': 'شقة للإيجار في حي طويق, مدينة الرياض', 'price': 2000,
                                            'area': 94, 'content': ''})
        self.assertIsNone(reference.price_per_sqm(unmarked))
        building = parse.parse_map_listing({**record, 'title': 'شقة للإيجار في حي طويق, مدينة الرياض', 'price': 26000,
                                            'area': 900, 'content': ''})
        self.assertIsNone(reference.price_per_sqm(building))
        shop = parse.parse_map_listing({**record, 'title': 'محل للإيجار في حي العليا, مدينة الرياض', 'price': 120000,
                                        'area': 80, 'content': '', 'rent_period': None})
        self.assertEqual(reference.price_per_sqm(shop), ('rent_year', 'commercial', 1500))
        office_month = parse.parse_map_listing({**record, 'title': 'مكتب تجاري للإيجار في حي العليا, مدينة الرياض', 'price': 1500,
                                                'area': 40, 'content': '', 'rent_period': None})
        self.assertEqual(reference.price_per_sqm(office_month), ('rent_unstated', 'office', 37.5), 'no period stated: its own figure')
        on_request = parse.parse_map_listing({**record, 'title': '', 'price': None, 'area': None, 'path': '/محلات-للإيجار/الرياض/x-1'})
        self.assertEqual((on_request['listingType'], on_request['propertyType'], on_request['priceSar']), ('rent', 'other', None),
                         'a listing with no price, area or readable title is kept')


if __name__ == '__main__':
    unittest.main()
