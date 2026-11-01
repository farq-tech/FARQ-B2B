"""The unclassified-business profile: who counts as unclassified, which evidence is found, and that no name leaks."""
import json
import os
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

import duckdb

import ai_classification
import startup_jobs


def write(root, targets, taxonomy, columns):
    db = duckdb.connect()
    db.execute(f"create table t({columns})")
    db.executemany(f"insert into t values ({','.join('?' * len(targets[0]))})", targets)
    db.execute("copy t to ? (format parquet)", [str(root / 'targets.parquet')])
    db.execute("create table c(poi_key varchar, sub_id varchar, source varchar, confidence varchar)")
    db.executemany("insert into c values (?,?,?,?)", taxonomy)
    db.execute("copy c to ? (format parquet)", [str(root / 'poi_taxonomy.parquet')])
    db.close()


FULL = ("poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, phone_norm varchar, "
        "license_activity_en varchar, google_categories varchar, delivery_rating double, brand varchar, description_ar varchar")


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        targets = [
            # served: a high-confidence label; its phone is shared with u3
            ('s1', 'Riyadh', 'صيدلية النور', None, '0500000001', None, None, None, None, None),
            # unclassified with licence activity
            ('u1', 'Riyadh', 'مؤسسة محمد', None, None, 'Retail sale of pharmaceuticals', None, None, None, None),
            # unclassified with a delivery signal and a brand
            ('u2', 'Jeddah', 'Al Noor', 'Al Noor', None, None, None, 4.5, 'النور', None),
            # unclassified, only a shared phone
            ('u3', 'Riyadh', 'محمد عبدالله', None, '0500000001', None, None, None, None, None),
            # unclassified, nothing: a placeholder name and no evidence
            ('u4', 'Riyadh', 'NULL', 'False', None, 'null', '', None, None, None),
            # a low label only: still unclassified on the map
            ('l1', 'Jeddah', 'بقالة', None, None, None, 'Grocery store', None, None, None),
            # duplicate key rows count once
            ('u1', 'Riyadh', 'مؤسسة محمد', None, None, 'Retail sale of pharmaceuticals', None, None, None, None),
        ]
        taxonomy = [('s1', 'health.pharmacy', 'crs_surveyor', 'high'), ('u2', 'unc.unknown', 'model', 'high'),
                    ('l1', 'retail.grocery', 'keyword', 'low')]
        write(self.root, targets, taxonomy, FULL)

    def report(self):
        return ai_classification.profile(self.root / 'targets.parquet', self.root / 'poi_taxonomy.parquet')

    def test_counts_only_served_labels_as_classified(self):
        report = self.report()
        self.assertEqual(report['businesses'], 6)
        self.assertEqual(report['served_activity'], 1)
        self.assertEqual(report['unclassified'], 5, 'unc.* and low-confidence labels are unclassified on the map')
        self.assertEqual(report['with_low_label'], 1)

    def test_finds_each_kind_of_evidence(self):
        evidence = self.report()['evidence']
        self.assertEqual(evidence['license_activity'], 1)
        self.assertEqual(evidence['google_categories'], 1)
        self.assertEqual(evidence['delivery_signal'], 1)
        self.assertEqual(evidence['brand'], 1)
        self.assertEqual(evidence['shared_phone'], 1)
        self.assertEqual(self.report()['with_any_evidence'], 4, 'the placeholder-only row has none')

    def test_placeholder_names_are_not_text(self):
        self.assertEqual(self.report()['with_text'], 4)

    def test_splits_by_city(self):
        cities = self.report()['cities']
        self.assertEqual(cities['Riyadh']['unclassified'], 3)
        self.assertEqual(cities['Jeddah']['unclassified'], 2)

    def test_report_holds_no_name_key_or_phone(self):
        text = json.dumps(self.report(), ensure_ascii=False)
        for secret in ('مؤسسة محمد', 'Al Noor', '0500000001', '"u1"', 'محمد عبدالله'):
            self.assertNotIn(secret, text)

    def test_missing_columns_count_as_absent(self):
        root = pathlib.Path(tempfile.mkdtemp())
        write(root, [('a', 'Riyadh', 'محل')], [('a', 'unc.x', 'm', 'low')], 'poi_key varchar, city_en varchar, name_ar varchar')
        report = ai_classification.profile(root / 'targets.parquet', root / 'poi_taxonomy.parquet')
        self.assertEqual(report['unclassified'], 1)
        self.assertEqual(report['with_any_evidence'], 0)
        self.assertIn('license_activity_en', report['missing_columns'])


class ProfileJobTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop('FARQ_AI_CLASSIFY_PROFILE', None)
        self.data, self.aux = pathlib.Path(tempfile.mkdtemp()), pathlib.Path(tempfile.mkdtemp())
        write(self.data, [('a', 'Riyadh', 'صيدلية')], [('a', 'health.pharmacy', 's', 'high')], 'poi_key varchar, city_en varchar, name_ar varchar')

    def tearDown(self):
        os.environ.pop('FARQ_AI_CLASSIFY_PROFILE', None)

    def test_off_unless_switched_on(self):
        with mock.patch.object(startup_jobs, '_ai_classification_profile') as job:
            self.assertNotIn('ai_classification_profile', startup_jobs.start(self.data, self.aux))
        job.assert_not_called()

    def test_writes_the_report_and_skips_when_unchanged(self):
        startup_jobs._ai_classification_profile(self.data, self.aux)
        report = json.loads((self.aux / 'ai_classification' / 'profile.json').read_text(encoding='utf-8'))
        self.assertEqual(report['served_activity'], 1)
        with mock.patch('ai_classification.profile') as again:
            startup_jobs._ai_classification_profile(self.data, self.aux)
        again.assert_not_called()

    def test_runs_in_the_background_when_switched_on(self):
        os.environ['FARQ_AI_CLASSIFY_PROFILE'] = '1'
        done = threading.Event()
        with mock.patch.object(startup_jobs, '_ai_classification_profile', side_effect=lambda *a: done.set()):
            self.assertIn('ai_classification_profile', startup_jobs.start(self.data, self.aux))
            self.assertTrue(done.wait(5))

    def test_missing_release_file_skips(self):
        (self.data / 'poi_taxonomy.parquet').unlink()
        startup_jobs._ai_classification_profile(self.data, self.aux)
        self.assertFalse((self.aux / 'ai_classification' / 'profile.json').exists())


if __name__ == '__main__':
    unittest.main()
