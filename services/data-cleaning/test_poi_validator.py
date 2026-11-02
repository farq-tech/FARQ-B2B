"""poi_validator: one synthetic case per dashboard rule, on each profile's column names."""
import csv
import json
import os
import tempfile
import unittest

import duckdb

import poi_validator as pv

GOLDEN_COLUMNS = ['globalid', 'name_ar', 'name_en', 'category', 'latitude', 'longitude', 'phone_number', 'email',
                  'website', 'floor_number', 'company_status', 'language', 'working_days',
                  'working_hours_for_each_day', 'cuisine'] + pv.GOLDEN_BOOLS

CLEAN = {'name_ar': 'مقهى النور', 'name_en': 'Al Noor Cafe', 'category': 'Restaurants', 'latitude': '24.7',
         'longitude': '46.7', 'phone_number': '+966 50 123 4567', 'email': '', 'website': 'https://alnoor.sa',
         'floor_number': 'G', 'company_status': 'Open', 'language': 'Arabic, English', 'working_days': 'Daily',
         'working_hours_for_each_day': 'Sun: 09:00-23:00; Mon: 09:00-23:00; Fri: Closed', 'cuisine': 'Coffee / Cafe'}
NON_FOOD = dict(CLEAN, name_ar='صيدلية النور', name_en='Al Noor Pharmacy', category='Health & Medical', cuisine='',
                website='https://alnoorpharmacy.sa', phone_number='+966 11 222 3333')


def golden_row(rid, base=CLEAN, **over):
    """A clean row: its own coordinates (derived from the id), Yes/No fields filled, food-only fields empty on non-food."""
    row = {c: '' for c in GOLDEN_COLUMNS}
    row.update(base)
    food = base['category'] == 'Restaurants'
    for b in pv.GOLDEN_BOOLS:
        row[b] = 'No' if food or b not in pv.GOLDEN_FOOD_ONLY else ''
    row['globalid'] = rid
    row['latitude'] = f'24.{(sum(map(ord, rid)) % 900) + 100:03d}'
    row['longitude'] = f'46.{(sum(map(ord, rid)) * 7 % 900) + 100:03d}'
    row.update(over)
    return row


class ValidatorCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def write_csv(self, rows, columns=GOLDEN_COLUMNS, name='poi.csv'):
        path = os.path.join(self.tmp.name, name)
        with open(path, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=columns)
            w.writeheader()
            w.writerows(rows)
        return path

    def run_golden(self, rows, out=None):
        path = self.write_csv(rows)
        val = pv.Validator(path, 'golden')
        summary = val.run(out)
        issues = val.issues()
        val.con.close()
        return summary, issues

    @staticmethod
    def of(issues, rule, rid=None):
        return [i for i in issues if i['rule'] == rule and (rid is None or i['id'] == rid)]


class CleanRowTests(ValidatorCase):
    def test_clean_food_and_non_food_rows_pass_the_gate(self):
        summary, issues = self.run_golden([golden_row('a'), golden_row('b', NON_FOOD, latitude='24.8')])
        self.assertEqual(issues, [], issues)
        self.assertEqual(summary['gate'], 'PASS')
        self.assertEqual(summary['total_rows'], 2)


class LocationTests(ValidatorCase):
    def test_shared_coordinates_are_medium_after_rounding(self):
        rows = [golden_row('a', latitude='24.784385000000043', longitude='46.68250500000005'),
                golden_row('b', NON_FOOD, latitude='24.784385', longitude='46.682505'),
                golden_row('c', latitude='24.9', longitude='46.9')]
        _, issues = self.run_golden(rows)
        loc = self.of(issues, '1_Location')
        self.assertEqual(sorted(i['id'] for i in loc), ['a', 'b'])
        self.assertTrue(all(i['severity'] == 'MEDIUM' for i in loc))
        self.assertIn('Shared coords with 1 others: مقهى النور, صيدلية النور', loc[0]['detail'])


class NameTests(ValidatorCase):
    def test_arabic_in_english_name_and_latin_arabic_name_are_high(self):
        rows = [golden_row('a', name_en='مقهى النور'), golden_row('b', name_ar='Al Noor Cafe'), golden_row('c')]
        _, issues = self.run_golden(rows)
        self.assertEqual([(i['id'], i['severity']) for i in self.of(issues, '2_Names')], [('a', 'HIGH'), ('b', 'HIGH')])
        self.assertTrue(self.of(issues, '2_Names', 'a')[0]['detail'].startswith('Name_EN is Arabic:'))
        self.assertTrue(self.of(issues, '2_Names', 'b')[0]['detail'].startswith('Name_AR has no Arabic:'))


