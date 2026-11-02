"""The served AI classification layer: what it edits, what it keeps, the switch, and main-only counting."""
import json
import os
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

import duckdb

import classification_layer
import market_analytics
from market_analytics import MarketAnalytics

TAXONOMY = {'subs': [
    {'main_id': 'health', 'main_ar': 'صحة', 'sub_id': 'health.pharmacy', 'sub_ar': 'صيدلية'},
    {'main_id': 'health', 'main_ar': 'صحة', 'sub_id': 'health.clinic', 'sub_ar': 'عيادة'},
    {'main_id': 'food', 'main_ar': 'أغذية ومشروبات', 'sub_id': 'food.restaurant', 'sub_ar': 'مطعم'},
]}


def parquet(path, schema, rows):
    db = duckdb.connect()
    db.execute(f'create table t({schema})')
    if rows:
        db.executemany(f"insert into t values ({','.join('?' * len(rows[0]))})", rows)
    db.execute('copy t to ? (format parquet)', [str(path)])
    db.close()


class LayerBuildTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.tax_json = self.root / 'farq_taxonomy.json'
        self.tax_json.write_text(json.dumps(TAXONOMY, ensure_ascii=False), encoding='utf-8')
        parquet(self.root / 'poi_taxonomy.parquet', 'poi_key varchar, sub_id varchar, source varchar, confidence varchar', [
            ('a', 'health.pharmacy', 'crs_surveyor', 'high'),    # served, merge keeps it
            ('b', 'health.clinic', 'keyword', 'low'),            # low label the model confirmed
            ('c', 'unc.unknown', 'none', 'low'),                 # nothing: the model estimates a sub
            ('d', 'food.restaurant', 'keyword', 'low'),          # low label: the model confirms the main only
            ('e', 'unc.unknown', 'none', 'low'),                 # nothing: model main only
            ('f', 'unc.unknown', 'none', 'low'),                 # nothing and the merge gives nothing
        ])
        parquet(self.root / 'merged.parquet',
                'poi_key varchar, final_sub varchar, final_main varchar, final_source varchar, final_confidence varchar', [
            ('a', 'health.pharmacy', 'صحة', 'directory_high', 'high'),
            ('b', 'health.clinic', 'صحة', 'directory_low_confirmed', 'low+model:0.91'),
            ('c', 'health.pharmacy', 'صحة', 'model_estimate', 'estimate:0.88'),
            ('d', None, 'أغذية ومشروبات', 'directory_low_main_confirmed', 'low+model_main:0.72'),
            ('e', None, 'صحة', 'model_estimate_main_only', 'estimate_main:0.75'),
            ('f', None, None, 'none', None),
        ])
        self.out = self.root / 'out'
        self.report = classification_layer.build(self.root / 'poi_taxonomy.parquet', self.root / 'merged.parquet', self.tax_json, self.out)
        self.db = duckdb.connect()

    def rows(self, name):
        return {r[0]: r[1:] for r in self.db.execute(f"select * from read_parquet('{self.out / name}')").fetchall()}

    def test_edits_keep_what_they_replaced_and_say_why(self):
        layer = self.db.execute(f"select poi_key, sub_id, confidence, orig_sub_id, orig_confidence, ai_method, ai_evidence, ai_version "
                                f"from read_parquet('{self.out / classification_layer.LAYER}') order by poi_key").fetchall()
        by_key = {r[0]: r[1:] for r in layer}
        self.assertEqual(by_key['b'], ('health.clinic', 'medium', 'health.clinic', 'low', 'low_label_confirmed_by_model',
                                       'directory_low_confirmed:low+model:0.91', classification_layer.VERSION))
        self.assertEqual(by_key['c'][:5], ('health.pharmacy', 'medium', 'unc.unknown', 'low', 'model_estimate'))

    def test_unchanged_rows_are_copied_as_they_are(self):
        layer = self.db.execute(f"select poi_key, sub_id, source, confidence, ai_method from read_parquet('{self.out / classification_layer.LAYER}') "
                                "where poi_key in ('a', 'f') order by poi_key").fetchall()
        self.assertEqual(layer, [('a', 'health.pharmacy', 'crs_surveyor', 'high', None), ('f', 'unc.unknown', 'none', 'low', None)])

    def test_main_only_rows_carry_the_main_id(self):
        main_only = self.db.execute(f"select poi_key, main_id, ai_method from read_parquet('{self.out / classification_layer.MAIN_ONLY}') "
                                    "order by poi_key").fetchall()
        self.assertEqual(main_only, [('d', 'food', 'low_label_main_confirmed_by_model'), ('e', 'health', 'model_estimate_main_only')])

    def test_report_counts_only(self):
        self.assertEqual(self.report['served_before'], 1)
        self.assertEqual(self.report['served_after'], 3)
        self.assertEqual(self.report['edits'], {'low_label_confirmed_by_model': 1, 'model_estimate': 1})
        self.assertEqual(sum(self.report['main_only'].values()), 2)
        self.assertEqual(self.report['replaced_a_served_label'], 0)
        self.assertEqual(self.report['merged_main_unknown'], 0)

    def test_release_files_are_not_written(self):
        before = (self.root / 'poi_taxonomy.parquet').read_bytes()
        classification_layer.build(self.root / 'poi_taxonomy.parquet', self.root / 'merged.parquet', self.tax_json, self.root / 'again')
        self.assertEqual((self.root / 'poi_taxonomy.parquet').read_bytes(), before)


