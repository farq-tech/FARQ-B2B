"""HudHud fill on synthetic rows: python3 -m unittest test_hudhud_fill (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from hudhud_fill import account, fills, floor, hours, phone, website  # noqa: E402

LIVE = {'trx_state': 'ready to publish', 'trx_is_deleted': 'false', 'trx_status': 'open'}


class CleanerTests(unittest.TestCase):
    def test_phone_prefers_a_mobile_and_writes_the_snapshot_format(self):
        self.assertEqual(phone('+966114463611', '{"phone_numbers": ["0598371899"]}'), ('+966598371899', 'mobile'))
        self.assertEqual(phone('011 446 3611'), ('+966114463611', 'landline'))
        self.assertEqual(phone('+966920000702'), ('+966920000702', 'landline'))
        self.assertEqual(phone('+9668002442225'), ('+9668002442225', 'landline'))
        self.assertIsNone(phone('19996'), 'a short code has no +966 form in the snapshot')
        self.assertIsNone(phone('1144666310114468028'), 'two numbers run together are not guessed apart')

    def test_accounts_hours_floor_website(self):
        self.assertEqual(account('snapchat', '@cafe_x'), 'https://www.snapchat.com/add/cafe_x')
        self.assertEqual(account('x_link', 'twitter.com/cafe'), 'https://twitter.com/cafe')
        self.assertIsNone(account('instagram', 'https://facebook.com/cafe'), "another site's link is refused")
        for bad in ('https://evil.sa/instagram.com/cafe', 'https://instagram.com@evil.sa/cafe', 'https://instagram.com.evil.sa/cafe'):
            self.assertIsNone(account('instagram', bad), bad)
        self.assertEqual(account('instagram', 'https://www.instagram.com/cafe/'), 'https://www.instagram.com/cafe/')
        self.assertEqual(account('instagram', '@cafe.name'), 'https://instagram.com/cafe.name', 'a dotted handle is a handle')
        self.assertEqual(account('instagram', 'cafe.name'), 'https://instagram.com/cafe.name')
        self.assertIsNone(account('instagram', 'www.evil.sa'))
        self.assertIsNone(account('instagram', 'cafe.com.sa'), 'a bare domain is a website, not a handle')
        self.assertEqual(hours('[{"day": "Sunday", "hours": [{"open": "08:30", "close": "23:30"}]}, {"day": "Friday", "hours": []}]'),
                         'Sun: 08:30 - 23:30')
        self.assertIsNone(hours('not json'))
        self.assertIsNone(hours('[{"day": "Monday", "hours": [{"open": "25:30", "close": "08:75"}]}]'), 'impossible times are refused')
        self.assertEqual(hours('[{"day": "Monday", "hours": [{"open": "16:00", "close": "24:00"}]}]'), 'Mon: 16:00 - 24:00')
        for odd in ('[null]', '"x"', '{"day": "Monday"}', '[{"day": "Monday", "hours": "08:00"}]', '[{"day": "Monday", "hours": [null]}]'):
            self.assertIsNone(hours(odd), odd)
        self.assertEqual(hours('[{"day": "Monday", "hours": [{"open": "00:00", "close": "00:00"}]}]'), 'Mon: 00:00 - 24:00', 'open all day')
        self.assertIsNone(hours('[{"day": "Monday", "hours": [{"open": "08:00", "close": "08:00"}]}]'), 'another equal pair: not guessed')
        self.assertEqual([floor(v) for v in ('0', 'GF', '2.0', 'B1', 'open')], ['0', '0', '2', 'B1', None])
        self.assertEqual(website('https://www.farq.sa/'), 'farq.sa')
        self.assertIsNone(website('https://google.com/maps/place/x'))
        from hudhud_fill import FIELDS
        name_en = FIELDS['name_en'][1]
        for junk in ('www.example.com', 'maps.app.goo.gl/x', 'ChIJuc0sAEAGLz4RJ3A9PIvA9SI', 'Unavailable', '2025-04-15T10:14:01.612Z', 'https://x.sa'):
            self.assertIsNone(name_en(junk), junk)
        self.assertEqual(name_en('Blue Cafe'), 'Blue Cafe')
        self.assertIsNone(FIELDS['tradename'][1]('غير معروف'))
        rating = FIELDS['rating'][1]
        self.assertEqual([rating(v) for v in ('4.5', '5', '5.0', '5.7', '0', '6')], ['4.5', '5', '5.0', None, None, None])


class FillTests(unittest.TestCase):
    def test_only_empty_fields_of_live_places(self):
        snapshot = {'1': {'email': '', 'phone_norm': '', 'national_address': 'RCWA0001'},
                    '2': {'email': ''}, '3': {'email': ''}, '4': {'email': ''}}
        hudhud = {'1': {**LIVE, 'trx_email': 'Info@Cafe.sa', 'trx_national_address': 'RHSA7359', 'trx_phone_number': '0551234567'},
                  '2': {**LIVE, 'trx_status': 'permanently closed', 'trx_email': 'a@b.sa'},
                  '3': {**LIVE, 'trx_state': 'draft', 'trx_email': 'a@b.sa'},
                  '4': {**LIVE, 'trx_email': 'not an email'}}
        new, refused = fills(snapshot, hudhud)
        self.assertEqual(new, {'1': {'email': 'info@cafe.sa', 'phone_raw': '+966551234567', 'phone_norm': '+966551234567',
                                     'phone_kind': 'mobile', 'phone_source': 'hudhud_cr'}},
                         'an existing national address is kept; closed and draft places are left alone')
        self.assertEqual(refused['email'], 1)

    def test_cli_writes_a_new_file_and_never_changes_a_value(self):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        columns = ['national_address', 'postal_code', 'building_no', 'floor_no', 'email', 'website', 'instagram', 'x_link', 'tiktok',
                   'snapchat', 'menu_link', 'google_place_id', 'working_hours', 'description_ar', 'description_en', 'tradename', 'name_en',
                   'commercial_license', 'rating', 'reviews_count', 'phone_raw', 'phone_norm', 'phone_kind', 'phone_source']
        db.execute(f"create table t(poi_key varchar, hudhud_id bigint, city_en varchar, completeness_pct double, search_text varchar, {', '.join(c + ' varchar' for c in columns)})")
        db.execute("insert into t(poi_key, hudhud_id, city_en, completeness_pct, search_text, email) values ('hh:1', 1, 'Riyadh', 66.7, 'مقهى', 'null'), ('hh:2', 2, 'Riyadh', 83.3, 'مكتب', 'kept@x.sa')")
        db.execute(f"copy t to '{temp / 't.parquet'}' (format parquet)")
        crs = duckdb.connect(str(temp / 'crs.duckdb'))
        trx = ['trx_state', 'trx_is_deleted', 'trx_status', 'trx_phone_number', 'trx_additional_feature', 'trx_national_address', 'trx_postal_code',
               'trx_building_no', 'trx_floorno', 'trx_email', 'trx_website', 'trx_instagram', 'trx_x_link', 'trx_tiktok', 'trx_snapchat',
               'trx_menu_link', 'trx_google_id', 'trx_opening_hours_regular_hours', 'trx_description_ar', 'trx_description_en', 'trx_tradename',
               'trx_name_en', 'trx_licenseno', 'trx_rating', 'trx_reviews_count']
        crs.execute(f"create table crs(cr_entity_id varchar, cr_id varchar, cr_created_at varchar, trx_updated_at varchar, {', '.join(c + ' varchar' for c in trx)})")
        crs.execute("insert into crs(cr_entity_id, cr_id, cr_created_at, trx_updated_at, trx_state, trx_is_deleted, trx_status, trx_email, trx_floorno, trx_name_en) values "
                    "('1.0', 'a', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'new@x.sa', '0', 'Blue Cafe'), "
                    "('1.0', 'b', '2025-05-01', '2025-05-02', 'ready to publish', 'false', 'open', 'old@x.sa', '3', 'Old Name'), ('2.0', 'c', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'other@x.sa', '1', null)")
        crs.close()
        run = lambda out: subprocess.run([sys.executable, str(HERE / 'hudhud_fill.py'), '--targets', str(temp / 't.parquet'),
                                          '--crs', str(temp / 'crs.duckdb'), '--out', str(out)], capture_output=True, text=True)
        self.assertNotEqual(run(temp / 't.parquet').returncode, 0, 'never writes over its input')
        result = run(temp / 't_hudhud.parquet')
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = db.execute(f"select poi_key, email, floor_no, completeness_pct, hudhud_filled from read_parquet('{temp / 't_hudhud.parquet'}') order by 1").fetchall()
        self.assertEqual(db.execute(f"select search_text from read_parquet('{temp / 't_hudhud.parquet'}') order by poi_key").fetchall(),
                         [('مقهى blue cafe',), ('مكتب',)], 'a filled English name joins the search text')
        self.assertEqual(rows[0], ('hh:1', 'new@x.sa', '0', 83.3, ['email', 'floor_no', 'name_en']), 'the most recently updated CR row is used whole; a «null» text is empty to the update as to fills(); a first contact adds one completeness point')
        self.assertEqual(rows[1], ('hh:2', 'kept@x.sa', '1', 83.3, ['floor_no']), 'an existing e-mail is never replaced')
        report = json.loads((temp / 't_hudhud.report.json').read_text())
        self.assertEqual((report['existing_values_changed'], report['rows_given_a_first_contact']), (0, 1))
        self.assertNotEqual(run(temp / 't_hudhud.parquet').returncode, 0, 'never writes over an existing snapshot')
        again = subprocess.run([sys.executable, str(HERE / 'hudhud_fill.py'), '--targets', str(temp / 't_hudhud.parquet'),
                                '--crs', str(temp / 'crs.duckdb'), '--out', str(temp / 't_again.parquet')], capture_output=True, text=True)
        self.assertEqual(again.returncode, 0, 'nothing left to fill still writes the copy and its report: ' + again.stderr)
        self.assertEqual(json.loads((temp / 't_again.report.json').read_text())['rows_filled'], 0)


if __name__ == '__main__':
    unittest.main()
