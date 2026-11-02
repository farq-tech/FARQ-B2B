"""Unit tests for build_name_polish (pure functions, no parquet / duckdb)."""

import unittest

from build_name_polish import (
    cut_activity_tail,
    shorten_name,
    strip_leading_legal,
    strip_owner_triple,
    strip_trailing_adjectives,
    strip_trailing_phrases,
    TRAILING_LEGAL,
)


class LeadingLegalTests(unittest.TestCase):
    def test_drops_known_forms(self):
        self.assertEqual(strip_leading_legal("مؤسسة التخصص الراقي"), "التخصص الراقي")
        self.assertEqual(strip_leading_legal("شركة نسما التجارية"), "نسما التجارية")
        self.assertEqual(strip_leading_legal("مكتب الصقر للمحاماة"), "الصقر للمحاماة")

    def test_bare_form_becomes_none(self):
        self.assertIsNone(strip_leading_legal("مؤسسة"))
        self.assertIsNone(strip_leading_legal("مكتب"))


class TrailingTests(unittest.TestCase):
    def test_trailing_legal(self):
        self.assertEqual(
            strip_trailing_phrases("نسما التجارية المحدودة", TRAILING_LEGAL),
            "نسما التجارية",
        )
        self.assertEqual(
            strip_trailing_phrases("اساس الجود للمقاولات شركة شخص واحد", TRAILING_LEGAL),
            "اساس الجود للمقاولات",
        )

    def test_activity_tail_cut(self):
        self.assertEqual(cut_activity_tail("التخصص الراقي للتجارة"), "التخصص الراقي")
        self.assertEqual(
            cut_activity_tail("نبع الخبر للمقاولات العامة"), "نبع الخبر"
        )
        # No activity head -> unchanged.
        self.assertEqual(cut_activity_tail("جوهرة البلد"), "جوهرة البلد")
        # Never cuts the very first word away.
        self.assertEqual(cut_activity_tail("للتجارة"), "للتجارة")

    def test_trailing_adjectives(self):
        self.assertEqual(
            strip_trailing_adjectives("عبدالمحسن الشريف التجارية"),
            "عبدالمحسن الشريف",
        )
        self.assertEqual(
            strip_trailing_adjectives("منار التجارة والمقاولات"), "منار التجارة"
        )


class OwnerTripleTests(unittest.TestCase):
    def test_strips_owner_when_brand_follows(self):
        # Owner name followed by a real (non-generic) trade name -> owner dropped.
        self.assertEqual(
            strip_owner_triple("محمد علي السالم ركن الذواقة"), "ركن الذواقة"
        )

    def test_keeps_owner_only_name(self):
        # Owner-only name: nothing follows, so the owner name is kept as-is.
        self.assertEqual(
            strip_owner_triple("عبدالمحسن جابر الشريف"),
            "عبدالمحسن جابر الشريف",
        )

    def test_refuses_when_remainder_is_generic(self):
        # Owner followed only by a generic activity word -> not stripped.
        self.assertEqual(
            strip_owner_triple("محمد علي السالم مطعم"), "محمد علي السالم مطعم"
        )


class ShortenGuardTests(unittest.TestCase):
    def test_legal_shortening_keeps_retrievable_legal_name(self):
        legal = "مؤسسة التخصص الراقي للتجارة"
        short = shorten_name(legal)
        self.assertEqual(short, "التخصص الراقي")
        # The full legal form is unchanged and remains retrievable as name_ar_legal.
        self.assertNotEqual(short, legal)
        self.assertIn(short, legal)

    def test_long_company_with_full_boilerplate(self):
        self.assertEqual(
            shorten_name("شركة الوطنية للمقاولات العامة المحدودة"), "الوطنية"
        )

    def test_generic_only_strip_is_refused(self):
        # Stripping "مؤسسة ... للتجارة" would leave only "مطعم" (generic): refuse,
        # leaving the name unchanged (None = no delta row).
        self.assertIsNone(shorten_name("مؤسسة مطعم للتجارة"))
        # Bare generic word alone is never shortened.
        self.assertIsNone(shorten_name("مطعم"))
        self.assertIsNone(shorten_name("وكالة سفر"))

    def test_non_arabic_or_empty_unchanged(self):
        self.assertIsNone(shorten_name("DUNKIN"))
        self.assertIsNone(shorten_name(""))
        self.assertIsNone(shorten_name(None))

    def test_already_short_name_unchanged(self):
        self.assertIsNone(shorten_name("ستاربكس"))

    def test_owner_eponymous_name_preserved(self):
        # Legal + owner triple + suffix -> owner name kept (not a generic word).
        self.assertEqual(
            shorten_name("مؤسسة عبدالمحسن جابر الشريف التجارية"),
            "عبدالمحسن جابر الشريف",
        )


class BrandUnifyLogicTests(unittest.TestCase):
    """The brand-spelling unification is pure data (canonical per brand); verify
    the decision rule used in build_delta: a branch is unified iff its effective
    name differs from the canonical spelling."""

    @staticmethod
    def _unify(effective, canonical):
        return canonical if effective != canonical else None

    def test_unifies_divergent_spelling(self):
        self.assertEqual(self._unify("دانكن دونتس", "دانكن"), "دانكن")
        self.assertEqual(self._unify("داتكن دونتس", "دانكن"), "دانكن")

    def test_no_change_when_already_canonical(self):
        self.assertIsNone(self._unify("دانكن", "دانكن"))


if __name__ == "__main__":
    unittest.main()
