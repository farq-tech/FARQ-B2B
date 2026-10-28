import json
import logging
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import startup_jobs


class StartupJobsTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop('FARQ_BUILD_BUILDING_POPULATION', None)
        # a volume with both inputs present, so the job is not skipped for a missing file
        self.data = Path(tempfile.mkdtemp())
        (self.data / 'buildings_ingest' / 'normalized').mkdir(parents=True)
        (self.data / 'buildings_ingest' / 'normalized' / 'buildings.parquet').write_bytes(b'')
        (self.data / 'districts.geojson').write_text('{}', encoding='utf-8')

    def tearDown(self):
        os.environ.pop('FARQ_BUILD_BUILDING_POPULATION', None)

    def test_nothing_runs_unless_switched_on(self):
        with mock.patch.object(startup_jobs, '_building_population') as job:
            self.assertEqual(startup_jobs.start(self.data), [])
        job.assert_not_called()

    def test_building_population_runs_in_the_background_and_logs_the_report(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = '1'
        done = threading.Event()
        report = {'districts': {'total': 3}, 'cities': {'Riyadh': {'assigned': 2}}}

        def fake_build(**kwargs):
            self.assertTrue(str(kwargs['buildings']).endswith('buildings_ingest/normalized/buildings.parquet'))
            self.assertIsNone(kwargs['official'], 'no official totals file on the volume means WorldPop calibration')
            done.set()
            return report

        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=fake_build, SOURCE='v3')}), \
                self.assertLogs('farq.targeting', level=logging.INFO) as logs:
            self.assertEqual(startup_jobs.start(self.data), ['building_population'])
            self.assertTrue(done.wait(5))
            threading.Event().wait(0.2)   # let the thread write its final line
        self.assertTrue(any('building_population_done' in line and json.dumps(report, ensure_ascii=False) in line for line in logs.output))

    def test_an_unchanged_run_is_skipped_and_a_changed_input_reruns(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = '1'
        (self.data / 'buildings_ingest' / 'population').mkdir(parents=True)
        calls = []
        module = mock.Mock(build=lambda **kwargs: calls.append(kwargs) or {}, SOURCE='v3')

        def run():
            with mock.patch.dict('sys.modules', {'build_building_population': module}), self.assertLogs('farq.targeting', level=logging.INFO) as logs:
                startup_jobs._run('building_population', startup_jobs._building_population, self.data)
            return logs.output

        run()
        self.assertEqual(len(calls), 1)
        self.assertTrue(any('reason=inputs_unchanged' in line for line in run()), 'a restart with the same inputs does not redo the work')
        self.assertEqual(len(calls), 1)
        (self.data / 'districts.geojson').write_text('{"features": []}', encoding='utf-8')
        run()
        self.assertEqual(len(calls), 2, 'a new district atlas reruns the job')
        module.SOURCE = 'v4'
        run()
        self.assertEqual(len(calls), 3, 'a new model version reruns the job')
        os.environ['FARQ_BUILDING_ELEVATION_MODE'] = 'floors'
        try:
            run()
        finally:
            del os.environ['FARQ_BUILDING_ELEVATION_MODE']
        self.assertEqual(len(calls), 4, 'a new elevation reading reruns the job')
        self.assertEqual(calls[-1]['elevation_mode'], 'floors')

    def test_a_failing_job_is_logged_by_type_and_never_raises(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = 'true'

        def boom(**kwargs):
            raise FileNotFoundError('/data/buildings_ingest/normalized/buildings.parquet')

        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=boom, SOURCE='v3')}), \
                self.assertLogs('farq.targeting', level=logging.ERROR) as logs:
            startup_jobs.start(self.data)
            for thread in threading.enumerate():
                if thread.name == 'job-building-population':
                    thread.join(5)
        self.assertTrue(any('startup_job_failed job=building_population error_type=FileNotFoundError' in line for line in logs.output))
        self.assertFalse(any('buildings.parquet' in line for line in logs.output), 'paths never reach the log')

    def test_a_missing_building_layer_is_fetched_from_the_bucket_and_checked(self):
        target = self.data / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
        target.unlink()
        payload = b'parquet-bytes'
        written = []

        class Client:
            def download_file(self, bucket, key, path):
                written.append((bucket, key))
                Path(path).write_bytes(payload)

        env = {'FARQ_BUILDINGS_OBJECT': 'inputs/buildings.parquet', 'BUCKET': 'farq-data-inputs',
               'FARQ_BUILDINGS_SHA256': __import__('hashlib').sha256(payload).hexdigest()}
        with mock.patch.dict(os.environ, env), mock.patch.dict('sys.modules', {'boto3': mock.Mock(client=lambda *a, **k: Client())}):
            self.assertTrue(startup_jobs._fetch_buildings(target))
        self.assertEqual((target.read_bytes(), written), (payload, [('farq-data-inputs', 'inputs/buildings.parquet')]))
        target.unlink()
        env['FARQ_BUILDINGS_SHA256'] = '0' * 64
        with mock.patch.dict(os.environ, env), mock.patch.dict('sys.modules', {'boto3': mock.Mock(client=lambda *a, **k: Client())}), \
                self.assertLogs('farq.targeting', level=logging.ERROR) as logs:
            self.assertFalse(startup_jobs._fetch_buildings(target))
        self.assertFalse(target.exists(), 'a download that does not match its digest never reaches the job')
        self.assertFalse(any(p.name.endswith('.download') for p in target.parent.iterdir()))
        self.assertTrue(any('sha256_mismatch' in line for line in logs.output))
        with mock.patch.dict(os.environ, {}, clear=False):
            for name in ('FARQ_BUILDINGS_OBJECT', 'BUCKET'):
                os.environ.pop(name, None)
            self.assertFalse(startup_jobs._fetch_buildings(target), 'without a configured source nothing is fetched')

    def test_real_estate_inputs_are_fetched_once_per_digest(self):
        out = Path(tempfile.mkdtemp())
        files = {'inputs/re-districts.json': b'{"cities": {}}', 'inputs/re-listings.json': b'{"listings": []}'}
        written = []

        class Client:
            def download_file(self, bucket, key, path):
                written.append(key)
                Path(path).write_bytes(files[key])

        sha = lambda data: __import__('hashlib').sha256(data).hexdigest()
        env = {'BUCKET': 'farq-data-inputs',
               'REAL_ESTATE_DISTRICTS': str(out / 'districts.json'), 'REAL_ESTATE_LISTINGS': str(out / 'listings.json'),
               'FARQ_REAL_ESTATE_DISTRICTS_OBJECT': 'inputs/re-districts.json', 'FARQ_REAL_ESTATE_DISTRICTS_SHA256': sha(files['inputs/re-districts.json']),
               'FARQ_REAL_ESTATE_LISTINGS_OBJECT': 'inputs/re-listings.json', 'FARQ_REAL_ESTATE_LISTINGS_SHA256': sha(files['inputs/re-listings.json'])}
        with mock.patch.dict(os.environ, env), mock.patch.dict('sys.modules', {'boto3': mock.Mock(client=lambda *a, **k: Client())}):
            startup_jobs._real_estate_inputs()
            self.assertEqual((out / 'listings.json').read_bytes(), files['inputs/re-listings.json'])
            startup_jobs._real_estate_inputs()
        self.assertEqual(written, ['inputs/re-districts.json', 'inputs/re-listings.json'], 'an unchanged digest is not fetched again')

    def test_the_job_works_in_the_population_folder_and_adopts_a_layer_left_in_the_release(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = '1'
        aux = Path(tempfile.mkdtemp())
        legacy = self.data / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
        legacy.write_bytes(b'layer')
        calls = []
        module = mock.Mock(build=lambda **kwargs: calls.append(kwargs) or {}, SOURCE='v3')
        with mock.patch.dict('sys.modules', {'build_building_population': module}), self.assertLogs('farq.targeting', level=logging.INFO):
            startup_jobs._run('building_population', startup_jobs._building_population, self.data, aux)
        moved = aux / 'buildings_ingest' / 'normalized' / 'buildings.parquet'
        self.assertEqual((moved.read_bytes(), legacy.exists()), (b'layer', False), 'the layer now lives where releases cannot replace it')
        self.assertEqual(calls[0]['buildings'], moved)
        self.assertEqual(calls[0]['output_dir'], aux / 'buildings_ingest' / 'population', 'outputs go where the server reads population')
        self.assertEqual(calls[0]['districts'], self.data / 'districts.geojson', 'the district atlas still comes from the release')

    def test_a_missing_input_is_reported_and_the_job_skipped(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = '1'
        (self.data / 'districts.geojson').unlink()
        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=mock.Mock(), SOURCE='v3')}), \
                self.assertLogs('farq.targeting', level=logging.ERROR) as logs:
            startup_jobs.start(self.data)
            for thread in threading.enumerate():
                if thread.name == 'job-building-population':
                    thread.join(5)
        self.assertTrue(any('startup_job_skipped job=building_population missing_input=districts' in line for line in logs.output))


if __name__ == '__main__':
    unittest.main()
