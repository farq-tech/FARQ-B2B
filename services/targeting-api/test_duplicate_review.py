"""Class C duplicate review: each owner rule, the grades, and that nothing is merged."""
import json
import pathlib
import tempfile
import unittest

import duckdb

import duplicate_review as dr

LAT, LON = 24.70000, 46.70000
M = 1 / 111320   # one metre of latitude in degrees


def row(key, ar, en=None, metres=0.0, phone=None, lic=None, city='Riyadh'):
    return (key, city, ar, en, LAT + metres * M, LON, phone, lic, None)


class DuplicateReviewTests(unittest.TestCase):
    def run_rows(self, rows):
        root = pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, latitude double, '
                   'longitude double, phone_norm varchar, commercial_license varchar, google_place_id varchar)')
        db.executemany('insert into t values (?,?,?,?,?,?,?,?,?)', rows)
        db.execute(f"copy t to '{root / 'targets.parquet'}' (format parquet)")
        report = dr.build(root / 'targets.parquet', root / 'out')
        audit = {(a, b): (g, e) for a, b, g, e in db.execute(
            f"select ka, kb, grade, excluded_by from read_parquet('{root / 'out' / 'duplicate_review_c_audit.parquet'}')").fetchall()}
        return report, audit, root

    def test_grades(self):
        report, audit, _ = self.run_rows([
            row('a1', 'مطعم السنبلة الذهبية'), row('a2', 'مطعم السنبلة الذهبية', metres=5),     # C1: ≤10 m
            row('b1', 'مؤسسة نجمة الوادي'), row('b2', 'مؤسسة نجمة الوادي', metres=18),          # C2: 10-25 m
            row('c1', 'صالون لمسة ملكية'), row('c2', 'صالون لمسه ملكيه', metres=3),            # C3: only after ة/ه
            row('d1', 'صيدلية زهرة الربيع'), row('d2', 'صيدلية زهرة الربيع', metres=40),         # C4: 25-50 m
        ])
        self.assertEqual(audit[('a1', 'a2')][0], 'C1')
        self.assertEqual(audit[('b1', 'b2')][0], 'C2')
        self.assertEqual(audit[('c1', 'c2')][0], 'C3')
        self.assertEqual(audit[('d1', 'd2')], ('C4', 'distance'))
        self.assertEqual(report['base_pairs'], 4)

    def test_generic_names_and_branch_numbers_and_conflicts_are_excluded(self):
        _, audit, _ = self.run_rows([
            row('g1', 'صيدلية'), row('g2', 'صيدلية', metres=2),
            row('n1', 'صيدلية الدواء 7879'), row('n2', 'صيدلية الدواء 1203', metres=2),
            row('p1', 'محل الأمانة للعطور', phone='0501111111'), row('p2', 'محل الأمانة للعطور', phone='0502222222', metres=2),
            row('l1', 'معرض الفخامة', lic='1010101010'), row('l2', 'معرض الفخامة', lic='2020202020', metres=2),
        ])
        self.assertIn('distinctive', audit[('g1', 'g2')][1])
        self.assertIn('numbers', audit[('n1', 'n2')][1], 'different branch numbers never merge, even at 2 m')
        self.assertIn('no_conflict', audit[('p1', 'p2')][1])
        self.assertIn('no_conflict', audit[('l1', 'l2')][1])

    def test_shared_evidence_pairs_are_not_class_c(self):
        report, audit, _ = self.run_rows([row('s1', 'مخبز الفجر', phone='0503333333'), row('s2', 'مخبز الفجر', phone='0503333333', metres=2)])
        self.assertEqual(report['base_pairs'], 0, 'a shared phone is class A/B evidence, not C')

    def test_rare_names_only(self):
        rows = [row(f'r{i}', 'مقهى الريم الفاخر', metres=i * 0.5) for i in range(52)]
        _, audit, _ = self.run_rows(rows)
        self.assertTrue(all('rare' in e for g, e in audit.values()))

    def test_outputs_and_no_record_is_touched(self):
        rows = [row('a1', 'مطعم السنبلة الذهبية'), row('a2', 'مطعم السنبلة الذهبية', metres=5)]
        report, _, root = self.run_rows(rows)
        for name in ('duplicate_review_c.report.json', 'sample_remaining.csv', 'sample_excluded.csv'):
            self.assertTrue((root / 'out' / name).is_file(), name)
        self.assertEqual(json.loads((root / 'out' / 'duplicate_review_c.report.json').read_text(encoding='utf-8'))['grades'], {'C1': 1})
        self.assertEqual(duckdb.connect().execute(f"select count(*) from read_parquet('{root / 'targets.parquet'}')").fetchone()[0], 2)


if __name__ == '__main__':
    unittest.main()


class JobTests(unittest.TestCase):
    def test_job_runs_once_on_the_release(self):
        import os
        from unittest import mock
        import startup_jobs
        data, aux = pathlib.Path(tempfile.mkdtemp()), pathlib.Path(tempfile.mkdtemp())
        db = duckdb.connect()
        db.execute('create table t(poi_key varchar, city_en varchar, name_ar varchar, latitude double, longitude double)')
        db.executemany('insert into t values (?,?,?,?,?)', [('a', 'Riyadh', 'مطعم السنبلة', LAT, LON), ('b', 'Riyadh', 'مطعم السنبلة', LAT + 3 * M, LON)])
        db.execute(f"copy t to '{data / 'targets.parquet'}' (format parquet)")
        with mock.patch.dict(os.environ, {'BUCKET': ''}):
            startup_jobs._duplicate_review(data, aux)
            self.assertTrue((aux / 'duplicate_review' / 'duplicate_review_c.report.json').is_file())
            with mock.patch('duplicate_review.build') as again:
                startup_jobs._duplicate_review(data, aux)
            again.assert_not_called()
