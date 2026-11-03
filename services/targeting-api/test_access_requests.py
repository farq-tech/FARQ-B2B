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
        status, answer = access_requests.submit(self.folder, body(), {'Riyadh'}, now=1000.0 + 25 * 3600)
        self.assertEqual((status, answer.get('duplicate')), (200, True), 'still open a day later: under review, not stored again')
        access_requests.review(self.folder, rows[0]['id'], 'reviewed', now=2000.0)
        self.assertEqual(access_requests.submit(self.folder, body(), now=1000.0 + 26 * 3600)[0], 200, 'reviewed is still open')
        access_requests.review(self.folder, rows[0]['id'], 'rejected', now=3000.0)
        status, _ = access_requests.submit(self.folder, body(), {'Riyadh'}, now=1000.0 + 27 * 3600)
        self.assertEqual(status, 201, 'once decided, and a day later, the same contact may ask again')

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
        self.assertNotIn('<script>x</script>', page)
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


class ConsoleRound3Tests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.ids = [access_requests.submit(self.folder, body(contact=f'05500000{i:02d}', name=f'شخص {i}'), now=100.0 + i)[1]['id'] for i in range(3)]
        access_requests.review(self.folder, self.ids[0], 'approved', 'اتصلت', now=200.0)
        access_requests.review(self.folder, self.ids[1], 'rejected', now=201.0)

    def test_the_status_filter_shows_only_that_status_newest_first_with_counts(self):
        rows = access_requests.with_reviews(self.folder)
        page = access_requests.render_html(rows, status='new')
        self.assertIn('شخص 2', page)
        self.assertNotIn('شخص 0', page)
        self.assertIn('<strong aria-current="page">جديد (1)</strong>', page)
        self.assertIn('href="/access-requests?status=approved">موافق عليه (1)', page)
        everything = access_requests.render_html(rows, status='nonsense')
        self.assertLess(everything.index('شخص 2'), everything.index('شخص 0'), 'an unknown filter shows all, newest first')
        self.assertIn('لا طلبات بهذه الحالة', access_requests.render_html(rows[:1], status='rejected'))

    def test_approved_shows_the_account_details_to_copy_and_nothing_else_does(self):
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertEqual(page.count('بيانات إنشاء الحساب'), 1)
        self.assertIn('الجوال: +966550000000', page)
        self.assertIn('data-copy="d-' + self.ids[0] + '"', page)

    def test_redact_empties_the_personal_details_and_notes_and_keeps_the_rest(self):
        self.assertEqual(access_requests.redact(self.folder, self.ids[0], now=300.0)[0], 200)
        self.assertEqual(access_requests.redact(self.folder, 'f' * 16)[0], 404)
        rows = {row['id']: row for row in access_requests.with_reviews(self.folder)}
        gone = rows[self.ids[0]]
        for field in access_requests.PERSONAL_FIELDS:
            self.assertNotIn(field, gone)
        self.assertEqual((gone['status'], gone['note'], gone['city'], gone['category'], gone['redacted_why']), ('approved', '', 'Riyadh', 'shops', 'owner'))
        self.assertEqual(rows[self.ids[2]]['name'], 'شخص 2', 'the others are untouched')
        with open(os.path.join(self.folder, access_requests.FILE_NAME), encoding='utf-8') as handle:
            self.assertNotIn('+966550000000', handle.read())
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertIn('بطلب صاحبها', page)
        self.assertEqual(page.count('بيانات إنشاء الحساب'), 0, 'nothing left to copy')

    def test_retention_empties_only_old_requests(self):
        self.assertEqual(access_requests.apply_retention(self.folder, now=100.0 + 40 * 86400, days=30), 3)
        self.assertEqual(access_requests.apply_retention(self.folder, now=100.0 + 41 * 86400, days=30), 0, 'once')
        self.assertTrue(all(row.get('redacted_why') == 'retention' for row in access_requests.read_all(self.folder)))
        fresh = tempfile.mkdtemp()
        access_requests.submit(fresh, body(), now=1000.0)
        self.assertEqual(access_requests.apply_retention(fresh, now=1000.0 + 29 * 86400, days=30), 0)
        with patch.dict(os.environ, {'FARQ_ACCESS_REQUEST_RETENTION_DAYS': '5'}):
            self.assertEqual(access_requests.retention_days(), 30, 'never shorter than 30 days')

    def test_a_redacted_contact_may_ask_again(self):
        access_requests.redact(self.folder, self.ids[2])
        self.assertEqual(access_requests.submit(self.folder, body(contact='0550000002'), now=100.0 + 2 * 86400)[0], 201)


