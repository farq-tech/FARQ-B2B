"""SPD closures on synthetic rows: python3 -m unittest test_spd_status (from services/data-cleaning)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / 'targeting-api'))
from spd_status import decide  # noqa: E402
import status_policy  # noqa: E402


class DecideTests(unittest.TestCase):
    def test_closures_only_raise_and_never_reopen(self):
        self.assertEqual(decide(None, 'permanently closed'), 'permanently_closed')
        self.assertEqual(decide('', 'temporary closed'), 'temporarily_closed')
        self.assertEqual(decide('temporarily_closed', 'permanently closed'), 'permanently_closed', 'a permanent closure outranks')
        self.assertIsNone(decide('permanently_closed', 'temporary closed'), 'never lightened')
        self.assertIsNone(decide('temporarily_closed', 'open'), 'never reopened')
        self.assertIsNone(decide('hidden', 'permanently closed'), 'another value is left as it is')
        self.assertEqual(decide(None, 'closed'), 'permanently_closed', "SPD's bare «closed» is permanent")
        for spelling in ('temporary closed', 'Temporarily Closed', 'مغلق مؤقتاً'):
            self.assertEqual(decide(spelling, 'permanently closed'), 'permanently_closed', spelling)
            self.assertIsNone(decide(spelling, 'temporary closed'), spelling)
        self.assertIsNone(decide('unknown', 'permanently closed'), 'an unrecognised value is left as it is')

    def test_values_are_read_by_the_status_policy(self):
        self.assertEqual(status_policy.normalize('permanently_closed')['status_normalized'], 'closed_permanent')
        self.assertEqual(status_policy.normalize('temporarily_closed')['status_normalized'], 'closed_temporary')


class CliTests(unittest.TestCase):
    def test_writes_a_new_file_and_moves_only_the_status(self):
        temp = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute("create table t(poi_key varchar, hudhud_id bigint, city_en varchar, company_status varchar, name_ar varchar)")
        db.execute("""insert into t values ('hh:1', 1, 'Riyadh', null, 'أ'), ('hh:2', 2, 'Riyadh', 'temporarily_closed', 'ب'),
                      ('hh:3', 3, 'Riyadh', null, 'ج'), ('hh:4', 4, 'Riyadh', null, 'د'), ('x', null, 'Riyadh', null, 'هـ')""")
        db.execute(f"copy t to '{temp / 't.parquet'}' (format parquet)")
        crs = duckdb.connect(str(temp / 'crs.duckdb'))
        crs.execute("create table crs(cr_entity_id varchar, cr_id varchar, cr_created_at varchar, trx_updated_at varchar, trx_state varchar, trx_is_deleted varchar, trx_status varchar)")
        crs.execute("""insert into crs values ('1.0', 'a', '2025-08-01', '2025-08-02', 'ready to publish', 'false', 'temporary closed'),
                       ('2.0', 'b', '2025-08-01', '2025-08-03', 'ready to publish', 'false', 'permanently closed'),
                       ('3.0', 'c', '2025-08-01', '2025-08-04', 'draft', 'false', 'permanently closed'),
                       ('4.0', 'd', '2025-08-01', '2025-08-05', 'ready to publish', 'false', 'open')""")
        crs.close()
        run = lambda out: subprocess.run([sys.executable, str(HERE / 'spd_status.py'), '--targets', str(temp / 't.parquet'),
                                          '--crs', str(temp / 'crs.duckdb'), '--out', str(out)], capture_output=True, text=True)
        self.assertNotEqual(run(temp / 't.parquet').returncode, 0, 'never writes over its input')
        result = run(temp / 't_closed.parquet')
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = db.execute(f"select poi_key, company_status, company_status_source, name_ar from read_parquet('{temp / 't_closed.parquet'}') order by 1").fetchall()
        self.assertEqual(rows, [('hh:1', 'temporarily_closed', 'hudhud_cr:2025-08-02', 'أ'),
                                ('hh:2', 'permanently_closed', 'hudhud_cr:2025-08-03', 'ب'),
                                ('hh:3', None, None, 'ج'), ('hh:4', None, None, 'د'), ('x', None, None, 'هـ')],
                         'a draft place and an open place are left alone')
        report = json.loads((temp / 't_closed.report.json').read_text())
        self.assertEqual(report['written'], {'(empty) -> temporarily_closed': 1, 'temporarily_closed -> permanently_closed': 1})
        self.assertEqual(report['other_columns_changed'], 0)
        again = subprocess.run([sys.executable, str(HERE / 'spd_status.py'), '--targets', str(temp / 't_closed.parquet'),
                                '--crs', str(temp / 'crs.duckdb'), '--out', str(temp / 't_again.parquet')], capture_output=True, text=True)
        self.assertEqual(again.returncode, 0, 'a second run with nothing to change still writes: ' + again.stderr)
        self.assertEqual(json.loads((temp / 't_again.report.json').read_text())['written'], {})


if __name__ == '__main__':
    unittest.main()
