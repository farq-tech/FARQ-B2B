# -*- coding: utf-8 -*-
"""Unit tests for build_specialty_from_name (pure logic, no parquet / duckdb)."""

import os
import tempfile
import unittest

import build_specialty_from_name as bs


# A tiny in-sub lexicon modelled on the real specialties.csv shape. Keys are the
# canonical (folded + singularised) term_key, built via bs.term_key so the test
# map never drifts from the module's own normalisation.
#   personal.laundry: مغسلة is the sub's generic activity word (sub-default);
#   غسيل is a distinctive term; دراي كلين -> dry_cleaning.
#   food.grocery:    تموينات is the sub-default; خضار -> produce.
def _m(pairs):
    out = {}
    for term, spec in pairs:
        out.setdefault(bs.term_key(term), set()).add(spec)
    return out


SPEC_MAP = {
    "personal.laundry": _m([
        ("مغسلة", "personal.laundry.wash_iron"),
        ("غسيل", "personal.laundry.wash_iron"),
        ("دراي كلين", "personal.laundry.dry_cleaning"),
        ("سجاد", "personal.laundry.carpets_blankets"),
    ]),
    "food.grocery": _m([
        ("تموينات", "food.grocery.tamweenat"),
        ("خضار", "food.grocery.grocery_produce"),
        ("منظفات", "food.grocery.grocery_cleaning"),
    ]),
}
# personal.laundry's activity word is مغسلة; food.grocery's is تموينات.
DEFAULT_TERMS = {
    "personal.laundry": {bs.term_key("مغسلة")},
    "food.grocery": {bs.term_key("تموينات")},
}


class ClassifyTests(unittest.TestCase):
    def test_distinctive_term_classifies(self):
        spec, method = bs.classify("Dry Clean Express", "دراي كلين", "personal.laundry", SPEC_MAP, DEFAULT_TERMS)
        self.assertEqual(spec, "personal.laundry.dry_cleaning")
        self.assertEqual(method, "name_specialty")

    def test_sub_default_word_is_flagged(self):
        # Name is only the sub's activity noun -> assigned, but marked sub_default.
        spec, method = bs.classify(None, "مغسلة النور", "personal.laundry", SPEC_MAP, DEFAULT_TERMS)
        self.assertEqual(spec, "personal.laundry.wash_iron")
        self.assertEqual(method, "name_specialty_sub_default")

    def test_distinctive_overrides_default_method(self):
        # Matches مغسله (default) AND غسيل (distinctive) -> same specialty, method distinctive.
        spec, method = bs.classify("laundry", "مغسلة غسيل وكي", "personal.laundry", SPEC_MAP, DEFAULT_TERMS)
        self.assertEqual(spec, "personal.laundry.wash_iron")
        self.assertEqual(method, "name_specialty")

    def test_disagreeing_terms_yield_nothing(self):
        # دراي كلين + سجاد disagree -> never guess.
        spec, method = bs.classify(None, "دراي كلين وغسيل سجاد", "personal.laundry", SPEC_MAP, DEFAULT_TERMS)
        self.assertIsNone(spec)
        self.assertIsNone(method)

    def test_cross_sub_leakage_impossible(self):
        # تموينات belongs to food.grocery; a laundry POI named تموينات matches nothing.
        spec, _ = bs.classify(None, "تموينات", "personal.laundry", SPEC_MAP, DEFAULT_TERMS)
        self.assertIsNone(spec)

    def test_unknown_sub_yields_nothing(self):
        self.assertEqual(bs.classify("Anything", "اي شيء", "auto.unknownsub", SPEC_MAP), (None, None))

    def test_no_match_yields_nothing(self):
        self.assertEqual(bs.classify("Random Co", "شركة عشوائية", "food.grocery", SPEC_MAP, DEFAULT_TERMS), (None, None))

    def test_blank_names_yield_nothing(self):
        self.assertEqual(bs.classify(None, None, "food.grocery", SPEC_MAP), (None, None))
        self.assertEqual(bs.classify("", "", "food.grocery", SPEC_MAP), (None, None))

    def test_singular_plural_meet(self):
        # map has خضار; name says خضارات (folded+singularised back to خضار).
        spec, _ = bs.classify(None, "بقالة خضارات", "food.grocery", SPEC_MAP, DEFAULT_TERMS)
        self.assertEqual(spec, "food.grocery.grocery_produce")


