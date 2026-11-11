"""The specialty is the unit of every pick and every figure (owner 2026-11-11): market-activities lists subcategories and
populated specialties, never a main activity, and each entry's `query` returns the same count everywhere."""
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


def _sub(main_id, main_ar, sub_ar):
    return {"main_id": main_id, "main_ar": main_ar, "sub_ar": sub_ar}


class FakeTaxonomy:
    subs = {
        "food.restaurant": _sub("food", "أغذية ومشروبات", "مطعم"),
        "food.fast_food": _sub("food", "أغذية ومشروبات", "وجبات سريعة"),
        "personal.laundry": _sub("personal", "خدمات شخصية", "مغسلة ملابس"),
        "auto.car_wash": _sub("auto", "سيارات ومركبات", "مغسلة سيارات"),
        "health.pharmacy": _sub("health", "صحة وطب", "صيدلية"),
        "unc.unknown": _sub("unc", "غير مصنّف", "غير مصنّف"),
        "noncom.mosque": _sub("noncom", "غير تجاري", "مسجد"),
    }
    specs = {
        "food.restaurant.burger": {"sub_id": "food.restaurant", "specialty_ar": "برجر"},
        "food.fast_food.burger": {"sub_id": "food.fast_food", "specialty_ar": "برجر"},
        "food.fast_food.pizza": {"sub_id": "food.fast_food", "specialty_ar": "بيتزا"},
        "food.fast_food.kebda": {"sub_id": "food.fast_food", "specialty_ar": "كبدة"},   # no business carries it
        "personal.laundry.self_service": {"sub_id": "personal.laundry", "specialty_ar": "مغسلة خدمة ذاتية"},
        "auto.car_wash.self_service": {"sub_id": "auto.car_wash", "specialty_ar": "مغسلة خدمة ذاتية"},
    }


# poi_key, city, name, district, specialty_ids, (sub_id, confidence) or None
ROWS = [
    ("r1", "Riyadh", "برجر الحي", "حي النخيل", "food.restaurant.burger", ("food.restaurant", "high")),
    ("r2", "Riyadh", "برجر سريع", "حي النخيل", "food.fast_food.burger", ("food.fast_food", "medium")),
    ("r3", "Riyadh", "برجر وبيتزا", "حي الياسمين", "food.fast_food.burger|food.fast_food.pizza", ("food.fast_food", "high")),
    ("r4", "Riyadh", "مطعم بلا تخصص", "حي الياسمين", "", ("food.restaurant", "high")),
    ("r5", "Riyadh", "مغسلة ذاتية", "حي النخيل", "personal.laundry.self_service", ("personal.laundry", "high")),
    ("r6", "Riyadh", "غسيل سيارات ذاتي", "حي النخيل", "auto.car_wash.self_service", ("auto.car_wash", "high")),
    ("r7", "Riyadh", "صيدلية ضعيفة", "حي النخيل", "", ("health.pharmacy", "low")),     # low confidence is not counted
    ("r8", "Riyadh", "مجهول", "حي النخيل", "", ("unc.unknown", "high")),
    ("r9", "Jeddah", "برجر جدة", "حي الروضة", "food.fast_food.burger", ("food.fast_food", "high")),   # another city
    ("r10", "Riyadh", None, "حي النخيل", "food.fast_food.pizza", ("food.fast_food", "high")),         # no name
]


class MarketActivitiesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.originals = (market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY)
        targets, taxonomy = root / "targets.parquet", root / "poi_taxonomy.parquet"
        db = duckdb.connect()
        db.execute("""create table t(poi_key varchar, city_en varchar, name_ar varchar, name_en varchar, has_whatsapp boolean,
                      phone_norm varchar, is_wholesale boolean, district_ar varchar, district_reliable boolean,
                      location_precision varchar, longitude double, latitude double, commercial_license varchar,
                      specialty_ids varchar)""")
        db.executemany("insert into t values (?, ?, ?, null, false, null, false, ?, true, 'point', 46.6, 24.7, '', ?)",
                       [(key, city, name, district, specs) for key, city, name, district, specs, _ in ROWS])
        db.execute("copy t to ? (format parquet)", [str(targets)])
        db.execute("create table c(poi_key varchar, confidence varchar, sub_id varchar)")
        db.executemany("insert into c values (?, ?, ?)", [(key, cls[1], cls[0]) for key, *_, cls in ROWS if cls])
        db.execute("copy c to ? (format parquet)", [str(taxonomy)])
        db.close()
        market_analytics.DATA = str(targets)
        market_analytics.POI_TAXONOMY = str(taxonomy)
        market_analytics.STREET_DENSITY = str(root / "missing.parquet")
        self.db = duckdb.connect()
        tiles = type("Tiles", (), {})()
        tiles.db, tiles.lock, tiles.search_sql = self.db, threading.RLock(), "true"
        self.analytics = MarketAnalytics(tiles)
        self.analytics._taxonomy = FakeTaxonomy()

    def tearDown(self):
        self.db.close()
        market_analytics.DATA, market_analytics.POI_TAXONOMY, market_analytics.STREET_DENSITY = self.originals
        self.temp.cleanup()

    def by_name(self):
        result = self.analytics.activities({"city": "Riyadh"})
        self.assertTrue(result["available"])
        return {(row["name_ar"], row["parent_ar"]): row for row in result["activities"]}

    def test_lists_subcategories_and_populated_specialties_never_a_main_activity(self):
        rows = self.by_name()
        kinds = {row["kind"] for row in rows.values()}
        self.assertEqual(kinds, {"sub", "specialty"})
        names = {name for name, _ in rows}
        for main in ("أغذية ومشروبات", "خدمات شخصية", "سيارات ومركبات", "صحة وطب"):
            self.assertNotIn(main, names, "a main activity is a heading, not a pick")
        self.assertNotIn("غير مصنّف", names)
        self.assertNotIn("مسجد", names)
        self.assertNotIn("كبدة", names, "a specialty with no business here is not listed")

    def test_counts_follow_the_served_classification(self):
        rows = self.by_name()
        self.assertEqual(rows[("مطعم", "أغذية ومشروبات")]["n"], 2)
        self.assertEqual(rows[("وجبات سريعة", "أغذية ومشروبات")]["n"], 2)   # Jeddah and the nameless row are out
        self.assertEqual(rows[("صيدلية", "صحة وطب")]["n"], 0)              # a low-confidence row does not count

    def test_one_specialty_name_under_one_main_is_one_entry(self):
        rows = self.by_name()
        burger = rows[("برجر", "مطعم، وجبات سريعة")]
        self.assertEqual(burger["n"], 3)
        self.assertEqual(burger["query"], {"specialty_ids": ["food.fast_food.burger", "food.restaurant.burger"]})
        self.assertEqual(burger["main_ar"], "أغذية ومشروبات")

    def test_same_name_under_different_mains_stays_apart(self):
        rows = self.by_name()
        self.assertEqual(rows[("مغسلة خدمة ذاتية", "مغسلة ملابس")]["n"], 1)
        self.assertEqual(rows[("مغسلة خدمة ذاتية", "مغسلة سيارات")]["n"], 1)

    def test_every_entry_query_returns_its_own_count_everywhere(self):
        for row in self.analytics.activities({"city": "Riyadh"})["activities"]:
            body = {"city": "Riyadh", **row["query"]}
            counted = self.analytics.district_counts(body)
            self.assertEqual(counted["total"], row["n"], row["name_ar"])
            self.assertEqual(sum(d["n"] for d in counted["districts"]), row["n"], row["name_ar"])
            self.assertEqual(self.analytics.market_summary(body)["summary"]["total"], row["n"], row["name_ar"])

    def test_sorted_largest_first(self):
        counts = [row["n"] for row in self.analytics.activities({"city": "Riyadh"})["activities"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_city_is_required(self):
        with self.assertRaises(ValueError):
            self.analytics.activities({})

    def test_without_taxonomy_nothing_is_offered(self):
        self.analytics._taxonomy = None
        self.analytics._tx = lambda: None
        self.assertEqual(self.analytics.activities({"city": "Riyadh"})["activities"], [])


if __name__ == "__main__":
    unittest.main()
