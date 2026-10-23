import json
import tempfile
import unittest
from pathlib import Path

import duckdb

from data_release import validate_release


class DataReleaseTests(unittest.TestCase):
    def make_release(self, root: Path, duplicate: bool = False) -> None:
        (root / "taxonomy").mkdir()
        (root / "taxonomy/farq_taxonomy.json").write_text(json.dumps({"subs": [{"sub_id": "construction.contracting"}]}), encoding="utf-8")
        (root / "districts.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"ar": "الربيع"}, "geometry": {"type": "Polygon", "coordinates": [[[46, 24], [47, 24], [47, 25], [46, 24]]]}}]}), encoding="utf-8")
        db = duckdb.connect()
        try:
            db.execute("create table targets(poi_key varchar, latitude double, longitude double, city_en varchar, district_ar varchar, location_precision varchar)")
            db.execute("insert into targets values ('a', 24.7, 46.7, 'Riyadh', 'الربيع', 'point')")
            if duplicate:
                db.execute("insert into targets values ('a', 24.8, 46.8, 'Riyadh', 'الربيع', 'point')")
            db.execute(f"copy targets to '{root / 'targets.parquet'}' (format parquet)")
            db.execute("create table taxonomy(poi_key varchar, sub_id varchar)")
            db.execute("insert into taxonomy values ('a', 'construction.contracting')")
            db.execute(f"copy taxonomy to '{root / 'poi_taxonomy.parquet'}' (format parquet)")
            db.execute("create table empty_asset(v integer)")
            for filename in ("street_density.parquet", "trade_clusters.parquet"):
                db.execute(f"copy empty_asset to '{root / filename}' (format parquet)")
        finally:
            db.close()

    def test_reports_a_valid_snapshot_without_rows(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self.make_release(root)
            report = validate_release(root)
            self.assertEqual(report["targets"]["rows"], 1)
            self.assertEqual(report["districts"]["features"], 1)
            self.assertIn("targets.parquet", report["assets"])

    def test_rejects_duplicate_stable_keys(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self.make_release(root, duplicate=True)
            with self.assertRaisesRegex(ValueError, "duplicate poi_key"):
                validate_release(root)


if __name__ == "__main__":
    unittest.main()