class NormalisationTests(unittest.TestCase):
    def test_fold_alef_hamza_tamarbuta_tatweel(self):
        # أ/إ/آ -> ا ; ة -> ه ; tatweel removed ; punctuation -> space.
        self.assertEqual(bs._fold("أحمـــد، وآدم"), "احمد وادم")

    def test_singular_arabic_and_english(self):
        self.assertEqual(bs._singular("منظفات"), "منظف")
        self.assertEqual(bs._singular("cups"), "cup")
        self.assertEqual(bs._singular("مغسله"), "مغسل")

    def test_term_key_drops_generic_only(self):
        self.assertIsNone(bs.term_key("خدمات"))      # pure GENERIC
        self.assertIsNone(bs.term_key("services"))
        self.assertEqual(bs.term_key("خضار"), "خضار")

    def test_term_key_drops_blocklist_token(self):
        self.assertIsNone(bs.term_key("gas"))
        self.assertIsNone(bs.term_key("نجم"))
        # a blocklist token is only dropped as a *lone* term, not inside a phrase.
        self.assertEqual(bs.term_key("نجم الذهب"), "نجم الذهب")

    def test_term_key_keeps_valid_short_trade_words(self):
        # the whole point of the blocklist over min-length>=4.
        for w in ("عود", "ذهب", "شاي", "زيت", "شيش"):
            self.assertEqual(bs.term_key(w), w, w)


class LoadTests(unittest.TestCase):
    def _write_specialties(self, rows):
        fd, p = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("main_ar,sub_id,sub_ar,specialty_id,specialty_ar,specialty_en,match_terms\n")
            for r in rows:
                fh.write(",".join(r) + "\n")
        return p

    def test_load_specialties_scopes_by_sub_and_keeps_ambiguous_set(self):
        p = self._write_specialties([
            ("غذاء", "food.grocery", "بقالة وتموينات", "food.grocery.tamweenat", "تموينات", "Tamweenat", "تموينات|مواد"),
            ("غذاء", "food.grocery", "بقالة وتموينات", "food.grocery.produce", "خضار", "Produce", "خضار|تموينات"),
        ])
        try:
            sm = bs.load_specialties(p)
        finally:
            os.remove(p)
        # 'مواد' is GENERIC -> dropped. 'تموينات' (canonical key 'تموين') appears in
        # two specialties of the same sub -> kept as an ambiguous set (so it blocks
        # instead of guessing).
        self.assertEqual(sm["food.grocery"]["تموين"], {"food.grocery.tamweenat", "food.grocery.produce"})
        self.assertEqual(sm["food.grocery"]["خضار"], {"food.grocery.produce"})
        self.assertNotIn("مواد", sm["food.grocery"])

    def test_ambiguous_term_blocks_assignment(self):
        p = self._write_specialties([
            ("غذاء", "food.grocery", "بقالة", "food.grocery.tamweenat", "تموينات", "T", "تموينات"),
            ("غذاء", "food.grocery", "بقالة", "food.grocery.produce", "خضار", "P", "تموينات"),
        ])
        try:
            sm = bs.load_specialties(p)
        finally:
            os.remove(p)
        self.assertEqual(bs.classify(None, "تموينات", "food.grocery", sm), (None, None))

    def test_default_term_detection(self):
        p = self._write_specialties([
            ("شخصي", "personal.laundry", "مغسلة ملابس", "personal.laundry.wash_iron", "غسيل وكي", "Wash", "مغسلة|غسيل"),
            ("شخصي", "personal.laundry", "مغسلة ملابس", "personal.laundry.dry", "دراي كلين", "Dry", "دراي كلين"),
        ])
        try:
            sm = bs.load_specialties(p)
            labels = bs.load_sub_labels(p)
            dts = bs.default_term_keys(sm, labels)
        finally:
            os.remove(p)
        # مغسلة is a token of sub_ar "مغسلة ملابس" -> sub-default; غسيل / دراي كلين are not.
        self.assertIn("مغسل", dts["personal.laundry"])          # folded singular of مغسلة
        self.assertNotIn("غسيل", dts["personal.laundry"])
        flags = bs.sub_default_flags(sm, dts)
        self.assertEqual(flags, [("personal.laundry", "personal.laundry.wash_iron", ["مغسل"])])


if __name__ == "__main__":
    unittest.main()
