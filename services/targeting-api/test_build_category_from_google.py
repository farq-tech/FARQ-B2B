# -*- coding: utf-8 -*-
"""Unit tests for build_category_from_google (pure logic, no parquet / duckdb)."""

import unittest

import build_category_from_google as bg


# A tiny curated map in the same key space load_map produces (lower, first token).
CAT_MAP = {
    "atm": "ATMs",
    "tire shop": "Tire Shop",
    "seafood restaurant": "Seafood Restaurant",
}


class MapKeyTests(unittest.TestCase):
    def test_first_token_and_fold(self):
        self.assertEqual(bg.map_key("Seafood restaurant|Restaurant"), "seafood restaurant")
        self.assertEqual(bg.map_key("  Tire Shop "), "tire shop")

    def test_blank_is_none(self):
        self.assertIsNone(bg.map_key(""))
        self.assertIsNone(bg.map_key(None))
        self.assertIsNone(bg.map_key("|Restaurant"))


class WeakGuardTests(unittest.TestCase):
    def test_low_confidence_is_weak(self):
        self.assertTrue(bg.is_weak_category("low", "food.restaurant"))

    def test_uncertain_main_is_weak(self):
        self.assertTrue(bg.is_weak_category("high", "unc.company_general"))

    def test_generic_bucket_is_weak(self):
        self.assertTrue(bg.is_weak_category("medium", "home.home_goods_general"))

    def test_confident_specific_is_not_weak(self):
        self.assertFalse(bg.is_weak_category("high", "food.restaurant"))
        self.assertFalse(bg.is_weak_category("medium", "auto.workshop"))


class DecideTests(unittest.TestCase):
    def test_known_google_category_maps_to_subcategory(self):
        # Weak POI + a Google category the map knows -> gains the subcategory.
        sub, src = bg.decide(
            google_category="ATM",
            google_categories="ATM",
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertEqual(sub, "ATMs")
        self.assertEqual(src, "google_category")

    def test_pipe_delimited_first_token_maps(self):
        sub, src = bg.decide(
            google_category="Seafood restaurant|Restaurant",
            google_categories=None,
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertEqual(sub, "Seafood Restaurant")
        self.assertEqual(src, "google_category")

    def test_fallback_to_google_categories_first(self):
        # Primary unknown/blank, fallback google_categories resolves.
        sub, src = bg.decide(
            google_category="",
            google_categories="Tire shop",
            cls_confidence="low",
            sub_id="auto.workshop_general",
            cat_map=CAT_MAP,
        )
        self.assertEqual(sub, "Tire Shop")
        self.assertEqual(src, "google_categories_first")

    def test_already_categorized_poi_is_not_overridden(self):
        # Confident, specific category -> no proposal even though the map knows "ATM".
        sub, src = bg.decide(
            google_category="ATM",
            google_categories="ATM",
            cls_confidence="high",
            sub_id="fin.bank",
            cat_map=CAT_MAP,
        )
        self.assertIsNone(sub)
        self.assertIsNone(src)

    def test_unmapped_google_category_yields_nothing(self):
        # Weak POI but the Google category is unknown to the curated map.
        sub, src = bg.decide(
            google_category="Interplanetary teleport hub",
            google_categories="Interplanetary teleport hub",
            cls_confidence="low",
            sub_id="unc.company_general",
            cat_map=CAT_MAP,
        )
        self.assertIsNone(sub)
        self.assertIsNone(src)


class LoadMapTests(unittest.TestCase):
    def test_dedupes_and_normalises(self):
        import os
        import tempfile

        fd, path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("category_en,farq_subcategory\n")
            fh.write("Bakery,Bakeries\n")
            fh.write("Bakery,Bakeries\n")          # exact duplicate
            fh.write("ATM,ATMs\n")
            fh.write(",ShouldSkip\n")               # blank key -> skipped
        try:
            m = bg.load_map(path)
        finally:
            os.remove(path)
        self.assertEqual(m, {"bakery": "Bakeries", "atm": "ATMs"})


if __name__ == "__main__":
    unittest.main()
