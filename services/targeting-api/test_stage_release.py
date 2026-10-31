import tempfile
import unittest
import json
from pathlib import Path

from stage_release import TAXONOMY_COMPANIONS, stage_release
from test_data_release import DataReleaseTests


class StageReleaseTests(unittest.TestCase):
    PROVENANCE = {"sources": [{"id": "synthetic-fixture", "license": "internal-test-only", "extracted_at": "2026-10-23T00:00:00Z"}]}
    def _source_assets(self, root: Path) -> dict[str, Path]:
        root.mkdir(parents=True)
        DataReleaseTests().make_release(root)
        for name in TAXONOMY_COMPANIONS:
            (root / "taxonomy" / name).write_text("sub_id,term\nx,y\n", encoding="utf-8")
        return {
            "targets.parquet": root / "targets.parquet",
            "poi_taxonomy.parquet": root / "poi_taxonomy.parquet",
            "street_density.parquet": root / "street_density.parquet",
            "trade_clusters.parquet": root / "trade_clusters.parquet",
            "districts.geojson": root / "districts.geojson",
            "taxonomy/farq_taxonomy.json": root / "taxonomy/farq_taxonomy.json",
            "identity/source_to_farq_atlas_id.parquet": root / "identity/source_to_farq_atlas_id.parquet",
        }

    def test_stages_a_new_release_with_manifest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            report = stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE)
            self.assertTrue((root / "release/release.manifest.json").is_file())
            self.assertEqual(report["targets"]["rows"], 1)
            self.assertTrue(report["release_id"])
            self.assertEqual(report["provenance"], self.PROVENANCE)

    def test_copies_the_search_vocabulary_beside_the_taxonomy(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE)
            for name in TAXONOMY_COMPANIONS:
                self.assertTrue((root / "release/taxonomy" / name).is_file(), name)

    def test_refuses_a_taxonomy_without_its_vocabulary(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            sources = self._source_assets(root / "source")
            (root / "source/taxonomy/saudi_market_terms.csv").unlink()
            with self.assertRaisesRegex(ValueError, "saudi_market_terms.csv"):
                stage_release(root / "release", sources, self.PROVENANCE)
            self.assertFalse((root / "release").exists())

    def test_never_overwrites_a_release(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            output = root / "release"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "already exists"):
                stage_release(output, self._source_assets(root / "source"), self.PROVENANCE)

    def test_rejects_provenance_without_a_source_timestamp(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            with self.assertRaisesRegex(ValueError, "extracted_at"):
                stage_release(root / "release", self._source_assets(root / "source"), {"sources": [{"id": "fixture", "license": "internal"}]})


if __name__ == "__main__":
    unittest.main()
