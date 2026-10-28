"""Schools, hospitals and city anchors around a point, from synthetic directory rows."""
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


class PlacesNearTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        targets = pathlib.Path(self.temp.name) / "targets.parquet"
        db = duckdb.connect()
        db.execute("""create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, district_ar varchar,
                      location_precision varchar, longitude double, latitude double)""")
        rows = [
            ("s1", "Riyadh", "مدارس الرواد الأهلية", None, "النرجس", "point", 46.661, 24.831),
            ("s2", "Riyadh", "الابتدائية 120", "Primary School 120", "النرجس", "point", 46.665, 24.835),
            ("s3", "Riyadh", "مدرسة النور", None, "النرجس", "point", 46.670, 24.840),
            ("s4", "Riyadh", "مدرسة القيادة", None, "النرجس", "point", 46.662, 24.832),
            ("h1", "Riyadh", "مستشفى الحمادي", None, "النزهة", "point", 46.700, 24.800),
            ("h2", "Riyadh", "عيادة الأسنان", None, "النرجس", "point", 46.661, 24.831),
            ("far", "Riyadh", "مستشفى بعيد", None, "الحائر", "point", 46.800, 24.400),
        ]
        db.executemany("insert into t values (?, ?, ?, ?, ?, ?, ?, ?)", rows)
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

    def test_schools_by_type_hospitals_and_anchors(self):
        result = self.analytics.places_near({"city": "Riyadh", "lon": 46.660, "lat": 24.830})
        places = result["places"]
        self.assertEqual([item["name"] for item in places["school_private"]], ["مدارس الرواد الأهلية"])
        self.assertEqual([item["name"] for item in places["school_public"]], ["الابتدائية 120"])
        self.assertEqual([item["name"] for item in places["school"]], ["مدرسة النور"], 'a driving school is not a school')
        self.assertEqual([item["name"] for item in places["hospital"]], ["مستشفى الحمادي"], 'a clinic is not a hospital; beyond the radius is left out')
        self.assertEqual(set(result["anchors"]), {"airport", "center"})
        self.assertGreater(result["anchors"]["airport"]["km"], 10)

    def test_a_point_outside_the_kingdom_is_refused(self):
        with self.assertRaises(ValueError):
            self.analytics.places_near({"city": "Riyadh", "lon": 0, "lat": 0})


if __name__ == "__main__":
    unittest.main()