class CategoryTests(ValidatorCase):
    def test_missing_or_placeholder_category_is_high(self):
        rows = [golden_row('a', category=''), golden_row('b', category='UNAVAILABLE'), golden_row('c')]
        _, issues = self.run_golden(rows)
        self.assertEqual(sorted(i['id'] for i in self.of(issues, '3_Categories')), ['a', 'b'])
        self.assertEqual(self.of(issues, '3_Categories', 'a')[0]['detail'], 'Missing category')
        # the dashboard reports the same cell under 8_Mandatory too
        self.assertEqual(self.of(issues, '8_Mandatory', 'b')[0]['detail'], 'category is UNAVAILABLE')


class PhoneTests(ValidatorCase):
    def test_scientific_notation_and_float_artefact_are_high(self):
        rows = [golden_row('a', phone_number='9.66551E+11'), golden_row('b', phone_number='966551000000.0')]
        _, issues = self.run_golden(rows)
        self.assertEqual([(i['id'], i['severity']) for i in self.of(issues, '4_Phone')], [('a', 'HIGH'), ('b', 'HIGH')])
        self.assertEqual(self.of(issues, '4_Phone', 'a')[0]['detail'], 'Scientific notation: 9.66551E+11')

    def test_non_standard_formats_are_low_and_standard_ones_pass(self):
        rows = [golden_row('a', phone_number='+96620000262'), golden_row('b', phone_number='0501234567'),
                golden_row('c', phone_number='920 000 262'), golden_row('d', phone_number='800 123 4567'),
                golden_row('e', phone_number='+966 11 234 5678'), golden_row('f', phone_number='+971 50 123 4567')]
        _, issues = self.run_golden(rows)
        flagged = {i['id']: i['severity'] for i in self.of(issues, '4_Phone')}
        self.assertEqual(flagged, {'a': 'LOW', 'b': 'LOW', 'f': 'LOW'})
        self.assertEqual(self.of(issues, '4_Phone', 'a')[0]['detail'], 'Non-standard format: +96620000262')


class WebsiteTests(ValidatorCase):
    def test_google_social_numeric_are_high_and_missing_protocol_low(self):
        rows = [golden_row('a', website='https://www.google.com/maps?q=24.77,46.68'),
                golden_row('b', website='https://www.instagram.com/alnoor'),
                golden_row('c', website='7'),
                golden_row('d', website='www.alnoor.sa'),
                golden_row('e', website='https://alnoor.sa/x.com/page'),   # not a social host
                golden_row('f', website='https://maps.app.goo.gl/abc')]
        _, issues = self.run_golden(rows)
        got = {i['id']: (i['severity'], i['detail'].split(':')[0]) for i in self.of(issues, '5_Website')}
        self.assertEqual(got, {'a': ('HIGH', 'Google link'), 'b': ('HIGH', 'Social media link'),
                               'c': ('HIGH', 'Numeric value'), 'd': ('LOW', 'Missing protocol'),
                               'f': ('HIGH', 'Google link')})


class PhoneSharedTests(ValidatorCase):
    def test_phone_on_three_differently_named_pois_is_low(self):
        shared = '+966 11 500 0000'
        rows = [golden_row('a', phone_number=shared), golden_row('b', NON_FOOD, phone_number=shared),
                golden_row('c', name_ar='مغسلة النور', name_en='Al Noor Laundry', category='Life & Convenience',
                           cuisine='', phone_number=shared),
                # a chain: three branches with the same name are not an issue
                golden_row('d', phone_number='920 000 111'), golden_row('e', phone_number='920 000 111'),
                golden_row('f', phone_number='920 000 111'),
                # only two share: not an issue
                golden_row('g', phone_number='920 000 222'), golden_row('h', NON_FOOD, phone_number='920 000 222')]
        _, issues = self.run_golden(rows)
        got = self.of(issues, '6_PhoneShared')
        self.assertEqual(sorted(i['id'] for i in got), ['a', 'b', 'c'])
        self.assertEqual(got[0]['detail'], 'Phone shared by 3 POIs (3 different names)')


class PlaceholderTests(ValidatorCase):
    def test_forbidden_tokens_are_one_low_issue_per_row_listing_the_fields(self):
        rows = [golden_row('a', email='UNAVAILABLE', shisha='unapplicable'), golden_row('b')]
        _, issues = self.run_golden(rows)
        got = self.of(issues, '7_Placeholder')
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]['id'], 'a')
        self.assertEqual(got[0]['severity'], 'LOW')
        self.assertEqual(got[0]['detail'], 'Forbidden placeholder in 2 field(s): email, shisha')


