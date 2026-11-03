# -*- coding: utf-8 -*-
"""Unit tests for build_category_from_name (pure logic, no parquet / duckdb)."""

import os
import tempfile
import unittest

import build_category_from_name as bn


LEX = {
    "barber shop": "beauty.barber",
    "barbershop": "beauty.barber",
    "pharmacy": "health.pharmacy",
    "abaya": "fashion.abaya",
}


class ClassifyTests(unittest.TestCase):
    def test_single_term_classifies(self):
        self.assertEqual(bn.classify("Al Noor Pharmacy", None, LEX), "health.pharmacy")

    def test_arabic_name_side_is_scanned(self):
        # English empty, term present on the english side via a 2-gram.
        self.assertEqual(bn.classify("Modern Barber Shop", None, LEX), "beauty.barber")

    def test_agreeing_terms_ok(self):
        # Two terms, same sub -> fine.
        self.assertEqual(bn.classify("Barbershop Barber Shop", None, LEX), "beauty.barber")

    def test_disagreeing_terms_yield_none(self):
        # pharmacy + abaya disagree -> never guess.
        self.assertIsNone(bn.classify("Pharmacy & Abaya", None, LEX))

    def test_no_match_yields_none(self):
        self.assertIsNone(bn.classify("Zorg Holding", "مؤسسة زورج", LEX))

    def test_blank_yields_none(self):
        self.assertIsNone(bn.classify(None, None, LEX))
        self.assertIsNone(bn.classify("", "", LEX))

    def test_short_fragments_ignored(self):
        # 'abc' (<4) never matches even if present.
        self.assertIsNone(bn.classify("abc", None, {"abc": "x.y"}))


class LoadLexiconTests(unittest.TestCase):
    def _write(self, rows):
        fd, p = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("term,sub_id,share,support,sources\n")
            for r in rows:
                fh.write(",".join(r) + "\n")
        return p

    def test_filters_low_confidence_and_short(self):
        p = self._write([
            ("barber shop", "beauty.barber", "1.0", "9", "m"),   # keep
            ("cheap", "x.y", "0.3", "9", "m"),                   # low share -> drop
            ("rare", "x.y", "1.0", "2", "m"),                    # low support -> drop
            ("ab", "x.y", "1.0", "9", "m"),                      # too short -> drop
        ])
        try:
            lex = bn.load_lexicon(p)
        finally:
            os.remove(p)
        self.assertEqual(lex, {"barber shop": "beauty.barber"})

    def test_ambiguous_term_dropped(self):
        p = self._write([
            ("center", "a.b", "1.0", "9", "m"),
            ("center", "c.d", "1.0", "9", "m"),   # same term, two subs -> dropped
            ("pharmacy", "health.pharmacy", "0.9", "20", "m"),
        ])
        try:
            lex = bn.load_lexicon(p)
        finally:
            os.remove(p)
        self.assertEqual(lex, {"pharmacy": "health.pharmacy"})


if __name__ == "__main__":
    unittest.main()