class RoundETests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.first = access_requests.submit(self.folder, body(name='ريم', company='مخابز الندى', contact='0551112222', city='Jeddah'), now=100.0)[1]['id']
        access_requests.submit(self.folder, body(name='فهد', company='توزيع الشرق', contact='fahad@east.sa', category='distributors'), now=200.0)

    def test_the_retention_job_runs_on_its_own_and_stops(self):
        import threading
        stop, ran = threading.Event(), threading.Event()
        with patch.object(access_requests, 'retention_days', return_value=30), patch.object(access_requests.time, 'time', return_value=100.0 + 40 * 86400):
            access_requests.start_retention(self.folder, every=0.01, first_after=0, stop=stop, log=lambda n: ran.set())
            self.assertTrue(ran.wait(2))
            stop.set()
        self.assertTrue(all(row.get('redacted_at') for row in access_requests.read_all(self.folder)))

    def test_search_finds_every_word_in_any_field_and_either_city_spelling(self):
        rows = access_requests.with_reviews(self.folder)
        names = {'Jeddah': 'جدة', 'Riyadh': 'الرياض'}
        self.assertEqual([row['name'] for row in rows if access_requests.matches(row, 'الندى جده', names)], ['ريم'], 'ة and ه are one letter')
        self.assertEqual([row['name'] for row in rows if access_requests.matches(row, 'EAST.sa', names)], ['فهد'])
        self.assertEqual([row['name'] for row in rows if access_requests.matches(row, '٥٥١١١٢', names)], ['ريم'], 'Arabic-Indic digits')
        page = access_requests.render_html(rows, query='فهد', city_names=names)
        self.assertIn('توزيع الشرق', page)
        self.assertNotIn('مخابز الندى', page)
        self.assertIn('href="/access-requests?status=new&amp;q=', page, 'the filters keep the search')
        self.assertIn('لا طلبات تطابق البحث', access_requests.render_html(rows, query='لا أحد'))

    def test_a_deletion_ask_keeps_only_a_hash_flags_the_request_and_reveals_nothing(self):
        self.assertEqual(access_requests.request_deletion(self.folder, '+966551112222', now=300.0), (200, {'ok': True}))
        self.assertEqual(access_requests.request_deletion(self.folder, 'nobody@x.sa', now=301.0), (200, {'ok': True}), 'same answer without a request')
        self.assertEqual(access_requests.request_deletion(self.folder, 'x')[0], 400)
        with open(os.path.join(self.folder, access_requests.DELETIONS_NAME), encoding='utf-8') as handle:
            text = handle.read()
        self.assertNotIn('551112222', text)
        self.assertNotIn('nobody', text)
        rows = {row['name']: row for row in access_requests.with_reviews(self.folder)}
        self.assertTrue(rows['ريم']['deletion_asked'])
        self.assertIsNone(rows['فهد']['deletion_asked'])
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertIn('طلبات حذف بيانات تنتظر: <strong>1</strong>', page)
        access_requests.redact(self.folder, self.first)
        self.assertNotIn('طلبات حذف بيانات تنتظر', access_requests.render_html(access_requests.with_reviews(self.folder)))

    def test_a_contact_approved_before_is_flagged_on_its_next_request(self):
        access_requests.review(self.folder, self.first, 'approved', now=150.0)
        access_requests.submit(self.folder, body(name='ريم', contact='0551112222'), now=100.0 + 2 * 86400)
        rows = access_requests.with_reviews(self.folder)
        flagged = [row for row in rows if row['prior_approved']]
        self.assertEqual(len(flagged), 1)
        self.assertNotEqual(flagged[0]['id'], self.first, 'the approved request itself is not flagged')
        self.assertIn('سبق قبوله', access_requests.render_html(rows))

    def test_arabic_city_names_in_the_list_the_details_and_the_demand_table(self):
        access_requests.review(self.folder, self.first, 'approved')
        rows = access_requests.with_reviews(self.folder)
        page = access_requests.render_html(rows, city_names={'Jeddah': 'جدة', 'Riyadh': 'الرياض'})
        self.assertIn('المدينة: جدة', page)
        self.assertIn('<td>الرياض</td>', page)
        self.assertNotIn('<td>Jeddah</td>', page)
        self.assertIn('Jeddah', access_requests.render_html(rows), 'without the list, the stored key')

    def test_demand_counts_survive_clearing(self):
        access_requests.submit(self.folder, body(contact='0553334444', city='Jeddah'), now=40 * 86400.0)
        before = access_requests.aggregate(access_requests.with_reviews(self.folder))
        access_requests.apply_retention(self.folder, now=400 * 86400.0, days=30)
        after = access_requests.aggregate(access_requests.with_reviews(self.folder))
        self.assertEqual(before, after)
        self.assertEqual(after[0][0], '1970-02', 'newest month first')
        self.assertEqual(sum(item[3] for item in after), 3)
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertIn('الطلب حسب الشهر والمدينة والفئة', page)
        self.assertNotIn('ريم', page)


