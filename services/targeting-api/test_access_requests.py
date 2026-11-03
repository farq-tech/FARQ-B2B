import json
import os
import tempfile
import unittest
from unittest.mock import patch

import access_requests
import read_only_test


def body(**changes):
    value = {'name': 'سارة', 'company': 'مطاعم الواحة', 'contact': '0551234567', 'city': 'Riyadh', 'category': 'shops',
             'purpose': 'أبحث عن حي لفرع ثانٍ', 'next': '/map?lens=shops'}
    value.update(changes)
    return value


class ContactTests(unittest.TestCase):
    def test_saudi_mobile_in_its_usual_spellings(self):
        for raw in ('0551234567', '551234567', '+966551234567', '00966551234567', '966 55 123 4567', '٠٥٥١٢٣٤٥٦٧'):
            self.assertEqual(access_requests.contact(raw), ('mobile', '+966551234567'), raw)

    def test_email_is_lowercased_and_others_rejected(self):
        self.assertEqual(access_requests.contact(' Sara@Company.SA '), ('email', 'sara@company.sa'))
        for raw in ('0451234567', '12345', 'sara@', 'sara@company', '<a>@b.sa', '', None):
            self.assertIsNone(access_requests.contact(raw), raw)


class ValidateTests(unittest.TestCase):
    def test_a_complete_request_passes_and_is_cleaned(self):
        record, errors = access_requests.validate(body(name='  سارة \n <b>  '), {'Riyadh'})
        self.assertIsNone(errors)
        self.assertEqual(record['name'], 'سارة b')
        self.assertEqual(record['contact_kind'], 'mobile')

    def test_each_wrong_field_is_named(self):
        _, errors = access_requests.validate({'name': 'س', 'contact': 'x', 'city': 'Atlantis', 'category': 'spies', 'purpose': 'x' * 501}, {'Riyadh'})
        self.assertEqual(set(errors), {'name', 'company', 'contact', 'city', 'category', 'purpose'})

    def test_purpose_is_optional_and_an_outside_next_is_dropped(self):
        record, errors = access_requests.validate(body(purpose=None, next='//evil.example'))
        self.assertIsNone(errors)
        self.assertEqual(record['purpose'], '')
        self.assertIsNone(record['next'])


class SubmitTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()

    def test_stores_one_line_and_the_same_contact_once_a_day(self):
        status, answer = access_requests.submit(self.folder, body(), {'Riyadh'}, now=1000.0)
        self.assertEqual(status, 201)
        self.assertTrue(answer['ok'])
        self.assertNotIn('contact', answer, 'the answer never repeats the contact')
        status, answer = access_requests.submit(self.folder, body(contact='+966551234567'), {'Riyadh'}, now=2000.0)
        self.assertEqual((status, answer.get('duplicate')), (200, True))
        rows = access_requests.read_all(self.folder)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['contact'], '+966551234567')
        status, _ = access_requests.submit(self.folder, body(), {'Riyadh'}, now=1000.0 + 25 * 3600)
        self.assertEqual(status, 201, 'a day later the same contact may ask again')

    def test_invalid_request_is_not_stored(self):
        status, answer = access_requests.submit(self.folder, body(city='Paris'), {'Riyadh'})
        self.assertEqual(status, 400)
        self.assertEqual(answer['fields'], {'city': 'INVALID'})
        self.assertEqual(access_requests.read_all(self.folder), [])

    def test_daily_cap(self):
        with patch.object(access_requests, 'DAILY_CAP', 2):
            for i in range(2):
                self.assertEqual(access_requests.submit(self.folder, body(contact=f'05500000{i:02d}'), now=500.0)[0], 201)
            self.assertEqual(access_requests.submit(self.folder, body(contact='0559999999'), now=600.0)[0], 429)

    def test_a_broken_line_is_skipped(self):
        access_requests.submit(self.folder, body(), now=1.0)
        with open(os.path.join(self.folder, access_requests.FILE_NAME), 'a', encoding='utf-8') as handle:
            handle.write('{not json\n')
        self.assertEqual(len(access_requests.read_all(self.folder)), 1)


class RenderTests(unittest.TestCase):
    def test_every_value_is_escaped_and_newest_first(self):
        rows = [{'id': '1', 'name': 'أول', 'received_at': 'a'}, {'id': '2', 'name': '<script>x</script>', 'received_at': 'b'}]
        page = access_requests.render_html(rows)
        self.assertNotIn('<script>', page)
        self.assertIn('&lt;script&gt;', page)
        self.assertLess(page.index('&lt;script&gt;'), page.index('أول'))
        self.assertIn('لا طلبات بعد', access_requests.render_html([]))


class ReadOnlyTests(unittest.TestCase):
    def test_the_read_only_deployment_stores_no_request(self):
        with patch.dict(os.environ, {'ATLAS_READ_ONLY': '1'}, clear=False):
            self.assertTrue(read_only_test.blocks_request('/access-requests'))


if __name__ == '__main__':
    unittest.main()
