import json
import os
import tempfile
import unittest
from pathlib import Path

from snapshot_version import snapshot_version


class SnapshotVersionTests(unittest.TestCase):
    def test_a_published_release_is_versioned_by_its_build_time(self):
        with tempfile.TemporaryDirectory() as raw:
            data = Path(raw)
            (data / 'targets.parquet').write_bytes(b'fixture')
            (data / 'release.lineage.json').write_text(json.dumps({'release': 'r2', 'created_at': '2026-11-03T08:15:00+03:00'}), encoding='utf-8')
            # the same instant, in UTC to the second, whatever zone the lineage was written in
            self.assertEqual(snapshot_version(raw), '2026-11-03T05:15:00+00:00')

    def test_without_lineage_the_manifest_then_the_newest_asset_dates_it(self):
        with tempfile.TemporaryDirectory() as raw:
            data = Path(raw)
            self.assertEqual(snapshot_version(raw), '')
            (data / 'targets.parquet').write_bytes(b'a')
            (data / 'street_density.parquet').write_bytes(b'b')
            os.utime(data / 'targets.parquet', (1_700_000_000, 1_700_000_000))
            os.utime(data / 'street_density.parquet', (1_700_000_100, 1_700_000_100))
            self.assertEqual(snapshot_version(raw), '2023-11-14T22:15:00+00:00')
            (data / 'release.manifest.json').write_text('{}', encoding='utf-8')
            os.utime(data / 'release.manifest.json', (1_700_000_500, 1_700_000_500))
            self.assertEqual(snapshot_version(raw), '2023-11-14T22:21:40+00:00')

    def test_a_broken_lineage_falls_back_instead_of_failing(self):
        with tempfile.TemporaryDirectory() as raw:
            data = Path(raw)
            (data / 'targets.parquet').write_bytes(b'a')
            os.utime(data / 'targets.parquet', (1_700_000_000, 1_700_000_000))
            (data / 'release.lineage.json').write_text('not json', encoding='utf-8')
            self.assertEqual(snapshot_version(raw), '2023-11-14T22:13:20+00:00')
            (data / 'release.lineage.json').write_text(json.dumps({'created_at': 'yesterday'}), encoding='utf-8')
            self.assertEqual(snapshot_version(raw), '2023-11-14T22:13:20+00:00')


if __name__ == '__main__':
    unittest.main()