class RoundE2Tests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.a = access_requests.submit(self.folder, body(name='مها', contact='0552223333'), now=100.0)[1]['id']
        access_requests.review(self.folder, self.a, 'rejected', 'لاحقاً', now=150.0)
        self.b = access_requests.submit(self.folder, body(name='مها', contact='+966552223333'), now=100.0 + 2 * 86400)[1]['id']
        self.other = access_requests.submit(self.folder, body(name='خالد', contact='0559990000'), now=300.0)[1]['id']
        access_requests.request_deletion(self.folder, '0552223333', now=100.0 + 3 * 86400)

    def rows(self):
        return {row['id']: row for row in access_requests.with_reviews(self.folder)}

    def test_delete_everything_needs_a_flag_and_the_owners_tick(self):
        self.assertEqual(access_requests.redact_person(self.folder, self.other), (409, {'ok': False, 'error': 'NO_DELETION_ASK'}))
        self.assertEqual(access_requests.redact_person(self.folder, self.b)[1]['error'], 'NOT_CONFIRMED')
        self.assertEqual(access_requests.confirm_deletion(self.folder, self.other)[0], 409, 'only a flagged request can be ticked')
        self.assertEqual(access_requests.confirm_deletion(self.folder, self.b, now=500.0)[0], 200)
        self.assertTrue(self.rows()[self.a]['deletion_confirmed'], 'the tick covers every request of the person')
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertIn('احذف كل بيانات هذا الشخص (2)', page)
        self.assertEqual(access_requests.redact_person(self.folder, self.b), (200, {'ok': True, 'cleared': 2}))
        rows = self.rows()
        self.assertTrue(rows[self.a]['redacted_at'] and rows[self.b]['redacted_at'])
        self.assertEqual(rows[self.a]['note'], '')
        self.assertFalse(rows[self.other].get('redacted_at'))
        self.assertEqual(access_requests.read_deletions(self.folder), [], 'the ask goes too')

    def test_the_tick_can_be_taken_back_and_hides_the_button(self):
        access_requests.confirm_deletion(self.folder, self.b)
        access_requests.confirm_deletion(self.folder, self.b, confirmed=False)
        self.assertIsNone(self.rows()[self.b]['deletion_confirmed'])
        page = access_requests.render_html(access_requests.with_reviews(self.folder))
        self.assertNotIn('احذف كل بيانات هذا الشخص', page)
        self.assertIn('تم التأكد من أن الطلب من صاحب البيانات', page)

    def test_the_flag_filter(self):
        rows = access_requests.with_reviews(self.folder)
        page = access_requests.render_html(rows, flag='deletion')
        self.assertIn('<strong aria-current="true">طلب حذف بياناته (2)</strong>', page)
        self.assertNotIn('خالد', page)
        self.assertIn('href="/access-requests?status=all&amp;flag=prior"', page)
        self.assertIn('لا طلبات بهذه التصفية', access_requests.render_html(rows, flag='prior'))

    def test_fifty_a_page_newest_first_with_the_filters_kept(self):
        folder = tempfile.mkdtemp()
        for i in range(120):
            access_requests.submit(folder, body(name=f'رقم {i:03d}', contact=f'0560{i:06d}'), now=1000.0 + i)
        rows = access_requests.with_reviews(folder)
        first = access_requests.render_html(rows, query='رقم')
        self.assertIn('رقم 119', first)
        self.assertNotIn('رقم 069', first)
        self.assertIn('الصفحة 1 من 3', first)
        self.assertIn('href="/access-requests?status=all&amp;q=%D8%B1%D9%82%D9%85&amp;page=2"', first)
        last = access_requests.render_html(rows, page='3')
        self.assertIn('رقم 000', last)
        self.assertNotIn('رقم 020', last)
        self.assertIn('الطلبات 101 إلى 120 من 120', last)
        self.assertIn('الصفحة 1 من 3', access_requests.render_html(rows, page='nonsense'))
        self.assertIn('الصفحة 3 من 3', access_requests.render_html(rows, page='99'))

    def test_seven_day_counts(self):
        rows = access_requests.with_reviews(self.folder)
        self.assertEqual(access_requests.week_counts(rows, now=100.0 + 3 * 86400), (3, 0))
        self.assertEqual(access_requests.week_counts(rows, now=100.0 + 8.5 * 86400), (1, 2))
        self.assertIn('طلبات آخر 7 أيام: <strong>1</strong>، أقل', access_requests.render_html(rows, now=100.0 + 8.5 * 86400))

    def test_the_retention_metric_counts_runs_and_waiting_without_details(self):
        import threading
        stop, ran = threading.Event(), threading.Event()
        before = dict(access_requests.RETENTION_STATS)
        # a period long enough that this run clears nothing (the fixture's times are from 1970)
        with patch.object(access_requests, 'retention_days', return_value=10 ** 6):
            access_requests.start_retention(self.folder, every=60, first_after=0, stop=stop, log=lambda n: ran.set())
            self.assertTrue(ran.wait(2))
            stop.set()
        text = '\n'.join(access_requests.metric_lines(self.folder))
        self.assertIn(f'atlas_access_request_retention_runs_total {before["runs"] + 1}', text)
        self.assertIn('atlas_access_requests_waiting{kind="deletion"} 1', text, 'one person, two requests')
        self.assertIn('atlas_access_requests_waiting{kind="decision"} 2', text)
        self.assertNotRegex(text, r'last_success_timestamp_seconds 0$')
        self.assertNotIn('مها', text)
        self.assertNotIn('555', text.replace('atlas', ''))


class ReadOnlyTests(unittest.TestCase):
    def test_the_read_only_deployment_stores_no_request(self):
        with patch.dict(os.environ, {'ATLAS_READ_ONLY': '1'}, clear=False):
            self.assertTrue(read_only_test.blocks_request('/access-requests'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/review'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/redact'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/deletion'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/redact-person'))
            self.assertTrue(read_only_test.blocks_request('/access-requests/deletion-confirm'))


if __name__ == '__main__':
    unittest.main()
