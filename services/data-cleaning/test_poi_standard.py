"""The POI standard layer: each rule, the owner's change (empty, never «UNAVAILABLE»), and that nothing is lost."""
import json
import os
import pathlib
import tempfile
import unittest

import duckdb

import poi_standard as ps

MAP = str(pathlib.Path(__file__).resolve().parents[2] / 'docs' / 'qa' / 'targeting' / 'taxonomy' / 'standard_category_map.csv')
CATS = ps.load_category_map(MAP)


class NameTests(unittest.TestCase):
    def test_category_suffix_and_other_script_are_removed(self):
        self.assertEqual(ps.name_ar('مقهى الياسمين، مقهى'), 'مقهى الياسمين')
        self.assertEqual(ps.name_ar('صيدلية النور Al Noor'), 'صيدلية النور')
        self.assertEqual(ps.name_en('Starbucks, coffee shop'), 'Starbucks')
        self.assertEqual(ps.name_en('Al Noor صيدلية'), 'Al Noor')

    def test_transliteration(self):
        self.assertEqual(ps.transliterate('النور'), 'Al Nwr')


class PhoneTests(unittest.TestCase):
    def test_saudi_formats(self):
        self.assertEqual(ps.phone('0501894546'), '+966 50 189 4546')
        self.assertEqual(ps.phone('966501894546'), '+966 50 189 4546')
        self.assertEqual(ps.phone('+966 11 234 5678'), '+966 11 234 5678')
        self.assertEqual(ps.phone('920011696'), '920 011 696')
        self.assertEqual(ps.phone('+966920011696'), '920 011 696', '920 never takes +966')
        self.assertEqual(ps.phone('8001111318'), '800 111 1318')

    def test_short_or_foreign_numbers_are_empty_not_unavailable(self):
        self.assertEqual(ps.phone('05018945'), '')
        self.assertEqual(ps.phone('+971501234567'), '')
        self.assertEqual(ps.phone(None), '')


class FloorTests(unittest.TestCase):
    def test_floor_spellings(self):
        self.assertEqual(ps.floor('Ground floor'), ('G', False))
        self.assertEqual(ps.floor('0'), ('G', False))
        self.assertEqual(ps.floor('2'), ('2', False))
        self.assertEqual(ps.floor('B1'), ('B1', False))
        self.assertEqual(ps.floor(None), ('G', True), 'the standard defaults a missing floor to G, marked inferred')


class WebTests(unittest.TestCase):
    def test_social_link_moves_out_of_website(self):
        site, social, flags, _ = ps.website('https://instagram.com/proteinklounge', None, 'Proteink Lounge')
        self.assertEqual(site, '')
        self.assertEqual(social, ['https://instagram.com/proteinklounge'])
        self.assertIn('website:social_moved', flags)

    def test_website_of_another_business_is_blanked(self):
        site, _, flags, _ = ps.website('http://www.aldrees.com/', None, 'Hanadi Batteries')
        self.assertEqual(site, '')
        self.assertIn('website:other_business', flags)

    def test_matching_domain_gets_https(self):
        self.assertEqual(ps.website('proteink.sa', None, 'Proteink')[0], 'https://proteink.sa')

    def test_company_email_gives_a_website(self):
        site, _, _, inferred = ps.website(None, 'info@proteink.sa', 'Proteink')
        self.assertEqual(site, 'https://proteink.sa')
        self.assertIn('website:from_email_domain', inferred)

    def test_generated_email_is_marked(self):
        mail, _, inferred = ps.email(None, 'https://proteink.sa', 'Proteink', medical=False)
        self.assertEqual(mail, 'info@proteink.sa')
        self.assertIn('email:generated', inferred)
        self.assertEqual(ps.email(None, 'https://alnoor-clinic.sa', 'Al Noor Clinic', medical=True)[0], 'care@alnoor-clinic.sa')

    def test_invalid_emails(self):
        for bad in ('388fe63e@sentry.io', 'johndoe@domain.com', 'info@domain.com:81'):
            self.assertEqual(ps.email(bad, '', 'Proteink', medical=False)[0], '')
        self.assertEqual(ps.email('owner@gmail.com', '', 'Proteink', medical=False)[0], 'owner@gmail.com', 'personal mail is kept')


class HoursTests(unittest.TestCase):
    def test_readable_hours_become_the_standard(self):
        wh, wd, brk = ps.hours('Sun: 09:00 - 13:00, 16:00 - 23:00 | Mon: 09:00 - 23:00 | Fri: 13:00 - 23:00')
        self.assertEqual(wh, 'Sun: 09:00-13:00, 16:00-23:00; Mon: 09:00-23:00; Fri: 13:00-23:00')
        self.assertEqual(wd, 'Sun, Mon, Fri')
        self.assertEqual(brk, '13:00-16:00')

    def test_open_24_hours(self):
        day = ' | '.join(f'{d}: 00:00 - 24:00' for d in ps.normalize_hours.SHORT)
        self.assertEqual(ps.hours(day), ('Open 24 Hours', 'Daily', 'No Break'))

    def test_unknown_hours_are_empty(self):
        self.assertEqual(ps.hours(None), ('', '', ''))


