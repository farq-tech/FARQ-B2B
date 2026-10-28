"""Chains of an activity from synthetic directory rows."""
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


class MarketBrandsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        targets = pathlib.Path(self.temp.name) / "targets.parquet"
        db = duckdb.connect()
        db.execute("""create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, brand_name varchar,
                      district_ar varchar, district_reliable boolean)""")
        rows = [
            ("a1", "Riyadh", "صيدلية النهدي - العليا", None, None, "العليا"),
            ("a2", "Riyadh", "صيدليه النهدي فرع الملقا", None, None, "الملقا"),
            ("a3", "Riyadh", "صيدلية النهدي (النرجس)", None, None, "النرجس"),
            ("a4", "Riyadh", "اسم آخر", None, "صيدلية النهدي", "النرجس"),
            ("b1", "Riyadh", "صيدلية الدواء", None, None, "العليا"),
            ("b2", "Riyadh", "صيدلية الدواء - الملقا", None, None, "الملقا"),
            ("c1", "Riyadh", "صيدلية الحي", None, None, "العليا"),
            ("j1", "Jeddah", "صيدلية النهدي", None, None, "الروضة"),
        ]
        db.executemany("insert into t values (?, ?, ?, ?, ?, ?, true)", rows)
        db.execute(f"copy t to '{targets}' (format parquet)")
        db.close()
        self.original = market_analytics.DATA
        market_analytics.DATA = str(targets)
        self.db = duckdb.connect()
        tiles = type("Tiles", (), {})()
        tiles.db, tiles.lock, tiles.search_sql = self.db, threading.RLock(), "true"
        self.analytics = MarketAnalytics(tiles)

    def tearDown(self):
        self.db.close()
        market_analytics.DATA = self.original
        self.temp.cleanup()

    def test_branches_of_one_brand_group_across_spellings_and_branch_suffixes(self):
        result = self.analytics.brands({"city": "Riyadh"})
        self.assertEqual((result["total"], result["chains"], result["in_chains"]), (7, 1, 4))
        chain = result["brands"][0]
        self.assertEqual((chain["branches"], chain["districts"]), (4, 3))
        self.assertEqual(chain["by_district"][0], {"district_ar": "النرجس", "n": 2})

    def test_the_chain_threshold_is_the_callers(self):
        result = self.analytics.brands({"city": "Riyadh", "min_branches": 2})
        self.assertEqual([item["branches"] for item in result["brands"]], [4, 2])
        with self.assertRaises(ValueError):
            self.analytics.brands({"city": "Riyadh", "min_branches": 1})


if __name__ == "__main__":
    unittest.main()
