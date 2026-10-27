"""Market-gap ranking against synthetic directory rows and district populations."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

SERVICE_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))
from market_analytics import MarketAnalytics  # noqa: E402


class MarketGapTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.targets = self.root / "targets.parquet"
        db = duckdb.connect()
        db.execute("""create table targets(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar,
            has_whatsapp boolean, phone_norm varchar, is_wholesale boolean, district_ar varchar, district_reliable boolean,
            location_precision varchar, longitude double, latitude double)""")
        rows = []
        # pharmacies: 10 in النخيل (20k people), 2 in الياسمين (40k people), 0 in الربيع (30k people), 3 in a district with no population
        for i in range(10): rows.append((f"n{i}", "Riyadh", f"صيدلية {i}", None, False, None, False, "النخيل", True, "point", 46.6, 24.7))
        for i in range(2): rows.append((f"y{i}", "Riyadh", f"صيدلية ي{i}", None, False, None, False, "الياسمين", True, "point", 46.7, 24.8))
        for i in range(3): rows.append((f"u{i}", "Riyadh", f"صيدلية م{i}", None, False, None, False, "مجهول", True, "point", 46.8, 24.9))
        db.executemany("insert into targets values (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.execute("copy targets to ? (format parquet)", [str(self.targets)])
        db.close()
        tiles = type("Tiles", (), {})()
        tiles.db, tiles.lock, tiles.search_sql, tiles.path = duckdb.connect(), threading.RLock(), "true", str(self.targets)
        self.analytics = MarketAnalytics(tiles)
        self.population = {
            "النخيل": {"population": 20000.0, "male": 11000.0, "female": 9000.0},
            "الياسمين": {"population": 40000.0, "male": 20000.0, "female": 20000.0},
            "الربيع": {"population": 30000.0, "male": None, "female": None},
            "صغير": {"population": 1000.0, "male": None, "female": None},
        }

    def test_districts_are_ranked_by_shortfall_against_the_city_rate(self):
        result = self.analytics.market_gaps({"city": "Riyadh"}, self.population)
        # city rate over districts with both population and businesses: 60,000 people / 12 pharmacies = 5,000
        self.assertEqual(result["residents_per_business"], 5000)
        names = [row["district_ar"] for row in result["districts"]]
        self.assertEqual(names, ["الربيع", "الياسمين", "النخيل"], "the small district is below min_population")
        rabi, yasmin, nakheel = result["districts"]
        self.assertEqual((rabi["businesses"], rabi["expected_businesses"], rabi["shortfall"]), (0, 6.0, 6.0))
        self.assertIsNone(rabi["residents_per_business"], "no business means no ratio, not infinity")
        self.assertEqual((yasmin["businesses"], yasmin["shortfall"], yasmin["residents_per_business"]), (2, 6.0, 20000))
        self.assertEqual(nakheel["shortfall"], -6.0, "a surplus is a negative shortfall")
        self.assertEqual(nakheel["male_pct"], 55.0)
        self.assertIn("الدليل لا يغطي", result["basis"])

    def test_min_population_and_limit_are_respected_and_validated(self):
        result = self.analytics.market_gaps({"city": "Riyadh", "min_population": 500, "limit": 2}, self.population)
        self.assertEqual(len(result["districts"]), 2)
        for bad in ({"city": "Riyadh", "min_population": -1}, {"city": "Riyadh", "limit": 0}, {"city": "Riyadh", "limit": True}):
            with self.assertRaises(ValueError):
                self.analytics.market_gaps(bad, self.population)

    def test_no_population_or_no_businesses_gives_an_explained_empty_answer(self):
        result = self.analytics.market_gaps({"city": "Riyadh"}, {})
        self.assertEqual(result["districts"], [])
        self.assertIsNone(result["residents_per_business"])
        self.assertTrue(result["message"])


if __name__ == "__main__":
    unittest.main()
