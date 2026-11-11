import tempfile
import unittest
import json
from pathlib import Path

from data_release import REQUIRED_ASSETS, _release_id, validate_release, verify_manifest
from stage_release import TAXONOMY_COMPANIONS, _quality, stage_release
from test_data_release import DataReleaseTests


class StageReleaseTests(unittest.TestCase):
    PROVENANCE = {"sources": [{"id": "synthetic-fixture", "license": "internal-test-only", "extracted_at": "2026-10-23T00:00:00Z"}]}
    def _source_assets(self, root: Path) -> dict[str, Path]:
        root.mkdir(parents=True)
        DataReleaseTests().make_release(root)
        for name in TAXONOMY_COMPANIONS:
            (root / name).write_text("sub_id,term\nx,y\n", encoding="utf-8")
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
            report = stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE)
            for name in TAXONOMY_COMPANIONS:
                self.assertTrue((root / "release" / name).is_file(), name)
                self.assertIn(name, report["assets"], "the vocabulary is fingerprinted")

    def test_a_changed_vocabulary_fails_the_approved_manifest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            report = stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE)
            manifest = root / "approved.json"
            manifest.write_text(json.dumps(report), encoding="utf-8")
            (root / "release/taxonomy/saudi_market_terms.csv").write_text("sub_id,term\nx,z\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "mismatch"):
                verify_manifest(validate_release(root / "release"), manifest)
            (root / "release/taxonomy/saudi_market_terms.csv").unlink()
            with self.assertRaisesRegex(ValueError, "mismatch"):
                verify_manifest(validate_release(root / "release"), manifest)

    def test_a_manifest_approved_before_the_vocabulary_still_verifies(self):
        # the served release was approved with the required assets only, and its vocabulary was added beside it later
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            report = stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE)
            required = {name: report["assets"][name] for name in REQUIRED_ASSETS}
            old = {**report, "assets": required, "release_id": _release_id(required)}
            manifest = root / "approved.json"
            manifest.write_text(json.dumps(old), encoding="utf-8")
            verify_manifest(validate_release(root / "release"), manifest)
            (root / "release/targets.parquet").write_bytes(b"changed")
            with self.assertRaises(Exception):
                verify_manifest(validate_release(root / "release"), manifest)

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



    def test_a_passing_quality_gate_is_recorded_in_the_manifest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            gate = {"version": "quality_gate_v1", "gate": "PASS", "reasons": [], "absolute": {"7_Placeholder": 0, "10_Bbox": 0},
                    "ratchet": {}, "baseline_used": False, "max_rise_pct": 1.0, "validator": {"rows_with_high": 0}}
            (root / "gate.json").write_text(json.dumps(gate), encoding="utf-8")
            report = stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE, _quality(root / "gate.json"))
            self.assertEqual(report["quality"]["gate"], "PASS")
            manifest = json.loads((root / "release/release.manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["quality"]["absolute"], {"7_Placeholder": 0, "10_Bbox": 0})

    def test_a_failed_quality_gate_refuses_the_release(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "gate.json").write_text(json.dumps({"gate": "FAIL", "reasons": ["7_Placeholder: 3 rows (must be 0)"]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "7_Placeholder"):
                _quality(root / "gate.json")
            with self.assertRaisesRegex(ValueError, "quality gate failed"):
                stage_release(root / "release", self._source_assets(root / "source"), self.PROVENANCE, {"gate": "FAIL"})
            self.assertFalse((root / "release").exists())
            self.assertIsNone(_quality(None), "the gate stays optional for releases staged without one")


if __name__ == "__main__":
    unittest.main()
