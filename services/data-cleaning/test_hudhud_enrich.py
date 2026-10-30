"""HudHud enrich on synthetic rows: python3 -m unittest test_hudhud_enrich (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from hudhud_enrich import confidence, enrich, gmaps, logo  # noqa: E402

LIVE = {'trx_state': 'ready to publish', 'trx_is_deleted': 'false', 'trx_status': 'open'}


class CleanerTests(unittest.TestCase):
    def test_gmaps_only_google_hosts(self):
        for ok in ('https://www.google.com/maps/place/x/@24.8,46.7,17z', 'https://maps.app.goo.gl/abc',
                   'https://www.google.com/maps?cid=12345',           # a query form, no slash after «maps»
                   'https://maps.google.com/?cid=9', 'https://www.google.com.sa/maps/place/x', 'https://goo.gl/maps/x'):
            self.assertEqual(gmaps(ok), ok, ok)
        for bad in ('http://www.google.com/maps/x', 'https://evil.sa/maps/', 'https://google.com.evil.sa/maps/x',
                    'https://www.google.com.evil.sa/maps/x',          # an extra label after the real host is not Google
                    'https://www.google.com/search?q=x', 'not a url', ''):
            self.assertIsNone(gmaps(bad), bad)

    def test_logo_http_only(self):
        self.assertEqual(logo('https://cdn.x/logo.png'), 'https://cdn.x/logo.png')
        self.assertIsNone(logo('logo.png'))
        self.assertIsNone(logo('null'))

    def test_confidence_range(self):
        self.assertEqual([confidence(v) for v in ('0', '80', '100', '85.5')], ['0.0', '80.0', '100.0', '85.5'])
        for bad in ('101', '-1', 'high', '', 'null'):
            self.assertIsNone(confidence(bad), bad)


class EnrichTests(unittest.TestCase):
    def test_adds_only_valid_values_of_live_places(self):
        snapshot = {'1': {'google_maps_url': '', 'logo_url': '', 'hudhud_confidence': ''},
                    '2': {}, '3': {}, '4': {'google_maps_url': 'https://keep.example/maps'}}
        hudhud = {'1': {**LIVE, 'trx_google_url': 'https://www.google.com/maps/place/x', 'trx_logo': 'https://cdn.x/a.png', 'trx_confidence': '92'},
                  '2': {**LIVE, 'trx_status': 'permanently closed', 'trx_confidence': '90'},
                  '3': {**LIVE, 'trx_is_deleted': 'true', 'trx_confidence': '90'},
                  '4': {**LIVE, 'trx_google_url': 'https://www.google.com/maps/place/new', 'trx_confidence': '200'}}
        new, refused = enrich(snapshot, hudhud)
        self.assertEqual(new, {'1': {'google_maps_url': 'https://www.google.com/maps/place/x',
                                     'logo_url': 'https://cdn.x/a.png', 'hudhud_confidence': '92.0'}},
                         'closed/deleted places are skipped; an existing url is kept; an out-of-range confidence is refused')
        self.assertEqual(refused['hudhud_confidence'], 1)

    def test_cli_adds_columns_new_file_never_changes_a_value(self):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("create table t(poi_key varchar, hudhud_id bigint, city_en varchar, name_ar varchar)")
        db.execute("insert into t values ('hh:1', 1, 'Riyadh', 'مقهى'), ('hh:2', 2, 'Riyadh', 'مكتب'), ('new:9', NULL, 'Jeddah', 'بلا هدهد')")
        db.execute(f"copy t to '{temp / 't.parquet'}' (format parquet)")
        crs = duckdb.connect(str(temp / 'crs.duckdb'))
        trx = ['trx_state', 'trx_is_deleted', 'trx_status', 'trx_google_url', 'trx_logo', 'trx_confidence']
        crs.execute(f"create table crs(cr_entity_id varchar, cr_id varchar, cr_created_at varchar, trx_updated_at varchar, {', '.join(c + ' varchar' for c in trx)})")
        crs.execute("insert into crs(cr_entity_id, cr_id, cr_created_at, trx_updated_at, trx_state, trx_is_deleted, trx_status, trx_google_url, trx_logo, trx_confidence) values "
                    "('1.0', 'a', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'https://www.google.com/maps/place/x', 'https://cdn.x/a.png', '92'), "
                    "('1.0', 'b', '2025-05-01', '2025-05-02', 'ready to publish', 'false', 'open', 'https://www.google.com/maps/place/old', 'https://cdn.x/old.png', '40'), "
                    "('2.0', 'c', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'not a url', 'https://cdn.x/b.png', '55')")
        crs.close()
        run = lambda out: subprocess.run([sys.executable, str(HERE / 'hudhud_enrich.py'), '--targets', str(temp / 't.parquet'),
                                          '--crs', str(temp / 'crs.duckdb'), '--out', str(out)], capture_output=True, text=True)
        self.assertNotEqual(run(temp / 't.parquet').returncode, 0, 'never writes over its input')
        result = run(temp / 't_enriched.parquet')
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = db.execute(f"""select poi_key, google_maps_url, logo_url, hudhud_confidence, hudhud_enriched
                              from read_parquet('{temp / 't_enriched.parquet'}') order by poi_key""").fetchall()
        self.assertEqual(rows[0], ('hh:1', 'https://www.google.com/maps/place/x', 'https://cdn.x/a.png', 92.0,
                                   ['google_maps_url', 'hudhud_confidence', 'logo_url']), 'most recent CR row; all three columns added')
        self.assertEqual(rows[1], ('hh:2', None, 'https://cdn.x/b.png', 55.0, ['hudhud_confidence', 'logo_url']),
                         'a bad Google URL is left null; the logo and confidence are added')
        self.assertEqual(rows[2], ('new:9', None, None, None, None), 'a row with no hudhud_id is untouched')
        # name_ar and city_en (existing columns) are unchanged
        self.assertEqual(db.execute(f"select name_ar from read_parquet('{temp / 't_enriched.parquet'}') where poi_key='hh:1'").fetchone()[0], 'مقهى')
        report = json.loads((temp / 't_enriched.report.json').read_text())
        self.assertEqual((report['rows_enriched'], report['refused_by_field'].get('google_maps_url')), (2, 1))
        self.assertEqual(sorted(report['columns_added']), ['google_maps_url', 'hudhud_confidence', 'logo_url'])
        self.assertNotEqual(run(temp / 't_enriched.parquet').returncode, 0, 'never writes over an existing snapshot')

    def test_cli_fills_preexisting_empty_columns_without_refusing(self):
        # the columns are already on the snapshot (a re-run, or a second pass): empty rows are filled and that is not a
        # change to refuse, while a value already there is kept (the Codex finding on the unchanged-value check)
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("create table t(poi_key varchar, hudhud_id bigint, google_maps_url varchar, logo_url varchar, hudhud_confidence double)")
        db.execute("insert into t values ('hh:1', 1, NULL, NULL, NULL), ('hh:5', 5, 'https://www.google.com/maps/place/keep', NULL, NULL)")
        db.execute(f"copy t to '{temp / 't.parquet'}' (format parquet)")
        crs = duckdb.connect(str(temp / 'crs.duckdb'))
        trx = ['trx_state', 'trx_is_deleted', 'trx_status', 'trx_google_url', 'trx_logo', 'trx_confidence']
        crs.execute(f"create table crs(cr_entity_id varchar, cr_id varchar, cr_created_at varchar, trx_updated_at varchar, {', '.join(c + ' varchar' for c in trx)})")
        crs.execute("insert into crs(cr_entity_id, cr_id, cr_created_at, trx_updated_at, trx_state, trx_is_deleted, trx_status, trx_google_url, trx_logo, trx_confidence) values "
                    "('1.0', 'a', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'https://www.google.com/maps/place/x', NULL, '88'), "
                    "('5.0', 'e', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'open', 'https://www.google.com/maps/place/other', NULL, '70')")
        crs.close()
        result = subprocess.run([sys.executable, str(HERE / 'hudhud_enrich.py'), '--targets', str(temp / 't.parquet'),
                                 '--crs', str(temp / 'crs.duckdb'), '--out', str(temp / 't2.parquet')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, 'filling an empty cell of an existing column is not a refused change: ' + result.stderr)
        rows = db.execute(f"select poi_key, google_maps_url, hudhud_confidence from read_parquet('{temp / 't2.parquet'}') order by poi_key").fetchall()
        self.assertEqual(rows[0], ('hh:1', 'https://www.google.com/maps/place/x', 88.0), 'an empty cell is filled')
        self.assertEqual(rows[1], ('hh:5', 'https://www.google.com/maps/place/keep', 70.0), 'a value already there is never overwritten')


if __name__ == '__main__':
    unittest.main()
