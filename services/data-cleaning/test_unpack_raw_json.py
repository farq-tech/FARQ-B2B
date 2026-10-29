"""raw_json unpacking on synthetic rows: python3 -m unittest test_unpack_raw_json (from services/data-cleaning)."""
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from unpack_raw_json import clean, text, unpack  # noqa: E402

HOURS = {'timezone': 'Asia/Riyadh', 'regular_hours': [{'day': 'Sunday', 'hours': [{'open': '08:30', 'close': '23:30'}]}]}


def cr(**log):
    return json.dumps({'success': True, 'data': {'cr': {'id': '1'}, 'trx': {'phone_number': 'not unpacked'}, 'last_log': log}})


class CleanTests(unittest.TestCase):
    def test_values_are_checked_by_their_pattern_and_never_guessed(self):
        out, dropped = clean({'phone_number': '1933', 'email': 'a@b.sa, c@d.sa', 'postal_code': 'Riyadh 13321', 'website': 'https://cafe.sa',
                              'latitude': 24.7, 'longitude': 146.5, 'duplicate_of_id': 1315578, 'floorno': 0, 'is_deleted': False,
                              'region_ar': '001', 'name_ar': 'مقهى'})
        self.assertEqual((out['phone_number'], out['email'], out['postal_code']), (None, None, None), 'a short code, two e-mails, a city are dropped')
        self.assertEqual((out['latitude'], out['longitude']), (None, None), 'half a coordinate pair is dropped with its other half')
        self.assertEqual((out['website'], out['name_ar'], out['floorno'], out['is_deleted']), ('https://cafe.sa', 'مقهى', '0', 'false'))
        self.assertEqual((out['duplicate_of_id'], out['duplicate_of']), ('1315578', 'hh:1315578'))
        self.assertEqual(sorted(dropped), ['email', 'latitude', 'longitude', 'phone_number', 'postal_code', 'region_ar'])

    def test_nested_values(self):
        out, dropped = clean({'opening_hours': HOURS, 'additional_feature': {'phone_numbers': ['19996', '+966598371899']},
                              'order_link': ['https://shop.sa', 'shop'], 'menu_link': 'https://menu.sa',
                              'poi_geometry': {'type': 'Point', 'coordinates': [46.55, 24.75]}})
        self.assertEqual(json.loads(out['opening_hours']), HOURS['regular_hours'], "crs_latest's format: the regular_hours list")
        self.assertEqual(json.loads(out['additional_phones']), ['+966598371899'], 'only the extra numbers that pass are kept')
        self.assertEqual((json.loads(out['order_link']), out['menu_link']), (['https://shop.sa'], 'https://menu.sa'))
        self.assertIsNotNone(out['poi_geometry'])
        self.assertEqual(dropped, [])
        out, dropped = clean({'opening_hours': {'timezone': 'Asia/Riyadh', 'regular_hours': []}, 'additional_feature': {'phone_numbers': []},
                              'poi_geometry': {'type': 'Point', 'coordinates': [146.55, 24.75]}})
        self.assertEqual((out['opening_hours'], out['additional_phones'], out['poi_geometry']), (None, None, None))
        self.assertEqual(dropped, ['poi_geometry'], 'empty hours and an empty phone list are empty, not dropped')
        self.assertEqual([text(v) for v in (None, 'null', [], {}, True, 2)], ['', '', '', '', 'true', '2'])

    def test_latest_approved_record_per_place(self):
        others = {}
        records = [('7', '2025-01-01', '10', 'create', 'a', 'approved', 'poi', {'name_ar': 'قديم', 'new_key': 'x'}),
                   ('7', '2025-03-01', '11', 'update', 'b', 'approved', 'poi', {'name_ar': 'جديد'}),
                   ('7', '2025-03-01', '9', 'update', 'c', 'approved', 'poi', {'name_ar': 'نفس الوقت'}),
                   ('7', '2025-04-01', '12', 'update', 'd', 'rejected', 'poi', {'name_ar': 'مرفوض'}),
                   ('8.0', '2025-02-01', '13', 'delete', 'e', 'approved', 'poi', {'name_ar': 'محذوف'}),
                   ('9', '2025-02-01', '14', 'create', 'f', 'approved', 'poi', None)]
        rows, profile, columns = unpack(records, others)
        by = {r['poi_key']: r for r in rows}
        self.assertEqual((by['hh:7']['name_ar'], by['hh:7']['surveyor']), ('جديد', 'b'), 'latest by time, then by the larger id; rejected is skipped')
        self.assertTrue(by['hh:8']['deleted'])
        self.assertEqual((profile['places'], profile['records_without_fields'], profile['not_unpacked']), (2, 1, {'new_key': 1}))
        self.assertEqual(columns, ['name_ar'], 'only keys the source holds become columns')


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("""create table c as select * from (values
            ('hh:1', false, null, 'مقهى', null, null),
            ('hh:2', false, '+966114463611', 'مكتب', '[{"day": "Sunday", "hours": []}]', 'hh:5')) t(poi_key, deleted, phone, name_ar, opening_hours, duplicate_of)""")
        for col in ('name_en', 'tradename', 'website', 'email', 'instagram', 'hh_status'):
            db.execute(f'alter table c add column {col} varchar')
        db.execute(f"copy c to '{self.temp / 'crs_latest.parquet'}' (format parquet)")

    def run_cli(self, source, out):
        return subprocess.run([sys.executable, str(HERE / 'unpack_raw_json.py'), '--db', str(source), '--crs',
                               str(self.temp / 'crs_latest.parquet'), '--out', str(out)], capture_output=True, text=True)

    def test_cr_database(self):
        source = self.temp / 'crs.duckdb'
        con = duckdb.connect(str(source))
        con.execute('create table crs (cr_entity_id varchar, cr_created_at timestamp, cr_id varchar, cr_operation varchar, cr_created_by varchar, '
                    'cr_status varchar, cr_entity_type varchar, raw_json varchar)')
        con.executemany('insert into crs values (?, ?, ?, ?, ?, ?, ?, ?)', [
            ('1', '2025-08-01', '100', 'update', 'a', 'approved', 'poi', cr(phone_number='+966551234567', name_ar='مقهى', opening_hours=HOURS)),
            ('1', '2025-09-01', '101', 'update', 'b', 'draft', 'poi', cr(phone_number='+966500000000')),
            ('2', '2025-08-01', '102', 'update', 'c', 'approved', 'poi', cr(phone_number='+966114463611', duplicate_of_id=5, email='x@y.sa')),
            ('3', '2025-08-01', '103', 'create', 'd', 'approved', 'poi', cr(phone_number='1933', additional_feature={'phone_numbers': ['0598371899']}))])
        con.close()
        out = self.temp / 'crs_raw_json.parquet'
        self.assertNotEqual(self.run_cli(source, source).returncode, 0, 'never writes over its input')
        result = self.run_cli(source, out)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = duckdb.sql(f"select poi_key, phone_number, additional_phones from read_parquet('{out}') order by 1").fetchall()
        self.assertEqual(rows, [('hh:1', '+966551234567', None), ('hh:2', '+966114463611', None), ('hh:3', None, '["0598371899"]')])
        report = json.loads((self.temp / 'crs_raw_json.report.json').read_text())
        v = report['versus_crs_latest']
        self.assertEqual(v['fields']['phone_number'], {'adds_where_crs_empty': 1, 'adds_where_crs_empty_live': 1, 'adds_place_not_in_crs': 0,
                                                       'adds_place_not_in_crs_live': 0, 'same': 1, 'differs': 0})
        self.assertEqual(v['phones'], {'crs_places_given_a_first_phone_live': 1, 'places_with_extra_phones': 1, 'extra_phones': 1})
        self.assertEqual((v['fields']['opening_hours']['adds_where_crs_empty'], v['fields']['duplicate_of']['same'],
                          v['fields']['email']['adds_where_crs_empty']), (1, 1, 1))
        self.assertEqual(report['profile']['per_field']['phone_number'], {'valid': 2, 'dropped': 1})
        self.assertIn('data.trx', report['profile']['not_unpacked'])
        self.assertNotEqual(self.run_cli(source, out).returncode, 0, 'never writes over an existing file')

    def test_poi_logs_database(self):
        source = self.temp / 'hudhud.db'
        con = sqlite3.connect(str(source))
        con.execute('create table poi_logs (id text, cr_id text, created_by text, created_at text, operation text, status text, '
                    'entity_type text, raw_json text)')
        con.executemany('insert into poi_logs values (?, ?, ?, ?, ?, ?, ?, ?)', [
            ('1', '1', 'a', '2025-08-01 10:00', 'update', 'approved', 'poi',
             json.dumps({'id': '1', 'name_ar': 'مقهى', 'latitude': '24.7', 'longitude': '46.6', 'trx': {'id': 1, 'name_ar': 'مقهى'}})),
            ('2', '4', 'b', '2025-08-01 10:00', 'delete', 'approved', 'poi', json.dumps({'id': '2', 'name_ar': 'محذوف'}))])
        con.commit()
        con.close()
        out = self.temp / 'poi_logs_raw_json.parquet'
        result = self.run_cli(source, out)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.temp / 'poi_logs_raw_json.report.json').read_text())
        self.assertEqual((report['profile']['places'], report['profile']['places_deleted']), (2, 1))
        self.assertEqual(report['profile']['not_unpacked'], {'trx.id': 1, 'trx.name_ar': 1})
        self.assertEqual(report['versus_crs_latest']['fields']['phone'], {'adds': 0, 'note': 'not in this raw_json'})
        self.assertEqual(report['versus_crs_latest']['fields']['name_ar']['adds_place_not_in_crs_live'], 0)
        self.assertEqual(duckdb.sql(f"select latitude from read_parquet('{out}') where poi_key = 'hh:1'").fetchone(), (24.7,))


if __name__ == '__main__':
    unittest.main()
