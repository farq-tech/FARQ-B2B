# -*- coding: utf-8 -*-
"""Unit tests for build_category_from_urbi (pure logic, no parquet / duckdb)."""

import csv
import os
import unittest

import build_category_from_urbi as bu


# A tiny curated map in the same key space load_map produces (lower, whole label).
CAT_MAP = {
    "car service / garages": "auto.workshop",
    "cafe / restaurants": "food.cafe",
    "grocery stores / supermarkets": "food.grocery",
}


class MapKeyTests(unittest.TestCase):
    def test_whole_label_not_split_on_slash(self):
        # The slash is part of the Urbi label, NOT a delimiter.
        self.assertEqual(bu.map_key("Cafe / Restaurants"), "cafe / restaurants")
        self.assertEqual(bu.map_key("  Grocery stores /  Supermarkets "),
                         "grocery stores / supermarkets")

    def test_blank_is_none(self):
        self.assertIsNone(bu.map_key(""))
        self.assertIsNone(bu.map_key(None))
        self.assertIsNone(bu.map_key("   "))


class WeakGuardTests(unittest.TestCase):
    def test_low_confidence_is_weak(self):
        self.assertTrue(bu.is_weak_category("low", "food.restaurant"))

    def test_uncertain_main_is_weak(self):
        self.assertTrue(bu.is_weak_category("high", "unc.company_general"))

    def test_generic_bucket_is_weak(self):
        self.assertTrue(bu.is_weak_category("medium", "home.home_goods_general"))

    def test_confident_specific_is_not_weak(self):
        self.assertFalse(bu.is_weak_category("high", "food.restaurant"))
        self.assertFalse(bu.is_weak_category("medium", "auto.workshop"))


class DecideTests(unittest.TestCase):
    def test_known_urbi_category_maps_to_sub_id(self):
        sub, src = bu.decide(
            urbi_category_en="Car service / garages",
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertEqual(sub, "auto.workshop")
        self.assertEqual(src, "urbi_category_en")

    def test_case_and_whitespace_insensitive(self):
        sub, src = bu.decide(
            urbi_category_en="  cafe /  restaurants ",
            cls_confidence="low",
            sub_id="unc.unknown",
            cat_map=CAT_MAP,
        )
        self.assertEqual(sub, "food.cafe")
        self.assertEqual(src, "urbi_category_en")

    def test_already_categorized_poi_is_not_overridden(self):
        # Confident, specific category -> no proposal even though the map knows it.
        sub, src = bu.decide(
            urbi_category_en="Car service / garages",
            cls_confidence="high",
            sub_id="auto.dealership",
            cat_map=CAT_MAP,
        )
        self.assertIsNone(sub)
        self.assertIsNone(src)

    def test_unmapped_urbi_category_yields_nothing(self):
        sub, src = bu.decide(
            urbi_category_en="Interplanetary teleport hub",
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertIsNone(sub)
        self.assertIsNone(src)

    def test_blank_urbi_category_yields_nothing(self):
        sub, src = bu.decide(
            urbi_category_en=None,
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertIsNone(sub)
        self.assertIsNone(src)


class LoadMapTests(unittest.TestCase):
    def test_dedupes_and_normalises(self):
        import tempfile

        fd, path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("category_en,farq_sub_id\n")
            fh.write("Bakery,food.bakery\n")
            fh.write("Bakery,food.bakery\n")          # exact duplicate
            fh.write("Barbershops,beauty.barber\n")
            fh.write(",skip.me\n")                      # blank key -> skipped
        try:
            m = bu.load_map(path)
        finally:
            os.remove(path)
        self.assertEqual(m, {"bakery": "food.bakery", "barbershops": "beauty.barber"})


class ShippedMapIntegrityTests(unittest.TestCase):
    """The curated map that ships in reference/ must stay clean."""

    MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "reference", "urbi_category_map.csv")

    def test_map_file_exists_and_nonempty(self):
        self.assertTrue(os.path.isfile(self.MAP_PATH))
        m = bu.load_map(self.MAP_PATH)
        self.assertGreater(len(m), 100)

    def test_no_duplicate_keys_in_shipped_map(self):
        keys = []
        with open(self.MAP_PATH, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                k = bu.map_key(row.get("category_en"))
                if k:
                    keys.append(k)
        self.assertEqual(len(keys), len(set(keys)),
                         "duplicate category_en keys in shipped map")

    def test_every_target_looks_like_a_sub_id(self):
        # Shape check (main.sub, lowercase) — full taxonomy validation runs in
        # the __main__ fail-closed guard against farq_taxonomy.json.
        import re
        m = bu.load_map(self.MAP_PATH)
        for sub in m.values():
            self.assertRegex(sub, r"^[a-z]+\.[a-z0-9_]+$", f"bad sub_id shape: {sub}")


if __name__ == "__main__":
    unittest.main()
