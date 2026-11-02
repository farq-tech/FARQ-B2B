# -*- coding: utf-8 -*-
"""Unit tests for build_street_ar.norm_key (pure logic, no parquet / duckdb)."""

import unittest

import build_street_ar as bs


class NormKeyTests(unittest.TestCase):
    def test_abd_split_folds(self):
        # عبد العزيز and عبدالعزيز are the same name.
        self.assertEqual(bs.norm_key("طريق الملك عبد العزيز"),
                         bs.norm_key("طريق الملك عبدالعزيز"))

    def test_hamza_alef_folds(self):
        self.assertEqual(bs.norm_key("طريق الأمير سلطان"),
                         bs.norm_key("طريق الامير سلطان"))

    def test_ta_marbuta_folds(self):
        self.assertEqual(bs.norm_key("طريق المدينة المنورة"),
                         bs.norm_key("طريق المدينه المنوره"))

    def test_whitespace_collapses(self):
        self.assertEqual(bs.norm_key("شارع   العليا  "), bs.norm_key("شارع العليا"))

    def test_tatweel_stripped(self):
        self.assertEqual(bs.norm_key("شارع العـليا"), bs.norm_key("شارع العليا"))

    def test_road_type_is_preserved(self):
        # شارع X and طريق X are DIFFERENT roads -> different keys.
        self.assertNotEqual(bs.norm_key("شارع الملك خالد"),
                            bs.norm_key("طريق الملك خالد"))

    def test_distinct_names_stay_distinct(self):
        self.assertNotEqual(bs.norm_key("شارع العليا"), bs.norm_key("شارع حراء"))

    def test_blank_is_none(self):
        self.assertIsNone(bs.norm_key(""))
        self.assertIsNone(bs.norm_key(None))
        self.assertIsNone(bs.norm_key("   "))


if __name__ == "__main__":
    unittest.main()