class FoodFieldTests(ValidatorCase):
    def test_food_only_fields_filled_on_non_food_poi_are_low(self):
        rows = [golden_row('a', NON_FOOD, menu='Yes', shisha='No'),
                golden_row('b', NON_FOOD, menu='UNAPPLICABLE'),     # a placeholder is not «filled»
                golden_row('c', menu='Yes')]                        # food POI: fine
        _, issues = self.run_golden(rows)
        got = self.of(issues, '7_FoodFields')
        self.assertEqual([i['id'] for i in got], ['a'])
        self.assertEqual(got[0]['detail'], 'Non-food: menu=Yes, shisha=No')
        self.assertEqual(self.of(issues, '7_Placeholder', 'b')[0]['detail'], 'Forbidden placeholder in 1 field(s): menu')


class MandatoryTests(ValidatorCase):
    def test_each_empty_mandatory_field_is_a_high_issue(self):
        rows = [golden_row('a', name_ar='', name_en='UNAVAILABLE', latitude='', longitude='abc')]
        _, issues = self.run_golden(rows)
        got = sorted(i['detail'] for i in self.of(issues, '8_Mandatory'))
        self.assertEqual(got, ['latitude is empty', 'longitude is empty', 'name_ar is empty', 'name_en is UNAVAILABLE'])
        self.assertTrue(all(i['severity'] == 'HIGH' for i in self.of(issues, '8_Mandatory')))


class StandardsTests(ValidatorCase):
    def test_values_outside_the_enums_are_low(self):
        rows = [golden_row('a', order_from_car='{https://alhayat.med.sa/}'),
                golden_row('b', floor_number='1.0'), golden_row('c', floor_number='B2'),
                golden_row('d', company_status='unknown'),
                golden_row('e', language='English, Arabic'),
                golden_row('f', working_days='Sunday, Monday'),
                golden_row('g', working_hours_for_each_day='Sun: Prayer Times; Mon: Prayer Times'),
                golden_row('h', working_hours_for_each_day='Open 24 Hours'),
                golden_row('i', working_hours_for_each_day='Sun: 11:30-17:30, 20:30-02:30; Fri: Closed')]
        _, issues = self.run_golden(rows)
        got = {i['id']: i['field'] for i in self.of(issues, '9_Standards')}
        self.assertEqual(got, {'a': 'order_from_car', 'b': 'floor_number', 'd': 'company_status', 'e': 'language',
                               'f': 'working_days', 'g': 'working_hours_for_each_day'})
        self.assertEqual(self.of(issues, '9_Standards', 'a')[0]['detail'],
                         'order_from_car="{https://alhayat.med.sa/}" (not Yes/No)')
        self.assertTrue(all(i['severity'] == 'LOW' for i in self.of(issues, '9_Standards')))


class BboxTests(ValidatorCase):
    def test_coordinates_outside_saudi_arabia_are_high(self):
        rows = [golden_row('a', latitude='25.2', longitude='55.3'), golden_row('b', latitude='35.0', longitude='46.0'),
                golden_row('c', latitude='-24.7', longitude='46.7'), golden_row('d')]
        _, issues = self.run_golden(rows)
        self.assertEqual(sorted(i['id'] for i in self.of(issues, '10_Bbox')), ['b', 'c'])
        self.assertEqual(self.of(issues, '10_Bbox', 'b')[0]['severity'], 'HIGH')


class OutputAndGateTests(ValidatorCase):
    def test_outputs_summary_and_exit_code(self):
        rows = [golden_row('a', NON_FOOD, category=''), golden_row('b', phone_number='0501234567')]
        path = self.write_csv(rows)
        out = os.path.join(self.tmp.name, 'run')
        self.assertEqual(pv.main([path, '--profile', 'golden', '--out', out]), 1, 'HIGH present → gate fails')
        with open(out + '_summary.json', encoding='utf-8') as fh:
            summary = json.load(fh)
        self.assertEqual(summary['gate'], 'FAIL')
        self.assertEqual(summary['total_rows'], 2)
        self.assertEqual(summary['by_rule']['3_Categories'], {'total': 1, 'HIGH': 1})
        self.assertEqual(summary['by_rule']['8_Mandatory'], {'total': 1, 'HIGH': 1})
        self.assertEqual(summary['by_rule']['4_Phone'], {'total': 1, 'LOW': 1})
        self.assertEqual(summary['by_severity'], {'HIGH': 2, 'MEDIUM': 0, 'LOW': 1})
        self.assertEqual(summary['rows_with_high'], 1)
        con = duckdb.connect()
        cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{out}_issues.parquet')").fetchall()]
        self.assertEqual(cols, ['id', 'rule', 'severity', 'field', 'detail'])
        self.assertEqual(con.execute(f"SELECT count(*) FROM read_parquet('{out}_issues.parquet')").fetchone()[0], 3)
        con.close()
        self.assertEqual(pv.main([self.write_csv([golden_row('x', phone_number='0501234567')], name='low.csv'),
                                  '--profile', 'golden']), 0, 'LOW only → gate passes')


