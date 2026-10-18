"""Exact-specialty and intersected-filter checks using synthetic Parquet fixtures."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
import market_analytics  # noqa: E402
from market_analytics import MarketAnalytics  # noqa: E402


class FakeTaxonomy:
    subs = {
        "plumbing.fixtures": {"main_id": "plumbing", "main_ar": "مواد صحية", "sub_ar": "أدوات صحية"},
        "plumbing.tools": {"main_id": "plumbing", "main_ar": "مواد صحية", "sub_ar": "أدوات سباكة"},
    }
    specs = {"spec.sinks": {"sub_id": "plumbing.fixtures", "specialty_ar": "مغاسل"}}

    def spec_hits(self, text):
        return (["spec.sinks"], 10) if "مغاسل" in text else ([], 0)

    def subs_in(self, text):
        return (["plumbing.tools"], 10) if "أدوات" in text else ([], 0)


class MarketAnalyticsSpecialtyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.originals = (market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY)
        self.targets = self.root / "targets.parquet"
        self.taxonomy = self.root / "poi_taxonomy.parquet"
        self.street_density = self.root / "missing-street-density.parquet"
        self._write_targets(self.targets, include_specialty=True)
        self._write_taxonomy(self.taxonomy)
        market_analytics.DATA = str(self.targets)
        market_analytics.POI_TAXONOMY = str(self.taxonomy)
        market_analytics.STREET_DENSITY = str(self.street_density)
        self.db = duckdb.connect()
        self.tiles = type("Tiles", (), {})()
        self.tiles.db = self.db
        self.tiles.lock = threading.RLock()
        self.tiles.search_sql = "true"
        self.analytics = MarketAnalytics(self.tiles)
        self.analytics._taxonomy = FakeTaxonomy()

    def tearDown(self):
        self.db.close()
        market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY = self.originals
        self.temp.cleanup()

    @staticmethod
    def _write_targets(path, include_specialty):
        db = duckdb.connect()
        specialty = ", specialty_ids varchar" if include_specialty else ""
        db.execute(f"""create table targets(
            poi_key varchar, city_en varchar, name_ar varchar, name_en varchar,
            has_whatsapp boolean, is_wholesale boolean, district_ar varchar,
            district_reliable boolean, location_precision varchar, longitude double,
            latitude double, commercial_license varchar{specialty})""")
        columns = "poi_key,city_en,name_ar,name_en,has_whatsapp,is_wholesale,district_ar,district_reliable,location_precision,longitude,latitude,commercial_license"
        if include_specialty:
            columns += ",specialty_ids"
        base_rows = [
            ("p1", "Riyadh", "منشأة أ", "Place A", True, False, "حي النخيل", True, "point", 46.6, 24.7, "CR1"),
            ("p2", "Riyadh", "منشأة ب", "Place B", False, True, "حي الياسمين", True, "point", 46.7, 24.8, "CR2"),
            ("p3", "Riyadh", "منشأة ج", "Place C", True, False, "حي النخيل", True, "point", 46.6, 24.71, "CR3"),
            ("p4", "Jeddah", "منشأة د", "Place D", True, False, "حي النخيل", True, "point", 39.2, 21.5, "CR4"),
            ("p5", "Riyadh", "منشأة هـ", "Place E", False, False, None, False, "unknown", None, None, ""),
        ]
        if include_specialty:
            rows = [row + (specs,) for row, specs in zip(base_rows, ["spec.sinks", "spec.taps", "spec.sinks", "spec.sinks", "spec.sinks"])]
            placeholders = ",".join("?" for _ in range(13))
        else:
            rows = base_rows
            placeholders = ",".join("?" for _ in range(12))
        db.executemany(f"insert into targets({columns}) values ({placeholders})", rows)
        db.execute("copy targets to ? (format parquet)", [str(path)])
        db.close()

    @staticmethod
    def _write_taxonomy(path):
        db = duckdb.connect()
        db.execute("create table poi_taxonomy(poi_key varchar, confidence varchar, sub_id varchar)")
        db.executemany("insert into poi_taxonomy values (?, ?, ?)", [
            ("p1", "high", "plumbing.fixtures"),
            ("p2", "high", "plumbing.fixtures"),
            ("p3", "high", "plumbing.tools"),
            ("p4", "high", "plumbing.fixtures"),
            ("p5", "medium", "plumbing.fixtures"),
        ])
        db.execute("copy poi_taxonomy to ? (format parquet)", [str(path)])
        db.close()

    def test_district_counts_intersect_explicit_activity_and_specialty(self):
        result = self.analytics.district_counts({
            "city": "Riyadh",
            "sub_ids": ["plumbing.fixtures"],
            "specialty_ids": ["spec.sinks"],
        })

        self.assertTrue(result["specialty_available"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["districts"], [{
            "district_ar": "حي النخيل", "n": 1, "n_whatsapp": 1, "n_wholesale": 0,
        }])

    def test_market_summary_reports_only_exact_specialty_cohort(self):
        result = self.analytics.market_summary({
            "city": "Riyadh",
            "sub_ids": ["plumbing.fixtures"],
            "specialty_ids": ["spec.sinks"],
        })["summary"]

        self.assertTrue(result["specialty_available"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["n_whatsapp"], 1)
        self.assertEqual(result["n_approx"], 1)
        self.assertIsNone(result["densest_street"])

    def test_unmatched_query_and_activity_intersection_returns_zero(self):
        city, subs, where, params, _ = self.analytics._where({
            "city": "Riyadh",
            "q": "مغاسل",
            "sub_ids": ["plumbing.tools"],
        })

        self.assertEqual(city, "Riyadh")
        self.assertEqual(subs, [])
        self.assertIn("false", where)
        self.assertEqual(self.db.execute(f"select count(*) from read_parquet(?) p where {where}", params).fetchone()[0], 0)

    def test_missing_specialty_column_fails_closed(self):
        missing_column = self.root / "targets-without-specialties.parquet"
        self._write_targets(missing_column, include_specialty=False)
        market_analytics.DATA = str(missing_column)
        self.analytics._specialty_column = None

        result = self.analytics.district_counts({
            "city": "Riyadh",
            "sub_ids": ["plumbing.fixtures"],
            "specialty_ids": ["spec.sinks"],
        })

        self.assertFalse(result["specialty_available"])
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["districts"], [])


if __name__ == "__main__":
    unittest.main()
