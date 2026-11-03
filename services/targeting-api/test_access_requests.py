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


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        _, answer = access_requests.submit(self.folder, body(), now=10.0)
        self.id = answer['id']
        access_requests.submit(self.folder, body(contact='0550000001'), now=11.0)

    def test_a_decision_replaces_the_earlier_one_and_the_request_file_is_untouched(self):
        path = os.path.join(self.folder, access_requests.FILE_NAME)
        with open(path, encoding='utf-8') as handle:
            before = handle.read()
        self.assertEqual(access_requests.unread_count(self.folder), 2)
        self.assertEqual(access_requests.review(self.folder, self.id, 'reviewed', 'اتصلت به', now=20.0)[0], 200)
        self.assertEqual(access_requests.review(self.folder, self.id, 'approved', ' أُنشئ الحساب يدوياً <b> ', now=30.0)[0], 200)
        rows = {row['id']: row for row in access_requests.with_reviews(self.folder)}
        self.assertEqual((rows[self.id]['status'], rows[self.id]['note']), ('approved', 'أُنشئ الحساب يدوياً b'))
        self.assertEqual(access_requests.unread_count(self.folder), 1)
        with open(path, encoding='utf-8') as handle:
            self.assertEqual(handle.read(), before)
        self.assertEqual(len(access_requests.read_reviews(self.folder)), 2, 'every decision is kept as a trail')

    def test_wrong_status_note_or_id(self):
        self.assertEqual(access_requests.review(self.folder, self.id, 'new')[0], 400)
        self.assertEqual(access_requests.review(self.folder, self.id, 'approved', 'x' * 501)[0], 400)
        self.assertEqual(access_requests.review(self.folder, '0' * 16, 'approved')[0], 404)
        self.assertEqual(access_requests.review(self.folder, '../etc', 'approved')[0], 404)
        self.assertEqual(access_requests.read_reviews(self.folder), [])

    def test_the_page_shows_the_decision_the_unread_count_and_a_form_per_request(self):
        access_requests.review(self.folder, self.id, 'rejected', 'A & "B"')
        page = access_requests.render_html(access_requests.with_reviews(self.folder), saved=True)
        self.assertIn('جديدة لم يُتخذ فيها قرار: <strong>1</strong>', page)
        self.assertIn('مرفوض', page)
        self.assertIn('A &amp; &quot;B&quot;', page)
        self.assertNotIn('A & "B"', page)
        self.assertEqual(page.count('action="/access-requests/review"'), 2)
        self.assertIn('حُفظ القرار', page)


class ReadOnlyTests(unittest.TestCase):
    def test_the_read_only_deployment_stores_no_request(self):
        with patch.dict(os.environ, {'ATLAS_READ_ONLY': '1'}, clear=False):
            self.assertTrue(read_only_test.blocks_request('/access-requests'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/review'))


if __name__ == '__main__':
    unittest.main()
