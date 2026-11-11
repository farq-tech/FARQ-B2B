"""The business list of a picked subcategory or specialty is the cohort its figure counts (owner 2026-11-11).

The directory's own `sub_id` column also holds low-confidence labels (Riyadh women's salons: 8,034 there against 3,017
in the figure). The served filters read the same classification as market_analytics, so the two agree exactly."""
import pathlib
import sys
import tempfile
import threading
import unittest

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import market_analytics  # noqa: E402
from directory_tiles import DirectoryTiles, valid_filters  # noqa: E402
from market_analytics import MarketAnalytics  # noqa: E402

ROWS = [
    # poi_key, name, directory sub_id, specialty_ids, served sub_id, served confidence
    ("a", "صالون أ", "beauty.salon_women", "", "beauty.salon_women", "high"),
    ("b", "صالون ب", "beauty.salon_women", "", "beauty.salon_women", "low"),        # directory says salon, figure does not
    ("c", "مشغل ج", None, "", "beauty.salon_women", "medium"),                       # the directory has no label, the figure does
    ("d", "برجر د", "food.fast_food", "food.fast_food.burger", "food.fast_food", "high"),
    ("e", "برجر هـ", "food.restaurant", "food.restaurant.burger", "food.restaurant", "high"),
]


class Taxonomy:
    subs = {"beauty.salon_women": {"main_id": "beauty", "main_ar": "تجميل", "sub_ar": "صالون نسائي"},
            "food.fast_food": {"main_id": "food", "main_ar": "أغذية", "sub_ar": "وجبات سريعة"},
            "food.restaurant": {"main_id": "food", "main_ar": "أغذية", "sub_ar": "مطعم"}}
    specs = {}


class ServedFilterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        targets, taxonomy = root / "targets.parquet", root / "poi_taxonomy.parquet"
        db = duckdb.connect()
        db.execute("""create table t(poi_key varchar, name_ar varchar, name_en varchar, city_en varchar, sub_id varchar,
                      specialty_ids varchar, brand_name varchar, district_ar varchar, district_reliable boolean,
                      has_whatsapp boolean, phone_norm varchar, is_wholesale boolean, location_precision varchar,
                      longitude double, latitude double, commercial_license varchar)""")
        db.executemany("insert into t values (?, ?, null, 'Riyadh', ?, ?, '', 'النخيل', true, false, null, false, 'point', 46.6, 24.7, '')",
                       [(key, name, sub, specs) for key, name, sub, specs, _, _ in ROWS])
        db.execute(f"copy t to '{targets}' (format parquet)")
        db.execute("create table c(poi_key varchar, sub_id varchar, confidence varchar)")
        db.executemany("insert into c values (?, ?, ?)", [(key, served, conf) for key, _, _, _, served, conf in ROWS])
        db.execute(f"copy c to '{taxonomy}' (format parquet)")
        db.close()
        self.original = (market_analytics.DATA, market_analytics.POI_TAXONOMY)
        market_analytics.DATA, market_analytics.POI_TAXONOMY = str(targets), str(taxonomy)
        self.tiles = DirectoryTiles.__new__(DirectoryTiles)
        self.tiles.path, self.tiles.columns, self.tiles.search_sql = str(targets), None, "true"
        self.tiles.lock = threading.RLock()
        self.tiles.db = duckdb.connect()
        self.tiles.db.execute("create table branches(brand varchar, n bigint)")
        analytics_tiles = type("Tiles", (), {})()
        analytics_tiles.db, analytics_tiles.lock, analytics_tiles.search_sql, analytics_tiles.path = duckdb.connect(), threading.RLock(), "true", str(targets)
        self.analytics = MarketAnalytics(analytics_tiles)
        self.analytics._taxonomy = Taxonomy()

    def tearDown(self):
        market_analytics.DATA, market_analytics.POI_TAXONOMY = self.original
        self.temp.cleanup()

    def listed(self, filters):
        base, params = self.tiles.sql("Riyadh", valid_filters(filters))
        return sorted(row[0] for row in self.tiles.db.execute("select p.poi_key " + base, params).fetchall())

    def test_a_picked_subcategory_lists_exactly_what_its_figure_counts(self):
        self.assertEqual(self.listed({"served_sub_ids": ["beauty.salon_women"]}), ["a", "c"])
        figure = self.analytics.district_counts({"city": "Riyadh", "sub_ids": ["beauty.salon_women"]})["total"]
        self.assertEqual(figure, 2)
        # the directory's own column would list a and b: one the figure does not count, and miss c
        self.assertEqual(self.listed({"taxonomy_sub_id": "beauty.salon_women"}), ["a", "b"])

    def test_a_merged_specialty_lists_both_parents(self):
        ids = ["food.fast_food.burger", "food.restaurant.burger"]
        self.assertEqual(self.listed({"served_specialty_ids": ids}), ["d", "e"])
        self.assertEqual(self.analytics.district_counts({"city": "Riyadh", "specialty_ids": ids})["total"], 2)

    def test_bad_ids_are_refused(self):
        for bad in ({"served_sub_ids": ["../x"]}, {"served_sub_ids": "beauty"}, {"served_specialty_ids": ["a"] * 21},
                    {"served_sub_ids": ["A.B"]}):
            with self.assertRaises(ValueError):
                valid_filters(bad)

    def test_without_the_tags_a_specialty_lists_none(self):
        self.tiles.columns = {"poi_key", "name_ar", "name_en", "city_en", "sub_id", "brand_name"}   # no specialty_ids
        self.assertEqual(self.listed({"served_specialty_ids": ["food.fast_food.burger"]}), [])


if __name__ == "__main__":
    unittest.main()
