# -*- coding: utf-8 -*-
"""Unit tests for build_name_en.normalize (pure logic, no parquet / duckdb)."""

import unittest

import build_name_en as bn


class NormalizeTests(unittest.TestCase):
    def test_trims_and_collapses_whitespace(self):
        self.assertEqual(bn.normalize("  Nahdi   Pharmacy "), "Nahdi Pharmacy")

    def test_case_is_preserved(self):
        # Never title-case: brands/acronyms must survive verbatim.
        self.assertEqual(bn.normalize("McDonald's"), "McDonald's")
        self.assertEqual(bn.normalize("iPhone Store"), "iPhone Store")
        self.assertEqual(bn.normalize("barber shop"), "barber shop")

    def test_placeholder_becomes_none(self):
        for p in ["No Information", "n/a", "N/A", "-", ".", "unknown", "TEST", "غير متاح"]:
            self.assertIsNone(bn.normalize(p), p)

    def test_generic_noun_is_kept(self):
        # Weak but real — not a placeholder.
        self.assertEqual(bn.normalize("Shop"), "Shop")
        self.assertEqual(bn.normalize("Laundry"), "Laundry")

    def test_blank_is_none(self):
        self.assertIsNone(bn.normalize(""))
        self.assertIsNone(bn.normalize("   "))
        self.assertIsNone(bn.normalize(None))

    def test_arabic_in_name_en_is_left_as_is(self):
        self.assertEqual(bn.normalize("شبرا"), "شبرا")


class ChangedTests(unittest.TestCase):
    def test_changed_true_for_whitespace(self):
        self.assertTrue(bn.changed("  x  y "))

    def test_changed_true_for_placeholder(self):
        self.assertTrue(bn.changed("No Information"))

    def test_changed_false_for_clean_value(self):
        self.assertFalse(bn.changed("Starbucks"))

    def test_changed_false_for_none(self):
        self.assertFalse(bn.changed(None))


if __name__ == "__main__":
    unittest.main()