class RecordTests(unittest.TestCase):
    def record(self, **over):
        row = {'poi_key': 'k1', 'name_ar': 'مطعم الشامي', 'name_en': 'Al Shami Restaurant', 'latitude': 24.7789131, 'longitude': 46.6879682,
               'sub_id': 'food.restaurant', 'main_id': 'food', 'company_status': 'open'}
        row.update(over)
        return ps.standardize(row, CATS)

    def test_restaurant(self):
        values, inferred, _ = self.record()
        self.assertEqual(values['std_category'], 'Restaurants')
        self.assertEqual(values['std_dine_in'], 'Yes')
        self.assertEqual(values['std_has_family_seating'], 'Yes')
        self.assertEqual(values['std_cuisine'], 'Syrian / Levantine')
        self.assertEqual(values['std_google_map_url'], 'https://www.google.com/maps?q=24.778913,46.687968')
        self.assertEqual(values['std_payment_methods'], ps.DEFAULT_PAYMENT)
        self.assertIn('payment:rule', inferred)
        self.assertIn('dine_in:rule', inferred)

    def test_bank_gets_unapplicable_for_food_fields(self):
        values, _, _ = self.record(name_en='Riyad Bank', name_ar='بنك الرياض', sub_id='fin.bank', main_id='fin')
        self.assertEqual(values['std_category'], 'Finance & Insurance')
        for field in ('std_dine_in', 'std_drive_thru', 'std_shisha', 'std_cuisine', 'std_has_family_seating', 'std_menu'):
            self.assertEqual(values[field], 'UNAPPLICABLE', field)
        self.assertEqual(values['std_holidays'], 'National Day (Sep 23), Founding Day (Feb 22), Eid Al-Fitr, Eid Al-Adha')

    def test_mosque(self):
        values, _, _ = self.record(name_ar='جامع الراجحي', name_en='', sub_id='noncom.mosque', main_id='noncom')
        self.assertEqual(values['std_payment_methods'], 'UNAPPLICABLE')
        self.assertEqual(values['std_language'], 'Arabic')
        self.assertEqual(values['std_provides_iftar_tent'], 'Yes')
        self.assertEqual(values['std_name_en'], 'Jama Al Rajhy')

    def test_chain_with_drive_thru(self):
        values, _, _ = self.record(name_en="McDonald's", name_ar='ماكدونالدز', sub_id='food.fast_food')
        self.assertEqual(values['std_drive_thru'], 'Yes')
        self.assertEqual(values['std_pickup_point_exists'], 'Yes')
        self.assertEqual(values['std_children_area'], 'Yes')

    def test_known_closure_is_never_rewritten_as_open(self):
        self.assertEqual(self.record(company_status='temporarily_closed')[0]['std_company_status'], 'temporarily_closed')

    def test_no_value_is_ever_unavailable(self):
        values, _, _ = self.record(name_en=None, latitude=None, longitude=None, sub_id=None, main_id=None)
        self.assertNotIn('UNAVAILABLE', json.dumps(values))


class RunTests(unittest.TestCase):
    def test_layer_dedupes_and_never_writes_the_source(self):
        root = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('create table t(poi_key varchar, name_ar varchar, name_en varchar, latitude double, longitude double, phone_norm varchar, website varchar)')
        db.executemany('insert into t values (?,?,?,?,?,?,?)', [
            ('a', 'محل أ', 'Shop A', 24.1, 46.1, '0501111111', None),
            ('b', 'محل ب', 'Shop B', 24.2, 46.2, '0501111111', None),
            ('c', 'محل ج', 'Shop C', 24.3, 46.3, '0501111111', None),   # third unrelated business on one phone
            ('d', 'ستاربكس', 'Starbucks', 24.4, 46.4, '0502222222', 'https://starbucks.sa'),
            ('e', 'ستاربكس', 'Starbucks', 24.5, 46.5, '0502222222', 'https://starbucks.sa'),   # a branch shares both
        ])
        db.execute(f"copy t to '{root / 'targets.parquet'}' (format parquet)")
        before = (root / 'targets.parquet').read_bytes()
        report = ps.run(str(root / 'targets.parquet'), None, MAP, str(root / 'std.parquet'))
        rows = {r[0]: r[1:] for r in db.execute(f"select poi_key, std_phone, std_website, std_flags from read_parquet('{root / 'std.parquet'}')").fetchall()}
        self.assertEqual(rows['a'][0], '+966 50 111 1111')
        self.assertEqual((rows['b'][0], rows['c'][0]), ('', ''))
        self.assertIn('phone:duplicate', rows['b'][2])
        self.assertEqual(rows['e'][:2], ('+966 50 222 2222', 'https://starbucks.sa'), 'branches of one name keep shared contacts')
        self.assertEqual(report['flags']['phone:duplicate'], 2)
        self.assertEqual((root / 'targets.parquet').read_bytes(), before)
        self.assertTrue(os.path.isfile(root / 'std.report.json'))


if __name__ == '__main__':
    unittest.main()