class LayerJobTests(unittest.TestCase):
    def setUp(self):
        import startup_jobs
        self.jobs = startup_jobs
        self.data, self.aux = pathlib.Path(tempfile.mkdtemp()), pathlib.Path(tempfile.mkdtemp())
        (self.data / 'taxonomy').mkdir()
        (self.data / 'taxonomy' / 'farq_taxonomy.json').write_text(json.dumps(TAXONOMY, ensure_ascii=False), encoding='utf-8')
        parquet(self.data / 'poi_taxonomy.parquet', 'poi_key varchar, sub_id varchar, source varchar, confidence varchar',
                [('c', 'unc.unknown', 'none', 'low')])
        self.merged = self.aux / 'ai_classification' / 'classification_merged.parquet'

    def test_skips_without_the_merged_file(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('FARQ_CLASSIFICATION_MERGED_OBJECT', None)
            self.jobs._classification_layer(self.data, self.aux)
        self.assertFalse((self.aux / 'ai_classification' / classification_layer.LAYER).exists())

    def test_builds_once_from_a_merged_file_on_the_volume(self):
        self.merged.parent.mkdir(parents=True)
        parquet(self.merged, 'poi_key varchar, final_sub varchar, final_main varchar, final_source varchar, final_confidence varchar',
                [('c', 'health.pharmacy', 'صحة', 'model_estimate', 'estimate:0.9')])
        with mock.patch.dict(os.environ, {'FARQ_CLASSIFICATION_MERGED_SHA256': self.jobs._sha256(self.merged)}):
            self.jobs._classification_layer(self.data, self.aux)
            report = json.loads((self.aux / 'ai_classification' / 'layer_report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['served_after'], 1)
            with mock.patch('classification_layer.build') as again:
                self.jobs._classification_layer(self.data, self.aux)
            again.assert_not_called()


class SwitchTests(unittest.TestCase):
    def setUp(self):
        self.aux = pathlib.Path(tempfile.mkdtemp())
        self.env = mock.patch.dict(os.environ, {'FARQ_TARGETING_AUX_DATA_DIR': str(self.aux)})
        self.env.start()
        os.environ.pop('FARQ_AI_CLASSIFICATION', None)

    def tearDown(self):
        self.env.stop()

    def test_off_reads_the_release_file(self):
        (self.aux / 'ai_classification').mkdir()
        (self.aux / 'ai_classification' / classification_layer.LAYER).write_bytes(b'x')
        self.assertEqual(classification_layer.served_taxonomy('release.parquet'), 'release.parquet')
        self.assertIsNone(classification_layer.main_only())

    def test_on_without_a_built_layer_reads_the_release_file(self):
        os.environ['FARQ_AI_CLASSIFICATION'] = '1'
        self.assertEqual(classification_layer.served_taxonomy('release.parquet'), 'release.parquet')
        self.assertIsNone(classification_layer.main_only())

    def test_on_with_a_built_layer_reads_it(self):
        os.environ['FARQ_AI_CLASSIFICATION'] = '1'
        (self.aux / 'ai_classification').mkdir()
        for name in (classification_layer.LAYER, classification_layer.MAIN_ONLY):
            (self.aux / 'ai_classification' / name).write_bytes(b'x')
        self.assertTrue(classification_layer.served_taxonomy('release.parquet').endswith(classification_layer.LAYER))
        self.assertTrue(classification_layer.main_only().endswith(classification_layer.MAIN_ONLY))


class MainOnlyCountingTests(unittest.TestCase):
    """A picked main activity counts main-only businesses when the layer is on; a typed activity never does."""

    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        parquet(self.root / 'targets.parquet', 'poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, district_ar varchar, '
                'district_reliable boolean, has_whatsapp boolean, phone_norm varchar, is_wholesale boolean', [
            ('a', 'Riyadh', 'صيدلية', None, 'النخيل', True, False, None, False),
            ('e', 'Riyadh', 'مؤسسة', None, 'النخيل', True, False, None, False),
        ])
        parquet(self.root / 'poi_taxonomy.parquet', 'poi_key varchar, sub_id varchar, source varchar, confidence varchar',
                [('a', 'health.pharmacy', 's', 'high'), ('e', 'unc.unknown', 'none', 'low')])
        layer_dir = self.root / 'aux' / 'ai_classification'
        layer_dir.mkdir(parents=True)
        parquet(layer_dir / classification_layer.LAYER, 'poi_key varchar, sub_id varchar, source varchar, confidence varchar',
                [('a', 'health.pharmacy', 's', 'high'), ('e', 'unc.unknown', 'none', 'low')])
        parquet(layer_dir / classification_layer.MAIN_ONLY, 'poi_key varchar, main_id varchar', [('e', 'health')])
        self.env = mock.patch.dict(os.environ, {'FARQ_TARGETING_AUX_DATA_DIR': str(self.root / 'aux')})
        self.env.start()
        os.environ.pop('FARQ_AI_CLASSIFICATION', None)
        self.original = market_analytics.POI_TAXONOMY
        market_analytics.POI_TAXONOMY = str(self.root / 'poi_taxonomy.parquet')
        tiles = type('Tiles', (), {})()
        tiles.db, tiles.lock, tiles.search_sql, tiles.path = duckdb.connect(), threading.RLock(), 'true', str(self.root / 'targets.parquet')
        self.analytics = MarketAnalytics(tiles)
        tx = type('Tx', (), {})()
        tx.subs = {s['sub_id']: s for s in TAXONOMY['subs']}
        tx.spec_hits = lambda q: ([], None)
        tx.subs_in = lambda q: (['health.pharmacy'] if 'صيدلية' in q else [], None)
        tx.specs = {}
        self.analytics._tx = lambda: tx

    def tearDown(self):
        market_analytics.POI_TAXONOMY = self.original
        self.env.stop()

    def count(self, body):
        return sum(row['n'] for row in self.analytics.district_counts({'city': 'Riyadh', **body})['districts'])

    def test_off_counts_the_release_classification_only(self):
        self.assertEqual(self.count({'main_id': 'health'}), 1)

    def test_on_a_picked_main_counts_main_only_businesses(self):
        os.environ['FARQ_AI_CLASSIFICATION'] = '1'
        self.assertEqual(self.count({'main_id': 'health'}), 2)
        self.assertEqual(self.count({'main_id': 'food'}), 0, 'a main-only row counts for its own main only')

    def test_on_a_typed_activity_never_counts_main_only_businesses(self):
        os.environ['FARQ_AI_CLASSIFICATION'] = '1'
        self.assertEqual(self.count({'q': 'صيدلية'}), 1)


if __name__ == '__main__':
    unittest.main()
