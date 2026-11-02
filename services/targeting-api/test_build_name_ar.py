"""Unit tests for build_name_ar (the name_ar fill logic)."""

import unittest

from build_name_ar import (
    has_arabic,
    normalize_ws,
    is_junk_latin,
    strip_legal_prefix,
    is_generic_arabic,
    clean_arabic_candidate,
    pick_name_ar,
    BRAND_MAP,
)


class HelperTests(unittest.TestCase):
    def test_has_arabic(self):
        self.assertTrue(has_arabic("مطعم البيك"))
        self.assertFalse(has_arabic("Max Fashion"))
        self.assertFalse(has_arabic(""))
        self.assertFalse(has_arabic(None))

    def test_normalize_ws(self):
        self.assertEqual(normalize_ws("  مطعم   البيك "), "مطعم البيك")
        self.assertIsNone(normalize_ws("   "))
        self.assertIsNone(normalize_ws(None))

    def test_is_junk_latin(self):
        for junk in ["No Information", "approved", "50.0", "1", "- 2", "x",
                     "Grocery", "Coffee shop", None, ""]:
            self.assertTrue(is_junk_latin(junk), junk)
        for real in ["Max Fashion", "Domino's Pizza", "Rivers World"]:
            self.assertFalse(is_junk_latin(real), real)

    def test_strip_legal_prefix(self):
        self.assertEqual(
            strip_legal_prefix("مؤسسة فردية صالون كوكوكت للتزيين النسائي"),
            "صالون كوكوكت للتزيين النسائي",
        )
        self.assertEqual(
            strip_legal_prefix("ذ.م.م. مؤسسة إيلف للتجارة"),
            "إيلف للتجارة",
        )
        # nothing to strip
        self.assertEqual(strip_legal_prefix("باب الخير للهدايا"), "باب الخير للهدايا")
        # only a legal form -> empty
        self.assertIsNone(strip_legal_prefix("مؤسسة"))

    def test_is_generic_arabic(self):
        self.assertTrue(is_generic_arabic("مطعم"))
        self.assertTrue(is_generic_arabic("وكالة سفر"))
        self.assertTrue(is_generic_arabic("مؤسسة"))
        self.assertFalse(is_generic_arabic("مطعم البيك"))
        self.assertFalse(is_generic_arabic("بقالة يزن للتسويق"))

    def test_clean_arabic_candidate(self):
        self.assertEqual(
            clean_arabic_candidate("مؤسسة فردية مؤسسة محمد سليمان المغربي للتجارة"),
            "محمد سليمان المغربي للتجارة",
        )
        self.assertIsNone(clean_arabic_candidate("Elf Trading Company"))  # not Arabic
        self.assertIsNone(clean_arabic_candidate("مطعم"))  # generic only
        self.assertIsNone(clean_arabic_candidate(None))
        # Arabic legal prefix + English trade name -> English remainder rejected.
        self.assertIsNone(
            clean_arabic_candidate("مؤسسة فردية Tahani Osery oil change workshop"))


class PickNameArTests(unittest.TestCase):
    def _row(self, **kw):
        base = dict(name_ar=None, name_en=None, brand_name_ar=None,
                    source_license_name=None, urbi_legal_name_ar=None,
                    legal_name=None)
        base.update(kw)
        return base

    def test_keeps_good_existing_arabic(self):
        fill, src = pick_name_ar(self._row(
            name_ar="مطعم البيك", source_license_name="شيء آخر تماما"))
        self.assertIsNone(fill)
        self.assertIsNone(src)

    def test_fills_null_from_license(self):
        fill, src = pick_name_ar(self._row(
            name_ar=None, source_license_name="باب الخير للهدايا"))
        self.assertEqual(fill, "باب الخير للهدايا")
        self.assertEqual(src, "source_license_name")

    def test_brand_name_ar_wins_over_license(self):
        fill, src = pick_name_ar(self._row(
            name_ar=None, brand_name_ar="هرفي",
            source_license_name="شركة الأغذية الممتازة"))
        self.assertEqual(fill, "هرفي")
        self.assertEqual(src, "brand_name_ar")

    def test_urbi_legal_name_prefix_stripped(self):
        fill, src = pick_name_ar(self._row(
            name_ar=None,
            urbi_legal_name_ar="مؤسسة فردية صالون كوكوكت للتزيين النسائي"))
        self.assertEqual(fill, "صالون كوكوكت للتزيين النسائي")
        self.assertEqual(src, "urbi_legal_name_ar")

    def test_replaces_junk_latin(self):
        fill, src = pick_name_ar(self._row(
            name_ar="Grocery", source_license_name="بقالة يزن للتسويق"))
        self.assertEqual(fill, "بقالة يزن للتسويق")
        self.assertEqual(src, "source_license_name")

    def test_replaces_generic_arabic(self):
        fill, src = pick_name_ar(self._row(
            name_ar="مطعم", source_license_name="مطعم نجمة الشام"))
        self.assertEqual(fill, "مطعم نجمة الشام")
        self.assertEqual(src, "source_license_name")

    def test_brand_map_used_for_latin_brand(self):
        fill, src = pick_name_ar(self._row(name_ar="STC"))
        self.assertEqual(fill, BRAND_MAP["stc"])
        self.assertEqual(src, "brand_map")

    def test_brand_map_from_name_en_when_null(self):
        fill, src = pick_name_ar(self._row(name_ar=None, name_en="KFC"))
        self.assertEqual(fill, BRAND_MAP["kfc"])
        self.assertEqual(src, "brand_map")

    def test_no_fill_for_real_latin_without_source(self):
        # A genuine English name with no Arabic source and no brand-map entry is
        # left untouched (we never invent / free-form transliterate).
        fill, src = pick_name_ar(self._row(name_ar="Max Fashion", name_en="Max Fashion"))
        self.assertIsNone(fill)
        self.assertIsNone(src)

    def test_never_writes_generic_from_source(self):
        # Source is only a generic activity word -> rejected, no fill.
        fill, src = pick_name_ar(self._row(
            name_ar=None, source_license_name="مطعم",
            urbi_legal_name_ar="مؤسسة"))
        self.assertIsNone(fill)
        self.assertIsNone(src)

    def test_does_not_repeat_identical_value(self):
        fill, src = pick_name_ar(self._row(
            name_ar="مطعم", source_license_name="مطعم"))
        self.assertIsNone(fill)
        self.assertIsNone(src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
