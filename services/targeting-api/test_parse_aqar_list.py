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
        self.assertEqual(reference.price_per_sqm(listing), ('rent', 'commercial', 1200))

    def test_monthly_text_under_a_yearly_label_has_no_period(self):
        listing = parse.parse_row({**RENT, 'description': 'الإيجار شهري 3800'})
        self.assertIsNone(listing['rentPeriod'])
        self.assertIsNone(reference.price_per_sqm(listing))

    def test_unreadable_card_and_repeats(self):
        self.assertIsNone(parse.parse_row({'name': 'إعلان مميز', 'data': '1'}))
        self.assertEqual(len(parse.parse_rows([SALE, SALE, RENT, {**RENT, 'image': 'x'}])), 2)


if __name__ == '__main__':
    unittest.main()
