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
                      district_ar varchar, commercial_license varchar, district_reliable boolean)""")
        rows = [
            ("a1", "Riyadh", "صيدلية النهدي - العليا", None, None, "العليا", "CR-N"),
            ("a2", "Riyadh", "صيدليه النهدي فرع الملقا", None, None, "الملقا", "CR-N"),
            ("a3", "Riyadh", "صيدلية النهدي (النرجس)", None, None, "النرجس", None),
            ("a4", "Riyadh", "اسم آخر", None, "صيدلية النهدي", "النرجس", None),
            ("a5", "Riyadh", None, "Nahdi Pharmacy", None, "الياسمين", "CR-N"),
            ("b1", "Riyadh", "صيدلية الدواء", None, None, "العليا", "CR-H"),
            ("b2", "Riyadh", "صيدلية الدواء - الملقا", None, None, "الملقا", "CR-H"),
            ("b3", "Riyadh", "صيدلية الشفاء", None, None, "الملقا", "CR-H"),
            ("c1", "Riyadh", "صيدلية الحي", None, None, "العليا", None),
            # a stray registration ties Nahdi's Latin name to a competitor's Arabic one: the competitor stays apart
            ("d1", "Riyadh", "صيدلية ليمون", None, None, "العليا", "CR-L"),
            ("d2", "Riyadh", "صيدلية ليمون 2", None, None, "الملقا", "CR-L"),
            ("d3", "Riyadh", "صيدلية ليمون ٣", None, None, "النرجس", "CR-L"),
            ("d4", "Riyadh", None, "Nahdi Pharmacy", None, "العليا", "CR-L"),
            # a bare activity word is many independent shops, not a brand
            ("g1", "Riyadh", "صيدلية", None, None, "العليا", "CR-N"),
            ("g2", "Riyadh", "صيدلية", None, None, "الملقا", None),
            ("g3", "Riyadh", None, "Pharmacy", None, "النرجس", "CR-N"),
            ("j1", "Jeddah", "صيدلية النهدي", None, None, "الروضة", None),
        ]
        db.executemany("insert into t values (?, ?, ?, ?, ?, ?, ?, true)", rows)
        taxonomy = pathlib.Path(self.temp.name) / "poi_taxonomy.parquet"
        db.execute("create table x(poi_key varchar, sub_id varchar, confidence varchar)")
        db.executemany("insert into x values (?, ?, 'high')", [("a1", "health.pharmacy"), ("a2", "health.pharmacy"), ("a5", "retail.cosmetics")])
        db.execute(f"copy x to '{taxonomy}' (format parquet)")
        db.execute(f"copy t to '{targets}' (format parquet)")
        db.close()
        self.original = (market_analytics.DATA, market_analytics.POI_TAXONOMY)
        market_analytics.DATA, market_analytics.POI_TAXONOMY = str(targets), str(taxonomy)
        self.db = duckdb.connect()
        tiles = type("Tiles", (), {})()
        tiles.db, tiles.lock, tiles.search_sql = self.db, threading.RLock(), "true"
        self.analytics = MarketAnalytics(tiles)
        self.analytics._taxonomy = type("Tx", (), {"subs": {"health.pharmacy": {"main_ar": "صيدليات"}, "retail.cosmetics": {"main_ar": "تجميل"}}})()

    def tearDown(self):
        self.db.close()
        market_analytics.DATA, market_analytics.POI_TAXONOMY = self.original
        self.temp.cleanup()

    def test_branches_of_one_brand_group_across_spellings_and_branch_suffixes(self):
        result = self.analytics.brands({"city": "Riyadh"})
        self.assertEqual((result["total"], result["chains"], result["in_chains"]), (16, 2, 9))
        chain = result["brands"][0]
        self.assertEqual((chain["brand"], chain["branches"], chain["districts"]), ("صيدلية النهدي", 6, 4),
                         'the Latin spelling joins through the shared registration, under the Arabic name')
        self.assertEqual(chain["by_district"][0], {"district_ar": "العليا", "n": 2})
        self.assertEqual((result["brands"][1]["brand"], result["brands"][1]["branches"]), ("صيدلية ليمون", 3),
                         'a branch number is not part of the brand, and the competitor is not pulled into Nahdi')
        self.assertNotIn("صيدليه", [key for brand in result["brands"] for key in brand["keys"]])
        self.assertIsNone(chain["growth"], 'no history yet')

    def test_the_chain_threshold_is_the_callers(self):
        result = self.analytics.brands({"city": "Riyadh", "min_branches": 2})
        self.assertEqual([item["branches"] for item in result["brands"]], [6, 3, 2],
                         'two Arabic brands of one registration stay apart')
        with self.assertRaises(ValueError):
            self.analytics.brands({"city": "Riyadh", "min_branches": 1})

    def test_uncovered_lists_populated_districts_no_large_chain_reached(self):
        population = {"العليا": {"population": 40000}, "الروضة": {"population": 30000}, "الصحافة": {"population": 20000}, "الملز": {"population": 900}}
        result = self.analytics.brands({"city": "Riyadh"}, population=population)
        self.assertEqual([row["district_ar"] for row in result["uncovered"]], ["الروضة", "الصحافة"])
        self.assertEqual(result["uncovered_by"], ["صيدلية النهدي", "صيدلية ليمون"])

    def test_profile_counts_every_branch_and_its_activities(self):
        keys = self.analytics.brands({"city": "Riyadh"})["brands"][0]["keys"]
        profile = self.analytics.brand_profile({"city": "Riyadh", "keys": keys})
        self.assertEqual((profile["branches"], profile["activities"][0]), (6, {"main_ar": "صيدليات", "n": 2}))
        self.assertEqual(profile["activity"], {"main_ar": "صيدليات", "classified": 3, "agree": 2},
                         'the chain takes the activity most of its branches carry; the cosmetics one is named apart')

    def test_a_district_name_or_a_name_fragment_is_no_brand(self):
        rows = [("p1", "العليا", "العليا", "العليا", None), ("p2", "الملقا", "العليا", "العليا", None),
                ("p3", "النرجس", "العليا", "العليا", None),
                ("q1", "العليا", "للملابس الجاهزة", "للملابس الجاهزه", None), ("q2", "الملقا", "للملابس الجاهزة", "للملابس الجاهزه", None),
                ("r1", "العليا", "صيدلية سيف", "صيدليه سيف", None), ("r2", "الملقا", "صيدلية سيف", "صيدليه سيف", None)]
        self.assertEqual([group["brand"] for group in market_analytics.group_chains(rows).values()], ["صيدلية سيف"])
        self.assertEqual(market_analytics.fold_key("الْمَلْقا - أ"), market_analytics.fold_key("الملقا ا"))

    def test_a_name_with_and_without_its_activity_word_is_one_brand(self):
        rows = [("n1", "العليا", "صيدلية النهدي", "صيدليه النهدي", "CR-N"), ("n2", "الملقا", "صيدلية النهدي", "صيدليه النهدي", "CR-N"),
                ("n3", "النرجس", "النهدي", "النهدي", None),
                ("n4", "العليا", "Nahdi", "nahdi", "CR-N"), ("n5", "الملقا", "Nahdi Pharmacy", "nahdi pharmacy", None),
                ("n6", "النرجس", "Al -Nahdi Medical Company Pharmacy", "al nahdi medical company pharmacy", None),
                ("w1", "العليا", "صيدلية الدواء, s", "صيدليه الدواء s", None), ("w2", "الملقا", "الدواء", "الدواء", None),
                ("t1", "العليا", "The", "the", None), ("t2", "الملقا", "The", "the", None)]
        groups = market_analytics.group_chains(rows)
        nahdi = groups["النهدي"]
        self.assertEqual((nahdi["brand"], len(nahdi["pois"])), ("صيدلية النهدي", 6), 'every spelling, in both scripts, is one chain')
        self.assertEqual(len(groups["الدواء"]["pois"]), 2, 'a stray trailing letter is not part of the name')
        self.assertEqual(sorted(groups), ["الدواء", "النهدي"], '«the» names no brand, and the Latin cores joined the Arabic one')
        rows = [("c1", "العليا", "عنوان القهوة", "عنوان القهوه", None), ("c2", "الملقا", "شركة عنوان القهوة للتجارة", "شركه عنوان القهوه للتجاره", None),
                ("k1", "العليا", "مغاسل", "مغاسل", None), ("k2", "الملقا", "بخاري", "بخاري", None), ("k3", "النرجس", "البخاري", "البخاري", None),
                ("k4", "العليا", "اسواق مركزية", "اسواق مركزيه", None), ("k5", "الملقا", "غسيل السيارات", "غسيل السيارات", None)]
        self.assertEqual({core: len(group["pois"]) for core, group in market_analytics.group_chains(rows).items()}, {"عنوان القهوه": 2},
                         'the company form is the same brand, and a kind of shop is no brand')

    def test_history_gives_growth_once_two_snapshots_exist(self):
        path = str(pathlib.Path(self.temp.name) / "chain_history.json")
        self.assertTrue(market_analytics.record_chain_history(self.analytics, path, today="2026-09-01"))
        self.assertFalse(market_analytics.record_chain_history(self.analytics, path), 'the same directory is not recorded twice')
        history = market_analytics.read_chain_history(path)
        history["snapshots"].append({"date": "2026-10-28", "cities": {"Riyadh": {"صيدليه النهدي": 9}}})
        growth = market_analytics.chain_growth(history, "Riyadh", ["صيدليه النهدي"])
        self.assertEqual(growth, {"since": "2026-09-01", "before": 4, "now": 9})

    def test_growth_waits_for_a_history_longer_than_a_rebuild(self):
        two_days = {"snapshots": [{"date": "2026-10-28", "cities": {"Riyadh": {"صيدليه النهدي": 400}}},
                                  {"date": "2026-10-30", "cities": {"Riyadh": {"صيدليه النهدي": 430}}}]}
        self.assertIsNone(market_analytics.chain_growth(two_days, "Riyadh", ["صيدليه النهدي"]), 'two days of rebuilds are not growth')
        undated = {"snapshots": [{"cities": {}}, {"date": "2026-12-01", "cities": {}}]}
        self.assertIsNone(market_analytics.chain_growth(undated, "Riyadh", ["صيدليه النهدي"]))


if __name__ == "__main__":
    unittest.main()