class StdProfileTests(ValidatorCase):
    def test_std_columns_and_cuisine_food_detection(self):
        con = duckdb.connect()
        path = os.path.join(self.tmp.name, 'std.parquet')
        con.execute(f"""
            COPY (SELECT * FROM (VALUES
                ('k1', 'مخبز النور', 'Al Noor Bakery', 'Shopping & Distribution', 24.7, 46.7, '+966 50 123 4567',
                 'https://alnoor.sa', 'G', 'Open', 'Arabic, English', 'Daily', 'Open 24 Hours', 'Bakery / Pastry', 'Yes', 'No'),
                ('k2', 'صيدلية النور', 'Al Noor Pharmacy', 'Health & Medical', 24.8, 46.8, '0501234567',
                 'alnoor.sa', 'G', 'unknown', 'Arabic, English', '', '', 'UNAPPLICABLE', 'UNAPPLICABLE', 'No'),
                ('k3', 'بقالة', 'Grocery', '', 24.9, 46.9, '', '', 'G', 'Open', 'Arabic, English', '', '', '', 'Yes', 'No')
            ) t(poi_key, std_name_ar, std_name_en, std_category, std_latitude, std_longitude, std_phone, std_website,
                std_floor_number, std_company_status, std_language, std_working_days, std_working_hours, std_cuisine,
                std_menu, std_drive_thru)) TO '{path}' (FORMAT PARQUET)""")
        con.close()
        val = pv.Validator(path, 'std')
        summary = val.run()
        issues = val.issues()
        val.con.close()
        rules = {(i['id'], i['rule']) for i in issues}
        self.assertNotIn(('k1', '7_FoodFields'), rules, 'a bakery with a cuisine is a food POI')
        self.assertIn(('k3', '7_FoodFields'), rules)
        self.assertIn(('k3', '3_Categories'), rules)
        self.assertIn(('k2', '7_Placeholder'), rules)
        self.assertIn(('k2', '4_Phone'), rules)
        self.assertIn(('k2', '5_Website'), rules)
        self.assertEqual({i['detail'] for i in issues if i['id'] == 'k2' and i['rule'] == '9_Standards'},
                         {'std_company_status="unknown" (expected Open | Closed | Temporarily Closed | Permanently Closed)'})
        self.assertEqual(summary['gate'], 'FAIL')
        self.assertIn('std_email', summary['skipped_columns'])


class DirectoryProfileTests(ValidatorCase):
    def test_directory_columns_and_e164_phone(self):
        con = duckdb.connect()
        path = os.path.join(self.tmp.name, 'dir.parquet')
        con.execute(f"""
            COPY (SELECT * FROM (VALUES
                ('p1', 'مطعم النور', 'Al Noor Restaurant', 'Restaurant', 'أغذية ومشروبات', 24.7, 46.7, '966501234567', 'https://alnoor.sa', 'G', NULL),
                ('p2', NULL, 'Noor Trading', 'General Contractor', 'مقاولات', 24.7, 46.7, '0501234567', 'https://instagram.com/noor', 'Ground', 'unknown'),
                ('p3', 'نور', 'نور', NULL, NULL, 40.0, 46.7, '920000262', NULL, NULL, NULL)
            ) t(poi_key, name_ar, name_en, category, secondary_category, latitude, longitude, phone_norm, website, floor_no, company_status))
            TO '{path}' (FORMAT PARQUET)""")
        con.close()
        val = pv.Validator(path, 'directory')
        val.run()
        issues = val.issues()
        val.con.close()
        rules = {(i['id'], i['rule']) for i in issues}
        self.assertIn(('p1', '1_Location'), rules)
        self.assertIn(('p2', '1_Location'), rules)
        self.assertIn(('p2', '8_Mandatory'), rules)
        self.assertIn(('p2', '4_Phone'), rules)
        self.assertIn(('p2', '5_Website'), rules)
        self.assertIn(('p2', '9_Standards'), rules)
        self.assertIn(('p3', '2_Names'), rules)
        self.assertIn(('p3', '3_Categories'), rules)
        self.assertIn(('p3', '10_Bbox'), rules)
        self.assertNotIn(('p1', '4_Phone'), rules)
        self.assertNotIn(('p3', '4_Phone'), rules)


if __name__ == '__main__':
    unittest.main()
