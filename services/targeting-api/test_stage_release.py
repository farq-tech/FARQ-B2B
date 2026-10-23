import tempfile
import unittest
from pathlib import Path

from stage_release import stage_release
from test_data_release import DataReleaseTests


class StageReleaseTests(unittest.TestCase):
    def _source_assets(self, root: Path) -> dict[str, Path]:
        root.mkdir(parents=True)
        DataReleaseTests().make_release(root)
        return {
            "targets.parquet": root / "targets.parquet",
            "poi_taxonomy.parquet": root / "poi_taxonomy.parquet",
            "street_density.parquet": root / "street_density.parquet",
            "trade_clusters.parquet": root / "trade_clusters.parquet",
            "districts.geojson": root / "districts.geojson",
            "taxonomy/farq_taxonomy.json": root / "taxonomy/farq_taxonomy.json",
        }

    def test_stages_a_new_release_with_manifest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            report = stage_release(root / "release", self._source_assets(root / "source"))
            self.assertTrue((root / "release/release.manifest.json").is_file())
            self.assertEqual(report["targets"]["rows"], 1)
            self.assertTrue(report["release_id"])

    def test_never_overwrites_a_release(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            output = root / "release"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "already exists"):
                stage_release(output, self._source_assets(root / "source"))


if __name__ == "__main__":
    unittest.main()
