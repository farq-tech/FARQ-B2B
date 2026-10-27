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

        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=fake_build)}), \
                self.assertLogs('farq.targeting', level=logging.INFO) as logs:
            self.assertEqual(startup_jobs.start(self.data), ['building_population'])
            self.assertTrue(done.wait(5))
            threading.Event().wait(0.2)   # let the thread write its final line
        self.assertTrue(any('building_population_done' in line and json.dumps(report, ensure_ascii=False) in line for line in logs.output))

    def test_a_failing_job_is_logged_by_type_and_never_raises(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = 'true'

        def boom(**kwargs):
            raise FileNotFoundError('/data/buildings_ingest/normalized/buildings.parquet')

        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=boom)}), \
                self.assertLogs('farq.targeting', level=logging.ERROR) as logs:
            startup_jobs.start(self.data)
            for thread in threading.enumerate():
                if thread.name == 'job-building-population':
                    thread.join(5)
        self.assertTrue(any('startup_job_failed job=building_population error_type=FileNotFoundError' in line for line in logs.output))
        self.assertFalse(any('buildings.parquet' in line for line in logs.output), 'paths never reach the log')

    def test_a_missing_input_is_reported_and_the_job_skipped(self):
        os.environ['FARQ_BUILD_BUILDING_POPULATION'] = '1'
        (self.data / 'districts.geojson').unlink()
        with mock.patch.dict('sys.modules', {'build_building_population': mock.Mock(build=mock.Mock())}), \
                self.assertLogs('farq.targeting', level=logging.ERROR) as logs:
            startup_jobs.start(self.data)
            for thread in threading.enumerate():
                if thread.name == 'job-building-population':
                    thread.join(5)
        self.assertTrue(any('startup_job_skipped job=building_population missing_input=districts' in line for line in logs.output))


if __name__ == '__main__':
    unittest.main()
